/*jshint esversion: 6 */

// The OpenSBP command table (runtime/opensbp/sb3_commands.json) is the single
// source for command arity in the runtime and for menus / fill-in sheets in the
// Sb4 and Tool Status apps. The runtime sizes a command's arguments from the
// length of its params array, so a handler with no table entry silently
// receives NO arguments. These tests keep the table and the handlers in step.

const fs = require("fs");
const path = require("path");

const tablePath = path.join(__dirname, "..", "runtime", "opensbp", "sb3_commands.json");
const table = JSON.parse(fs.readFileSync(tablePath, "utf8"));

// Collect every exported two-character handler from runtime/opensbp/commands/*.js
// by scanning source text (requiring the modules pulls in config/log side effects).
function loadHandlerNames() {
    const dir = path.join(__dirname, "..", "runtime", "opensbp", "commands");
    const names = new Set();
    fs.readdirSync(dir).forEach((file) => {
        if (path.extname(file) !== ".js" || file === "index.js") return;
        const src = fs.readFileSync(path.join(dir, file), "utf8");
        const re = /exports\.([A-Z][A-Z0-9#])\s*=/g;
        let m;
        while ((m = re.exec(src)) !== null) names.add(m[1]);
    });
    return [...names].sort();
}

test("every command handler has an entry in the command table", () => {
    const missing = loadHandlerNames().filter((cmd) => !(cmd in table));
    expect(missing).toEqual([]);
});

test("every table entry is well-formed", () => {
    const problems = [];
    Object.keys(table).forEach((key) => {
        const entry = table[key];
        if (entry.cmd !== key) problems.push(key + ": cmd field does not match key");
        if (typeof entry.name !== "string") problems.push(key + ": missing name");
        if ("params" in entry) {
            if (!Array.isArray(entry.params)) problems.push(key + ": params is not an array");
            else
                entry.params.forEach((p, i) => {
                    if (typeof p.name !== "string") problems.push(key + ": param " + i + " has no name");
                });
        }
    });
    expect(problems).toEqual([]);
});

test("VL parameter layout matches the VL handler positions", () => {
    // commands/value.js VL reads args 0-7 (X,Y,Z,A lo/hi), 9-10 (B), 12-13 (C)
    const abrevs = table.VL.params.map((p) => p.abrev);
    expect(abrevs).toEqual([
        "loX",
        "hiX",
        "loY",
        "hiY",
        "loZ",
        "hiZ",
        "loA",
        "hiA",
        "ON",
        "loB",
        "hiB",
        "lmNm",
        "loC",
        "hiC",
    ]);
});

test("no app ships its own copy of the command table", () => {
    const appsDir = path.join(__dirname, "..", "dashboard", "apps");
    const copies = fs
        .readdirSync(appsDir)
        .map((app) => path.join(appsDir, app, "assets", "sb3_commands.json"))
        .filter((p) => fs.existsSync(p));
    expect(copies).toEqual([]);
});
