import { asString } from "@paperclipai/adapter-utils/server-utils";
import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

export { execute } from "./execute.js";
export { getConfigSchema } from "./config-schema.js";
export { listSkills, syncSkills } from "./skills.js";
export {
  testEnvironment,
  listGrokModels,
  refreshGrokModels,
  detectModel,
  parseGrokModelsOutput,
} from "./test.js";
export { parseGrokStreamJson, parseGrokJsonl, isGrokUnknownSessionError } from "./parse.js";

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const sessionId = asString(obj.sessionId, "");
    if (!sessionId) return null;
    const cwd = asString(obj.cwd, "");
    const workspaceId = asString(obj.workspaceId, "");
    const repoUrl = asString(obj.repoUrl, "");
    const repoRef = asString(obj.repoRef, "");
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
      ...(obj.remoteExecution && typeof obj.remoteExecution === "object"
        ? { remoteExecution: obj.remoteExecution }
        : {}),
    };
  },
  serialize(params) {
    if (!params || typeof params !== "object") return null;
    const sessionId = asString(params.sessionId, "");
    if (!sessionId) return null;
    const cwd = asString(params.cwd, "");
    const workspaceId = asString(params.workspaceId, "");
    const repoUrl = asString(params.repoUrl, "");
    const repoRef = asString(params.repoRef, "");
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
      ...(params.remoteExecution && typeof params.remoteExecution === "object"
        ? { remoteExecution: params.remoteExecution }
        : {}),
    };
  },
  getDisplayId(params) {
    if (!params || typeof params !== "object") return null;
    return asString((params as Record<string, unknown>).sessionId, "") || null;
  },
};