# Bundled FabMo-Updater package

The release build places the pinned FabMo-Updater package here, e.g.:

    fabmo-updater_linux_raspberry-pi_v4.0.55.fmp

On startup, the engine compares this package's version (parsed from the
filename) against the installed updater's `/fabmo-updater/version.json`.
If the bundle is newer, the engine streams it to the updater's own
manual-update endpoint on loopback :81 a few minutes after boot (machine
idle), and the updater self-installs with its shadow-copy mechanism and
restarts its own service — invisible to the user. See `updater_bundle.js`
and `doc/updater-bundling.md`.

Packages are NOT committed to git (see .gitignore): the release process
(FabMo-Updater `scripts/build.js` on the release machine) downloads the
pinned updater release and drops it in this directory before packaging
the engine `.fmp`. A dev checkout with an empty directory simply skips
the check.
