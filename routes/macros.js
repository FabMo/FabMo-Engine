var macros = require("../macros");
var log = require("../log").logger("api");

// eslint-disable-next-line no-unused-vars
var updateMacro = function (req, res, next) {
    var id = req.params.id;
    var macro = macros.get(id);
    var updated_macro = {};
    if (macro) {
        updated_macro.name = req.params.name || macro.name;
        updated_macro.description = req.params.description || macro.description;
        updated_macro.content = req.params.content || macro.content;
        if (req.params.index != req.params.id) {
            if (req.params.index < 0) {
                return res.json({
                    status: "error",
                    message: "Macro number cannot be negative.",
                });
            }
            updated_macro.index = req.params.index;
        }
    }
    macros.update(id, updated_macro, function (err, macro) {
        if (err) {
            var response = { status: "error", message: err.message };
        } else {
            response = { status: "success", data: macro };
        }
        res.json(response);
    });
};

/**
 * @apiGroup Macros
 * @api {get} /macros List all macros
 * @apiDescription Returns a listing with information about all macros
 */
// eslint-disable-next-line no-unused-vars
var getMacros = function (req, res, next) {
    var response = { status: "success", data: { macros: macros.list() } };
    res.json(response);
};

/**
 * @apiGroup Macros
 * @api {get} /macros/:id Get macro
 * @apiDescription Returns the specified macro
 * @apiSuccess {Object} macro The requested macro
 * @apiSuccess {String} macro.name Macro name
 * @apiSuccess {String} macro.description Macro description
 * @apiSuccess {String} macro.content Macro code
 * @apiSuccess {String} macro.type Runtime used by the macro
 * @apiSuccess {String} macro.filename Local filename where the macro is stored
 * @apiSuccess {Number} macro.index Macro numeric index
 */
// eslint-disable-next-line no-unused-vars
var getMacro = function (req, res, next) {
    var id = req.params.id;
    var macro = macros.get(id);
    if (macro) {
        res.json({
            status: "success",
            data: { macro: macro },
        });
    } else {
        res.json({
            status: "error",
            message: "No such macro: " + id,
        });
    }
};

/**
 * @apiGroup Macros
 * @api {get} /macros/:id/info Get macro summary
 * @apiDescription Returns the specified macro info (no macro content provided)
 * @apiSuccess {Object} macro The requested macro info
 * @apiSuccess {String} macro.name Macro name
 * @apiSuccess {String} macro.description Macro description
 * @apiSuccess {String} macro.type Runtime used by the macro
 * @apiSuccess {String} macro.filename Local filename where the macro is stored
 * @apiSuccess {Number} macro.index Macro numeric index
 */
// eslint-disable-next-line no-unused-vars
var getMacroInfo = function (req, res, next) {
    var id = req.params.id;
    var info = macros.getInfo(id);
    if (info) {
        res.json({
            status: "success",
            data: info,
        });
    } else {
        res.json({
            status: "error",
            message: "No such macro: " + id,
        });
    }
};

// eslint-disable-next-line no-unused-vars
var runMacro = function (req, res, next) {
    var id = req.params.id;
    var macro = macros.get(id);
    if (macro) {
        // macros.run -> machine.runFile -> arm() throws synchronously if the
        // machine is busy (e.g. already running another macro from a rapid
        // double-click). Without this guard the throw escapes the route
        // handler and tears down the process.
        try {
            macros.run(id);
        } catch (e) {
            log.warn("runMacro: " + e.message);
            return res.json({
                status: "error",
                message: e.message,
            });
        }
        res.json({
            status: "success",
            data: macros.list(),
        });
    } else {
        res.json({
            status: "error",
            message: "No such macro: " + id,
        });
    }
};

// eslint-disable-next-line no-unused-vars
var deleteMacro = function (req, res, next) {
    var id = req.params.id;
    macros.del(id, function (err) {
        if (err) {
            res.json({
                status: "error",
                message: err.message,
            });
        } else {
            res.json({
                status: "success",
                data: macros.list(),
            });
        }
    });
};

/**
 * @apiGroup Macros
 * @api {get} /macros/status Get macro default-version status
 * @apiDescription For every macro (installed or shipped with the current
 * profile) reports how the installed copy relates to the shipped default:
 * current / customized / update_available / diverged / new_default /
 * ignored_default / custom.
 */
// eslint-disable-next-line no-unused-vars
var getMacroStatus = function (req, res, next) {
    res.json({
        status: "success",
        data: { macros: macros.getStatus() },
    });
};

/**
 * @apiGroup Macros
 * @api {get} /macros/:id/default Get shipped default version
 * @apiDescription Returns the version of the macro shipped with the current
 * machine profile (name, description, and header-stripped content), so the
 * client can preview or diff it against the installed copy.
 */
// eslint-disable-next-line no-unused-vars
var getDefaultMacro = function (req, res, next) {
    var macro = macros.getDefault(req.params.id);
    if (macro) {
        res.json({ status: "success", data: { macro: macro } });
    } else {
        res.json({
            status: "error",
            message: "No shipped default for macro " + req.params.id,
        });
    }
};

/**
 * @apiGroup Macros
 * @api {post} /macros/:id/install_default Install shipped default
 * @apiDescription Replaces the macro (or installs it, if missing) with the
 * version shipped in the current machine profile.
 */
// eslint-disable-next-line no-unused-vars
var installDefaultMacro = function (req, res, next) {
    macros.installDefault(req.params.id, function (err, info) {
        if (err) {
            res.json({ status: "error", message: err.message });
        } else {
            res.json({ status: "success", data: info });
        }
    });
};

/**
 * @apiGroup Macros
 * @api {post} /macros/:id/dismiss_default Dismiss shipped default
 * @apiDescription Marks the current shipped default version as seen without
 * installing it, clearing the update indicator until the default changes
 * again.
 */
// eslint-disable-next-line no-unused-vars
var dismissDefaultMacro = function (req, res, next) {
    macros.dismissDefault(req.params.id, function (err) {
        if (err) {
            res.json({ status: "error", message: err.message });
        } else {
            res.json({ status: "success" });
        }
    });
};

module.exports = function (server) {
    server.get("/macros", getMacros);
    // Register before /macros/:id so "status" is not consumed as an id
    server.get("/macros/status", getMacroStatus);
    server.get("/macros/:id", getMacro);
    server.get("/macros/:id/default", getDefaultMacro);
    server.post("/macros/:id/install_default", installDefaultMacro);
    server.post("/macros/:id/dismiss_default", dismissDefaultMacro);
    server.del("/macros/:id", deleteMacro);
    server.get("/macros/:id/info", getMacroInfo);
    server.post("/macros/:id/run", runMacro);
    server.post("/macros/:id", updateMacro);
};
