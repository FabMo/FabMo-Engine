/*
 * /i18n routes — exposes the language dictionaries to the dashboard.
 *
 * GET /i18n/languages    → list of available { code, language } pairs
 *                          and the currently-active code.
 * GET /i18n/dict/:lang   → the full nested dict for a given language.
 *                          Browsers fetch one at page load and cache it.
 *
 * Language is a single global per machine, stored on the engine config
 * as `engine.language`.
 */

var i18n = require("../i18n");
var config = require("../config");

function getLanguages(req, res, next) {
    var current = config.engine.get("language") || "en";
    res.json({
        current: current,
        available: i18n.listLanguages(),
    });
    return next();
}

function getDict(req, res, next) {
    var lang = req.params.lang;
    res.json(i18n.getDict(lang));
    return next();
}

module.exports = function (server) {
    server.get("/i18n/languages", getLanguages);
    server.get("/i18n/dict/:lang", getDict);
};
