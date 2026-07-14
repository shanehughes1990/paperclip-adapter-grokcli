export {
  type,
  label,
  models,
  DEFAULT_GROK_MODEL,
  DEFAULT_GROK_COMMAND,
  DEFAULT_MAX_TURNS_PER_RUN,
} from "./shared/constants.js";

export { agentConfigurationDoc } from "./shared/doc.js";
export { createServerAdapter } from "./create-server-adapter.js";

export interface GrokCliConfig {
  command?: string;
  model?: string;
  cwd?: string;
  instructionsFilePath?: string;
  systemPrompt?: string;
  promptTemplate?: string;
  bootstrapPromptTemplate?: string;
  maxTurnsPerRun?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  alwaysApprove?: boolean;
  noPlan?: boolean;
  noSubagents?: boolean;
  disallowedTools?: string[];
  extraArgs?: string[];
  env?: Record<string, string>;
  timeoutSec?: number;
  graceSec?: number;
  skillsDir?: string;
}