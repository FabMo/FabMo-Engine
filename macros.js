/*
 * macros.js
 *
 * Functions and data relating to macros.
 *
 * Macros are sort of "canned routines" that are analagous to the "custom cuts" in SB3.
 * They are in fact, invoked in the same way in the OpenSBP runtime as they were in SB3,
 * by using the C# command (C3 to home the tool, C2 for Z-zero, etc.)
 *
 * Macros are stored on disk at (for example) /opt/fabmo/macros - anything in this directory is scanned
 * at startup and files containing an appropriate header are loaded into memory.  Ideally macros can be
 * in any file format, but the OpenSBP format is the only one that is actually implemented right now.
 * When macros are modified by the user they are saved back to the files that they were loaded from. The
 * header in each macro file contains metadata that identifies the macro, its custom-cut number, and description
 *
 * The macro headers are part of the files, but they are not displayed to the user when editing.  The user
 * is able to edit those fields, but only as exposed through the UI in the macro manager.  This prevents
 * users from corrupting the headers and creating a bunch of edge cases when editing macros.
 */
var fs = require("fs-extra");
var path = require("path");
var async = require("async");
var crypto = require("crypto");
var config = require("./config");
var log = require("./log").logger("macro");

// The marker in the header that signifies a macro.
// TODO - This is used to create files, but not in the regexs used to parse them (see below)
var MARKER = "!FABMO!";

// All the loaded macros will be stored here
var macros = {};

// These functions create macro headers from the specified options
// options:
//         name - The macro display name
//  description - The macro description
//      enabled - Whether or not the macro is enabled (TODO: Is this used?)

var _createGCodeHeader = function (options) {
    var name = options.name || "Untitled Macro";
    var description = options.description || "";
    var enabled = options.enabled || true;
    return (
        "(" +
        MARKER +
        "name:" +
        name +
        ")\n" +
        "(" +
        MARKER +
        "description:" +
        description +
        ")\n" +
        "(" +
        MARKER +
        "enabled:" +
        enabled +
        ")\n"
    );
};

var _createOpenSBPHeader = function (options) {
    var name = options.name || "Untitled Macro";
    var description = options.description || "";
    var enabled = options.enabled || true;
    return (
        "'" +
        MARKER +
        "name:" +
        name +
        "\n" +
        "'" +
        MARKER +
        "description:" +
        description +
        "\n" +
        "'" +
        MARKER +
        "enabled:" +
        enabled +
        "\n"
    );
};

var _deleteMacroFile = function (index, callback) {
    var macro_path = config.getDataDir("macros");
    var opensbp = path.join(macro_path, "macro_" + index + ".sbp");
    var gcode = path.join(macro_path, "macro_" + index + ".nc");
    // eslint-disable-next-line no-unused-vars
    fs.unlink(opensbp, function (err) {
        // eslint-disable-next-line no-unused-vars
        fs.unlink(gcode, function (err) {
            callback(null);
        });
    });
};

// Given a number and a type, construct a path to the corresponding macro file
var _createMacroFilename = function (id, type) {
    var macro_path = config.getDataDir("macros");
    switch (type) {
        case "nc":
            return path.join(macro_path, "macro_" + id + ".nc");

        case "sbp":
            return path.join(macro_path, "macro_" + id + ".sbp");

        default:
            throw new Error("Invalid macro type: " + type);
    }
};

// Create default macro content for the specified macro.
// (Use if you want "new" macros to be non-empty)
var _createMacroDefaultContent = function (macro) {
    switch (macro.type) {
        case "nc":
            //return 	'( ' + macro.name + ' )\n( ' + macro.description + ' )\n\n';
            return "";

        case "sbp":
            //return 	"' " + macro.name + "\n' " + macro.description + "\n\n";
            return "";

        default:
            throw new Error("Invalid macro type: " + macro.type);
    }
};

// Iterate over the lines in the macro file, and parse out lines that appear to be part of the header
// filename - The filename of the macro to parse out
// callback - called with the parsed contents of the macro file, eg:
//            {name : 'My Macro', description:'Move to X=10',content : 'MZ,0.5\nMX,10'}
var _parseMacroFile = function (filename, callback) {
    var re = /[(']!FABMO!(\w+):([^)]*)\)?/;
    var obj = {};
    var ok = false;
    fs.readFile(filename, function (err, data) {
        if (err) {
            log.error(err);
        } else {
            var lines = data.toString().split("\n");
            var i = 0;
            while (i < lines.length) {
                var line = lines[i];
                var groups = line.match(re);
                if (groups) {
                    ok = true;
                    var key = groups[1];
                    var value = groups[2];
                    obj[key] = value;
                } else {
                    break;
                }
                i += 1;
            }
            if (ok) {
                obj.filename = filename;
                obj.content = lines.slice(i, lines.length).join("\n");
                callback(null, obj);
            } else {
                try {
                    log.error("File " + filename + " failed to parse.  Unlinking it so it can be replaced.");
                    fs.unlink(filename);
                } finally {
                    callback(null, undefined);
                }
            }
        }
    });
};

// Update an existing macro with new content
//       id - The macro to update
//    macro - The macro object that contains the new content
// callback - called on completion, with an error if appropriate
var update = function (id, macro, callback) {
    // Get the old macro data
    var old_macro = get(id);

    if (old_macro) {
        // Here, we're updating an existing macro
        // We only update fields that were provided in the macro passed in
        // Other fields, we leave alone.
        // Tried moving this function to outer scope but it caused issues with
        // saving macros, will address later
        // eslint-disable-next-line no-inner-declarations
        function savemacro(id, callback) {
            old_macro.name = macro.name || old_macro.name;
            old_macro.description = macro.description || old_macro.description;
            old_macro.content = macro.content || old_macro.content;
            old_macro.index = macro.index || old_macro.index;
            old_macro.type = macro.type || old_macro.type;
            old_macro.filename = _createMacroFilename(old_macro.index, old_macro.type);
            save(id, callback);
        }
        // This function takes an id, and the macro can carry an index as well
        // If the incoming macros index is different than the id that was passed,
        // we interpret that as an intent to move that macro to a new index.
        if (macro.index) {
            var new_index = parseInt(macro.index);
            // If there's already a macro at the index that we're moving to, that's an error.
            // we're not going to write it.
            if (get(new_index)) {
                return callback(new Error("There is already a macro #" + new_index));
            }

            // If the new index is different we actually want to move the macro,
            // so we assign it to the new index, trash the macro at the old index
            // trash the file at the old index, and finally save the file at the new index
            if (new_index != old_macro.index) {
                macros[new_index] = old_macro;
                delete macros[old_macro.index];
                // eslint-disable-next-line no-unused-vars
                _deleteMacroFile(old_macro.index, function (err) {
                    savemacro(new_index, callback);
                });
            } else {
                // Provided an index with the macro, but it's the the same, so no move needed
                savemacro(id, callback);
            }
        } else {
            // Not moving the macro (didn't provide an index) so just save it
            savemacro(id, callback);
        }
    } else {
        // In this case, we're "updating" a macro that doesn't exist, so create a new one
        // (filling in any attributes that were not provided by the update)
        var new_macro = {
            name: macro.name || "Untitled Macro",
            description: macro.description || "Macro Description",
            type: macro.type || "sbp",
            enabled: macro.enabled || true, // TODO fix this
            index: id,
        };
        new_macro.filename = _createMacroFilename(id, new_macro.type);
        new_macro.content = macro.content || _createMacroDefaultContent(new_macro);
        macros[id] = new_macro;
        save(id, callback);
    }
};

// Commit the provided macro id to disk.
// callback is called with the macro object that was saved (or error)
var save = function (id, callback) {
    var macro = get(id);
    if (macro) {
        var macro_path = config.getDataDir("macros");
        var file_path = path.join(macro_path, "macro_" + macro.index + "." + macro.type);
        switch (macro.type) {
            case "nc":
                var header = _createGCodeHeader(macro);
                break;
            case "sbp":
                // eslint-disable-next-line no-redeclare
                var header = _createOpenSBPHeader(macro);
                break;
            default:
                setImmediate(callback, new Error("Invalid macro type: " + macro.type));
                break;
        }
        fs.open(file_path, "w", function (err, fd) {
            if (err) {
                log.error(err);
                return callback(err);
            }
            let contentString = header + macro.content;
            var contents = Buffer.from(contentString);
            fs.write(
                fd,
                contents,
                0,
                contents.length,
                0,
                // eslint-disable-next-line no-unused-vars
                function (err, written, string) {
                    if (err) {
                        log.error(err);
                        return callback(err);
                    }
                    fs.fsync(fd, function (err) {
                        if (err) {
                            log.error(err);
                        }
                        fs.closeSync(fd);
                        log.debug("fsync()ed " + file_path);
                        callback(err, macro);
                    });
                },
            );
        });
    } else {
        callback(new Error("No such macro " + id));
    }
};

// Load all macros from disk
var load = function (callback) {
    var macro_path = config.getDataDir("macros");
    var re = /macro_([0-9]+)\.(nc|sbp)/;
    macros = {};
    fs.readdir(macro_path, function (err, files) {
        if (err) {
            callback(err);
        } else {
            for (var i = 0; i < files.length; i++) {
                files[i] = path.join(macro_path, files[i]);
            }
            async.map(files, _parseMacroFile, function (err, results) {
                results.forEach(function (info) {
                    if (info) {
                        var groups = info.filename.match(re);
                        if (groups) {
                            var idx = parseInt(groups[1]);
                            var ext = groups[2];
                            info.index = idx;
                            info.type = ext;
                            macros[idx] = info;
                        }
                    }
                });
                callback(null);
            });
        }
    });
};

// Return the full list of macros (scrubbed)
var list = function () {
    var retval = [];
    for (var key in macros) {
        retval.push(getInfo(key));
    }
    return retval;
};

// Get the metadata for a macro by index (null if no macro with that index)
var getInfo = function (idx) {
    var macro = get(idx);
    if (macro) {
        return {
            name: macro.name,
            description: macro.description,
            enabled: macro.enabled,
            type: macro.type,
            index: parseInt(macro.index),
        };
    } else {
        return null;
    }
};

// Retrieve a macro by index
var get = function (idx) {
    return macros[idx] || null;
};

// Run a macro by index.
var run = function (idx) {
    var machine = require("./machine").machine;
    var bypassInterlock = false;
    var info = macros[idx];
    log.debug(idx);
    log.debug(info);
    if (parseInt(idx) === 2) {
        bypassInterlock = true;
    }
    if (info) {
        machine.runFile(info.filename, bypassInterlock);
    } else {
        throw new Error("No such macro.");
    }
};

// Delete a macro by index
// callback returns an error only
var del = function (idx, callback) {
    var info = macros[idx];
    if (info) {
        _deleteMacroFile(idx, function (err) {
            if (err) {
                callback(err);
            } else {
                delete macros[idx];
                callback(null);
            }
        });
    } else {
        callback(new Error("No such macro: " + idx));
    }
};

// Copy macros from the current profile to the macros directory.
// Only copies macros if they do not exist.
var loadProfileMacros = function (callback) {
    var installedMacrosDir = config.getDataDir("macros");
    var profileMacrosDir = config.getProfileDir("macros");
    var copyIfNotExists = function (fn, callback) {
        var a = path.join(profileMacrosDir, fn);
        var b = path.join(installedMacrosDir, fn);
        fs.stat(b, function (err, stats) {
            if (!err && stats.isFile()) {
                log.debug("Not Copying " + a + " -> " + b + " because it already exists.");
                callback();
            } else {
                log.debug("Copying " + a + " -> " + b + " because it doesnt already exist.");
                // eslint-disable-next-line no-unused-vars
                fs.copy(a, b, function (err, data) {
                    callback(err);
                });
            }
        });
    };

    fs.readdir(profileMacrosDir, function (err, files) {
        if (err) {
            return callback(err);
        }
        async.map(files, copyIfNotExists, callback);
    });
};

// ---- Shipped-default (profile) macro tracking -----------------------------
//
// Profile macros are copied into the data directory once (when the profile
// is applied) and never touched again, so user edits survive engine
// updates -- but newly shipped macro revisions never arrive either. The
// functions below compare the installed macros against the shipped
// defaults for the current profile and track, per macro, a hash of the
// default each installed copy was last synced from (its "base"). That
// lets the macro manager distinguish "you customized this" from "a newer
// default version arrived with an update" and offer a per-macro
// update / revert (both are installDefault -- the difference is only in
// how the UI words it).
//
// The base hashes live in <data>/config/macros_meta.json -- deliberately
// NOT in the macros directory, because load() unlinks any file there
// that does not parse as a macro.

function _metaPath() {
    return path.join(config.getDataDir("config"), "macros_meta.json");
}

function _readMeta() {
    try {
        var meta = JSON.parse(fs.readFileSync(_metaPath()));
        meta.macros = meta.macros || {};
        return meta;
    } catch (e) {
        return { macros: {} };
    }
}

function _writeMeta(meta) {
    try {
        fs.writeFileSync(_metaPath(), JSON.stringify(meta, null, 2));
    } catch (e) {
        log.warn("Could not write " + _metaPath() + ": " + e.message);
    }
}

// Hash macro file content for comparison. Line endings and trailing
// whitespace are normalized so a copy that round-tripped through an
// editor or another OS does not read as a modification.
function _hashContent(data) {
    var normalized = data.toString().replace(/\r\n/g, "\n").replace(/\s+$/, "");
    return crypto.createHash("sha1").update(normalized).digest("hex");
}

function _hashFile(filename) {
    try {
        return _hashContent(fs.readFileSync(filename));
    } catch (e) {
        return null;
    }
}

// Resolve the shipped-defaults macros directory for the current profile.
// The engine config may hold either the profile's directory name or its
// display name (from the profile's package.json), so match both, case-
// insensitively. Prefer the engine's own ./profiles copy, which is always
// current with the installed engine version -- the mirror under the data
// directory is only copied when missing, so it goes stale across updates.
// Custom (profile designer) profiles exist only under the data directory.
function _getDefaultMacrosDir() {
    var current = config.engine.get("profile") || "default";
    var registry = require("./profiles").getProfiles();
    var profileDir = null;
    Object.keys(registry).forEach(function (name) {
        var p = registry[name];
        if (
            name.toLowerCase() === current.toLowerCase() ||
            path.basename(p.dir).toLowerCase() === current.toLowerCase()
        ) {
            profileDir = p.dir;
        }
    });
    if (!profileDir) {
        profileDir = path.join(config.getDataDir("profiles"), current);
    }
    var repoDir = path.join(__dirname, "profiles", path.basename(profileDir), "macros");
    if (fs.existsSync(repoDir)) {
        return repoDir;
    }
    var dataDir = path.join(profileDir, "macros");
    if (fs.existsSync(dataDir)) {
        return dataDir;
    }
    return null;
}

// List the shipped default macro files, keyed by index:
// { 2 : {filename : '/fabmo/profiles/.../macro_2.sbp', type : 'sbp'}, ... }
function _listDefaultMacros() {
    var defaults = {};
    var dir = _getDefaultMacrosDir();
    if (!dir) {
        return defaults;
    }
    var re = /^macro_([0-9]+)\.(nc|sbp)$/;
    try {
        fs.readdirSync(dir).forEach(function (fn) {
            var groups = fn.match(re);
            if (groups) {
                defaults[parseInt(groups[1])] = {
                    filename: path.join(dir, fn),
                    type: groups[2],
                };
            }
        });
    } catch (e) {
        log.warn("Could not read default macros from " + dir + ": " + e.message);
    }
    return defaults;
}

// Read a macro file synchronously into {name, description, ..., content}
// (header fields plus header-stripped content) without the
// unlink-on-parse-failure behavior of _parseMacroFile (we must never
// delete files out of a profile directory). Returns null if unreadable.
function _readMacroFileSync(filename) {
    var re = /[(']!FABMO!(\w+):([^)]*)\)?/;
    var obj = {};
    try {
        var lines = fs.readFileSync(filename).toString().split("\n");
        var i = 0;
        while (i < lines.length) {
            var groups = lines[i].match(re);
            if (!groups) {
                break;
            }
            obj[groups[1]] = groups[2];
            i++;
        }
        obj.content = lines.slice(i).join("\n");
    } catch (e) {
        return null;
    }
    return obj;
}

// Read just the header fields (name, description, ...)
function _readHeaderInfo(filename) {
    return _readMacroFileSync(filename) || {};
}

// Get the shipped default for a macro index (null if the current profile
// does not ship one): {index, type, name, description, content}
var getDefault = function (idx) {
    idx = parseInt(idx);
    var def = _listDefaultMacros()[idx];
    if (!def) {
        return null;
    }
    var parsed = _readMacroFileSync(def.filename);
    if (!parsed) {
        return null;
    }
    return {
        index: idx,
        type: def.type,
        name: parsed.name || "macro_" + idx,
        description: parsed.description || "",
        content: parsed.content || "",
    };
};

// Compute the status of every macro (installed and/or shipped) vs the
// current profile's defaults. Returns a list sorted by index:
//   { index, installed, has_default, state, name?, description? }
// states:
//   custom           - installed macro with no shipped counterpart
//   current          - installed copy matches the shipped default
//   customized       - user edited it; the default is unchanged since sync
//   update_available - the default changed; the installed copy was never edited
//   diverged         - both differ (edits + a new default, or unknown history)
//   new_default      - shipped default exists but no macro is installed
//   ignored_default  - like new_default, but the user chose to dismiss it
// Base recording self-heals: whenever installed == default the base hash
// is (re)recorded, so machines that predate this feature converge without
// a migration step.
var getStatus = function () {
    var defaults = _listDefaultMacros();
    var meta = _readMeta();
    var dirty = false;
    var indices = {};
    Object.keys(macros).forEach(function (k) {
        indices[k] = true;
    });
    Object.keys(defaults).forEach(function (k) {
        indices[k] = true;
    });
    var result = [];
    Object.keys(indices)
        .map(Number)
        .sort(function (a, b) {
            return a - b;
        })
        .forEach(function (idx) {
            var installed = macros[idx];
            var def = defaults[idx];
            var entry = {
                index: idx,
                installed: !!installed,
                has_default: !!def,
            };
            if (installed && !def) {
                entry.state = "custom";
            } else if (!installed && def) {
                var header = _readHeaderInfo(def.filename);
                entry.name = header.name || "macro_" + idx;
                entry.description = header.description || "";
                var seen = meta.macros[idx];
                entry.state = seen && seen.base === _hashFile(def.filename) ? "ignored_default" : "new_default";
            } else {
                var defHash = _hashFile(def.filename);
                var instHash = _hashFile(installed.filename);
                var base = (meta.macros[idx] || {}).base;
                if (defHash === instHash) {
                    entry.state = "current";
                    if (base !== defHash) {
                        meta.macros[idx] = { base: defHash };
                        dirty = true;
                    }
                } else if (base === defHash) {
                    entry.state = "customized";
                } else if (base === instHash) {
                    entry.state = "update_available";
                } else {
                    entry.state = "diverged";
                }
            }
            result.push(entry);
        });
    if (dirty) {
        _writeMeta(meta);
    }
    return result;
};

// Replace the installed macro at idx with the shipped default (also used
// to install a shipped macro that is missing). Records the new base hash
// and reloads the macro into memory.
var installDefault = function (idx, callback) {
    idx = parseInt(idx);
    var def = _listDefaultMacros()[idx];
    if (!def) {
        return callback(new Error("No shipped default for macro " + idx));
    }
    // Remove any existing files at this index first -- the installed copy
    // may be a different type (.nc vs .sbp) than the default.
    _deleteMacroFile(idx, function () {
        var dest = _createMacroFilename(idx, def.type);
        fs.copy(def.filename, dest, function (err) {
            if (err) {
                return callback(err);
            }
            var meta = _readMeta();
            meta.macros[idx] = { base: _hashFile(def.filename) };
            _writeMeta(meta);
            delete macros[idx];
            _parseMacroFile(dest, function (err, info) {
                if (info) {
                    info.index = idx;
                    info.type = def.type;
                    macros[idx] = info;
                }
                callback(err || null, getInfo(idx));
            });
        });
    });
};

// Mark the current shipped default for idx as "seen" without installing
// it: records its hash as the base so the update badge goes away until
// the default changes again.
var dismissDefault = function (idx, callback) {
    idx = parseInt(idx);
    var def = _listDefaultMacros()[idx];
    if (!def) {
        return callback(new Error("No shipped default for macro " + idx));
    }
    var meta = _readMeta();
    meta.macros[idx] = { base: _hashFile(def.filename) };
    _writeMeta(meta);
    callback(null);
};

exports.load = load;
exports.list = list;
exports.get = get;
exports.del = del;
exports.run = run;
exports.getInfo = getInfo;
exports.update = update;
exports.save = save;
exports.loadProfile = loadProfileMacros;
exports.getStatus = getStatus;
exports.installDefault = installDefault;
exports.dismissDefault = dismissDefault;
exports.getDefault = getDefault;
