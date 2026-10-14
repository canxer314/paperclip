import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent } from "storybook/test";
import { useEffect, useState } from "react";
import { useCompanyListQuery } from "@/api/companies-query";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { useDialog } from "@/context/DialogContext";
import {
  ONBOARDING_ARC_ENTRY_STEP,
  STORYBOOK_COMPANY_ID,
  clearOnboardingDraft,
  seedOnboardingDraft,
} from "../fixtures/onboardingDraft";
import { resetOnboardingFixtureState, setOnboardingFixtureState } from "../fixtures/onboardingEnvironment";
import { storybookHiredAgent } from "../fixtures/paperclipData";

const meta = {
  title: "Onboarding/Claude host configuration",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Scenario = "configure" | "permission-error" | "verification-failed" | "pending-approval";

// Walk the real controller from its entry step so the configuration footer
// includes the same Back action as an existing company's first Agent setup.
function HostWizard() {
  const [seeded] = useState(() => { seedOnboardingDraft(); return true; });
  const companies = useCompanyListQuery();
  const ready = companies.isSuccess && companies.data !== undefined;
  const { openOnboarding } = useDialog();
  useEffect(() => clearOnboardingDraft, []);
  useEffect(() => {
    if (seeded && ready) openOnboarding({ initialStep: ONBOARDING_ARC_ENTRY_STEP, companyId: STORYBOOK_COMPANY_ID });
  }, [seeded, ready, openOnboarding]);
  return ready ? <OnboardingWizard /> : null;
}

function hostStory(scenario: Scenario): StoryObj {
  return {
    beforeEach: () => {
      setOnboardingFixtureState({ environments: "local" });
      const originalFetch = window.fetch;
      const agent = { ...storybookHiredAgent, id: "host-storybook", companyId: STORYBOOK_COMPANY_ID,
        adapterType: "claude_local", adapterConfig: { configurationSource: "host" },
        status: scenario === "pending-approval" ? "pending_approval" : "error",
        lifecycleState: scenario === "pending-approval" ? "pending_approval" : "verifying",
        lifecycleError: scenario === "pending-approval" ? null : "Local verification failed." };
      window.fetch = async (input, init) => {
        const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin).pathname;
        if (path.endsWith("/claude-host-access")) return scenario === "permission-error"
          ? Response.json({ error: "Permission lookup unavailable" }, { status: 503 })
          : Response.json({ enabled: false });
        if (path.endsWith("/agent-hires")) return Response.json({ agent, approval: null });
        if (path === "/api/agents/host-storybook") return Response.json(agent);
        return originalFetch(input, init);
      };
      return () => { window.fetch = originalFetch; resetOnboardingFixtureState(); };
    },
    render: () => <HostWizard />,
    play: async () => {
      const next = await screen.findByRole("button", { name: "Next" }, { timeout: 15000 });
      await userEvent.click(next);
      const source = await screen.findByRole("combobox", { name: "Configuration source" }, { timeout: 15000 });
      await userEvent.selectOptions(source, "host");
      await screen.findByText(scenario === "permission-error" ? /Could not load company permission/ : "Company permission: not granted", {}, { timeout: 15000 });
      if (scenario === "verification-failed" || scenario === "pending-approval") {
        await userEvent.click(screen.getByRole("button", { name: "Save Agent" }));
        await screen.findByRole("heading", { name: "Agent configuration saved" }, { timeout: 15000 });
        await expect(screen.getByText(scenario === "pending-approval" ? /must approve this Agent/ : /Local verification needs attention/)).toBeVisible();
        await expect(screen.getByRole("button", { name: "Open Agent" })).toBeEnabled();
      } else {
        await expect(screen.getByRole("button", { name: "Save Agent" })).toBeEnabled();
        await expect(screen.getByRole("button", { name: "Back" })).toBeVisible();
      }
    },
  };
}

export const WithoutPermission = hostStory("configure");
export const PermissionQueryFailed = hostStory("permission-error");
export const SavedWithFailedVerification = hostStory("verification-failed");
export const SavedPendingApproval = hostStory("pending-approval");
