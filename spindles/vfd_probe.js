// vfd_probe.js
//
// Identify the connected VFD by attempting a Modbus read against each known
// template's signature register. The "signature" is implicit in the template
// itself: open the port with that template's baud/parity/address and read
// its TRIG_READ_FREQ register. If the read succeeds (no exception, sensible
// length), the template matches the connected drive.
//
// Probe order matters. Delta uses high-range registers (0x2100+) that
// Lenze/Yaskawa cleanly reject with Modbus exception 02 (Illegal Data
// Address), so trying Delta first is safe. Yaskawa and Lenze both use
// low-numbered registers but at different addresses, so a successful read
// at one drive's address will typically fail at the other.

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

// Try one template against a given tty path. Resolves with the template
// object on a successful read, null on any failure. Always closes the port.
async function tryTemplate(ttyPath, templateName) {
    const tpl = loadTemplate(templateName);
    const s = tpl.VFD_Settings;
    const client = new ModbusRTU();

    log.info(`Probe: trying ${templateName} on ${ttyPath} @ ${s.BAUDRATE} ${s.BYTESIZE}${s.PARITY[0].toUpperCase()}${s.STOPBITS}, addr ${s.MB_ADDRESS}, reg ${s.Registers.TRIG_READ_FREQ}`);

    try {
        await client.connectRTUBuffered(ttyPath, {
            baudRate: s.BAUDRATE,
            parity: s.PARITY,
            dataBits: s.BYTESIZE,
            stopBits: s.STOPBITS,
        });
        client.setID(s.MB_ADDRESS);
        client.setTimeout(READ_TIMEOUT_MS);

        const res = await client.readHoldingRegisters(s.Registers.TRIG_READ_FREQ, s.READ_LENGTH || 1);
        if (res && Array.isArray(res.data) && res.data.length > 0) {
            log.info(`Probe: ${templateName} responded with ${res.data.length} registers: [${res.data.join(", ")}]`);
            return tpl;
        }
        log.info(`Probe: ${templateName} read returned no data`);
        return null;
    } catch (e) {
        log.info(`Probe: ${templateName} failed: ${e.message}`);
        return null;
    } finally {
        try {
            if (client.isOpen) await client.close();
        } catch (e) { /* ignore */ }
    }
}

// Walk PROBE_ORDER, return { name, template } of the first match, or null.
async function probeVFD(ttyPath) {
    for (const name of PROBE_ORDER) {
        const tpl = await tryTemplate(ttyPath, name);
        if (tpl) {
            return { name, template: tpl };
        }
    }
    return null;
}

// Copy a template's JSON into spindle1_settings.json, overwriting the
// COM_PORT with the live tty path so the settings reflect the current bind.
function installTemplate(templateName, ttyPath) {
    const tpl = loadTemplate(templateName);
    tpl.VFD_Settings.COM_PORT = ttyPath;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(tpl, null, 4));
    log.info(`Installed template ${templateName} -> ${SETTINGS_PATH} (COM_PORT=${ttyPath})`);
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
