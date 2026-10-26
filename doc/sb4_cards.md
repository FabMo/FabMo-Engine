# Sb4 on the card layout — developer notes

In FabMo the app is labelled **"Console"** (package.json `name`): "Sb4" is
too arcane for new customers and "Dashboard" already means the whole FabMo
client. The app id stays `fabmo-sb4` (the dashboard special-cases it for the
video overlay) and the code keeps the Sb4 name.

Sb4 (`dashboard/apps/sb4.fma`, app id `fabmo-sb4`, version 4.1.0, Oct 2026)
was rebuilt on the card layout of Brian's tool_status app ("FabMo
Dashboard", `dashboard/apps/tool_status.fma`). Every tool_status card is now
an optional, draggable card in Sb4; the Sb4 command panel is itself a card.
The intent is that Sb4 supersedes tool_status once it has proven itself on
real tools, and that Shop Tools / card work continues in Sb4.

## What changed for the user

- Menu bar (Files / Moves / Jogs / …) stays page-wide at the top, with the
  layout pencil and the app-settings gear at its right end. Hiding the
  "Individual Command Input" card also hides the menus; pencil and gear stay.
- Two panes, 40/60, page up to 1400 px wide. Below 700 px the panes stack
  with the right pane (command card) first. Default layout: left = Jobs,
  USB Drive, My Workflow, Current Tool, Apps; right = Individual Command
  Input, Default Speeds, Shop Tools, Tools. Every card can be hidden (gear),
  dragged (pencil) or folded to its title bar (click the title; a caret
  shows the state; `layout.collapsed`); layout, theme and shortcuts are
  per browser.
- Default theme is "SB4 Console". The Sb4 command panel, menu bar and the
  Foundation modals keep their own look under every theme.
- The old left panel is gone. Home XY / Home Z / Jog Home / Park live on
  the "My Workflow" card (tool_status's Machine card, restyled as a slim
  full-width procedure list; `data-card-id` is still `machine`); Spindle
  Warm Up (C5), Square Gantry (C10) etc. can be added there as custom macro
  buttons. The Home XY / Home Z buttons carry
  the Sb4 "homed" state (yellow = not homed, dimmed = homed); the ⦸ glyph
  on each cycles not homed → homed → indicator off.
- The speeds panel became the "Default Speeds" card. Logo, shortcut hints
  and copyright are a footer; the beta MOtion-PAD / INSERT links sit under
  the file window.
- Single keys: K opens the Keypad from anywhere, U is reserved for the
  calculator (Sb3 convention; shows "not available yet"). Neither fires
  while typing in a card field.
- The tool_status "Console" card and its fill-in sheet are not in Sb4; the
  Sb4 command line is the console.

## Focus rule

Sb4 used to pull focus back to the command line on every click and mouse
move. With a page full of card inputs the rule is now (`sb_app.js`
`setSafeCmdFocus`, `init_setActions.js` document click handler):

- typing in any other field (input / textarea / select / contenteditable)
  keeps focus there;
- a click on non-typing space, including card buttons, returns focus to
  the command line;
- nothing is stolen while a card modal (`.ts-modal-backdrop`) is open,
  while the Keypad is up (manual mode), or when the command card is hidden;
- ESC from the command line clears it as before.

## How the code is put together

| Piece | Source | Notes |
|---|---|---|
| `index.html` | new | Sb4 nav + card markup. Card markup other than the command and speeds cards is tool_status's verbatim. |
| `js/cards.js` | copy of `tool_status.fma/js/app.js` | Minimal edits, listed in its header: no own `FabMoDashboard`, `sb4-*` storage keys, Console code replaced by a `consoleLog` shim into the file window, `CARDS`/`DEFAULT_LAYOUT`, menu-bar toggle, default theme. Keep it diffable against tool_status while both apps exist. |
| `css/cards.css`, `css/themes.css`, `css/theme-bridge.css` | verbatim copies of tool_status's `style.css`, `themes.css`, `theme-bridge.css` | Resync by copying. |
| `css/foundation-scoped.css` | **generated** | `node scripts/scope-foundation-css.js dashboard/apps/sb4.fma/css/foundation.css dashboard/apps/sb4.fma/css/foundation-scoped.css`. Every Foundation 5 selector is prefixed with `.sb4-scope`, so Foundation cannot restyle the cards. Re-run only if `foundation.css` changes. |
| `css/style.css` | rewritten | Sb4-only styling plus the theme exemptions for the `.sb4-scope` areas. |
| `js/sb_app.js`, `js/init_setActions.js`, `js/tool_config.js` | Sb4 code | Edits: focus rule, universal K/U, homed indicators moved to the Machine card, resize guard when the command card is hidden, old left-panel handlers removed. |
| `js/video.js`, `js/motion.js`, `js/mo_pad.js`, `js/jog_dial.js`, `js/message_g2.js` | unchanged | |

`.sb4-scope` wrappers: the menu bar (`#sb4-menu`), the command card body
(`#cmd-panel`) and the modal wrapper (`.sb4-modals`). Foundation's reveal
plugin re-parents an open modal to its root element, so the root is set to
`.sb4-modals` (inline script in index.html) and each modal also carries the
class itself. The wrapper must stay unpositioned.

One `fabmo` global (`new FabMoDashboard()` at the end of `<body>`) serves
both the Sb4 code and cards.js; the constructor appends to `document.body`,
so it cannot live in `<head>`.

Translation keys for the cards stay in the `tool_status.*` namespace (shared
dictionary entries); Sb4-specific additions are under `sb4.*`.

## Testing notes

Checked headless on the dev Pi (simulator G2) inside the real dashboard:
cards, layout edit/hide/restore, menus by single key, VS fill-in sheet,
K from command line and from the page, U notice, focus rule with the drill
press fields, homed-indicator cycle (XYHOMED tempVariable), Jog Home from the
Machine card. Needs a physical-tool pass before merge: Keypad interplay,
FP/OK-RUN file flow, video overlay, Motion Pad, and the Shop Tools cuts.
