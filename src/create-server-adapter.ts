import type { ServerAdapterModule } from "@paperclipai/adapter-utils";
import { models, type, label } from "./shared/constants.js";
import { agentConfigurationDoc } from "./shared/doc.js";
import {
  detectModel,
  execute,
  getConfigSchema,
  listGrokModels,
  listSkills,
  refreshGrokModels,
  sessionCodec,
  syncSkills,
  testEnvironment,
} from "./server/index.js";

const sessionManagement = {
  supportsSessionResume: true,
  nativeContextManagement: "confirmed" as const,
  defaultSessionCompaction: {
    enabled: true,
    maxSessionRuns: 0,
    maxRawInputTokens: 0,
    maxSessionAgeHours: 0,
  },
};

export function createServerAdapter(): ServerAdapterModule {
  return {
    type,
    execute,
    testEnvironment,
    sessionCodec,
    sessionManagement,
    listSkills,
    syncSkills,
    models,
    listModels: listGrokModels,
    refreshModels: refreshGrokModels,
    detectModel,
    getConfigSchema,
    supportsLocalAgentJwt: true,
    supportsInstructionsBundle: true,
    instructionsPathKey: "instructionsFilePath",
    requiresMaterializedRuntimeSkills: true,
    getRuntimeCommandSpec: (config) => ({
      command:
        typeof config.command === "string" && config.command.trim().length > 0
          ? config.command.trim()
          : "grok",
      detectCommand:
        typeof config.command === "string" && config.command.trim().length > 0
          ? config.command.trim()
          : "grok",
      installCommand: null,
    }),
    agentConfigurationDoc,
  };
}

export { label as grokCliLabel, type as grokCliType };