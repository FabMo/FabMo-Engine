# FabMo System Architecture (Three-Repo Overview)

This document describes how the three FabMo repositories fit together and how they deploy into the runtime data directory `/opt/fabmo`. Each repo also has its own `CLAUDE.md` with internal detail; this is the cross-cutting picture.

## The three repos + one data directory

| Path | Role | Mutability |
|------|------|------------|
| `/fabmo` | **Engine** — motion control, OpenSBP/G-Code runtimes, dashboard, REST/WebSocket API. Node `>=18.20.0`. | Source, replaced on update |
| `/fabmo-updater` | **Updater** — online updates (engine/firmware/self), OS patches, network, reboot, identity. Separate service on port 81. | Source, replaced on update |
| `/fabmo-def` | **Definitions** — first-boot auto-profile + persistent recovery snapshots. Data only, **lives outside `/opt`**. | Data, persists across wipes |
| `/opt/fabmo` | **Runtime data** — config, macros, db, hosted apps, profiles, logs. | Mutable; can be wiped/restored |

The guiding principle: **source code is immutable and replaceable; user data lives in `/opt/fabmo`; the survivable definition/recovery layer lives in `/fabmo-def` outside `/opt`.** This lets an update wipe and re-clone source without losing user state, and lets a wiped `/opt` be recovered.

## Ports & processes
- **Engine** — port 80 (+ Socket.IO 9876), `systemctl … fabmo` (`/fabmo/files/fabmo.service`, `ExecStart=node /fabmo/server.js`).
- **Updater** — port 81 (`server_port` in `updater.json`; it knows the engine is on `engine_server_port: 80`), `/fabmo-updater/files/fabmo-updater.service`.

Running the updater as an independent service is what lets it stop, replace, and restart the engine — and recover a broken engine — without taking itself down.

## `/opt/fabmo` layout (runtime data)
```
/opt/fabmo/
├── approot/    # extracted, hosted dashboard apps
├── apps/       # user-installed .fma app archives
├── config/     # active config (engine.json, machine.json, user.json, …) + .auto_profile_applied marker
├── db/         # TingoDB collections (files, jobs, thumbnails)
├── macros/     # user macros (.sbp / .nc with embedded !FABMO! headers)
├── profiles/   # runtime copies of machine profiles
├── fmus/       # FabMo Modular Update config packages
├── files/      # uploaded cut files
├── log/        # engine logs
└── update.fmp  # current update package
```
Plus engine-managed siblings outside `/opt/fabmo`:
- `/opt/fabmo_backup/` — automatic mirror of config/macros/apps on every config save (with a small `config_history/`).
- `/opt/fabmo_snapshots/` — user-created/auto snapshots (baselines).
- `/opt/patches/` — updater patch-applied state (kept here so it survives engine reinstalls).

## First boot (auto-provisioning)
1. Device image ships `/fabmo`, `/fabmo-updater`, `/fabmo-def`.
2. `systemctl start fabmo` runs `/fabmo/server.js`; the engine creates the `/opt/fabmo` tree if missing.
3. Engine copies system profiles from `/fabmo/profiles/` → `/opt/fabmo/profiles/`.
4. Engine reads `/fabmo-def/fabmo-def.json`. If `auto_profile.enabled` and not yet applied:
   - marks `in_progress` in `/opt/fabmo/config/.auto_profile_applied`,
   - applies the named profile (config/macros/apps copied into `/opt/fabmo/`),
   - restarts (a deliberate "double boot"), then marks the profile applied.
5. Dashboard system apps are copied from `/fabmo/dashboard/apps/` into `/opt/fabmo/approot/`.
6. Engine is ready; users can upload custom apps/macros.

See `/fabmo-def/CLAUDE.md` and `/fabmo/config/profile_definition.js` for the auto-profile contract.

## Update flow (updater-driven)
1. Updater polls a remote manifest for newer `.fmp` packages (semver compare in `fmp/fmp.js`; **updater self-updates first**, then engine/firmware).
2. Downloads the `.fmp` and invokes the platform hook under `/fabmo-updater/hooks/<os>/<platform>/`.
3. Typical engine **update** (`update_engine.sh`): `systemctl stop fabmo` → `git fetch`/checkout new tag in `/fabmo` → `npm install` → **clear only `/opt/fabmo/approot`** → `systemctl start fabmo`. Config, macros, and profiles are preserved.
4. Typical engine **install** (`install_engine.sh`, fresh device): stop → **wipe `/opt/fabmo` and `/fabmo`** → `git clone` + checkout → `npm install` → start. Destroys user data — first-time setup only.
5. On restart the engine re-populates `approot` with the updated system apps.

The engine vs. updater difference matters: **update preserves `/opt/fabmo`; install wipes it.**

## Recovery & persistence
- **Config corruption** is recovered by a chain: `/opt/fabmo_backup/config/` → user-default snapshot → rebuild from `/opt/fabmo/profiles/<profile>/config/` → fall back to source `/fabmo/profiles/<profile>/config/`.
- **`/opt` wiped**: user-default snapshots mirrored into `/fabmo-def/snapshots/` (outside `/opt`) allow config/macros to be restored; auto-profile in `fabmo-def.json` reprovisions the machine type.
- **Profile switch** snapshots current state, then replaces `/opt/fabmo/{config,macros,apps}` with the profile's versions and clears `approot`.

## Data flow at runtime (within the engine)
```
G2 Driver (g2.js) → Machine Model (machine.js) → WebSocket (Socket.IO) → Dashboard
```
Jobs: file → db.js → queue → machine selects a runtime (SBP/GCode/Manual/…) → streams to G2 → status events flow back. See `/fabmo/CLAUDE.md` for engine internals.

## Where to look
- Engine internals → `/fabmo/CLAUDE.md`, `/fabmo/doc/project_layout.md`
- Update/patch/hook mechanics → `/fabmo-updater/CLAUDE.md`, `/fabmo-updater/hooks/`, `/fabmo-updater/fmp/`
- Auto-profile & recovery contract → `/fabmo-def/CLAUDE.md`, `/fabmo/config/profile_definition.js`, `/fabmo/snapshots.js`
