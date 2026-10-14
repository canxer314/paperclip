import { z } from "zod";

/** Missing source preserves the existing Paperclip authentication behavior. */
export const CLAUDE_CONFIGURATION_SOURCES = ["paperclip", "host"] as const;
export const claudeConfigurationSourceSchema = z.enum(CLAUDE_CONFIGURATION_SOURCES).default("paperclip");
export type ClaudeConfigurationSource = z.infer<typeof claudeConfigurationSourceSchema>;

export function resolveClaudeConfigurationSource(config: Record<string, unknown>): ClaudeConfigurationSource {
  return claudeConfigurationSourceSchema.parse(config.configurationSource);
}

export const adapterEnvironmentTestPurposeSchema = z.enum(["local-check", "model-test"]);
export type AdapterEnvironmentTestPurpose = z.infer<typeof adapterEnvironmentTestPurposeSchema>;
