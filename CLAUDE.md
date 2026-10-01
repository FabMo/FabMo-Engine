# FabMo-Engine — notes for Claude

The FabMo server. See ~/.claude/CLAUDE.md (or fabmo-def/FABMO-DEV-OVERVIEW.md)
for the platform picture, team conventions, and safety rules. Read those first.

## Run, build, test

- Node ≥ 18. Entry point `server.js` → `engine.js` (the `Engine` object,
  `start()` wires everything up).
- Service on the Pi: `systemctl restart fabmo` after any server-side change.
- Dashboard is built by webpack: `npm run build` (dev mode; there is no real
  prod build) then hard-reload the browser. `dashboard/build/` is the output;
  edit `dashboard/static/` and app sources, not `build/`.
- Tests: `npm test` (jest; `test/*.test.js`). Coverage is thin — pendant
  parsing, canned cuts, opensbp variable isolation, util. There is no
  end-to-end or motion test; those are physical. Lint: `npm run lint`,
  format: `npm run prettier`. Husky runs on commit.
- Debug: `npm run debug` (`node server.js --debug`). Logs go through `log.js`;
  G2 traffic is logged as `g2: --S-…>` (sent) / `<-S-…` (received).

## Layout

| Path | What |
|------|------|
| `engine.js`, `server.js` | startup, HTTP server (restify), socket.io |
| `machine.js` | the Machine: owns `this.status`, drives runtimes, talks to G2 driver |
| `g2.js` | G2core serial driver. Fragile state handling — see "Do not" |
| `config/` | config tree: `machine_config.js`, `g2_config.js` (incl. status-report field list), `opensbp_config.js` (persistent variables), `engine_config.js`… |
| `runtime/opensbp/` | OpenSBP interpreter (`opensbp.js` is large), `commands/*.js` |
| `runtime/gcode/`, `runtime/manual/`, `runtime/idle.js`, `runtime/passthrough/` | other runtimes |
| `runtime/output_policy.js`, `output_triggers.js`, `bounds.js` | output masking, triggers, table limits |
| `routes/` | HTTP + websocket (`websocket.js` broadcasts `status` and `change` events) |
| `snapshots.js` | named settings restore points — see "Snapshots" below |
| `dashboard/static/js/main.js`, `libs/fabmoui.js`, `libs/fabmoapi.js`, `libs/fabmo.js` | dashboard shell, DRO/status rendering, client API |
| `dashboard/apps/*.fma/` | system apps (unzipped): editor, job_manager, previewer, configuration, sb4, tool_status, macro_manager, profile_designer, network_manager, video, selftest… |
| `profiles/fabmo-profile-*/` | per-machine profiles: `config/*.json`, `macros/macro_N.sbp` |
| `firmware/` | G2core `.bin` files shipped with the engine; `BOSSA/` flashes them |
| `pendant/`, `spindles/`, `network/` | pendant drivers, VFD/spindle drivers (Modbus), networking. `spindle1.js` + `spindles/vfd_probe.js`: the installed VFD profile is `/fabmo-def/spindle1_settings.json` (never in `/fabmo/spindles/`); templates in `spindles/spindle-VFD-data/`. Auto-detect runs on first/clean start and first start after an update; see `machine.startAccessories` |
| `doc/`, `CONFIG_VARIABLE_FEATURE.md`, `DEPENDENCY_UPDATE_MIGRATION.md` | docs |

## Profiles

All of `fabmo-profile-dt`, `-dtmax`, `-dtatc`, `default` are live and
shipping, joined (Sept 2026) by the large gantry tools: `-prsalpha`,
`-prsalpha-atc`, `-prs-carolina`, `-prs-carolina-atc`. The PRS profiles are
SB3-era retrofits — note their motor polarity (`1po`–`3po`: 1) is flipped
vs the G2 default because SB3 drove the DIR pin with the opposite
convention. `fabmo-profile-handibot-2` is legacy (a few discontinued
Handibots), rarely changed. A machine picks its profile from
`/fabmo-def/fabmo-def.json` on first boot.

Macros are commonized (Sept 2026): the shared set lives in
`profiles/default/macros/`, feature-specific sets in subdirectories
(`atc/`, later `laser/`, `knife/`) gated by the `machine.features`
booleans in machine config. Profiles no longer carry their own macros
(only `handibot-2` still does, plus any profile-specific override
dropped in a profile's `macros/` dir, which wins over the common set).
`macros.installProfile()` assembles the installed set at
`/opt/fabmo/macros` on startup, copy-if-not-exists — so edit a shared
macro in ONE place: `profiles/default/macros/`.

## Snapshots (Settings & Backups)

`snapshots.js` manages named restore points in `/opt/fabmo_snapshots/<name>/`:
`config/` (minus `instance.json`/`auth_secret`), `macros/`, `db/` (job history
metadata — cut files in `/opt/fabmo/files` are never stored on-tool, only
bundled into downloads), and `apps.json` — an inventory of installed apps
(id/name/version/archive filename). App archives are NOT embedded: restoring
Apps verifies the manifest against `/opt/fabmo/apps` (the boot loader
re-extracts any archive missing from the approot) and reports `missing_apps`.
A `source` field on apps is planned so connected machines can redownload
missing ones.

The default ("preferred") snapshot is recorded in three places — the
`.default` pointer file, a full mirror in `/fabmo-def/snapshots/<name>`, and
`snapshot_name` in `/fabmo-def/fabmo-def.json` — and is a tier in the boot
config-recovery chain (live backup mirror → default snapshot → profile).

Routes (`routes/config.js`): CRUD under `/snapshots`; restore accepts
`{parts: {config, macros, apps, jobdb}, set_default}` and then
`process.exit(0)` (systemd restarts the engine — blessing happens before the
restart on purpose); `GET /snapshots/:name/download?jobdb=1` bundles the cut
files into the `.fmsnap.zip`; `GET /jobdb/size` feeds the UI size estimate.
Gotchas: snapshot JSON endpoints signal errors as HTTP 200 +
`{status:"error"}` (check `resp.status`); restores are additive and never
delete files; only machine-idle allows create/restore.

UI: configuration app, General tab — two buttons ("Save Current Settings" /
"Restore Settings") with inline dialogs (the sandboxed iframe blocks
`prompt`/`confirm`). The old granular routes (macros backup/restore, history
export/import) remain server-side but have no UI. After editing the app's
`index.html`, copy it to `/opt/fabmo/approot/approot/configuration.fma/` —
the approot only rebuilds on engine version change or debug mode.

## Status pipeline (G2 → browser) — the classic silent failure

```
G2 status report → g2.js handleStatusReport (copies every SR key into g2.status)
  → machine._updateStatusFromDriver   ← copies ONLY keys already declared in
                                          machine.js `this.status` init. Anything
                                          else is SILENTLY DROPPED. No error.
  → routes/websocket.js               ← forwards the whole object
  → fabmoapi.js → fabmoui.updateStatusContent (DRO etc.)
```
To expose a new G2 field end-to-end: (1) add it to `config/g2_config.js`
`configureStatusReports` `sr:{…}`; (2) make sure G2core's max-SR size fits the
list (firmware constant — dropping another field to make room breaks that
field's live display); (3) declare it in `machine.js` `this.status`. Example:
`momo` (motion mode, 0 = rapid) added June 2026.

Persistent-variable changes do **not** push to clients: `configChanged` emit in
`opensbp_config.js` is commented out, and the `change` socket event only fires
for `"jobs"` and `"offsets"`. Apps read variables via `getConfig()` on load.
The pattern for a push is `machine.emit("change", "<topic>")` as in
`runtime/opensbp/commands/location.js`.

## OpenSBP specifics worth knowing

- `&TOOL` is read from the file (first read) and then handed to macros; the
  runtime special-cases it (opensbp.js ~L745, ~L2397, ~L3396). It is being
  cleaned up; avoid touching that path incidentally.
- Tool-number variables: canonical `$SB_TOOLCURRENT`; legacy `$ATC.TOOLIN`
  (ATC macros, tool_status app), `$TOOL_IN`, `&CURRENT_TOOL` (diagnostics).
  Reconciliation is a tracked issue; don't rename in passing.
- Macro 201 runs before the first file and initializes persistent variables.
- Tool-change macros: 9 (manual), 71/72/75 (ATC, dtatc profile).

## Apps

A system app is an unzipped `.fma` directory here; add-in apps are the same
package zipped. `sb4.fma` is dual-identity — it also exists as a standalone
repo and both are still maintained ("still both, unfortunately"); ask before
large Sb4 changes. Newer beta apps (tool_status, probe_logger, profile_designer,
segment_optimizer, hello-i18n) have their source of truth here.

## Do not, without an explicit ask

- Simplify or "clean up" `g2.js` quit/stop/hold/flush handling.
- Modernize callback code to promises as a side effect (see overview).
- Change status-report contents or timing, or add polling from the client.
- Change what outputs are on at startup/after a file (`output_policy.js`).
- Edit `dashboard/build/` by hand.
- Touch `handibot-2` profile unless the task names it.
