// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { CompanyProvider, useCompany } from "@/context/CompanyContext";
import { InstanceAccess } from "./InstanceAccess";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), directory: vi.fn(), detachInflightList: vi.fn(), detachInflightDirectory: vi.fn(),
  getSession: vi.fn(), searchAdminUsers: vi.fn(), getUserCompanyAccess: vi.fn(),
  listClaudeHostAccess: vi.fn(), setClaudeHostAccess: vi.fn(),
  setUserCompanyAccess: vi.fn(), setBreadcrumbs: vi.fn(), pushToast: vi.fn(),
}));
vi.mock("@/api/companies", () => ({ companiesApi: mocks }));
vi.mock("@/api/auth", () => ({ authApi: mocks }));
vi.mock("@/api/access", () => ({ accessApi: mocks }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => mocks }));
vi.mock("@/context/ToastContext", () => ({ useToast: () => mocks }));

const companyA = { id: "company-a", name: "Company A", issuePrefix: "CPA", status: "active" };
const companyB = { id: "company-b", name: "Company B", issuePrefix: "CPB", status: "active" };
const user = { id: "admin", name: "Admin", email: "admin@example.com", isInstanceAdmin: true };
const membershipA = {
  id: "membership-a", companyId: companyA.id, companyName: companyA.name,
  status: "active", membershipRole: "owner", updatedAt: "2020-01-01T00:00:00Z",
};

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

function NavigationProbe() {
  const { companies } = useCompany();
  return <nav data-testid="navigation">{companies.map((company) => company.name).join(", ")}</nav>;
}

async function renderPage() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <CompanyProvider><NavigationProbe /><InstanceAccess /></CompanyProvider>
      </QueryClientProvider>,
    );
  });
}

async function eventually(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assertion();
  });
}

function button(text: string) {
  return [...container.querySelectorAll("button")].find((element) => element.textContent === text);
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  mocks.getSession.mockResolvedValue({ session: { id: "session-admin", userId: user.id }, user });
  mocks.list.mockResolvedValue([companyA]);
  mocks.directory.mockResolvedValue([companyA, companyB]);
  mocks.searchAdminUsers.mockResolvedValue([user]);
  mocks.getUserCompanyAccess.mockResolvedValue({ user, companyAccess: [membershipA] });
  mocks.setUserCompanyAccess.mockResolvedValue({});
  mocks.listClaudeHostAccess.mockResolvedValue([{ id: companyA.id, name: companyA.name, enabled: false }, { id: companyB.id, name: companyB.name, enabled: false }]);
  mocks.setClaudeHostAccess.mockResolvedValue({ enabled: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe("InstanceAccess company directory", () => {
  it("lets admins grant access outside their navigation list and refreshes their own navigation", async () => {
    await renderPage();
    await eventually(() => {
      expect(button("Save organization access")).toBeDefined();
      expect(container.querySelector("nav")?.textContent).toBe("Company A");
    });
    const otherCompany = [...container.querySelectorAll("label")].find((label) => label.textContent?.includes("Company B"));
    const checkbox = otherCompany?.querySelector<HTMLButtonElement>('[role="checkbox"]');
    expect(checkbox?.getAttribute("aria-checked")).toBe("false");
    mocks.setUserCompanyAccess.mockImplementation(async () => {
      mocks.list.mockResolvedValue([companyA, companyB]);
      mocks.getUserCompanyAccess.mockResolvedValue({ user, companyAccess: [membershipA, {
        ...membershipA, id: "membership-b", companyId: companyB.id, companyName: companyB.name,
      }] });
      return {};
    });
    await act(async () => checkbox!.click());
    await act(async () => button("Save organization access")!.click());
    await eventually(() => {
      expect(mocks.setUserCompanyAccess).toHaveBeenCalledWith(user.id, [companyA.id, companyB.id]);
      expect(container.querySelector("nav")?.textContent).toBe("Company A, Company B");
    });
  });

  it("shows an organization empty state without blocking instance user administration", async () => {
    mocks.list.mockResolvedValue([]);
    mocks.directory.mockResolvedValue([]);
    mocks.getUserCompanyAccess.mockResolvedValue({ user, companyAccess: [] });
    await renderPage();
    await eventually(() => expect(container.textContent).toContain("No organizations yet."));
    expect(button("Remove instance admin")).toBeDefined();
    expect(mocks.setBreadcrumbs).toHaveBeenCalledWith([{ label: "Instance Access" }]);
  });

  it("prevents editing an incomplete directory and lets the admin retry", async () => {
    mocks.directory.mockRejectedValue(new Error("Unavailable"));
    await renderPage();
    await eventually(() => {
      expect(container.textContent).toContain("Failed to load organizations.");
      expect(container.querySelector("nav")?.textContent).toBe("Company A");
    });
    expect(button("Save organization access")).toBeUndefined();
    expect(mocks.setUserCompanyAccess).not.toHaveBeenCalled();
    mocks.directory.mockResolvedValue([companyA, companyB]);
    await act(async () => button("Try again")!.click());
    await eventually(() => expect(button("Save organization access")).toBeDefined());
  });

  it("shows the server denial without fetching the directory or allowing edits for a non-admin", async () => {
    mocks.searchAdminUsers.mockRejectedValue(new ApiError("Forbidden", 403, {}));
    await renderPage();
    await eventually(() => expect(container.textContent).toContain("Instance admin access is required"));
    expect(mocks.directory).not.toHaveBeenCalled();
    expect(button("Save organization access")).toBeUndefined();
    expect(button("Promote to instance admin")).toBeUndefined();
    expect(mocks.setUserCompanyAccess).not.toHaveBeenCalled();
  });
});

describe("InstanceAccess Claude host permission", () => {
  it("grants a company independently of the selected membership user", async () => {
    mocks.searchAdminUsers.mockResolvedValue([user, { ...user, id: "other-user", name: "Other user" }]);
    await renderPage();
    await eventually(() => expect(button("Grant Company B host access")).toBeDefined());
    await act(async () => { [...container.querySelectorAll("button")].find((item) => item.textContent?.includes("Other user"))!.click(); });
    await act(async () => button("Grant Company B host access")!.click());
    await eventually(() => expect(mocks.setClaudeHostAccess).toHaveBeenCalledWith(companyB.id, true));
    expect(mocks.setUserCompanyAccess).not.toHaveBeenCalled();
  });
  it("keeps host permission available when the membership directory fails", async () => {
    mocks.directory.mockRejectedValue(new Error("Membership directory unavailable"));
    await renderPage();
    await eventually(() => expect(button("Grant Company B host access")).toBeDefined());
    expect(container.textContent).toContain("Failed to load organizations.");
  });

  it("disables only the pending row and reports row failure without changing permission", async () => {
    let reject!: (error: Error) => void;
    mocks.setClaudeHostAccess.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    await renderPage();
    await eventually(() => expect(button("Grant Company B host access")).toBeDefined());
    await act(async () => button("Grant Company B host access")!.click());
    await eventually(() => expect(button("Saving host access…")?.disabled).toBe(true));
    expect(button("Grant Company A host access")?.disabled).toBe(false);
    await act(async () => reject(new Error("sensitive backend error")));
    await eventually(() => expect(container.textContent).toContain("Failed to update host access for Company B."));
    expect(button("Grant Company B host access")).toBeDefined();
    expect(container.textContent).not.toContain("sensitive backend error");
  });

  it("reads committed permission after grant and keeps revoke separate from membership", async () => {
    await renderPage();
    await eventually(() => expect(button("Grant Company B host access")).toBeDefined());
    mocks.setClaudeHostAccess.mockImplementation(async (_companyId, enabled) => {
      mocks.listClaudeHostAccess.mockResolvedValue([{ id: companyB.id, name: companyB.name, enabled }]);
      return { enabled };
    });
    await act(async () => button("Grant Company B host access")!.click());
    await eventually(() => expect(button("Revoke Company B host access")).toBeDefined());
    await act(async () => button("Revoke Company B host access")!.click());
    await eventually(() => expect(button("Grant Company B host access")).toBeDefined());
    expect(mocks.setClaudeHostAccess).toHaveBeenLastCalledWith(companyB.id, false);
    expect(mocks.setUserCompanyAccess).not.toHaveBeenCalled();
  });

  it("does not reuse permission cached for another account", async () => {
    client.setQueryData(["access", "claude-host-access", "previous-user"], [{ id: "private-company", name: "Private company", enabled: true }]);
    mocks.listClaudeHostAccess.mockResolvedValue([]);
    await renderPage();
    await eventually(() => expect(container.textContent).toContain("No organizations available for host access."));
    expect(container.textContent).not.toContain("Private company");
  });

  it("shows directory failure separately and can retry", async () => {
    mocks.listClaudeHostAccess.mockRejectedValue(new Error("Unavailable"));
    await renderPage();
    await eventually(() => expect(container.textContent).toContain("Failed to load Claude host access"));
    expect(button("Save organization access")).toBeDefined();
    expect(button("Grant Company B host access")).toBeUndefined();
    mocks.listClaudeHostAccess.mockResolvedValue([]);
    await act(async () => button("Retry host access directory")!.click());
    await eventually(() => expect(container.textContent).toContain("No organizations available for host access."));
  });
});
