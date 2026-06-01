/*
 * network/mdns.js
 *
 * Publishes the engine on mDNS by writing an Avahi service file. Avahi watches
 * /etc/avahi/services/ and re-broadcasts on change, so re-calling publish() after
 * name/identity changes refreshes what the network sees.
 *
 * No-ops cleanly on platforms without /etc/avahi/services (dev machines, non-Pi).
 */
var fs = require("fs");
var path = require("path");
var exec = require("child_process").exec;
var log = require("../log").logger("mdns");

var AVAHI_SERVICES_DIR = "/etc/avahi/services";
var SERVICE_FILE = path.join(AVAHI_SERVICES_DIR, "fabmo.service");
var SERVICE_TYPE = "_fabmo._tcp";

// Without this drop-in, avahi-daemon can enumerate interfaces before
// NetworkManager has brought up eth0/wlan0, leaving mDNS visible only on
// the AP interface. Ordering avahi-daemon After=network-online.target
// fixes the boot-time race.
var SYSTEMD_DIR = "/etc/systemd/system/avahi-daemon.service.d";
var SYSTEMD_DROPIN = path.join(SYSTEMD_DIR, "wait-for-network.conf");
var SYSTEMD_DROPIN_CONTENT = [
    "[Unit]",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
].join("\n");

function xmlEscape(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderServiceXml(opts) {
    var name = opts.name || "FabMo";
    var port = parseInt(opts.port, 10) || 80;
    var records = [
        "name=" + (opts.name || ""),
        "engine_id=" + (opts.engine_id || ""),
        "version=" + (opts.version || ""),
        "path=/",
        "protocol=http",
    ];
    var txt = records
        .map(function (r) {
            return "    <txt-record>" + xmlEscape(r) + "</txt-record>";
        })
        .join("\n");
    return [
        '<?xml version="1.0" standalone="no"?>',
        '<!DOCTYPE service-group SYSTEM "avahi.service.dtd">',
        "<service-group>",
        "  <name>" + xmlEscape(name) + "</name>",
        "  <service>",
        "    <type>" + SERVICE_TYPE + "</type>",
        "    <port>" + port + "</port>",
        txt,
        "  </service>",
        "</service-group>",
        "",
    ].join("\n");
}

function publish(opts, callback) {
    callback = callback || function () {};
    opts = opts || {};
    if (!fs.existsSync(AVAHI_SERVICES_DIR)) {
        log.debug("Avahi services dir not present; skipping mDNS publish");
        return callback();
    }
    var xml = renderServiceXml(opts);
    fs.writeFile(SERVICE_FILE, xml, function (err) {
        if (err) {
            log.warn("Could not write " + SERVICE_FILE + ": " + err.message);
            return callback(err);
        }
        log.info(
            "Published mDNS " + SERVICE_TYPE + " as '" + (opts.name || "FabMo") + "'"
        );
        callback();
    });
}

// Idempotent: only writes (and restarts avahi-daemon) if the drop-in is
// missing or out-of-date. No-ops on platforms without systemd.
function ensureSystemdDropIn() {
    if (!fs.existsSync("/etc/systemd/system")) return;
    try {
        if (fs.existsSync(SYSTEMD_DROPIN)) {
            var existing = fs.readFileSync(SYSTEMD_DROPIN, "utf8");
            if (existing === SYSTEMD_DROPIN_CONTENT) return;
        }
        if (!fs.existsSync(SYSTEMD_DIR)) {
            fs.mkdirSync(SYSTEMD_DIR, { recursive: true });
        }
        fs.writeFileSync(SYSTEMD_DROPIN, SYSTEMD_DROPIN_CONTENT);
        log.info("Installed avahi-daemon drop-in: " + SYSTEMD_DROPIN);
        exec(
            "systemctl daemon-reload && systemctl restart avahi-daemon",
            function (err) {
                if (err) {
                    log.warn(
                        "Could not reload avahi-daemon: " + err.message
                    );
                } else {
                    log.info("avahi-daemon reloaded with new drop-in");
                }
            }
        );
    } catch (e) {
        log.warn("Could not install avahi systemd drop-in: " + e.message);
    }
}

exports.publish = publish;
exports.ensureSystemdDropIn = ensureSystemdDropIn;
exports.SERVICE_FILE = SERVICE_FILE;
exports.SERVICE_TYPE = SERVICE_TYPE;
