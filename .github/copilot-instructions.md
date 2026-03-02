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
