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
| `dashboard/static/js/main.js`, `libs/fabmoui.js`, `libs/fabmoapi.js`, `libs/fabmo.js` | dashboard shell, DRO/status rendering, client API |
| `dashboard/apps/*.fma/` | system apps (unzipped): editor, job_manager, previewer, configuration, sb4, tool_status, macro_manager, profile_designer, network_manager, video, selftest… |
| `profiles/fabmo-profile-*/` | per-machine profiles: `config/*.json`, `macros/macro_N.sbp` |
| `firmware/` | G2core `.bin` files shipped with the engine; `BOSSA/` flashes them |
| `pendant/`, `spindles/`, `network/` | pendant drivers, VFD/spindle drivers (Modbus), networking |
| `doc/`, `CONFIG_VARIABLE_FEATURE.md`, `DEPENDENCY_UPDATE_MIGRATION.md` | docs |

## Profiles

All of `fabmo-profile-dt`, `-dtmax`, `-dtatc`, `default` are live and shipping.
`fabmo-profile-handibot-2` is legacy (a few discontinued Handibots), rarely
changed. More profiles for larger tools are coming. A machine picks its
profile from `/fabmo-def/fabmo-def.json` on first boot. A change to a macro
usually needs to be made in every profile that has that macro — check with
`grep -l` across `profiles/*/macros/` and say which profiles you changed.

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
