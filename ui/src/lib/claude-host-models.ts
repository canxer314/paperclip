import { models } from "@paperclipai/adapter-claude-local";

/** Shipped suggestions, never an account's available models or a whitelist. */
export const claudeHostModels = [
  { id: "opus", label: "opus" },
  { id: "sonnet", label: "sonnet" },
  { id: "haiku", label: "haiku" },
  ...models,
];
