# @paperclipai/adapter-grokcli

**Grok CLI adapter for Paperclip** — run autonomous agents via [xAI's grok-cli](https://x.ai/grok) headless mode with full tool access (files, shell, web search, subagents).

## Install in Paperclip Desktop

1. Build the package:

```bash
npm install
npm run build
```

1. In Paperclip → **Adapters** → **Install Adapter** → choose **Local path** and enter the project root:

```
/Volumes/External/workspace/projects/personal/paperclip-adapter-grokcli
```

1. Hire or reconfigure an agent to use adapter type **Grok CLI** (`grokcli`).

2. After code changes, rebuild (`npm run build`) and click **Reload** on the adapter in Paperclip (this clears the UI’s cached parser worker).

### Run transcript still shows raw `{"type":"thought",...}` JSON?

That means the **Paperclip UI** is still using the generic **process** parser, not this adapter’s `ui-parser.js`. The server log on disk is correct (streaming-json); only the **nice** transcript view is wrong until the dynamic parser loads.

**`GET …/heartbeat-runs/…/log?offset=…` → 404** is usually a timing race (log not flushed yet). It does **not** explain raw JSON in Nice when the same run’s log is available elsewhere.

**`curl` adapter reload is not enough for the browser.** Only **Adapters → grokcli → Reload** in the desktop UI calls `invalidateDynamicParser`, which clears the client’s `failedLoads` cache and restarts the sandboxed parser worker. Server-only reload leaves the UI stuck on the process parser until you use that button (or fully restart the app after a failed parser load).

1. Confirm the agent uses adapter type **`grokcli`** (not `grok_local` or `process`).
2. In the run detail panel, use **nice** (not **raw**). Raw mode shows unparsed log lines.
3. **Adapters → grokcli → Reload** after `npm run build` (same as step 4 above). Restarting the desktop app alone does **not** clear a failed parser load.
4. Open **Developer Tools** (Help → Toggle Developer Tools), **Console** + **Network**, then open a **grokcli** run (nice view).
   - **Network filter:** use `grokcli` or `ui-parser.js` — not only `ui-parser` (some filters miss the path).
   - **Preserve log** on, then reload the run panel or navigate away and back so the fetch can fire.
   - Success: `GET …/api/adapters/grokcli/ui-parser.js` → **200** (`Content-Type: application/javascript`).
   - Success console: `[adapter-ui-loader] Loaded sandboxed UI parser for "grokcli"`.
   - If there is **no** `ui-parser.js` request at all, the UI may still be using a cached failed load or the built-in **process** parser — **Adapters → grokcli → Reload**, then **fully close and reopen** the run (or restart the desktop app).
5. If you see `Failed to load UI parser`, worker init errors, or `GET …/ui-parser.js` → **404**, reload the adapter after `npm run build` and reopen the run. Paperclip **caches failed parser loads** until adapter reload / invalidation.
6. **Uncaught (in promise) … failed to convert value to `Response`:** often a **different** request (not the parser). In DevTools, expand the error **stack** and check the **failed URL** on the Network tab. A JSON **404** on `heartbeat-runs/.../log` right after starting a run is a common race and is separate from ui-parser; if the stack points at `ui-parser.js` or `adapter-ui-loader`, treat it as parser load failure (step 5).
7. Quick check from the project root (replace host/port with your Paperclip API origin, often the desktop app port e.g. **3101**):

```bash
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" \
  "http://127.0.0.1:3101/api/adapters/grokcli/ui-parser.js"
```

Expect `200 application/javascript`. `404` means the server did not load `dist/ui-parser.js` from this adapter install path — reinstall or reload the adapter after `npm run build`.

Paperclip desktop usually serves the API on the same origin as the UI (e.g. port **3101**), not necessarily `127.0.0.1:3100`.

## Why use this instead of `grok_local`?

The built-in `grok_local` adapter passes `--permission-mode dontAsk`, which causes grok-cli to **cancel shell tools**. This adapter:

- Uses `--prompt-file` + `--always-approve` (shell tools work)
- Discovers models live via `grok models` (including Composer)
- Defaults to `grok-composer-2.5-fast`
- Stages Paperclip-managed skills into `.claude/skills`
- Supports remote execution targets (sandboxes/SSH) like other local adapters

## Features

- Full grok-cli tool access in headless mode
- Live model discovery (`listModels`, `refreshModels`, `detectModel`)
- Paperclip-managed skills via `paperclipSkillSync`
- Instructions bundle staging to `Agents.md`
- Wake/resume prompts via `renderPaperclipWakePrompt`
- Session resume with `--resume`
- Remote execution target support
- Run viewer transcript parsing (`ui-parser.cjs`)
- Declarative agent config schema (`getConfigSchema`)

## Auth

- `grok login` — cached in `~/.grok/auth.json`
- `XAI_API_KEY` — for CI/headless environments (adapter config `env` or host env)

## Development

```bash
npm run typecheck
npm test
npm run build
```

## Configuration highlights

| Field | Default | Notes |
|-------|---------|-------|
| `model` | `grok-composer-2.5-fast` | Refresh models in the agent config UI |
| `maxTurnsPerRun` | `25` | Passed as `--max-turns` |
| `alwaysApprove` | `true` | Required for unattended tool use |
| `command` | `grok` | Path to grok binary |

Do **not** set `permissionMode: dontAsk` — it breaks shell execution in grok-cli.
