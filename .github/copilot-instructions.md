# FabMo Engine - AI Coding Agent Instructions

## Project Overview
FabMo Engine is a host software for G2 motion control platforms. It manages CNC motion systems, streams G-Code, interprets OpenSBP (ShopBot language), and hosts a web-based dashboard for controlling digital fabrication tools.

**Key Technologies**: Node.js v16.14.0, Restify (REST API), Socket.IO (WebSockets), TingoDB (database), SerialPort (G2 driver), Webpack (dashboard build)

## Architecture: The Big Picture

### 1. Application Lifecycle
- **Entry point**: `server.js` → `engine.js` → `engine.start()`
- **Initialization sequence** in `engine.start()`:
  1. Configure engine (`EngineConfig`)
  2. Connect to G2 motion controller via serial (`machine.connect()`)
  3. Initialize config subsystems (driver, opensbp, dashboard, machine, user)
  4. Setup HTTP/WebSocket servers (Restify + Socket.IO on port 80/9876)
  5. Load routes from `/routes` directory
  6. Load dashboard apps and profiles
  7. Start network manager (platform-specific)

### 2. Core Architectural Components

**Machine Model** (`machine.js`): Central singleton that abstracts the physical CNC machine. Manages state, coordinates runtimes, and sits one layer above the G2 driver. Access via `require('./machine').machine`.

**G2 Driver** (`g2.js`): Low-level serial communication with G2 motion controller. Handles command queuing, status reports, and error codes. JSON-based protocol over SerialPort.

**Runtimes**: Pluggable execution contexts that control the machine for specific tasks:
- `GCodeRuntime` - G-Code execution
- `SBPRuntime` - OpenSBP language interpreter (primary language)
- `ManualRuntime` - Manual control (keyboard/pendant)
- `PassthroughRuntime` - Direct G2 access
- `IdleRuntime` - Default when inactive

Only ONE runtime active at a time. Switch via `machine.setRuntime()`.

**Configuration System** (`/config`): Multi-branch tree structure:
- `engine` - Engine settings (ports, platform)
- `driver` - G2 motion controller config
- `opensbp` - OpenSBP runtime settings
- `machine` - Machine-specific parameters
- `dashboard` - UI configuration
- `user` - Authentication data

All configs sync between disk (`/opt/fabmo` or `C:\opt\fabmo`) and memory.

**Profiles** (`profiles.js`): Packages of settings/macros/apps for different machine types. Located in `/profiles`. Applying a profile obliterates existing configs and requires engine restart.

**Database** (`db.js`): TingoDB (MongoDB-like) stores:
- File metadata (actual files on disk)
- Job queue/history
- Thumbnails

Collections: `files`, `jobs`, `thumbnails`. Max storage: 500MB (auto-pruning).

**Dashboard** (`/dashboard`): Web frontend built with Webpack. Apps are modular installable components stored in `/opt/fabmo/approot`. System apps in `/dashboard/apps` are core (editor, job manager, network manager, etc.).

**Routes** (`/routes`): REST API endpoints. Each `.js` file exports a function accepting the Restify server object. Auto-loaded by `routes/index.js`. See `/routes/config.js`, `/routes/jobs.js`, etc.

### 3. Data Flow Patterns

**Status Updates**: Machine state flows via EventEmitter pattern:
```
G2 Driver → Machine Model → WebSocket → Dashboard
```
Machine emits `status` events (`machine.emit('status', this.status)`). Listen in routes/websockets via `machine.on('status', ...)`.

**Job Execution**:
1. File uploaded → Database (`db.js`)
2. Job created → Queue
3. Machine picks job → Selects runtime
4. Runtime interprets code → Streams to G2
5. Status updates flow back through chain

**Configuration Changes**: 
- HTTP POST → Route handler → Config object `.update()` → Sync to disk
- Profile changes trigger `process.exit(1)` expecting systemd restart

## Critical Development Workflows

### Build & Run
```bash
npm install              # Install deps + webpack build
npm run debug           # Debug mode (enhanced logging, no webpack)
npm run dev             # Webpack + debug server
npm start               # Production mode
npm run webpack         # Build dashboard only
```

**Important**: Dashboard requires webpack build before running. Debug mode reloads apps more aggressively.

### Platform-Specific Considerations
- **Serial ports**: Configured in `engine_config.js` based on `process.platform`:
  - Linux: `/dev/fabmo_g2_motion` (via udev rules)
  - macOS: `/dev/cu.usbmodem*`
  - Windows: COM ports in `C:\fabmo\config\engine.json`
- **Data directory**: `/opt/fabmo` (Linux/Mac) or `C:\opt\fabmo` (Windows)
  - Must be writable by engine user (no sudo required)

### Testing
Jest tests in `/test`. Run with `npm test`. Limited coverage currently (`util.test.js`, `machine.test.js`).

### Code Quality
- **ESLint**: Uses `eslint-config-prettier`. Config in `.eslintrc.js`. Many files have selective `eslint-disable` comments.
- **Prettier**: `printWidth: 120`, `endOfLine: lf`. Config in `.prettierrc`.
- **Husky + lint-staged**: Pre-commit hooks (configured in `package.json`).

## Project-Specific Conventions

### Error Handling Pattern
Most async functions use Node.js callback style: `callback(err, result)`. Use `setImmediate(callback, err)` for immediate error returns.

### Module Organization
- **Singletons**: Many modules export singletons (`engine`, `machine`, `config branches`). Import via `require('./module')`, don't instantiate.
- **Routes**: Export a function accepting `server` parameter. Register endpoints inside.
- **Configs**: Inherit from `Config` base class (`/config/config.js`). Override `apply()` to sync changes.

### Macros System
Macros stored in `/opt/fabmo/macros`. Headers embedded in files (e.g., `(!FABMO!name:Macro Name)`). Invoked in OpenSBP via `C#` commands (e.g., `C3` for home). Only OpenSBP format currently implemented.

### G2 Communication
Commands queued and JSON-wrapped. Status reports arrive asynchronously. Use promises pattern (`_promiseCounter`, `Q` library). See `g2.js` for `get()`, `set()`, `requestStatusReport()` methods.

### Dashboard Apps
Apps are directories with `package.json` + web assets. Copied from source to `/opt/fabmo/approot` on startup. System apps non-removable. User apps installed via dashboard.

## Integration Points

### WebSocket API (`/routes/websocket.js`)
Real-time communication via Socket.IO namespaces:
- `/` - Main status updates (machine state, position)
- Emit: `status`, `change`, `job_start`, `job_end`
- Listen: Custom per-app

### REST API Patterns
- **GET** `/config` - Read config tree
- **POST** `/config` - Update config (merged)
- **GET** `/status` - Machine status snapshot
- **POST** `/code` - Direct code execution
See API docs: http://fabmo.github.io/FabMo-Engine/api

### External Dependencies
- **G2 Motion Controller**: Serial (115200 baud). JSON protocol. Firmware in `/firmware`.
- **Network Management**: Platform-specific (`/network/linux/raspberry-pi`). Uses `wireless-tools` npm package.
- **Python Utilities** (`/pythonUtils`): I2C display, USB logging. Separate processes.

## Common Gotchas

1. **Config Caching**: Config objects cache values. Call `.update()` then `.save()` to persist.
2. **Profile Changes**: Cause immediate `process.exit(1)`. Design for restart.
3. **Runtime Context**: Always check `machine.status.state` and active runtime before operations.
4. **Serial Port Permissions**: Common setup issue. User must have access to serial device.
5. **Webpack Required**: Dashboard won't load without `npm run webpack` or `npm install` (postinstall hook).
6. **Node Version**: Officially supported v16.14.0. Newer versions may break dependencies.
7. **Global Variables**: Avoid. Some legacy globals exist (`global.CUR_RUNTIME`, `global.CLIENT_DISCONNECTED`). Don't add more.

## Key Files Reference
- `engine.js` - Application initialization logic
- `machine.js` - Machine model and runtime coordination
- `g2.js` - Motion controller driver
- `/config/engine_config.js` - Engine settings + profile switching
- `/runtime/opensbp/opensbp.js` - OpenSBP interpreter (2500+ lines)
- `/routes/index.js` - Route auto-loader
- `db.js` - Database operations and job management
- `/doc/project_layout.md` - Additional architecture notes

## When Modifying Code

- **Machine state changes**: Emit via `machine.emit('status', this.status)` for dashboard updates
- **New routes**: Add to `/routes`, export function accepting `server`, will auto-load
- **Config additions**: Update appropriate config class in `/config`, add defaults
- **Runtime modifications**: Implement `connect()`, `disconnect()`, `toString()` methods
- **Database changes**: Update schema in `db.js`, handle migration for existing data

## Notes to AI

- When working in dev mode here is vscode, our script always runs `npm run webpack` to rebuild the dashboard. No need to harp about running webpack!

## Lessons Learned re: FabMo

Here is my concern. My experience has been that in multiple cases in which we have hoped to improve the operation of the FabMo by introducing async/await functions, these changes have produced havoc and disfunction and bugs that have been difficult to deal with. Most of FabMo was architected before the patterns for async programming were developed and it means that we start getting hidden and unexpected gotcha's. FabMo, by this point, is a huge system and my experience to date is that this haphazard introduction of async functions inevitably produces cascading problems.

AI:
You're absolutely right to be concerned, and your experience is valid. The pattern is clear: _execute was changed to async to support await this._assign() in the assign/weak_assign cases, but this silently broke every caller and every recursive call within _execute itself — because an async function always returns a Promise, never a raw boolean.

The cascading damage from this one async keyword:

cond → return: this._execute(command.stmt, callback) returns a Promise, not true. The result === true check fails. Callback never fires. Deadlock.

cond → any inner statement: Same problem for any nested _execute call.

_executeNext: Calls this._execute(line, callback) and checks the return value — gets a Promise instead of a boolean.
try/catch around _execute: Never catches Promise rejections — they become unhandled rejections that silently vanish.

**The fix is not to propagate async/await further — that would cascade changes throughout the entire call chain, touching _executeNext, resume, _run, the onStat handler, etc. Instead, remove async from _execute and handle the async _assign without making the whole function async:

**The key principle: check if _assign returns a Promise using duck-typing (typeof result.then === 'function'), and chain .then() instead of using await. This keeps _execute synchronous — it returns actual true/false booleans — and the entire existing callback/event-driven architecture continues working as designed.

This pattern — .then() chaining only where a Promise actually appears, without making the caller async — is the safe way to introduce async operations into a callback-based system. It's the containment approach: the async behavior stays localized to the one case that needs it, rather than virally infecting everything upstream.

The broader lesson for FabMo: never make a function async if its callers check its return value or wrap it in try/catch. Instead, use explicit .then()/.catch() at the boundary point where async meets sync.
The principle remains: never make a function async if its callers are synchronous and use try/catch or check return values. Contain async behavior at the boundary using .then()/callbacks.

NOTE ABOUT resumePending:
The resumePending flag's purpose is to prevent a spurious STAT_STOP (generated by G2 as it transitions out of hold) from triggering _executeNext when the runtime hasn't actually processed the resume yet. But in this code path, we are the resume handler — we're explicitly calling _executeNext ourselves. So clearing resumePending immediately after driver.resume() and before _executeNext() ensures:

G2 gets the ~ command to exit hold
The resumePending flag won't consume the STAT_STOP that _executeNext needs (for stack-breaking commands)
_executeNext can properly defer to onStat for STAT_STOP delivery
This also still works for the consecutive PAUSE case because when _executeNext immediately hits another PAUSE (no stack break wait needed), it sets this.paused = true synchronously and returns — no STAT_STOP is needed.



