// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Outlet, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "./components/ui/tooltip";
import { queryKeys } from "./lib/queryKeys";

const state = vi.hoisted(() => ({ streamlined: true }));
const record = vi.hoisted(() => ({ id: "saved-agent", companyId: "company-1", name: "Atlas", urlKey: "atlas",
  adapterType: "claude_local", adapterConfig: { configurationSource: "host" }, status: "idle", lifecycleState: "verifying", lifecycleError: "safe_code" }));
const api = vi.hoisted(() => ({ hire: vi.fn(), get: vi.fn(), adapterModels: vi.fn(async () => []),
  list: vi.fn(async () => []), getClaudeOAuthTokenStatus: vi.fn(async () => null), getAdapterAuthSignal: vi.fn(async () => ({ status: "missing" })), testEnvironment: vi.fn() }));
vi.mock("./api/agents", () => ({ agentsApi: api }));
vi.mock("./api/adapters", () => ({ adaptersApi: { list: async () => [{ type: "claude_local", loaded: true }] } }));
vi.mock("./api/environments", () => ({ environmentsApi: { list: async () => [{ id: "local", driver: "local", name: "Local", config: {} }], capabilities: async () => ({ sandboxProviders: {} }) } }));
vi.mock("./api/instanceSettings", () => ({ instanceSettingsApi: { get: async () => ({ defaultEnvironmentId: "local" }), getGeneral: async () => ({ executionMode: "any" }), getExperimental: async () => ({}) } }));
vi.mock("./api/secrets", () => ({ secretsApi: { list: async () => [], listMyUserSecrets: async () => [] } }));
vi.mock("./api/ai-connections", () => ({ aiConnectionsApi: { list: async () => ({ connections: [], currentUserId: "user" }) } }));
vi.mock("./api/access", () => ({ accessApi: { getClaudeHostAccess: async () => ({ enabled: false }) } }));
vi.mock("./components/AgentConfigForm", () => ({ ModelDropdown: () => null, AdapterLoginPanel: () => null }));
vi.mock("./components/Layout", () => ({ Layout: () => <div data-shell="default"><Outlet /></div> }));
vi.mock("./components/Layout.production", () => ({ Layout: () => <div data-shell="production"><Outlet /></div> }));
vi.mock("./components/CloudAccessGate", () => ({ CloudAccessGate: () => <Outlet /> }));
vi.mock("./components/OnboardingWizardVariant", () => ({ OnboardingWizardVariant: () => null }));
vi.mock("./hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: state.streamlined, loaded: true }) }));
vi.mock("./hooks/useCloudInstance", () => ({ useCloudInstance: () => null }));
vi.mock("./hooks/useCombinedInboxTasksEnabled", () => ({ useCombinedInboxTasksEnabled: () => ({ enabled: false }) }));
vi.mock("./context/CompanyContext", () => ({
  useCompany: () => ({ companies: [{ id: "company-1", issuePrefix: "PC1" }], selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", issuePrefix: "PC1" }, loading: false }),
  CompanyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("./context/DialogContext", () => ({ useDialogActions: () => ({ openNewIssue: vi.fn() }),
  useDialogState: () => ({ onboardingOpen: false, onboardingRouteDismissed: true }) }));
vi.mock("motion/react", () => ({ AnimatePresence: ({ children }: any) => children, MotionConfig: ({ children }: any) => children,
  motion: { div: ({ children, initial, animate, exit, transition, ...rest }: any) => <div {...rest}>{children}</div>, span: ({ children }: any) => <span>{children}</span> } }));

const { App } = await import("./App");
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let cache: QueryClient;
function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(b => b.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await settle();
}
beforeEach(() => {
  vi.clearAllMocks();
  api.hire.mockImplementation(async () => ({ agent: { ...record } }));
  api.get.mockImplementation(async () => ({ ...record }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(queryKeys.health, { deploymentMode: "local_trusted", hiddenSettings: [] });
});
afterEach(async () => { await act(async () => root.unmount()); cache.clear(); container.remove(); });

it.each([true, false])("saves host through the actual New Agent route and restores the same record in shell %s", async streamlined => {
  state.streamlined = streamlined;
  await act(async () => root.render(<QueryClientProvider client={cache}><TooltipProvider><MemoryRouter initialEntries={["/PC1/agents/new?name=Atlas&adapterType=claude_local"]}><App /><Location /></MemoryRouter></TooltipProvider></QueryClientProvider>));
  await settle();
  expect(container.querySelector(`[data-shell="${streamlined ? "default" : "production"}"]`)).not.toBeNull();
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Configuration source"]');
  expect(select).not.toBeNull();
  await act(async () => { select!.value = "host"; select!.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
  await click("Finish setup");
  expect(api.hire).toHaveBeenCalledTimes(1);
  expect(api.hire).toHaveBeenCalledWith("company-1", expect.objectContaining({ adapterConfig: expect.objectContaining({ configurationSource: "host" }) }));
  expect(container.querySelector("output")?.textContent).toContain("createdAgentId=saved-agent");
  expect(container.textContent).toContain("Local verification needs attention");
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={cache}><TooltipProvider><MemoryRouter initialEntries={["/PC1/agents/new?name=Atlas&adapterType=claude_local&createdAgentId=saved-agent"]}><App /><Location /></MemoryRouter></TooltipProvider></QueryClientProvider>));
  await settle();
  expect(container.textContent).toContain("Your agent has been created");
  expect(container.textContent).not.toContain("Finish setup");
  expect(api.hire).toHaveBeenCalledTimes(1);
  expect(api.testEnvironment).not.toHaveBeenCalled();
});
