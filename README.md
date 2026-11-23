# cmfProductManagement

Local web app that replaces the Excel Connect IoT backlog. It reads Connect IoT work items from TFS (`Products/Product`), lets you edit business order, state, tags and titles in a grid, and writes approved changes back to TFS. The browser talks only to the local server; the server talks to TFS with your PAT.

## Prerequisites

- Node.js at `D:\Node\nodejs\node.exe` (falls back to `node` on PATH).
- This repo on `N:` (BitLocker). After logon, unlock `N:` manually.
- User environment variable `AZURE_DEVOPS_PAT` (TFS personal access token). The app never stores it.
- Internal root CA at `N:\Product\.claude\cmf-root-ca.pem`. The scripts set it as `NODE_EXTRA_CA_CERTS`.

## First run

```
scripts\start.cmd            (add --no-browser to skip opening the browser)
```

Installs dependencies on first run (`npm ci`), runs `npm run build` when `server\src` or `web\src` is newer than the build output, starts the server minimized, waits for `/api/health` and opens <http://127.0.0.1:5180>.

## Autostart at logon

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 [-OpenBrowser]
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1
```

The installer copies `launcher.ps1` to `%LOCALAPPDATA%\cmfProductManagement\` and creates a Startup shortcut. At logon the launcher waits (polls every 20 s, up to 12 h) until `N:` is unlocked and `scripts\start.cmd` exists, then starts the server hidden. Re-run the installer after editing `launcher.ps1`, because the C: copy is a snapshot. Uninstall removes the shortcut and that folder; it does not stop a running server.

## Stop

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop.ps1
```

Stops `node.exe` processes whose command line contains `server\dist\index.js`. It does not stop `npm run dev`.

## Dev mode

```
npm run dev
```

Server on :5180 (watch mode) and Vite on :5181. Open <http://127.0.0.1:5181> in dev mode. Do not run `start.cmd` at the same time, because both use port 5180.

## Configuration

- `config/default.json`: committed defaults (port, TFS server, backlogs, WIQL template, score bands, component rules, version tags, editable fields). **Min ver / Max ver** are not configured: they are the lowest and highest version-like tags of the item (`12.0x`, `12.0.x`, `12.0`, `11x`, `12.1.0` …; a line tag such as `12.1x` is the start of its line for Min and the whole line for Max).
- `config.local.json`: personal overrides, gitignored. Edit it from the **Settings** page in the app. A legacy `wiql` key is ignored and removed on the next save.

### Backlogs (tabs)

Each backlog is one area path with its own tab (`#/b/<id>`). In **Settings > Backlogs (tabs)** you can add, order, rename, colour and hide backlogs (hidden = no tab, nothing deleted). Every backlog is loaded with the shared **WIQL template**, where `{{areaPath}}` is replaced by the backlog's area path (single quotes are escaped). Enable **Custom WIQL** on a row to override the template for that backlog only. Bands, version and component rules and editable fields are shared by all backlogs. Each tab keeps its own cache, pending edits and column layout (`cmfpm.columnState.v1.<id>`; the old single layout is used as a fallback).

API: `/api/backlog`, `/api/metrics`, `/api/tags` and `/api/changes` take `?backlog=<id>`. Missing = first configured backlog; unknown id = 404.

### Tags filter

The Tags column filter lists every distinct tag (ascending, with counts; **(no tags)** last). Unchecking a tag hides every item that has it; tags added later are shown by default. **only** next to a tag shows just the items with that tag (shown as a banner with ✕ to remove it). Pending edits count. **Settings > Tags filter > Hidden by default** lists tags that start unchecked in every backlog; the filter's **defaults** link restores them after you change the filter.

### Feature items (fold)

In the Backlog view, items whose parent is a Feature are listed right under that Feature (indented with ↳, in their own sort order). The **▾ N** button on a Feature row folds or unfolds its N items. **Feature items ▾ Show all / ▸ Hide all** in the toolbar does it for every Feature; "N folded" counts the folded items. The fold state is kept per backlog in the browser (`cmfpm.featureFold.v1.<id>`). A parent Feature from another area (or already closed) is added as a grey, read-only header row marked **other area**, so its items can be folded too. It can't be edited, selected or moved (right-click offers only details and Open in TFS), and it isn't counted in the metrics. If a filter hides a Feature row, its items show in their normal place.

### Comments waiting for you

An item is **waiting** when someone else's comment @mentions you and is newer than your own latest comment on it. The 💬 column (next to ID) shows how many such comments it has; hover for the latest one. When a tab opens with waiting items, a notification lists them (click it to filter), and the **Waiting for me** card toggles the same filter. It clears when you reply in TFS, or with **Mark handled** in the item details (local only, stored in `data\attention-acks.json`; **Undo** restores it). The scan runs the backlog's WIQL and reads each item's revision and comment count fresh from TFS (it does not depend on the tab's cached list), then fetches comments only for items with comments whose revision changed. While a tab is visible it re-checks every 5 minutes and when you return to the window (at most once a minute); new waiting comments raise a "New comment waiting for you" notification. API: `GET /api/attention?backlog=<id>`, `POST|DELETE /api/attention/<id>/ack`.

### Tab badges

Each area tab shows **💬N** (items with comments waiting for you, in the backlog and in To validate) and **✓N** (items to validate). They come from `GET /api/summary`, refreshed every 5 minutes, when you return to the window (at most once a minute) and after a Close/Reject. The server warms this at startup (the first scan reads every commented item; about 10 s).

### To validate

Each area has sub-tabs **Backlog | To validate** (`#/b/<id>/validate`). To validate lists the Resolved items assigned to you in that area (Settings > Validation > WIQL template, `{{areaPath}}` = the area), oldest resolved first, with Resolved reason / by / on and **Waiting** days (amber from 14, red from 30).

- **PR versions**: the versions each item's **completed** pull requests went into, from any repo (`12.1/dev` → 12.1, `11.3/7/beta` → 11.3.7). Other target branches (`development`, `dev`, feature branches) show as grey chips. Each chip opens its PR; the tooltip lists all of them, plus any PR still active. The PR links are read with the list (completed PRs are cached until restart, active ones are re-read).
- **⚠ No PR — analyse**: the item has no completed pull request (red chip, red stripe on the row). It isn't ready to validate as-is; **⚠ No PR only** in the toolbar shows just these. A grey **?** means the links could not be read from TFS.
- **✓ Close** (toolbar or right-click, on the selected rows): writes to TFS immediately — State Closed with the close reason of the type (Bug: Verified; Story/Feature/Epic: Acceptance tests pass).
- **✗ Reject…**: asks for an optional comment, then sets State Active with the reject reason (Bug: Test Failed; Story/Feature/Epic: Acceptance tests fail); the comment is added to the item's discussion. The item reappears in the Backlog view.
- All items are validated first (`validateOnly`); if any fails nothing is written. Otherwise successes are kept and failures listed in a dialog. Each write is logged in `data\changes.jsonl` (`kind: "validation"`). Reasons per type are in Settings > Validation.

API: `GET /api/validation?backlog=<id>`, `POST /api/validation/transition?backlog=<id>[&dryRun=1]` (`{ items: [{id, rev}], action: "close"|"reject", comment? }`), `GET /api/attention?backlog=<id>&view=validate`.

### Setting the iteration

Right-click a row and open **Set iteration**: the list holds the distinct iterations of the items in this backlog, ordered by their lowest BusinessOrder (BO −1 and empty do not rank; those iterations go last, by name). Choosing one writes it to TFS immediately, like a move, together with any pending edits of those items; a failure parks it as a pending change and opens the changes dialog.

### Assign to me

Right-click a row (or several selected rows) and choose **Assign to me**: `System.AssignedTo` is set to the signed-in TFS user immediately. The client sends `@me`; the server resolves it from `connectionData` and accepts no other value for that field.

### Moving items between backlogs

Right-click a row (view or edit mode; with several rows selected it acts on all of them) and choose **Move to <backlog>**. The move is written to TFS immediately (`System.AreaPath` set to that backlog's area path), together with any pending edits of those items. Success shows a notification; the moved items disappear from the source tab and the other backlogs reload from TFS. If it fails, the move stays as a pending change (Area column, italic row with a stripe in the target colour) and the changes dialog opens with the error; **Undo move** in the same menu drops it. The server accepts an area path change only to the area path of a configured backlog.

## Editing workflow

1. Switch to **Edit** mode.
2. Click a cell and type. Enter moves down one row.
3. Click **Apply**: the changes are written to TFS at once and a notification shows the result. If anything fails, the changes dialog opens with the errors.
4. Optional: **Review** opens the changes dialog first, with **Dry run** (no TFS writes).

Failure semantics: a pre-validation failure writes nothing. A runtime failure keeps the rows that succeeded; the failed rows stay pending for a retry.

## Security

- The server listens on `127.0.0.1` only.
- API requests must carry the `X-CMF-PM` header.
- The PAT is read from the `AZURE_DEVOPS_PAT` environment variable. It is never written to disk, config or logs.

## Files and folders

| Path | Contents |
|---|---|
| `server\` | Express API and TFS client (TypeScript). `server\src\types.ts` is the API contract. |
| `web\` | React and AG Grid UI (Vite). |
| `config\default.json` | Committed defaults. |
| `scripts\` | `start.cmd`, `stop.ps1`, `launcher.ps1`, `install-autostart.ps1`, `uninstall-autostart.ps1`. |
| `data\changes.jsonl` | Audit log of changes, one JSON object per line (gitignored). |
| `logs\` | Server output: `server.log`, `server.err.log` (gitignored). |
| `server\dist`, `web\dist` | Build output (gitignored). |
| `%LOCALAPPDATA%\cmfProductManagement\` | Autostart copy of the launcher, `launcher.log`, `start.log`. |
