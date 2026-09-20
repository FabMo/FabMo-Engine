# Translating the FabMo Interface

*A working paper on internationalizing FabMo for the Japanese market —
and beyond.*

---

## Summary

We built a per-machine localization system for FabMo. The dashboard
chrome (keypad, status bar, action tooltips, Toolbox) and the
Configuration app render fully in Japanese when the operator picks
日本語 from a new selector in **Configuration → General Settings →
Language**. Switching languages writes a single config setting and
reloads the page.

The system is built around a simple translation key/value convention,
an export/import workflow that hands clean CSVs to translators (or AI
for first-pass translation), and tooling that automatically detects
when English copy changes have left a translation stale. Third-party
apps shipped to FabMo can opt into the same system without server
changes.

What's done is enough for a credible Japanese demo for our reseller.
What's left is per-app migration of the remaining bundled apps and a
translator-review pass over the AI-generated Japanese.

---

## Why now

We have a Japanese reseller with an active customer base, and AI
translation is good enough now that bootstrapping a non-English
interface no longer costs months of professional translator time. A
first-pass Japanese UI can ship with a few hours of mechanical markup
work plus an AI translation pass; a human reviewer then iterates,
shipping improvements without needing to touch any code.

The reseller has asked for Japanese; the same machinery extends to
Korean, German, Spanish, or any other market we want to enter later
— each new language costs one translator's time, not another
engineering project.

---

## The approach

### Source of truth: English

Every visible string in the UI is referenced by a short identifier
(a "key") like `keypad.go_to` or `toolbox.cut`. The English values
live in a single file — `i18n/en.json` — that engineers edit as
part of normal code changes.

```json
{
  "keypad": {
    "go_to": "Go To",
    "stop":  "STOP"
  },
  "toolbox": {
    "cut": "CUT"
  }
}
```

Translations are sibling files: `i18n/ja.json`, `i18n/ko.json`,
`i18n/de.json`, etc. Each mirrors the English structure with values
in the target language.

```json
{
  "keypad": { "go_to": "移動", "stop": "停止" },
  "toolbox": { "cut": "カット" }
}
```

Missing keys in any language silently fall back to English at
runtime. **Partial translations ship cleanly** — a reseller can roll
out 60% of a language and refine the rest over time without breaking
the UI.

### How strings get translated in the UI

HTML elements opt in with a `data-i18n` attribute:

```html
<span data-i18n="keypad.go_to">Go To</span>
```

A small client-side script (~100 lines) walks the page after the
active language dictionary loads and replaces the text. The English
text stays in the HTML as the no-JavaScript / pre-fetch fallback.
For attributes (tooltips, placeholders, ARIA labels), there are
matching `data-i18n-title`, `data-i18n-placeholder`,
`data-i18n-aria-label` attributes. For copy that contains markup
like `<br>`, there's `data-i18n-html`.

JavaScript-injected text uses a `window.t(key, vars)` function:

```js
$greeting.textContent = window.t("hello.greeting", { name: "Bob" });
// → "Hello, Bob!"  or  "こんにちは、Bobさん！"
```

The same convention applies on the server for error messages —
`i18nError(code, vars)` creates a tagged error that the response
layer translates at the boundary instead of carrying a baked-in
English string deep in the stack.

### Single per-machine setting

Operators pick the language in the Configuration app. Internally
this writes one value (`engine.language`) and reloads the page.
Every browser connected to that FabMo gets the same language. This
matches how shops actually work — a single tool runs in one
language, the same one the operator's keypad labels are in.

(If we ever need per-user language down the road, the architecture
supports it — but starting with per-machine kept the scope simple.)

---

## The translator workflow

The most important property of any localization system isn't the
runtime — it's how easily translators (or AI) can iterate on the
translations without touching code.

### Round trip via CSV

Translators see a four-column CSV and edit only the third column:

```
key                   english        ja              status
keypad.go_to          Go To          移動            ok
keypad.stop           STOP           停止            ok
toolbox.new_feature   Cool New Thing                 new
keypad.exit           Exit Program   出る            stale (was: "Exit")
toolbox.old_button    (removed)      古いボタン      orphaned
```

The `status` column tells the translator exactly what needs
attention:

- **ok** — translation matches the English it was made from. No
  action needed.
- **new** — no translation yet. Fill it in.
- **stale (was: "...")** — English has changed since the translation
  was recorded. The old English is shown so the translator can judge
  whether the existing translation still applies, needs an edit, or
  needs a full rewrite.
- **untracked** — translation exists with no record of what English
  it was made against. Promote to "ok" by reviewing and re-saving.
- **orphaned** — the key has been removed from the English source.
  Translator can delete the row or leave it for archival.

This solves the most dangerous problem in long-running translation
projects: **silent staleness**. When a developer rewords an English
button label, the existing translation keeps rendering as if nothing
changed — possibly contradicting the new English. Our staleness
flag forces re-review on every change.

### Import is idempotent and safe

Importing the edited CSV rewrites the target language JSON file and
also writes a **sidecar metadata file** (`i18n/ja.meta.json`) that
records the English value each translation was made against. The
next export uses the sidecar to compute the status column. The
sidecar is part of the codebase, committed in git — the history
becomes a useful audit trail showing which translations were
anchored to which English source.

Empty rows in the CSV are skipped on import — they don't get written
as empty strings that would mask the English fallback at runtime.
This means a translator can ship 80% of a language now and the other
20% next month without anything ever rendering blank.

### AI as first pass

The workflow assumes AI does most of the heavy lifting. A translator
exports a CSV of all `new` and `stale` rows, sends it to ChatGPT /
Claude / DeepL with a prompt like *"Translate the third column from
English to Japanese for FabMo CNC dashboard; preserve {var} tokens
and any HTML tags,"* and then reviews the AI output. The human
verifies meaning and tone; the AI eliminates the typing.

For the current ~211 keys of Japanese in `feature/i18n`, the
translations are AI-generated. They're good enough for the reseller
to demo and start refining. A native Japanese reviewer would
typically tighten phrasing in a few hours.

---

## How third-party apps participate

FabMo's strength is that anyone can ship an app to it — installed
via drag-and-drop in the Apps tab. The translation system extends
to those apps without requiring changes to the FabMo core or any
coordination with our team.

### Convention

A third-party app developer ships an `i18n/` directory inside their
`.fma` package:

```
my-cool-app.fma/
├── package.json          { "name": "my-cool-app", ... }
├── i18n/
│   ├── en.json           keys namespaced under "my-cool-app.*"
│   └── ja.json           (optional)
├── js/
│   └── i18n.js           copy of the FabMo helper script
└── index.html            uses data-i18n attributes
```

The server walks every installed app's `i18n/` directory at startup
and merges each language file into the global dictionary. Apps must
namespace their keys under the app id, which prevents collisions
with FabMo core or other apps.

When an app is installed, its translations come along with it. When
it's uninstalled, they go away. No central registry, no manual
coordination.

### Submission protocol

We provide one CLI tool a developer runs before submitting:

```bash
node scripts/i18n-analyze.js path/to/my-app.fma
```

It reports:

- **Structural validity** — keys properly namespaced, no malformed
  JSON, no empty values.
- **Coverage scan** — heuristic walk of the app's HTML and JS files
  looking for user-visible English text that has no `data-i18n` or
  `t()` markup. This catches the obvious "developer forgot to mark
  this string" cases.
- **Translation summary** — total keys, longest strings (translator
  effort estimate), coverage percent per language already present.

A developer iterates until the issues count is zero and the coverage
candidates have been reviewed, then submits the `.fma` directory.
The reviewing team re-runs the analyzer to verify, then uses the
same CSV workflow (`--export ja > my-app-ja.csv`) to get
translations into the app. The translated files commit back into
the app's own `i18n/` directory and ship with future versions.

### Sample app

`dashboard/apps/hello-i18n.fma/` is a minimal reference
implementation that third-party developers can read as a template.
Its source — HTML with `data-i18n`, JS with `window.t()`, English
and Japanese dictionaries — is the simplest possible demonstration
of the entire system.

---

## What's done and what's next

### Done

| Area                                  | Status                                    |
|---------------------------------------|-------------------------------------------|
| Server-side i18n module + routes      | Done                                      |
| Client-side `t()` + DOM walker        | Done                                      |
| Engine config (`engine.language`)     | Done                                      |
| CSV export/import + staleness detection| Done                                      |
| Orphan-key scanner                    | Done                                      |
| Third-party app convention + auto-merge| Done                                      |
| Per-app analyzer + per-app import     | Done                                      |
| Sample app for third-party reference  | Done                                      |
| Developer documentation               | Done (`doc/i18n.md`)                      |
| Translated: core dashboard chrome     | Done (~70 keys, AI Japanese)              |
| Translated: Toolbox (custom cut UI)   | Done (~50 keys, AI Japanese)              |
| Translated: Configuration app         | Done (~140 keys, AI Japanese)             |
| Translated: sb4 main app              | Reference only — top nav + workflow buttons|
| Engine error helper                   | Built; one error type migrated            |
| Language selector in UI               | Done                                      |

Today an operator can flip a single setting and run the most-used
parts of FabMo in Japanese. That's enough for the reseller demo.

### What's next (in roughly the order they matter)

1. **Native Japanese review pass over current translations.** AI
   output is "probably ok" but a translator should polish phrasing
   and verify terminology. Estimated effort: a few hours of a native
   Japanese CNC-literate reviewer's time, using the existing CSV
   workflow.

2. **Remaining bundled apps.** sb4 is mostly untranslated (only the
   menu and a couple buttons done as a reference). `previewer`,
   `macro_manager`, `editor`, `job_manager`, `network_manager`,
   `video` follow the same mechanical pattern. Estimated effort per
   app varies from a few hours (small apps) to a couple of days
   (sb4 is the biggest).

3. **Engine error message migration.** We built the infrastructure
   (`i18nError(code, vars)` + response-boundary translation) but
   only migrated one error as a worked example. Engine errors are
   constructed deep in the call stack — they need to be reformulated
   one at a time to use the new pattern. Estimated effort: ongoing,
   incremental. Each migrated error becomes translatable; old
   patterns continue to work in English.

4. **Additional languages.** Same workflow, drop in a new
   `<code>.json` file. The reseller market would dictate priority.

5. **Per-app sidecar coverage.** Currently the staleness system is
   per-language, applied to the core dict and demonstrated on the
   sample app. Other bundled apps that get migrated should
   participate the same way.

### Optional polish

- **Live reload on language switch** instead of page reload (small UX
  improvement, not blocking).
- **MutationObserver-based walker** so dynamically-injected DOM gets
  translated automatically (currently apps call
  `window.i18nApply(root)` manually after injecting markup).
- **Single canonical `i18n.js`** served from one URL, eliminating the
  per-app copy duplication. Requires resolving a FabMo URL-routing
  detail.

None of these block shipping the current state.

---

## Decisions and trade-offs

A few choices worth flagging for review:

**Per-machine language, not per-user.** Simpler scope, matches shop
floor reality. Per-user is possible later; the architecture doesn't
preclude it.

**English as source of truth (not a "neutral" format).** Standard
for our codebase, matches developer workflow, AI translation works
best from English. The alternative — abstract keys with no implicit
English — adds friction for developers without a clear benefit.

**Simple JSON dictionaries, not gettext / PO files.** PO is the
industry standard for software i18n and has excellent tooling
(Poedit, Crowdin, etc.). We chose JSON because (a) FabMo is a
JavaScript ecosystem and JSON is native, (b) our scale doesn't
justify the tooling overhead, (c) the CSV roundtrip gives
translators a comfortable interface without forcing them to install
PO editors. If we outgrow JSON, the conversion is straightforward.

**No plural form handling.** Japanese doesn't pluralize. English
does, but the strings we have today don't depend on plural forms
("1 file" vs "2 files" patterns). When we need it, add a
`tn(key, count, vars)` helper. Not blocking.

**Per-app dict files duplicate the `i18n.js` helper script.** Each
`.fma` ships its own copy. The alternative (single canonical URL)
runs into a quirk of FabMo's static-asset routing that's solvable
but not urgent. Cost: ~100 lines duplicated per app. Acceptable.

---

## Investment estimate to "fully translated Japanese"

Numbers below are rough but realistic:

| Task                                         | Effort (engineering) | Effort (translator) |
|----------------------------------------------|----------------------|---------------------|
| Native Japanese polish over current ~260 keys | —                    | 2–4 hours           |
| Migrate remaining bundled apps (~7 apps)      | 1–3 days total       | 4–8 hours           |
| Migrate engine error messages                 | 1–2 days             | 1 hour              |
| Test pass with native Japanese operator       | 0.5 day              | 1–2 hours           |
| Documentation for the reseller                | 0.5 day              | —                   |

Total: **roughly one engineering week + one translator day** to a
state we'd be comfortable calling "Japanese-supported" for the
reseller's general distribution. The reseller demo state is shippable
today.

For each additional language: **~one translator day** plus a quick
verification pass. No new engineering.

---

## Appendix: file layout

```
fabmo/
├── i18n/
│   ├── index.js               server module: t(), loadAll(), reload()
│   ├── errors.js              i18nError() + errorMessage()
│   ├── en.json                source of truth
│   ├── ja.json                Japanese translations
│   └── ja.meta.json           staleness sidecar (committed)
├── routes/
│   └── i18n.js                /i18n/languages and /i18n/dict/:lang
├── dashboard/
│   ├── static/js/libs/
│   │   └── i18n.js            client helper (window.t, walker)
│   └── apps/
│       ├── configuration.fma/ (migrated: language selector + tabs)
│       ├── sb4.fma/           (partially migrated: nav + workflow)
│       └── hello-i18n.fma/    (sample for third-party developers)
├── scripts/
│   ├── i18n-export.js         emit CSV with status column
│   ├── i18n-import.js         read CSV, write JSON + sidecar
│   ├── i18n-orphans.js        scan for unused keys
│   └── i18n-analyze.js        per-app validate + coverage scan
└── doc/
    ├── i18n.md                developer guide
    └── i18n-whitepaper.md     this document
```

## Appendix: commands at a glance

```bash
# Switch the live language
curl -X POST -H 'Content-Type: application/json' \
  -d '{"engine":{"language":"ja"}}' http://<host>/config

# Export a CSV for translator review
node scripts/i18n-export.js ja i18n/ja.csv

# Import translator's edits back
node scripts/i18n-import.js ja i18n/ja.csv

# Find unused keys (after a UI refactor)
node scripts/i18n-orphans.js

# Analyze a third-party app for translation readiness
node scripts/i18n-analyze.js path/to/my-app.fma

# Export CSV for a third-party app
node scripts/i18n-analyze.js path/to/my-app.fma --export ja > ja.csv

# Import translations into a third-party app
node scripts/i18n-import.js ja ja.csv --app path/to/my-app.fma
```
