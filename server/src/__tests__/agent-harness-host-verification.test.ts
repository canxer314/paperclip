import { beforeEach, describe, expect, it, vi } from "vitest";
import { agents, companies, companyClaudeHostAccess } from "@paperclipai/db";

const fixture = vi.hoisted(() => ({
  test: vi.fn(), router: vi.fn(), managed: vi.fn(), release: vi.fn(),
  resolveConfig: vi.fn(async (_company: string, config: unknown) => ({ config })),
  resolveEnv: vi.fn(async () => ({ env: { HTTPS_PROXY: "http://proxy.invalid" } })),
  environment: vi.fn(async () => ({ driver: "local", envVars: { HTTPS_PROXY: { type: "plain", value: "http://proxy.invalid" } } })),
}));
vi.mock("../adapters/index.js", () => ({ requireServerAdapter: () => ({ testEnvironment: fixture.test }) }));
vi.mock("../services/ai-connection-router.js", () => ({ aiConnectionRouterService: () => ({ resolve: fixture.router }) }));
vi.mock("../services/ai-connection-runtime.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/ai-connection-runtime.js")>(), withManagedAiProbe: fixture.managed,
}));
vi.mock("../services/secrets.js", () => ({ secretService: () => ({ resolveAdapterConfigForRuntime: fixture.resolveConfig, resolveEnvBindings: fixture.resolveEnv }) }));
vi.mock("../services/environments.js", () => ({ environmentService: () => ({ getById: fixture.environment, listBoundCompanyIds: async () => [] }) }));
vi.mock("../services/instance-settings.js", () => ({ instanceSettingsService: () => ({
  get: async () => ({ defaultEnvironmentId: null }), getExperimental: async () => ({ enableManagedSandboxOnly: false }),
}) }));

import { agentHarnessVerificationService } from "../services/agent-harness-verification.js";

describe("host harness lifecycle verification", () => {
  const initialAgent = {
    id: "agent-1", companyId: "company-1", lifecycleVersion: 1, adapterType: "claude_local",
    adapterConfig: { configurationSource: "host", cwd: "/work", env: { ANTHROPIC_API_KEY: "saved-key" } },
    runtimeConfig: { aiConnection: { mode: "router", connectionId: "missing-pool" } },
    lifecycleOperation: { id: "operation-1", responsibleUserId: "user-1" }, defaultEnvironmentId: null,
  };
  let agent = structuredClone(initialAgent);
  const permission = vi.fn<() => Promise<Array<{ enabled: boolean }>>>(async () => [{ enabled: true }]);
  const db = { select: () => ({ from: (table: unknown) => ({ where: () => {
    if (table === agents) return Promise.resolve([agent]);
    if (table === companies) return Promise.resolve([{ defaultResponsibleUserId: "user-1" }]);
    if (table === companyClaudeHostAccess) return permission();
    throw new Error("Unexpected database read");
  } }) }) };
  beforeEach(() => {
    vi.clearAllMocks(); agent = structuredClone(initialAgent); permission.mockResolvedValue([{ enabled: true }]);
    fixture.resolveConfig.mockImplementation(async (_company: string, config: unknown) => ({ config }));
    fixture.test.mockResolvedValue({
      adapterType: "claude_local", purpose: "local-check", outcome: "passed", status: "warn",
      localPrerequisites: "passed", configurationReproducibility: "unverifiable", modelResponse: "not_tested",
      checks: [], testedAt: new Date().toISOString(),
    });
  });

  it("completes from local prerequisites and prepares cwd without selecting the inactive pool", async () => {
    const verification = agentHarnessVerificationService(db as never, {} as never);
    await expect(verification.verify(agent as never)).resolves.toBe("complete");
    expect(permission).toHaveBeenCalledTimes(2);
    expect(fixture.router).not.toHaveBeenCalled();
    expect(fixture.managed).not.toHaveBeenCalled();
    expect(fixture.test).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "local-check", directoryPreparation: "create", config: agent.adapterConfig,
    }));
  });

  it.each(["failed", "unverifiable"])("cannot complete when local prerequisites are %s, even with legacy pass", async localPrerequisites => {
    fixture.test.mockResolvedValue({ purpose: "local-check", outcome: localPrerequisites, localPrerequisites,
      status: "pass", checks: [{ level: "info", code: "claude_hello_probe_passed" }] });
    await expect(agentHarnessVerificationService(db as never, {} as never).verify(agent as never)).rejects.toThrow("The harness test failed");
  });

  it("does not trust a generic adapter success as a local proof", async () => {
    fixture.test.mockResolvedValue({ status: "pass", checks: [] });
    await expect(agentHarnessVerificationService(db as never, {} as never).verify(agent as never)).rejects.toThrow("The harness test failed");
  });

  it("rechecks permission during each automatic verification retry", async () => {
    permission.mockResolvedValueOnce([{ enabled: true }]).mockResolvedValueOnce([{ enabled: false }]);
    const verification = agentHarnessVerificationService(db as never, {} as never);
    await expect(verification.verify(agent as never)).rejects.toMatchObject({ status: 403, details: { code: "claude_host_access_denied" } });
    expect(fixture.test).not.toHaveBeenCalled();
    permission.mockResolvedValue([{ enabled: true }]);
    await expect(verification.verify(agent as never)).resolves.toBe("complete");
    expect(fixture.test).toHaveBeenCalledTimes(1);
  });

  it("propagates permission query failures without performing a probe", async () => {
    permission.mockRejectedValueOnce(new Error("permission query failed"));
    await expect(agentHarnessVerificationService(db as never, {} as never).verify(agent as never)).rejects.toThrow("permission query failed");
    expect(fixture.resolveConfig).not.toHaveBeenCalled(); expect(fixture.test).not.toHaveBeenCalled();
  });

  it("does not ignore an invalid active env reference in favor of host credentials", async () => {
    fixture.resolveConfig.mockRejectedValueOnce(new Error("Active secret unavailable"));
    await expect(agentHarnessVerificationService(db as never, {} as never).verify(agent as never)).rejects.toThrow("Active secret unavailable");
    expect(fixture.test).not.toHaveBeenCalled(); expect(fixture.managed).not.toHaveBeenCalled();
  });
});
