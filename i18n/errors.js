/*
 * i18nError — tagged errors that carry a translation key + vars rather
 * than a baked-in English string.
 *
 *     throw i18nError("machine.cannot_arm_from_state", { state: "manual" });
 *
 * Response layers (HTTP, WebSocket) check for `.i18nKey` on caught
 * errors and translate at the boundary:
 *
 *     try { ... } catch (e) {
 *         res.json({ status: "fail", message: errorMessage(e, lang) });
 *     }
 *
 * Non-tagged errors fall through unchanged, so the migration can be
 * gradual — existing throw new Error("…") sites keep working.
 *
 * The English template lives in i18n/en.json so untranslated locales
 * still get a readable message via the English fallback.
 */

var i18n = require("./");

function i18nError(code, vars) {
    var template = i18n.t(code, "en", vars) || code;
    var err = new Error(template);
    err.i18nKey = code;
    err.i18nVars = vars || {};
    return err;
}

// Translate any error to a user-facing string in the requested language.
// - Tagged i18nError: looked up by key with var substitution.
// - Plain Error: its .message is returned as-is. Migration leaves these
//   in English until the throw site is converted.
function errorMessage(err, lang) {
    if (!err) return "";
    if (err.i18nKey) {
        return i18n.t(err.i18nKey, lang || "en", err.i18nVars);
    }
    return err.message || String(err);
}

module.exports = {
    i18nError: i18nError,
    errorMessage: errorMessage,
};
