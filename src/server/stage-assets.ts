import fs from "node:fs/promises";
import path from "node:path";
import type { PaperclipSkillEntry } from "@paperclipai/adapter-utils/server-utils";
import { materializePaperclipSkillCopy } from "@paperclipai/adapter-utils/server-utils";

type OnLog = (stream: "stdout" | "stderr", chunk: string) => Promise<void>;

export interface StageGrokProjectAssetsInput {
  cwd: string;
  instructionsFilePath: string;
  skillEntries: PaperclipSkillEntry[];
  desiredSkillNames: string[];
  onLog: OnLog;
}

export interface StagedGrokProjectAssets {
  stagedSkillsCount: number;
  stagedInstructionsPath: string | null;
  rulesFilePath: string | null;
  cleanup: () => Promise<void>;
}

async function pathExists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

export async function stageGrokProjectAssets(
  input: StageGrokProjectAssetsInput,
): Promise<StagedGrokProjectAssets> {
  const cleanup: Array<{ kind: "dir" | "file"; path: string }> = [];
  const ensureCleanupDir = (candidate: string) => {
    cleanup.push({ kind: "dir", path: candidate });
  };
  const ensureCleanupFile = (candidate: string) => {
    cleanup.push({ kind: "file", path: candidate });
  };

  let stagedInstructionsPath: string | null = null;
  let rulesFilePath: string | null = null;
  let stagedSkillsCount = 0;
  const instructionsTarget = path.join(input.cwd, "Agents.md");

  if (input.instructionsFilePath) {
    if (!(await pathExists(instructionsTarget))) {
      await fs.copyFile(input.instructionsFilePath, instructionsTarget);
      ensureCleanupFile(instructionsTarget);
      stagedInstructionsPath = instructionsTarget;
    } else if (path.resolve(instructionsTarget) !== path.resolve(input.instructionsFilePath)) {
      rulesFilePath = input.instructionsFilePath;
      await input.onLog(
        "stdout",
        `[paperclip] Grok workspace already contains ${instructionsTarget}; using --rules @${input.instructionsFilePath} instead of overwriting it.\n`,
      );
    }
  } else {
    const canonicalAgents = path.join(input.cwd, "AGENTS.md");
    if (!(await pathExists(instructionsTarget)) && (await pathExists(canonicalAgents))) {
      await fs.copyFile(canonicalAgents, instructionsTarget);
      ensureCleanupFile(instructionsTarget);
      stagedInstructionsPath = instructionsTarget;
    }
  }

  const desiredSet = new Set(input.desiredSkillNames);
  const selectedSkills = input.skillEntries.filter((entry) => desiredSet.has(entry.key));
  if (selectedSkills.length > 0) {
    const claudeDir = path.join(input.cwd, ".claude");
    const skillsRoot = path.join(claudeDir, "skills");
    if (!(await pathExists(claudeDir))) {
      await fs.mkdir(claudeDir, { recursive: true });
      ensureCleanupDir(claudeDir);
    }
    if (!(await pathExists(skillsRoot))) {
      await fs.mkdir(skillsRoot, { recursive: true });
      ensureCleanupDir(skillsRoot);
    }
    for (const skill of selectedSkills) {
      const target = path.join(skillsRoot, skill.runtimeName);
      if (await pathExists(target)) {
        await input.onLog(
          "stdout",
          `[paperclip] Grok skill target already exists at ${target}; leaving it unchanged.\n`,
        );
        continue;
      }
      await materializePaperclipSkillCopy(skill.source, target);
      ensureCleanupDir(target);
      stagedSkillsCount += 1;
    }
  }

  return {
    stagedSkillsCount,
    stagedInstructionsPath,
    rulesFilePath,
    cleanup: async () => {
      for (const entry of [...cleanup].reverse()) {
        if (entry.kind === "file") {
          await fs.rm(entry.path, { force: true }).catch(() => undefined);
          continue;
        }
        await fs.rm(entry.path, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}