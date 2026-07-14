import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stripModuleSyntax(source) {
  return source
    .replace(/^import\s.+$/gm, "")
    .replace(/^export function /gm, "function ")
    .replace(/^export const /gm, "const ")
    .replace(/^export \{[^}]+\};?\s*$/gm, "")
    .replace(/\/\/# sourceMappingURL=.*$/gm, "")
    .trim();
}

const turnBoundary = stripModuleSyntax(
  fs.readFileSync(path.join(root, "dist/shared/turn-boundary.js"), "utf8"),
);
const grokStreamLine = stripModuleSyntax(
  fs.readFileSync(path.join(root, "dist/shared/grok-stream-line.js"), "utf8"),
);
const parseStdout = stripModuleSyntax(
  fs.readFileSync(path.join(root, "dist/ui/parse-stdout.js"), "utf8"),
);

const output = `"use strict";

${turnBoundary}

${grokStreamLine}

${parseStdout}

module.exports = {
  parseStdoutLine,
  createStdoutParser,
  createGrokStdoutParser,
  parseGrokStdoutLine,
};
`;

const outPaths = [
  path.join(root, "ui-parser.cjs"),
  path.join(root, "dist", "ui-parser.js"),
];
for (const outPath of outPaths) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${output}\n`);
}