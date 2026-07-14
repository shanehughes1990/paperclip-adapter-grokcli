import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";
import {
  DEFAULT_GROK_COMMAND,
  DEFAULT_GROK_MODEL,
  DEFAULT_MAX_TURNS_PER_RUN,
} from "../shared/constants.js";

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "command",
        label: "Grok command",
        type: "text",
        default: DEFAULT_GROK_COMMAND,
        hint: "Path to the grok CLI binary. Defaults to grok on PATH.",
      },
      {
        key: "model",
        label: "Model",
        type: "text",
        default: DEFAULT_GROK_MODEL,
        hint: "Grok model id. Use Refresh models in the agent config UI to discover available models.",
      },
      {
        key: "cwd",
        label: "Working directory",
        type: "text",
        hint: "Absolute path used when Paperclip does not inject a workspace cwd.",
      },
      {
        key: "maxTurnsPerRun",
        label: "Max turns per run",
        type: "number",
        default: DEFAULT_MAX_TURNS_PER_RUN,
        hint: "Maximum agentic turns per Paperclip run (--max-turns).",
      },
      {
        key: "effort",
        label: "Effort",
        type: "select",
        options: [
          { value: "", label: "Default" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "xhigh", label: "Extra high" },
          { value: "max", label: "Max" },
        ],
        hint: "Optional reasoning effort passed via --effort.",
      },
      {
        key: "alwaysApprove",
        label: "Always approve tools",
        type: "toggle",
        default: true,
        hint: "Pass --always-approve so grok-cli can run shell and file tools unattended.",
      },
      {
        key: "disableWebSearch",
        label: "Disable web search",
        type: "toggle",
        default: false,
        hint: "Pass --disable-web-search when enabled.",
      },
      {
        key: "timeoutSec",
        label: "Timeout seconds",
        type: "number",
        default: 0,
        hint: "0 uses the Paperclip host default run timeout.",
      },
      {
        key: "graceSec",
        label: "Grace seconds",
        type: "number",
        default: 20,
        hint: "Seconds to wait after SIGTERM before killing the grok process.",
      },
      {
        key: "promptTemplate",
        label: "Prompt template",
        type: "textarea",
        hint: "Optional run prompt template with {{agent.id}}, {{agent.name}}, and other Paperclip placeholders.",
      },
      {
        key: "extraArgs",
        label: "Extra CLI args",
        type: "text",
        hint: "Comma-separated additional grok CLI arguments.",
      },
    ],
  };
}