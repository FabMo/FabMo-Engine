// vfd_probe.js
//
// Identify the connected VFD by attempting a Modbus read against each known
// template's signature register. The "signature" is implicit in the template
// itself: open the port with that template's baud/parity/address and read
// its TRIG_READ_FREQ register. If the read succeeds (no exception, sensible
// length), the template matches the connected drive.
//
// Probe order matters. Delta uses high-range registers (0x2100+) that most
// Lenze/Yaskawa drives cleanly reject with Modbus exception 02 (Illegal
// Data Address). Yaskawa V1000 is an exception — it answers reads in that
// range with all-zero data instead of rejecting, which would falsely match
// the Delta template. Two safeguards rule that out:
//   1) Any TRIG read that returns all zeros is rejected as a non-match
//      (a real drive answering its own template returns at least one
//      non-zero status/setpoint bit).
//   2) A template may define a SIGNATURE_REGISTER; if set, a second read
//      is issued there and must return non-zero for the match to stand.

const fs = require("fs");
const path = require("path");
const ModbusRTU = require("modbus-serial");
const log = require("../log").logger("spindleProbe");

const TEMPLATES_DIR = path.join(__dirname, "spindle-VFD-data");
const SETTINGS_PATH = path.join(__dirname, "spindle1_settings.json");

// Probe order: explicit list, most-specific first. Each entry is the basename
// of a JSON in spindle-VFD-data/. To add a VFD: drop a template JSON, then
// add its name here.
const PROBE_ORDER = [
    "spin-DT-1hp-delta",     // Delta DT/MS300 — 0x2100-range registers, distinct from Lenze/Yaskawa
    "spin-PRS5-yaskawaD",    // Yaskawa V1000 — low register set, FC16 writes
    "spin-DT-1hp-lenze",     // Lenze SMVector — low register set
];

const READ_TIMEOUT_MS = 1500;

function loadTemplate(name) {
    const file = path.join(TEMPLATES_DIR, name + ".json");
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
}

function listTemplates() {
    return fs.readdirSync(TEMPLATES_DIR)
        .filter(f => f.endsWith(".json"))
        .map(f => f.replace(/\.json$/, ""));
}

// Try one template with a given (address, parity) combo. Resolves with the
// template object on a successful read, null on any failure. Always closes
// the port.
async function tryTemplate(ttyPath, templateName, address, parity) {
    const tpl = loadTemplate(templateName);
    const s = tpl.VFD_Settings;
    const addr = address != null ? address : s.MB_ADDRESS;
    const par = parity != null ? parity : s.PARITY;
    const client = new ModbusRTU();

    log.info(`Probe: trying ${templateName} on ${ttyPath} @ ${s.BAUDRATE} ${s.BYTESIZE}${par[0].toUpperCase()}${s.STOPBITS}, addr ${addr}, reg ${s.Registers.TRIG_READ_FREQ}`);

    try {
        await client.connectRTUBuffered(ttyPath, {
            baudRate: s.BAUDRATE,
            parity: par,
            dataBits: s.BYTESIZE,
            stopBits: s.STOPBITS,
        });
        client.setID(addr);
        client.setTimeout(READ_TIMEOUT_MS);

        const res = await client.readHoldingRegisters(s.Registers.TRIG_READ_FREQ, s.READ_LENGTH || 1);
        if (!res || !Array.isArray(res.data) || res.data.length === 0) {
            log.info(`Probe: ${templateName} addr ${addr} parity ${par} read returned no data`);
            return null;
        }
        log.info(`Probe: ${templateName} responded at addr ${addr} parity ${par} with ${res.data.length} registers: [${res.data.join(", ")}]`);

        const sigReg = s.Registers && s.Registers.SIGNATURE_REGISTER;
        if (sigReg != null) {
            const sigLen = s.Registers.SIGNATURE_LENGTH || 1;
            try {
                const sig = await client.readHoldingRegisters(sigReg, sigLen);
                const data = sig && Array.isArray(sig.data) ? sig.data : [];
                if (data.length === 0 || data.every(v => v === 0)) {
                    log.info(`Probe: ${templateName} signature reg ${sigReg} returned all-zero [${data.join(", ")}] — rejecting match`);
                    return null;
                }
                log.info(`Probe: ${templateName} signature reg ${sigReg} = [${data.join(", ")}] — match confirmed`);
            } catch (e) {
                log.info(`Probe: ${templateName} signature reg ${sigReg} read failed: ${e.message} — rejecting match`);
                return null;
            }
        } else if (res.data.every(v => v === 0)) {
            log.info(`Probe: ${templateName} TRIG read was all-zero with no SIGNATURE_REGISTER to confirm — rejecting (likely a foreign drive that didn't exception)`);
            return null;
        }

        return tpl;
    } catch (e) {
        log.info(`Probe: ${templateName} addr ${addr} parity ${par} failed: ${e.message}`);
        return null;
    } finally {
        try {
            if (client.isOpen) await client.close();
        } catch (e) { /* ignore */ }
    }
}

// For a template, return the list of values to try for a given probe-time
// field. Defaults to a single-item list of the runtime value.
function listOr(arrField, fallback) {
    if (Array.isArray(arrField) && arrField.length > 0) return arrField;
    return [fallback];
}

// Walk PROBE_ORDER and each template's (address × parity) matrix, return
// { name, template, address, parity } of the first match, or null.
async function probeVFD(ttyPath) {
    for (const name of PROBE_ORDER) {
        const tpl = loadTemplate(name);
        const s = tpl.VFD_Settings;
        const addrs = listOr(s.PROBE_ADDRESSES, s.MB_ADDRESS);
        const parities = listOr(s.PROBE_PARITIES, s.PARITY);
        for (const addr of addrs) {
            for (const par of parities) {
                const match = await tryTemplate(ttyPath, name, addr, par);
                if (match) {
                    return { name, template: match, address: addr, parity: par };
                }
            }
        }
    }
    return null;
}

// Copy a template's JSON into spindle1_settings.json, overwriting COM_PORT,
// MB_ADDRESS, and PARITY with the values discovered during probing so the
// settings reflect the live connection.
function installTemplate(templateName, ttyPath, address, parity) {
    const tpl = loadTemplate(templateName);
    tpl.VFD_Settings.COM_PORT = ttyPath;
    if (address != null) tpl.VFD_Settings.MB_ADDRESS = address;
    if (parity != null) tpl.VFD_Settings.PARITY = parity;
    // Probe-time hints aren't part of the runtime settings
    delete tpl.VFD_Settings.PROBE_ADDRESSES;
    delete tpl.VFD_Settings.PROBE_PARITIES;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(tpl, null, 4));
    log.info(`Installed template ${templateName} -> ${SETTINGS_PATH} (COM_PORT=${ttyPath}, MB_ADDRESS=${tpl.VFD_Settings.MB_ADDRESS}, PARITY=${tpl.VFD_Settings.PARITY})`);
    return tpl;
}

module.exports = {
    PROBE_ORDER,
    listTemplates,
    loadTemplate,
    tryTemplate,
    probeVFD,
    installTemplate,
    SETTINGS_PATH,
    TEMPLATES_DIR,
};
