// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "./ui/tooltip";
import { ONBOARDING_STORAGE_KEY, OnboardingWizard } from "./OnboardingWizard";
import { OnboardingWizardVariant } from "./OnboardingWizardVariant";

const state = vi.hoisted(() => ({
  pathname: "/PC1/onboarding",
  open: false,
  navigate: vi.fn(),
  close: vi.fn(),
  dismiss: vi.fn(),
  selectCompany: vi.fn(),
}));
vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: state.pathname }),
  useNavigate: () => state.navigate,
  useParams: () => ({}),
}));
vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({
    onboardingOpen: state.open,
    onboardingOptions: {},
    onboardingRouteDismissed: false,
    closeOnboarding: state.close,
    setOnboardingRouteDismissed: state.dismiss,
  }),
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [{ id: "company-1", name: "Acme", issuePrefix: "PC1" }],
    loading: false,
    setSelectedCompanyId: state.selectCompany,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let cache: QueryClient;
let requests: Array<{ path: string; method: string; body: Record<string, any> }>;
let permissionStatus: number;
let savedAgent: Record<string, any>;
let hireStatus: number;
let approval: { id: string } | null;
let approvalStatus: number;
let detailStatus: number;
let localCheckResponse: (() => Promise<Response>) | null;
let approvalResponse: (() => Promise<Response>) | null;
let existingAgents: Record<string, unknown>[];
let localEnvironment: boolean;

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  });
}
async function render(variant = false) {
  await act(async () => root.render(
    <QueryClientProvider client={cache}><TooltipProvider>
      {variant ? <OnboardingWizardVariant /> : <OnboardingWizard />}
    </TooltipProvider></QueryClientProvider>,
  ));
  await settle();
}
async function click(label: string) {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
    .find(element => element.textContent?.trim() === label);
  expect(button, `Missing button: ${label}`).toBeTruthy();
  expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
  await settle();
}
async function fill(selector: string, value: string) {
  const input = document.body.querySelector<HTMLInputElement>(selector);
  expect(input, selector).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function selectSource(value: string) {
  const input = document.body.querySelector<HTMLSelectElement>('[aria-label="Configuration source"]');
  expect(input).toBeTruthy();
  await act(async () => {
    input!.value = value;
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
function restoreHost(extra: Record<string, unknown> = {}) {
  state.pathname = "/";
  state.open = true;
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
    step: 4, createdCompanyId: "company-1", createdCompanyPrefix: "PC1",
    agentName: "Ada", adapterType: "claude_local", configurationSource: "host", ...extra,
  }));
}
function expectNoAutomaticProviderWork() {
  expect(requests.filter(request => /\/models|auth-signal|login|claude-oauth|ai-connections|test-environment/.test(request.path))).toEqual([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.pathname = "/PC1/onboarding";
  state.open = false;
  permissionStatus = 200;
  hireStatus = 200;
  approval = null;
  approvalStatus = 200;
  detailStatus = 200;
  localCheckResponse = null;
  approvalResponse = null;
  existingAgents = [];
  localEnvironment = true;
  vi.stubGlobal("scrollTo", vi.fn());
  savedAgent = { id: "agent-1", companyId: "company-1", name: "Ada", urlKey: "ada",
    adapterType: "claude_local", adapterConfig: { configurationSource: "host" },
    status: "error", lifecycleState: "error", lifecycleError: "Local verification failed." };
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ path, method, body });
    if (path === "/api/health") return response({ deploymentMode: "local_trusted", localAiLoginSupported: true });
    if (path === "/api/auth/get-session") return response({ user: { id: "user-1" }, session: { id: "session-1" } });
    if (path === "/api/companies") return response(method === "GET" ? [{ id: "company-1", name: "Acme", issuePrefix: "PC1" }] : { id: "company-1", name: body.name, issuePrefix: "PC1" });
    if (path === "/api/adapters") return response(["claude_local", "codex_local"].map(type => ({ type, loaded: true, disabled: false })));
    if (path.endsWith("/claude-host-access")) return response(permissionStatus === 200 ? { enabled: false } : { error: "Permission query failed" }, permissionStatus);
    if (path.endsWith("/environments")) return response(localEnvironment ? [{ id: "local-1", name: "Local", driver: "local", status: "active", config: {} }] : []);
    if (path.endsWith("/environments/capabilities")) return response({ sandboxProviders: {} });
    if (path === "/api/instance/settings") return response({ defaultEnvironmentId: "local-1" });
    if (path === "/api/instance/settings/experimental") return response({});
    if (path.endsWith("/agents") && method === "GET") return response(existingAgents);
    if (path.endsWith("/agent-hires")) {
      if (hireStatus !== 200) return response({ error: "This configuration is not permitted." }, hireStatus);
      savedAgent = { ...savedAgent, ...body };
      return response({ agent: savedAgent, approval });
    }
    if (path === "/api/agents/agent-1") return response(detailStatus === 200 ? savedAgent : { error: "Could not load Agent" }, detailStatus);
    if (path.endsWith("/approve")) return approvalResponse ? approvalResponse() : response(approvalStatus === 200 ? {} : { error: "Approval denied" }, approvalStatus);
    if (path.includes("/secrets") || path.includes("/user-secrets")) return response([]);
    if (path.endsWith("/claude-oauth-token-status")) return response({ error: "No login" }, 404);
    if (path.endsWith("/ai-connections")) return response({ currentUserId: "user-1", connections: [] });
    if (path.endsWith("/models")) return response([]);
    if (path.endsWith("/test-environment")) return localCheckResponse ? localCheckResponse() : response({ adapterType: "claude_local", status: "fail", purpose: "local-check",
      outcome: "failed", localPrerequisites: "failed", modelResponse: "not_tested",
      testedAt: "2026-10-14T00:00:00Z", checks: [{ code: "missing_cli", level: "error", message: "The local CLI is unavailable." }] });
    return response({ error: `Unhandled fixture: ${method} ${path}` }, 500);
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  cache.clear();
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Host source in first-company and legacy onboarding", () => {
  it("restores host without querying login or provider models", async () => {
    restoreHost({ model: "gateway/custom-model" });
    await render();
    expect(document.body.querySelector<HTMLSelectElement>('[aria-label="Configuration source"]')?.value).toBe("host");
    expect(document.body.textContent).toContain("Native default");
    expect(document.body.textContent).toContain("gateway/custom-model");
    expectNoAutomaticProviderWork();
  });
  it("saves without permission and opens the same Agent after local verification fails", async () => {
    restoreHost({ model: "sonnet", cwd: "/missing-workspace", command: "/missing-cli" });
    await render();
    await click("Save Agent");
    const hires = requests.filter(request => request.path.endsWith("/agent-hires"));
    expect(hires).toHaveLength(1);
    expect(hires[0].body).toMatchObject({
      adapterConfig: { configurationSource: "host", model: "sonnet", cwd: "/missing-workspace", command: "/missing-cli" },
      onboardingFirstAgent: true,
    });
    expect(hires[0].body.runtimeConfig).not.toHaveProperty("aiConnection");
    expect(hires[0].body).not.toHaveProperty("applyStoredClaudeLogin");
    expect(document.body.textContent).toContain("Configuration saved. Local verification needs attention.");
    expect(document.body.textContent).not.toContain("ready to work!");
    expectNoAutomaticProviderWork();
    await click("Open Agent");
    expect(state.navigate).toHaveBeenCalledWith("/PC1/agents/ada");
    expect(requests.filter(request => request.path.endsWith("/agent-hires"))).toHaveLength(1);
    expect(requests.filter(request => /\/issues|\/projects/.test(request.path))).toEqual([]);
  });
  it("keeps env and shared model drafts while switching source and saves pending env edits", async () => {
    restoreHost({ model: "gateway/custom-model" });
    await render();
    await click("Add variable");
    await fill('input[placeholder="KEY"]', "CUSTOM_SETTING");
    await fill('input[aria-label="Variable value"]', "draft-value");
    await selectSource("paperclip");
    await selectSource("host");
    expect(document.body.querySelector<HTMLSelectElement>('[aria-label="Model"]')?.value).toBe("gateway/custom-model");
    expect(document.body.querySelector<HTMLInputElement>('input[aria-label="Variable value"]')?.value).toBe("draft-value");
    requests = [];
    await click("Save Agent");
    expect(requests.find(request => request.path.endsWith("/agent-hires"))?.body.adapterConfig).toMatchObject({
      configurationSource: "host", model: "gateway/custom-model",
      env: { CUSTOM_SETTING: { type: "plain", value: "draft-value" } },
    });
    expectNoAutomaticProviderWork();
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).not.toContain("draft-value");
  });
  it("keeps a failed optional local check separate from saving", async () => {
    restoreHost();
    await render();
    await click("Check local conditions");
    const checks = requests.filter(request => request.path.endsWith("/test-environment"));
    expect(checks).toHaveLength(1);
    expect(checks[0].body).toMatchObject({ purpose: "local-check", adapterConfig: { configurationSource: "host" } });
    expect(checks[0].body).not.toHaveProperty("aiConnection");
    expect(document.body.textContent).toContain("Local check failed");
    expect(document.body.textContent).not.toContain("Respond with hello.");
    await click("Save Agent");
    expect(requests.filter(request => request.path.endsWith("/agent-hires"))).toHaveLength(1);
  });
  it.each([false, true])("completes the real first-company journey through variant=%s", async variant => {
    state.pathname = "/onboarding";
    await render(variant);
    await fill("#onboarding-company-name", "Acme");
    await click("Continue");
    await fill("#onboarding-agent-name", "Ada");
    await click("Next");
    expect(document.body.querySelector<HTMLSelectElement>('[aria-label="Configuration source"]')?.value).toBe("paperclip");
    await selectSource("host");
    requests = [];
    await click("Save Agent");
    expect(requests.find(request => request.path.endsWith("/agent-hires"))?.body.adapterConfig.configurationSource).toBe("host");
    expectNoAutomaticProviderWork();
    await click("Open Agent");
    expect(state.navigate).toHaveBeenCalledWith("/PC1/agents/ada");
  });
  it.each([200, 500])("saves from the company route when permission lookup returns %s", async status => {
    permissionStatus = status;
    await render(true);
    await fill("#onboarding-agent-name", "Ada");
    await click("Next");
    await selectSource("host");
    expect(document.body.textContent).toContain(status === 500 ? "Could not load company permission" : "Company permission: not granted");
    requests = [];
    await click("Save Agent");
    expect(document.body.textContent).toContain("Agent configuration saved");
    expectNoAutomaticProviderWork();
  });
  it.each([400, 403, 422])("retains the draft when field, actor or target checks reject creation with %s", async status => {
    restoreHost({ model: "gateway/private-model" });
    hireStatus = status;
    await render();
    await click("Save Agent");
    expect(document.body.textContent).toContain("This configuration is not permitted.");
    expect(document.body.querySelector<HTMLSelectElement>('[aria-label="Model"]')?.value).toBe("gateway/private-model");
    expect(document.body.textContent).not.toContain("Agent configuration saved");
    expectNoAutomaticProviderWork();
  });
  it("retains the created record if the existing onboarding approval request fails", async () => {
    restoreHost();
    approval = { id: "approval-1" };
    approvalStatus = 403;
    savedAgent.status = "pending_approval";
    savedAgent.lifecycleState = "pending_approval";
    await render();
    await click("Save Agent");
    expect(document.body.textContent).toContain("Approval did not complete");
    expect(document.body.textContent).toContain("must approve this Agent");
    await click("Open Agent");
    expect(state.navigate).toHaveBeenCalledWith("/PC1/agents/ada");
    expect(requests.filter(request => request.path.endsWith("/agent-hires"))).toHaveLength(1);
    expect(requests.filter(request => request.path.endsWith("/approve"))).toHaveLength(1);
  });
  it("shows a saved record even when reading its verification state fails", async () => {
    restoreHost();
    detailStatus = 500;
    await render();
    await click("Save Agent");
    expect(document.body.textContent).toContain("its current verification state could not be loaded");
    await click("Open Agent");
    expect(state.navigate).toHaveBeenCalledWith("/PC1/agents/ada");
  });
  it("discards a late local result after changing the model", async () => {
    restoreHost();
    let finish!: (result: Response) => void;
    localCheckResponse = () => new Promise(resolve => { finish = resolve; });
    await render();
    await click("Check local conditions");
    const model = document.body.querySelector<HTMLSelectElement>('[aria-label="Model"]')!;
    await act(async () => {
      model.value = "sonnet";
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => finish(response({ adapterType: "claude_local", status: "pass", checks: [], testedAt: "2026-10-14T00:00:00Z" })));
    await settle();
    expect(document.body.textContent).not.toContain("Local conditions passed");
    await click("Save Agent");
    expect(requests.find(request => request.path.endsWith("/agent-hires"))?.body.adapterConfig.model).toBe("sonnet");
  });
  it("returns from host without submitting a draft", async () => {
    await render();
    await fill("#onboarding-agent-name", "Ada");
    await click("Next");
    await selectSource("host");
    await click("Back");
    expect(requests.filter(request => request.method === "POST")).toEqual([]);
    expect(state.navigate).not.toHaveBeenCalled();
  });
  it.each(["preparing", "verifying", "ready"])("reports saved local state %s without claiming a model connection", async phase => {
    restoreHost();
    savedAgent.lifecycleState = phase;
    savedAgent.lifecycleError = null;
    savedAgent.status = phase === "ready" ? "idle" : "paused";
    await render();
    await click("Save Agent");
    expect(document.body.textContent).toContain(phase === "ready" ? "Necessary local conditions passed" : "Local verification has not completed");
    expect(document.body.textContent).not.toContain("ready to work!");
    expectNoAutomaticProviderWork();
    await click("Open Agent");
  });
  it("reopens the saved host Agent after a refresh instead of creating another", async () => {
    restoreHost({ step: 5, createdAgentId: "agent-1" });
    await render(true);
    await click("Open Agent");
    expect(state.navigate).toHaveBeenCalledWith("/PC1/agents/ada");
    expect(requests.filter(request => request.method === "POST")).toEqual([]);
  });
  it("retains unfinished Paperclip authentication and one model across source switches", async () => {
    restoreHost({ model: "gateway/custom-model", credentialModeChoice: "api" });
    await render();
    await selectSource("paperclip");
    const chooseClaude = async () => {
      const tile = document.body.querySelector<HTMLButtonElement>('button[role="radio"]');
      expect(tile).toBeTruthy();
      await act(async () => tile!.click());
      await settle();
    };
    await chooseClaude();
    await fill('input[type="password"]', "unfinished-key");
    await selectSource("host");
    expect(document.body.querySelector('input[type="password"]')).toBeNull();
    expect(document.body.querySelector<HTMLSelectElement>('[aria-label="Model"]')?.value).toBe("gateway/custom-model");
    await selectSource("paperclip");
    await chooseClaude();
    expect(document.body.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("unfinished-key");
    expect(requests.filter(request => request.method === "POST")).toEqual([]);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).not.toContain("unfinished-key");
  });
  it("refreshes local verification after the existing approval request succeeds", async () => {
    restoreHost();
    approval = { id: "approval-1" };
    savedAgent.status = "pending_approval";
    savedAgent.lifecycleState = "pending_approval";
    let finish!: (result: Response) => void;
    approvalResponse = () => new Promise(resolve => { finish = resolve; });
    await render();
    await click("Save Agent");
    expect(requests.some(request => request.path === "/api/agents/agent-1")).toBe(true);
    savedAgent = { ...savedAgent, status: "idle", lifecycleState: "ready", lifecycleError: null };
    await act(async () => finish(response({})));
    await settle();
    expect(document.body.textContent).not.toContain("must approve this Agent");
    expect(document.body.textContent).toContain("Necessary local conditions passed");
  });
  it("does not adopt a same-name host Agent for a Paperclip source draft", async () => {
    restoreHost({ configurationSource: "paperclip" });
    localEnvironment = false;
    existingAgents = [{ ...savedAgent }];
    localCheckResponse = async () => response({ adapterType: "claude_local", status: "pass", checks: [], testedAt: "2026-10-14T00:00:00Z" });
    await render();
    const tile = document.body.querySelector<HTMLButtonElement>('button[role="radio"]')!;
    await act(async () => tile.click());
    await settle();
    await click("Connect");
    const hire = requests.find(request => request.path.endsWith("/agent-hires"));
    expect(hire).toBeDefined();
    expect(hire!.body.adapterConfig.configurationSource).not.toBe("host");
  });
});
