// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Outlet, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "./lib/queryKeys";

const state = vi.hoisted(() => ({ streamlined: true, admin: true }));
vi.mock("./components/Layout", () => ({ Layout: () => <div data-shell="default"><Outlet /></div> }));
vi.mock("./components/Layout.production", () => ({ Layout: () => <div data-shell="production"><Outlet /></div> }));
vi.mock("./pages/PluginPage", () => ({ PluginPage: () => <div>OTHER_PAGE</div> }));
vi.mock("./components/CloudAccessGate", () => ({ CloudAccessGate: () => <Outlet /> }));
vi.mock("./components/OnboardingWizardVariant", () => ({ OnboardingWizardVariant: () => null }));
vi.mock("./pages/InstanceAccess", () => ({ InstanceAccess: () => <h1>INSTANCE_ACCESS_PAGE</h1> }));
vi.mock("./hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: state.streamlined, loaded: true }) }));
vi.mock("./context/CompanyContext", () => ({
  useCompany: () => ({ companies: [], selectedCompany: null, selectedCompanyId: null, loading: false }),
  useOptionalCompany: () => null,
  CompanyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./context/DialogContext", () => ({ useDialogActions: () => ({ openOnboarding: vi.fn() }), useDialogState: () => ({ onboardingOpen: false, onboardingRouteDismissed: true }) }));
vi.mock("./hooks/useInstanceAdminAccess", () => ({ useInstanceAdminAccess: () => state.admin }));
vi.mock("./pages/NotFound", () => ({ NotFoundPage: () => <div>NOT_FOUND</div> }));
vi.mock("./hooks/useCloudInstance", () => ({ useCloudInstance: () => null }));
vi.mock("./hooks/useCombinedInboxTasksEnabled", () => ({ useCombinedInboxTasksEnabled: () => ({ enabled: false }) }));

const { App } = await import("./App");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}{location.hash}</output>; }

describe("company-independent instance access navigation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    state.admin = true;
    state.streamlined = true;
    client.setQueryData(queryKeys.health, { deploymentMode: "local_trusted", hiddenSettings: [] });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
  async function render(path: string) {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /><Location /></MemoryRouter></QueryClientProvider>));
  }
  it("retains onboarding for a non-admin with no companies", async () => {
    state.admin = false;
    await render("/");
    expect(container.querySelector("output")?.textContent).toBe("/onboarding");
    expect(container.querySelector('a[href="/instance/access"]')).toBeNull();
  });
  it("does not offer a hidden instance entry on the start page", async () => {
    client.setQueryData(queryKeys.health, { hiddenSettings: ["instance.access"] });
    await render("/");
    expect(container.querySelector('a[href="/instance/access"]')).toBeNull();
  });
  it("offers instance access from the zero-company start page", async () => {
    await render("/");
    expect(container.querySelector('a[href="/instance/access"]')).not.toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("/");
  });
  it.each([[true, "/instance/access"], [false, "/instance/access"], [true, "/instance/settings/access"], [false, "/instance/settings/access"]] as const)("uses the selected shell and hides direct and legacy access (%s, %s)", async (streamlined, path) => {
    state.streamlined = streamlined;
    client.setQueryData(queryKeys.health, { hiddenSettings: ["instance.access"] });
    await render(path);
    expect(container.textContent).not.toContain("INSTANCE_ACCESS_PAGE");
    expect(container.querySelector("output")?.textContent).not.toBe("/instance/access");
  });
  it.each([true, false])("uses the selected shell (%s)", async (streamlined) => {
    state.streamlined = streamlined;
    await render("/instance/access");
    expect(container.querySelector(`[data-shell="${streamlined ? "default" : "production"}"]`)).not.toBeNull();
  });
  it.each(["/company/settings/instance/access", "/PAP/company/settings/instance/access", "/instance/settings/access", "/settings/access", "/PAP/settings/access", "/PAP/instance/settings/access"])("redirects legacy %s without needing a company", async (path) => {
    await render(path);
    expect(container.querySelector("output")?.textContent).toBe("/instance/access");
    expect(container.textContent).toContain("INSTANCE_ACCESS_PAGE");
  });
  it("preserves legacy query and fragment", async () => {
    await render("/settings/access?user=admin#memberships");
    expect(container.querySelector("output")?.textContent).toBe("/instance/access?user=admin#memberships");
  });
  it("opens the instance page without a company", async () => {
    await render("/instance/access");
    expect(container.textContent).toContain("INSTANCE_ACCESS_PAGE");
    expect(container.querySelector('[data-shell="default"]')).not.toBeNull();
    expect(container.querySelector("output")?.textContent).toBe("/instance/access");
  });
});
