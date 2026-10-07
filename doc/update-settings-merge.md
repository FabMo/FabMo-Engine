# Updates You Can Trust: Preserving Custom Settings Across Software Updates

> **ADOPTED SIMPLIFICATION (2026-10-07, implemented):** rather than the full
> three-way merge below, the implemented policy is **additive-only**: on the
> first start after an update, NEW keys shipped by the updated profiles are
> added to `machine.json`/`g2.json`/`opensbp.json`; every existing value is
> left strictly alone (envelope, unit values, calibration, and persistent
> variables are per-machine state). A newly shipped default variable arrives
> additively; an existing variable is never overwritten. opensbp.json's
> backup-recovery tier is never skipped. Auto-profile reapply is fully
> non-destructive: config and macros are preserved, and apps install
> additively by app id (profile apps the machine lacks are added; nothing
> is removed or replaced — user-installed apps survive). Unmodified macros
> auto-update via the base-hash tracking; the "keep new / restore old"
> prompt is suppressed in the non-destructive path. See `profile_reconcile.js`. The trade-off
> (accepted): a changed factory default for an *existing* key does not land
> on machines — ship such corrections some other way if ever needed. The
> three-way design below is retained as reference for that eventuality.

**Status: proposal — for team discussion.** Companion to the updater-bundling
proposal (packaging FabMo-Updater updates inside engine packages). Together
they aim at one promise: *a customer can click "Install" and nothing they
care about gets lost or asked of them.*

## The problem

After a software update (or any auto-profile application), the dashboard asks:

> **Keep new settings** or **Restore old settings?**

This is a binary choice between two wrong answers, and the customer has no
way to know which losses hide behind each button:

- **"Keep new settings"** silently discards their home position, tool
  calibration, VFD setup, table size, speeds — everything they intentionally
  changed since the tool was set up.
- **"Restore old settings"** silently discards whatever the update
  intentionally shipped — corrected defaults, new config keys, fixed values.

Of course they click "keep new settings" — it sounds like what an update is
for — and then they're surprised the machine forgot where home is.

Three incidents/hazards motivate fixing this at the root:

1. **The unanswerable modal** (above) — a support burden and a trust cost on
   every update.
2. **The 2026-07-30 `$`-variable wipe** — an update's auto-profile
   application reset `opensbp.json` persistent variables (tool offsets,
   calibration state). Machine *state* was treated as profile *settings*.
3. **The stale-snapshot recovery hazard** — the preferred snapshot
   (Settings & Backups, the tier-2 entry in the boot config-recovery chain)
   is not refreshed by updates. A corruption recovery weeks after an update
   faithfully restores *pre-update* config against the *post-update* engine,
   re-breaking whatever the update fixed. (Manual profile *changes* already
   handle this — `routes/config.js` calls `snapshots.clearDefault()` — but
   engine updates do no equivalent.)

## How it works today (mechanics)

- `/fabmo-def/fabmo-def.json` `auto_profile` drives profile application on
  first/clean boot; updates can re-trigger application.
- Before applying, `config_watcher.js` backs up current config to
  `/opt/fabmo_backup/pre_auto_profile/` and writes the
  `/opt/fabmo/config/.auto_profile_applied` marker.
- Application overwrites `/opt/fabmo/config/*.json` with profile defaults —
  **wholesale**; user deltas are not distinguished from defaults.
- On next dashboard load, `GET /config/backup_restore_status` decides
  `should_prompt` from the marker, and the modal asks keep-vs-restore.
  "Restore" copies the backup back; "keep" stamps
  `user_choice: "keep_new_config"` in the marker.
- Boot config-recovery chain (per-file, in `config/config.js`):
  **live backup mirror → preferred snapshot → profile defaults**, skipped
  entirely while auto-profile is in progress.

The pre-update backup is thus a *parallel, hidden, single-slot* restore
mechanism living beside the snapshot system, with its own marker protocol
and its own UI.

## Goals

1. No post-update question in the normal case. Updates preserve customer
   customizations automatically.
2. Machine state (calibration, persistent variables, identity) is never
   touched by profile application. Ever.
3. One restore mechanism: the existing Settings & Backups snapshots.
4. The recovery chain stays version-consistent after updates.
5. Factory fixes still reach machines: a shipped default change lands on
   every tool that hasn't deliberately overridden that key.

**Non-goals:** redesigning the profile format; changing manual profile
*switches* (wholesale replace is correct there — and it already clears the
blessed snapshot); handling G2 *firmware* settings (separate mechanism).

## Design

### 1. State vs settings taxonomy

Declare, in code, which files are machine **state** — off-limits to profile
application and to the merge:

| File | Class | Profile application may touch? |
|---|---|---|
| `opensbp.json` persistent variables | state (calibration) | **never** |
| `instance.json`, `auth_secret` | identity | **never** (already excluded from snapshots) |
| network config | state | **never** |
| installed apps, macros | content (own mechanisms) | no — macros already have base-hash tracking |
| `machine.json`, `engine.json`, `opensbp.json` non-variable keys | settings | merge (below) |
| `g2.json` | settings (hardware tuning) | merge, conflicts surfaced (see Risks) |

This taxonomy alone prevents a repeat of the July `$`-variable wipe,
independent of everything below.

### 2. Record the applied base

Whenever a profile is applied (`profiles.apply`), write a copy of the
resulting factory defaults to `/opt/fabmo/config/.profile_base/*.json`,
stamped with `{profile_name, profile_hash, engine_version, applied_at}`.
This is the "old base" leg of the merge. (Pattern precedent: per-macro base
hashes in `config/macros_meta.json`; Profile Designer's diff-vs-default
profiles.)

Bootstrapping existing fleet machines with no recorded base: on first boot
after the update that ships this feature, record the *current shipped
profile* as base. First-merge behavior then degrades gracefully: keys where
user == new-default merge invisibly; the rest resolve as conflicts → "keep
user value, report" (safe default).

### 3. Three-way merge on update

On first boot after an engine update (version change is already detected for
the approot rebuild), for each settings file, per key:

| user vs old base | new base vs old base | result |
|---|---|---|
| unchanged | unchanged | keep (trivial) |
| unchanged | changed | **take new default** (factory fix lands) |
| changed | unchanged | **keep user value** (customization survives) |
| changed | changed | **keep user value + report conflict** |
| — | key added in new base | add with new default |
| key user-added (not in either base) | — | keep |
| — | key removed from new base | remove unless user-changed (then keep + report) |

Then refresh `.profile_base/` to the new base. No modal. The merge runs
*before* config load, in place of today's wholesale reapply.

Conflicts and taken-defaults are written to a small report
(`/opt/fabmo/config/.last_update_merge.json`).

### 4. Pre-update auto-snapshot replaces the shadow backup

Instead of `/opt/fabmo_backup/pre_auto_profile/` + marker + modal, the
update flow takes an ordinary snapshot through `snapshots.js`:
**"Before update to vX.Y.Z"** (config + macros + apps manifest; not blessed
as default). Users who want yesterday back go where they already go —
**Restore Settings** — and find it in the list with the partial-restore
checkboxes they already have. Retention: keep the last N (say 2) pre-update
snapshots, pruned automatically.

The `.auto_profile_applied` prompt protocol, `backup_restore_status`
route, and the modal retire. (The pre-auto-profile backup code path can
remain for true *profile-change* application if desired, but the update
path stops using it.)

### 5. Post-merge re-bless keeps recovery honest

After a successful merge, re-save the preferred snapshot automatically
(same name, annotated `{engine_version, profile_name, profile_hash}`), so
tier-2 recovery restores settings consistent with the running engine.
Snapshot metadata gains the version stamp regardless, letting recovery
*detect* a version mismatch and log it rather than restoring blind.

### 6. Review UI (small, reuses shipped patterns)

A notification after an update with conflicts: *"Update applied. 3 settings
had new factory defaults but you had customized them — kept your values."*
linking to a list in the config app (fed by `.last_update_merge.json`) with
per-key **Use new default** buttons — visually the same idiom as the
macro update-available/revert UI. No action required; the list is
informational and dismissable.

## Macros: same pattern, text instead of keys

The macro-defaults system (base hashes in `config/macros_meta.json`,
`getStatus()` states in `macros.js`) already detects everything this policy
needs; what's missing is policy. Proposed:

| state | meaning | on update |
|---|---|---|
| `update_available` | default changed; installed copy never edited | **auto-apply at startup, silently** (advance base hash) |
| `customized` | user edited; default unchanged | untouched (as today) |
| `diverged` | user edited AND default changed | never auto-overwrite; escalate by severity (below) |
| `new_default` | shipped default, nothing installed | install (as today) |
| `ignored_default` | user dismissed a new default | respect the dismissal |

Rationale: an unmodified macro has no customization to protect — auto-apply
closes the "seriously broken macro waits for the user to notice a badge"
gap for the majority who never edit macros, with the pre-update snapshot as
the undo. An *edited* macro must never be force-reverted, even for a
critical fix: the canonical support edit ("comment out the sensor check,
your sensor is broken") would be dangerously re-broken by a forced revert.

**Severity channel:** an optional shipped-macro header field
(`' UPDATE-PRIORITY: critical <reason>`) or sidecar manifest. A critical
fix against a `customized`/`diverged` macro raises a persistent
dashboard-level notification (not just the Macro Manager badge) until
reviewed.

**Review = three-way text diff:** show the factory delta (old default →
new default) beside the user delta (old default → installed). When the two
touch disjoint lines, offer a one-click diff3 merge — "apply fix, keep your
changes" — but as an offered action, not automatic: auto-merged text that
drives a tool-change is a different risk class than a merged config key.

## Rollout stages

1. **Quick wins (low risk, independent):** only trigger profile
   reconciliation when shipped profile content actually changed — hash the
   profile dir into the applied marker, compare on boot. Stops updates from
   manufacturing the keep/restore dilemma when nothing changed. Enforce the
   state-vs-settings exclusion list (fixes the `$`-variable class of bug on
   its own). And auto-apply `update_available` macros at startup — the
   detection machinery is already shipped; this is a policy change in
   `installProfile()`.
2. **Base recording + merge** behind a flag; wholesale-reapply remains the
   fallback on any merge error (merge failure → today's behavior, not a
   brick). Pre-update auto-snapshot lands here too.
3. **Retire the modal** and the shadow-backup protocol; add the review UI
   and post-merge re-bless.

## Risks and open questions

- **`g2.json` conflicts are real**, not theoretical: axis tuning is both
  factory-updated and user-calibrated (e.g. PRS motor polarity `1po`–`3po`).
  "Keep user + report" is the safe default; a profile-authored
  `force_keys` list (keys a profile may override unconditionally, used
  sparingly for safety-critical corrections) is the escape hatch.
- **The recovery chain is fragile** (documented history of boot races and
  skip-path interactions). The merge must run at a well-defined point
  before config load, and every stage needs the wholesale path as fallback.
  This is the main reason for staged rollout and team review.
- **Numeric noise:** compare values canonically (parsed JSON equality, not
  string equality) so `6.0` vs `6` isn't a phantom user-change.
- **Unit conversions:** values stored in machine units should be compared
  in machine units; confirm no config file stores display-unit values.
- **Who writes `.profile_base` on factory images?** Image builds should
  bake it so first customer boot already has a base.
- **Does anything legitimately depend on wholesale reapply at update?**
  (e.g. profiles that assume they can remove stale keys). Audit shipping
  profiles before stage 2.

## Relationship to the updater-bundling proposal

Bundling makes the *updater* invisible; this makes the *consequences* of an
update invisible. Both reduce the update to: one button, a progress screen
(shipped: the dashboard update-progress page), and a tool that comes back
knowing everything it knew before, plus the fixes.
