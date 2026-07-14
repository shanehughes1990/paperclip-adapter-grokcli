export const agentConfigurationDoc = `# grokcli adapter configuration

## Use when
- You want to run agents via xAI's Grok CLI (headless mode) with full tool access
- You need local file editing, shell commands, web search, and subagents via grok-cli
- You already have grok-cli installed and authenticated (\`grok login\` or XAI_API_KEY)

## Core fields
- \`command\` (string, optional) — Path to grok binary. Default: "grok"
- \`model\` (string, optional) — Grok model id, e.g. "grok-composer-2.5-fast" or "grok-build"
- \`cwd\` (string, optional) — Working directory for the agent process
- \`instructionsFilePath\` (string, optional) — Absolute path to markdown instructions injected via --rules
- \`promptTemplate\` (string, optional) — Run prompt template with {{agent.id}} etc.
- \`maxTurnsPerRun\` (number, optional) — Max agentic turns (--max-turns). Default: 25
- \`effort\` (string, optional) — Effort level: low, medium, high, xhigh, max
- \`alwaysApprove\` (boolean, optional) — Auto-approve tool executions (--always-approve). Default: true
- \`extraArgs\` (string[], optional) — Additional CLI arguments
- \`env\` (object, optional) — KEY=VALUE environment variables
- \`skillsDir\` (string, optional) — Skills root for injection into --rules

## Auth
- \`grok login\` (browser or device code) — cached in ~/.grok/auth.json
- \`XAI_API_KEY\` env var or adapterConfig.env — for CI/headless environments

## Don't use when
- You want direct HTTP API access without the grok-cli binary (use an API adapter instead)
- grok-cli is not installed on the host running Paperclip
`;