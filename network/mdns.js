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
var log = require("../log").logger("mdns");

var AVAHI_SERVICES_DIR = "/etc/avahi/services";
var SERVICE_FILE = path.join(AVAHI_SERVICES_DIR, "fabmo.service");
var SERVICE_TYPE = "_fabmo._tcp";

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

exports.publish = publish;
exports.SERVICE_FILE = SERVICE_FILE;
exports.SERVICE_TYPE = SERVICE_TYPE;
