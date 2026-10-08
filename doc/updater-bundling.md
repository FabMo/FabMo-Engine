# Bundled Updater Updates: One Product, Zero Questions

**Status: engine side implemented (2026-10); release-side change pending.**

## Problem

FabMo-Updater updates were a separate, user-visible product sharing the old
updater page's buttons: users were told "an updater update is available"
and had to install it before the engine update, a sequencing detail no
customer should ever see. The new config-app update flow (one button, PR
#1532) made this worse: it deliberately shows only `FabMo-Engine` packages,
so updater updates had no surface at all.

## Design (agreed 2026-10-07)

The updater stops being user-visible. Each engine release carries the
pinned updater package, and the updater is brought current **in the
background after the engine update**, with zero user interaction:

1. The release build drops the pinned updater `.fmp` into
   `bundled_updater/` in the engine tree (gitignored; the directory ships
   a README documenting the contract).
2. On startup, `updater_bundle.js` compares the bundled package's version
   (parsed from its filename) with `/fabmo-updater/version.json`.
3. If the bundle is newer, a few minutes after boot and once the machine
   is idle, the engine streams the package to the updater's own
   manual-update endpoint on loopback :81 (the same proven relay used by
   the browser/USB install paths — see `routes/updater.js
   relayPackage`).
4. The updater applies it with its existing shadow-copy self-update
   (`/tmp/temp-updater` + `--selfupdate`) and restarts its own service.
   The engine, dashboard, and any running job are untouched.

### Why this ordering is safe

- The engine update is applied by the *old* updater first; the updater
  then catches up in the background. Engine packages are plain tarballs —
  they have not historically required a newer updater to install. If that
  ever changes, add an `updater_needed` gate to the manifest as the
  escape hatch (the old flow's "updater first" ordering would need a
  one-release special case).
- Only upgrades happen (semver compare); failed attempts simply retry on
  the next boot, because `/fabmo-updater/version.json` advances only when
  the self-update succeeds.
- An unreadable installed version, a missing bundle, or an unreachable
  updater service all mean "do nothing, silently".

### Idle gating

The updater restart would not disturb motion (separate service), but the
install is still deferred until the machine is idle and a few minutes
past boot — update churn while cutting buys nothing and risks confusion
in support logs.

## What remains (release machine, not this repo)

`FabMo-Updater/scripts/build.js` must download the pinned updater release
and place it in `bundled_updater/` before packaging the engine `.fmp`
(~26 MB added to the ~62 MB engine package). Standalone updater releases
stay on the manifest for recovery and image builds; the config app and
sidebar badge continue to ignore the `FabMo-Updater` product.

## Rollout

The first engine release carrying a bundle installs under the old updater
normally; its first boot then brings the updater current. Fleet units
skipping several versions converge the same way — whatever engine lands,
its bundled updater follows.
