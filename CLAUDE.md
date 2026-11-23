# CLAUDE.md

Guidance for agents working in this repo. See `README.md` for users.

## Stack

- npm workspaces: `server` (Node, TypeScript, Express, vitest) and `web` (React 18, AG Grid, Vite).
- Windows scripts in `scripts\` (cmd and PowerShell 5.1). Node is at `D:\Node\nodejs`.

## Folder map

- `server\src\` API, TFS client, config loading. `server\test\` vitest tests.
- `web\src\` UI.
- `config\default.json` committed defaults; `config.local.json` is a gitignored override.
- `scripts\` start, stop, autostart.
- `data\` audit log `changes.jsonl`; `logs\` server output. Both gitignored.

## API contract

`server\src\types.ts` is the contract shared by both sides. When an API shape changes, update `types.ts`, the server and the web client together.

## Checks

After changes, run from the repo root: `npm test` and `npm run build`.

## Rules

- Never write to TFS while testing. Use `?dryRun=1` on write endpoints. Real writes only after the user approves a specific item.
- Never commit or push without explicit confirmation.
- Never log, print or write the PAT (`AZURE_DEVOPS_PAT`). Do not echo env values.
- Do not commit `config.local.json`, `data\`, `logs\`, `dist\` or `node_modules\`.
