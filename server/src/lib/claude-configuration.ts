import { resolveClaudeConfigurationSource } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";

export function assertClaudeConfigurationTarget(adapterType: string | null | undefined, adapterConfig: Record<string, unknown>) {
  if (adapterConfig.configurationSource !== undefined && adapterType !== "claude_local") {
    throw unprocessable("Configuration source is only supported by the Claude Code adapter.");
  }
  if (adapterType === "claude_local" && resolveClaudeConfigurationSource(adapterConfig) === "host" &&
    adapterConfig.engine !== undefined && adapterConfig.engine !== "cli") {
    throw unprocessable("Claude server configuration requires the CLI engine.", { code: "claude_host_target_unsupported" });
  }
}
