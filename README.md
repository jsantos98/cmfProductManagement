# PM Cockpit (cmfProductManagement)

Local web app for daily Connect IoT Product Management. Its **Home** page gathers what needs attention today (comments to reply, running features, items to validate, triage, next-version progress, recent changes), and each area tab replaces the Excel backlog: it reads Connect IoT work items from TFS (`Products/Product`), lets you edit business order, state, tags and titles in a grid, and writes approved changes back to TFS. The browser talks only to the local server; the server talks to TFS with your PAT.

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

### Layout

- **Sidebar** (left): **Home**, then each area with **Backlog** and **To validate**, and **Settings** at the bottom. Badges show pending edits (orange), comments waiting for you (💬) and items to validate. The footer shows the TFS connection (green dot = connected) and **« Collapse** (icons only; remembered in the browser).
- **Look** ("Control room"): navy sidebar and header band, teal accent, compact rows. All colours, sizes and the AG Grid theme come from the tokens at the top of `web\src\styles.css`.
- **Pages**: a header band (area, title, Backlog | To validate tabs, actions), then KPI tiles (click to filter), a filter bar (search + removable filter chips + page controls) and the grid.
- **Item details** open in a **side panel on the right** (click a row; on Home click an item). The grid stays usable and the open row is highlighted. ↑/↓ steps through the rows (or the card's list on Home), Esc closes, **TFS ↗** opens it in TFS; drag the panel's left edge to resize it (remembered, `cmfpm.detailsWidth.v1`).

### Home

The app opens on **Home** (`#/`): a dashboard of KPI tiles (click one to see its list as a sortable table below) with a Feature progress panel on the right. It reloads every 5 minutes while Home is visible and when you come back to it after more than a minute; **↻ Refresh** reloads everything from TFS.

| Section | Contents |
|---|---|
| 💬 Comments to reply | Items with comments waiting for you, in every area (backlog and To validate), newest first. Handled ones are left out. |
| 🚀 Running features | Your **Active** Features with a progress bar of their child items (Closed / Resolved / Active / New; Removed not counted). ▸ lists the items. Your **New** Features are under "Not started". |
| ✓ To validate | Per area: count, ⚠ No PR, My Feature, oldest waiting, and the 5 oldest items. |
| 🧭 Triage (BO −1) | Per area: items not reviewed yet (BusinessOrder −1) by type, oldest first. |
| 🎯 Next version | Per area: items tagged with the Next version tag in any state (except Removed), with a state bar and % done (Resolved + Closed). |
| 🕑 Recently changed | Items changed by others in the last *N* days (default 3), newest first, up to 30. |

The queries for features, next version and recent changes are in **Settings > Home**. The others reuse the backlog, To validate and comment scans. All Home calls only read from TFS. API: `GET /api/home/{comments,features,validate,triage,next-version,recent}[?refresh=1]`.

### Areas (backlogs)

Each backlog is one area path with its own entry in the sidebar (`#/b/<id>`). In **Settings > Areas** you can add, order, rename, colour and hide backlogs (hidden = not in the sidebar, nothing deleted). Every backlog is loaded with the shared **WIQL template**, where `{{areaPath}}` is replaced by the backlog's area path (single quotes are escaped). Enable **Custom WIQL** on a row to override the template for that backlog only. Bands, version and component rules and editable fields are shared by all backlogs. Each area keeps its own cache, pending edits and column layout (`cmfpm.columnState.v1.<id>`; the old single layout is used as a fallback).

API: `/api/backlog`, `/api/metrics`, `/api/tags` and `/api/changes` take `?backlog=<id>`. Missing = first configured backlog; unknown id = 404.

### Tags filter

The Tags column filter lists every distinct tag (ascending, with counts; **(no tags)** last). Unchecking a tag hides every item that has it; tags added later are shown by default. **only** next to a tag shows just the items with that tag (shown as a filter chip with ✕ to remove it). Pending edits count. **Settings > Versions & tags > Hidden by default** lists tags that start unchecked in every backlog; the filter's **defaults** link restores them after you change the filter.

### Feature items (fold)

In the Backlog view, items whose parent is a Feature are listed right under that Feature (indented with ↳, in their own sort order). The **▾ N** button on a Feature row folds or unfolds its N items. **Feature items ▾ Show all / ▸ Hide all** in the filter bar does it for every Feature; "N folded" counts the folded items. The fold state is kept per backlog in the browser (`cmfpm.featureFold.v1.<id>`). A parent Feature from another area (or already closed) is added as a grey, read-only header row marked **other area**, so its items can be folded too. It can't be edited, selected or moved (right-click offers only details and Open in TFS), and it isn't counted in the metrics. If a filter hides a Feature row, its items show in their normal place.

### Comments waiting for you

An item is **waiting** when someone else's comment @mentions you and is newer than your own latest comment on it. The 💬 column (next to ID) shows how many such comments it has; hover for the latest one. When a tab opens with waiting items, a notification lists them (click it to filter), and the **💬 Waiting for me** tile toggles the same filter. It clears when you reply in TFS, or with **Mark handled** in the item details (local only, stored in `data\attention-acks.json`; **Undo** restores it). The scan runs the backlog's WIQL and reads each item's revision and comment count fresh from TFS (it does not depend on the tab's cached list), then fetches comments only for items with comments whose revision changed. While a tab is visible it re-checks every 5 minutes and when you return to the window (at most once a minute); new waiting comments raise a "New comment waiting for you" notification. API: `GET /api/attention?backlog=<id>`, `POST|DELETE /api/attention/<id>/ack`.

### Sidebar badges

Under each area, **Backlog** shows 💬N (items with comments waiting for you) and **To validate** shows 💬N and the number of items to validate. They come from `GET /api/summary`, refreshed every 5 minutes, when you return to the window (at most once a minute) and after a Close/Reject. The server warms this at startup (the first scan reads every commented item; about 10 s).

### To validate

Each area has **Backlog | To validate** (sidebar, or the tabs in the page header; `#/b/<id>/validate`). Tiles on top: To validate, ⚠ No PR and My Feature and 💬 Waiting (click to filter), Oldest waiting, Resolved this week. To validate lists the Resolved items in that area that are assigned to you, plus the Resolved items whose parent Feature is assigned to you (whoever has the item). Oldest resolved first, with Resolved reason / by / on and **Waiting** days (amber from 14, red from 30). **Listed for** says why an item is there: *Assigned to me*, or a purple **My Feature** chip with the item's own assignee. Both queries are in Settings > Validation (`{{areaPath}}` = the area); the second one is a one-hop link query (`FROM WorkItemLinks`) and can be left empty to turn it off. The ✓ tab badge and the 💬 count include both.

- **PR versions**: the versions each item's **completed** pull requests went into, from any repo (`12.1/dev` → 12.1, `11.3/7/beta` → 11.3.7). Other target branches (`development`, `dev`, feature branches) show as grey chips. Each chip opens its PR; the tooltip lists all of them, plus any PR still active. The PR links are read with the list (completed PRs are cached until restart, active ones are re-read).
- **⚠ No PR — analyse**: the item has no completed pull request (red chip, red stripe on the row). It isn't ready to validate as-is; the **⚠ No PR** tile shows just these. A grey **?** means the links could not be read from TFS.
- **✓ Close** (the bar that appears at the bottom when rows are selected, or right-click): writes to TFS immediately — State Closed with the close reason of the type (Bug: Verified; Story/Feature/Epic: Acceptance tests pass).
- **✗ Reject…**: asks for an optional comment, then sets State Active with the reject reason (Bug: Test Failed; Story/Feature/Epic: Acceptance tests fail); the comment is added to the item's discussion. The item reappears in the Backlog view.
- All items are validated first (`validateOnly`); if any fails nothing is written. Otherwise successes are kept and failures listed in a dialog. Each write is logged in `data\changes.jsonl` (`kind: "validation"`). Reasons per type are in Settings > Validation.

API: `GET /api/validation?backlog=<id>`, `POST /api/validation/transition?backlog=<id>[&dryRun=1]` (`{ items: [{id, rev}], action: "close"|"reject", comment? }`), `GET /api/attention?backlog=<id>&view=validate`.

### Setting the iteration

Right-click a row and open **Set iteration**: the list holds the distinct iterations of the items in this backlog, ordered by their lowest BusinessOrder (BO −1 and empty do not rank; those iterations go last, by name). Choosing one writes it to TFS immediately, like a move, together with any pending edits of those items; a failure parks it as a pending change and opens the changes dialog.

### Assign to me

Right-click a row (or several selected rows) and choose **Assign to me**: `System.AssignedTo` is set to the signed-in TFS user immediately. The client sends `@me`; the server resolves it from `connectionData` and accepts no other value for that field.

### Moving items between backlogs

Right-click a row (view or edit mode; with several rows selected it acts on all of them) and choose **Move to <backlog>**. The move is written to TFS immediately (`System.AreaPath` set to that backlog's area path), together with any pending edits of those items. Success shows a notification; the moved items disappear from the source tab and the other backlogs reload from TFS. If it fails, the move stays as a pending change (Area column, italic row with a stripe in the target colour) and the changes dialog opens with the error; **Undo move** in the same menu drops it. The server accepts an area path change only to the area path of a configured backlog.

### Customer Portal: enhancement requests

**Customer Portal → Enhancement requests** in the sidebar (`#/portal`) tracks the Enhancement Request tickets of the CM Customer Portal (`portal.criticalmanufacturing.com`).

- **Sign in** once with **Sign in to Customer Portal**. It uses the normal CM login (OAuth 2 code + PKCE, client `Applications`, scope `Applications`, callback `http://127.0.0.1:5180/api/portal/callback`). The access token stays in memory. The refresh token is kept in Windows Credential Manager (generic credential `cmfpm/customer-portal`, via `scripts\credstore.ps1`), so the sign-in survives restarts. **Sign out** removes it.
- **My requests**: the tickets you pin. They are listed whatever their state, with the last reply (who, role, when) and *waiting for support*.
- **Suggestions**: open tickets (`openStates`) of the request type owned by `ownershipRole` whose title or text contains one of the `keywords` (whole words, case-insensitive). **Pin** moves one to My requests; **Dismiss** hides it. Pins and dismissals are local, in `data\portal-pins.json`.
- Click a row for the details panel: properties and the conversation, including internal notes (the HTML is shown in a sandboxed frame).
- Settings are the `portal` block of the config (keywords, request type, ownership role, open states, endpoints). Nothing is written to the portal yet. Assign, Assessed, Close, Reply and work item links come later, each behind a confirmation.

API: `GET /api/portal/status`, `GET /api/portal/login`, `POST /api/portal/logout`, `GET /api/portal/requests[?refresh=1]`, `GET /api/portal/tickets/<id>`, `POST|DELETE /api/portal/pins/<id>`, `POST|DELETE /api/portal/dismissed/<id>`.

## Editing workflow

1. Turn on **Edit mode** (switch in the page header), or just click a BusinessOrder cell.
2. Click a cell and type. Enter moves down one row. Select rows (checkboxes) to get the bulk bar at the bottom: add/remove a tag, set BusinessOrder, mark/unmark the next version.
3. While edits are pending, an orange bar above the grid shows how many items changed. **Apply** writes them to TFS at once and a notification shows the result. If anything fails, the changes dialog opens with the errors.
4. Optional: **Review** opens the changes dialog first, with **Dry run** (no TFS writes). **Discard** drops them.

Failure semantics: a pre-validation failure writes nothing. A runtime failure keeps the rows that succeeded; the failed rows stay pending for a retry.

## Security

- The server listens on `127.0.0.1` only.
- API requests must carry the `X-CMF-PM` header.
- The PAT is read from the `AZURE_DEVOPS_PAT` environment variable. It is never written to disk, config or logs.
- Customer Portal tokens are never written to files, logs or API responses. Only the refresh token is stored, in Windows Credential Manager, under your Windows account.

## Files and folders

| Path | Contents |
|---|---|
| `server\` | Express API and TFS client (TypeScript). `server\src\types.ts` is the API contract. |
| `web\` | React and AG Grid UI (Vite). |
| `config\default.json` | Committed defaults. |
| `scripts\` | `start.cmd`, `stop.ps1`, `launcher.ps1`, `install-autostart.ps1`, `uninstall-autostart.ps1`. |
| `data\changes.jsonl` | Audit log of changes, one JSON object per line (gitignored). |
| `data\portal-pins.json` | Pinned and dismissed Customer Portal tickets (gitignored). |
| `logs\` | Server output: `server.log`, `server.err.log` (gitignored). |
| `server\dist`, `web\dist` | Build output (gitignored). |
| `%LOCALAPPDATA%\cmfProductManagement\` | Autostart copy of the launcher, `launcher.log`, `start.log`. |
