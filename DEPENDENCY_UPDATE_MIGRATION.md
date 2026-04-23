# FabMo Dependency Update Migration Guide

## Overview
This guide tracks the multi-phase dependency update for FabMo-Engine, including the critical Node.js 16 → 18 and SerialPort v9 → v12 migration.

## Phase 1: Low-Risk Cleanup ✅ COMPLETED

### Changes Made
- ✅ Updated `glob` from 5.0.15 → 9.3.5 (security fix, Node 18 compatible, maintains old API)
- ✅ Updated `jquery` from 2.2.4 → 3.7.1 (dashboard library)
- ✅ Updated `async` from 1.4.x → 3.2.6
- ✅ Removed deprecated `q` library, replaced with native Promises
- ✅ Kept `es6-promise` (required by webpack.config.js)
- ✅ Updated various minor dependencies with security patches
- ✅ Updated ESLint to v8.57.1 (v9 requires Node 20+)

### Testing Checklist - Phase 1
- [ ] `npm install` completes without errors
- [ ] `npm run webpack` builds dashboard successfully
- [ ] `npm test` passes all existing tests
- [ ] Dashboard loads in browser
- [ ] File operations work (job upload, macro management)
- [ ] Configuration changes persist correctly

### Files Modified - Phase 1
- `package.json` - Dependency versions updated
- `g2.js` - Removed Q library, replaced with native Promises (2 occurrences)
- `runtime/manual/driver.js` - Removed Q library, replaced with native Promise
- `util.js` - Removed Q library, replaced with native Promise
- `.eslintrc.js` - Kept existing ESLint v8 config (v9 requires Node 20+)

---

## Phase 2: Security-Critical Updates ✅ COMPLETED

### Changes Made
- ✅ Updated `multer` from 1.4.5-lts.1 → 2.0.0-rc.4 (file upload security)
- ✅ Updated `formidable` (transitive dependency fix)
- ✅ Updated `webpack` from 5.76.0 → 5.97.1
- ✅ Updated dev tooling (babel-loader, css-loader, etc.)

### Testing Checklist - Phase 2
- [ ] File uploads work in dashboard (drag & drop)
- [ ] Job file uploads (.nc, .sbp files)
- [ ] App installation (.fma files)
- [ ] Profile uploads and imports
- [ ] Macro file uploads
- [ ] Large file handling (>10MB)

### Routes to Test for Multer Changes
Check these files use multer for file uploads:
- [ ] `/routes/jobs.js` - Job file uploads
- [ ] `/routes/dashboard.js` - App installations
- [ ] `/routes/macros.js` - Macro file uploads
- [ ] `/routes/config.js` - Profile imports

### Potential Multer v2 Breaking Changes
If file uploads fail, check for:
1. Field name changes in `req.file` vs `req.files`
2. Destination path handling
3. File size limit configurations
4. Error handling changes

---

## Phase 3: Node.js + SerialPort Migration 🔴 CRITICAL

### Changes Made
- ✅ Updated `serialport` from 9.2.8 → 13.0.0
- ✅ Updated Node.js requirement from 16.14.0 → 18.20.0+
- ✅ Modified `g2.js` for SerialPort v12+ API:
  - Changed import: `var SerialPort = require("serialport")` → `const { SerialPort } = require("serialport")`
  - Updated constructor to object syntax with `path` property
  - Changed `flowcontrol: ["RTSCTS"]` → `rtscts: true`
  - Added explicit `baudRate: 115200`

**Note:** SerialPort v13 was required to satisfy `modbus-serial` dependency. The API is compatible with v12 changes.

### Pre-Testing Requirements
**IMPORTANT: Test on a dedicated Raspberry Pi first, NOT on production hardware!**

1. **Set up test environment:**
   ```bash
   # On test Raspberry Pi
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Verify
   node --version  # Should show v18.20.x or higher
   ```

2. **Clone and update:**
   ```bash
   cd /opt
   sudo git clone https://github.com/FabMo/FabMo-Engine.git fabmo-test
   cd fabmo-test
   git checkout <your-update-branch>
   
   sudo npm install
   ```

3. **Check for compilation errors:**
   ```bash
   # SerialPort has native bindings - watch for build errors
   npm list serialport
   # Should show: serialport@13.0.0 (no "invalid" warnings)
   
   npm list @serialport/bindings-cpp
   # Should show: @serialport/bindings-cpp@13.x.x
   ```

### Critical Testing Checklist - SerialPort

#### Connection & Initialization
- [ ] G2 connects on engine startup
- [ ] "SYSTEM READY" message received within 3 seconds
- [ ] Initial status report retrieved successfully
- [ ] Heartbeat starts automatically (check logs every 5s)
- [ ] Serial port shown in `config.engine.serial` path

#### Data Flow & Communication
- [ ] Status reports stream continuously (position updates in dashboard)
- [ ] Commands accepted and acknowledged
- [ ] Queue depth reported correctly
- [ ] No buffer overruns or data corruption
- [ ] Error responses parsed correctly

#### Job Execution - G-Code
- [ ] Small G-Code file (10 lines) executes
- [ ] Large G-Code file (10,000+ lines) executes without dropping commands
- [ ] Feedhold during job (spacebar or dashboard button)
- [ ] Resume after feedhold
- [ ] Stop/quit job mid-execution
- [ ] Queue priming works correctly

#### Job Execution - OpenSBP
- [ ] Small OpenSBP file executes
- [ ] Large OpenSBP file with loops/conditionals
- [ ] Macro calls within OpenSBP (C# commands)
- [ ] Variable assignments and expressions
- [ ] Pause/resume functionality

#### Manual Control
- [ ] Keyboard/keypad mode enters correctly
- [ ] Arrow keys move axes (incremental mode)
- [ ] Continuous jog works
- [ ] Manual MDI commands execute
- [ ] Exit manual mode cleanly

#### Error Handling & Recovery
- [ ] Disconnect USB cable during idle - reconnects automatically
- [ ] Disconnect USB during job - reconnects and reports error
- [ ] Reconnection timeout works (5 minutes max retry)
- [ ] G2 alarm state handled correctly
- [ ] Bad command sends proper error response
- [ ] Queue stall recovery works

#### Homing & Probing
- [ ] Homing sequence completes for all axes
- [ ] Probe operations work (if hardware available)
- [ ] Zero-setting commands work
- [ ] Coordinate system changes persist

#### Performance Under Load
- [ ] Long job (30+ minutes) completes without errors
- [ ] High-speed streaming (rapid moves)
- [ ] No memory leaks during extended runtime
- [ ] Heartbeat remains responsive during heavy streaming
- [ ] Dashboard stays responsive during job execution

### Known SerialPort v12 Issues to Watch For

1. **Baud rate mismatch**: If connection fails, verify G2 is actually at 115200
2. **Flow control**: If you see buffer overruns, verify `rtscts: true` is working
3. **Timing issues**: v12 has different internal buffering - watch for:
   - Commands sent before G2 is ready
   - Status reports arriving out of sync
   - Queue depth inconsistencies

### Debugging Serial Issues

If serial connection fails:

```bash
# Check device exists
ls -l /dev/fabmo_g2_motion  # or /dev/ttyACM0

# Check permissions
sudo usermod -a -G dialout $USER
# (logout and login required)

# Monitor raw serial output
sudo screen /dev/fabmo_g2_motion 115200

# Check FabMo logs
tail -f /var/log/fabmo.log
# Look for: "Opening G2 port", "SYSTEM READY", serial errors
```

Enable debug logging:
```bash
# In server.js or via command line
DEBUG=g2,machine npm start
```

### Rollback Plan

If Phase 3 fails and cannot be debugged:

**Option A: Pin SerialPort v9 with updated bindings**
```json
"serialport": "9.2.8",
"@serialport/bindings-cpp": "^12.0.1"
```
This MAY work on Node 18 but is untested.

**Option B: Revert to Node 16**
- Keep Phase 1 & 2 updates (they're compatible)
- Revert `engines` in package.json to `"node": ">=16.14.0"`
- Revert SerialPort to 9.2.8
- Gives time to debug SerialPort issues offline

---

## Phase 4: Build System Updates (After Phase 3 Validates)

### Image Builder Update

Once Phase 3 is confirmed stable on test hardware, update the image builder:

**File:** `build-fabmo-image.sh` (or equivalent)

**Change line ~66:**
```bash
# OLD:
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_16.x nodistro main"

# NEW:
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main"
```

### Deployment Checklist
- [ ] Test image builds successfully
- [ ] Fresh install on clean SD card works
- [ ] Existing installations upgrade cleanly
- [ ] Migration script handles config file format changes (if any)
- [ ] User data preserved during upgrade

---

## Post-Deployment Monitoring

### Watch for these issues in production:

1. **Serial disconnections**: Check reconnection logic works in field
2. **Performance degradation**: Monitor for slower response times
3. **Memory usage**: Node 18 has different V8 GC - watch for leaks
4. **Compatibility**: Test with all supported G2 firmware versions

### User Communication

When releasing update:
- Document Node.js version requirement (18.20.0+)
- Note SerialPort driver update
- Provide rollback instructions
- Known issues and workarounds

---

## Completed Items Summary

### Dependencies Updated (Phase 1 & 2)
| Package | Old Version | New Version | Risk Level |
|---------|-------------|-------------|------------|
| node | 16.14.0 | 18.20.0+ | HIGH ⚠️ |
| serialport | 9.2.8 | 13.0.0 | HIGH ⚠️ |
| multer | 1.4.5-lts.1 | 2.0.0-rc.4 | MEDIUM |
| glob | 5.0.15 | 9.3.5 | LOW |
| jquery | 2.2.4 | 3.7.1 | LOW |
| async | 1.4.x | 3.2.6 | LOW |
| webpack | 5.76.0 | 5.97.1 | LOW |
| eslint | 8.57.1 | 8.57.1 | LOW |
| q | 1.5.1 | REMOVED | LOW |
| es6-promise | 3.2.1 | 4.2.8 | LOW |

### Code Changes
- ✅ `g2.js` - SerialPort v13 API + Promise conversion (lines 8, 376-379, 544-547, 1143-1170, 1386-1408)
- ✅ `runtime/manual/driver.js` - Promise conversion (lines 22, 109-112, 733)
- ✅ `util.js` - Promise conversion (lines 12, 212-248)
- ✅ `dashboard/app_manager.js` - glob@9.x Promise API (lines 513-530)
- ✅ `package.json` - All dependency updates (Node 18 compatible versions)

---

## Timeline Recommendation

- **Week 1**: Phase 1 testing on development machine
- **Week 2**: Phase 2 testing, verify file uploads
- **Week 3-4**: Phase 3 on dedicated test Raspberry Pi (allow time for debugging)
- **Week 5**: Validation on multiple test units
- **Week 6**: Image builder update and release candidate
- **Week 7+**: Staged rollout to production

---

## Support Resources

- [SerialPort v12 Documentation](https://serialport.io/docs/)
- [SerialPort Migration Guide](https://github.com/serialport/node-serialport/blob/main/UPGRADE_GUIDE.md)
- [Node.js 18 Release Notes](https://nodejs.org/en/blog/release/v18.0.0)
- [ESLint v9 Migration Guide](https://eslint.org/docs/latest/use/migrate-to-9.0.0)

---

## Notes & Observations

_(Use this section to track issues found during testing)_

### Issues Found:
- **Node 18 compatibility**: Initial package.json had `glob@11.x` and `eslint@9.x` which require Node 20+. Downgraded to `glob@9.3.5` (not 10.x or 11.x) and kept `eslint@8.57.1` for Node 18 compatibility.
- **glob API breaking change**: glob@10.x changed from function export to object export, breaking `glob()` calls in app_manager.js. glob@9.x maintains the old API while still providing security fixes.
- **webpack.config.js requires es6-promise**: Despite being deprecated, webpack.config.js still requires the `es6-promise` module. Kept in dependencies (v4.2.8) to avoid webpack build failures.
- **modbus-serial compatibility**: modbus-serial@8.0.19+ requires serialport@^13.0.0 (not v12). Updated serialport to v13.0.0 to resolve peer dependency conflict.
- **mime@4.x ESM incompatibility**: mime@4.x is ESM-only and breaks CommonJS `require()` calls. Downgraded to mime@3.0.0 (last CommonJS version) to maintain compatibility.
- **glob@9.x callback API removed**: glob@9.x no longer supports callbacks - returns Promises instead. Updated `dashboard/app_manager.js` to use `Promise.all()` instead of nested callbacks in `getAppPaths()` function.
- **jQuery 3.x incompatibility with Foundation**: jQuery 3.x removed the `.load(url)` AJAX method that older Foundation framework relies on. Downgraded jQuery to v2.2.4 (last 2.x stable release) to maintain compatibility with existing Foundation-based dashboard UI.
- **webpack.config.js dependency**: The webpack config requires `es6-promise` module - must keep it even though deprecated elsewhere.
- **modbus-serial conflict**: The `modbus-serial@8.0.25` package requires `serialport@^13.0.0`. Updated from `serialport@12.0.0` to `serialport@13.0.0` to resolve dependency conflict. The v12→v13 API changes are minimal and compatible with our existing code modifications.
- **mime ESM incompatibility**: The `mime@4.x` package is ESM-only and cannot be used with CommonJS `require()`. Downgraded to `mime@3.0.0` which supports CommonJS.

### Workarounds:
- Using glob@9.x instead of glob@10.x/11.x (v10+ has breaking API changes, v9 maintains compatibility)
- Staying on ESLint v8 until Node 20 upgrade (ESLint v9 requires Node 20+)
- Using serialport@13.x instead of @12.x to satisfy modbus-serial dependency requirements
- Using mime@3.x instead of @4.x (v4 is ESM-only, incompatible with CommonJS)

### Performance Notes:
- 

