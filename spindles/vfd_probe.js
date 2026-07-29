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
    "spin-PRS5-yaskawaD",    // Yaskawa V1000 — low register set, FC16 writes; signature reg 77 rejects a V7
    "spin-PRT-yaskawaV7",    // Yaskawa V7/V7-4X — same low register set as V1000, factory no-parity; must come after V1000
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
        if (res && Array.isArray(res.data) && res.data.length > 0) {
            log.info(`Probe: ${templateName} responded at addr ${addr} parity ${par} with ${res.data.length} registers: [${res.data.join(", ")}]`);

            // A successful TRIG read alone can false-match: some foreign drives
            // answer reads in another template's register range instead of
            // Modbus-exceptioning (e.g. both Yaskawa V7 and V1000 serve the
            // 0x0020 monitor area). Two-layer defense:
            //
            // 1. If the template defines a SIGNATURE_REGISTER, read it and
            //    require non-zero data. The signature is chosen per-template
            //    to exception or read zero on look-alike drives (V1000: reg 77
            //    drive capacity, which a V7 rejects; V7: reg 267 = n011 max
            //    frequency, never zero on a real V7). When a signature is
            //    defined, TRIG content is NOT validated — a stopped drive may
            //    legitimately read all zeros there.
            // 2. Without a signature, reject an all-zero TRIG response as a
            //    likely foreign drive.
            const sigReg = s.Registers.SIGNATURE_REGISTER;
            if (sigReg != null) {
                try {
                    const sig = await client.readHoldingRegisters(sigReg, s.Registers.SIGNATURE_LENGTH || 1);
                    if (sig && Array.isArray(sig.data) && sig.data.some(v => v !== 0)) {
                        log.info(`Probe: ${templateName} signature reg ${sigReg} confirmed: [${sig.data.join(", ")}]`);
                        return tpl;
                    }
                    log.info(`Probe: ${templateName} signature reg ${sigReg} read all-zero — rejecting match`);
                    return null;
                } catch (sigErr) {
                    log.info(`Probe: ${templateName} signature reg ${sigReg} failed (${sigErr.message}) — rejecting match`);
                    return null;
                }
            }
            if (!res.data.some(v => v !== 0)) {
                log.info(`Probe: ${templateName} TRIG read all-zero and no signature register — rejecting match`);
                return null;
            }
            return tpl;
        }
        log.info(`Probe: ${templateName} addr ${addr} parity ${par} read returned no data`);
        return null;
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
