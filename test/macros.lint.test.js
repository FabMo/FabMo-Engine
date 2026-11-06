/*jshint esversion: 6 */
//
// Lint every shipped macro: each .sbp under profiles/**/macros must parse
// cleanly and must not define the same label twice.
//
// Motivation: macro_70 shipped with its unit-forcing block (SetINCH /
// SetMETRIC / SetUniversalUnits) duplicated inside each $ATC.Type section.
// The runtime's _analyzeLabels throws on duplicate labels, so the macro
// failed on every machine at run time — a class of bug that is purely
// static and should never survive the build.
//
// Duplicate detection mirrors SBPRuntime._analyzeLabels exactly (parsed
// line.type === "label", exact match on line.value) so this test agrees
// with what the runtime would reject.

const fs = require("fs");
const path = require("path");
const parser = require("../runtime/opensbp/parser");

const PROFILES_DIR = path.join(__dirname, "..", "profiles");

// Legacy profiles whose macros predate the current grammar and are
// intentionally left untouched. Known issue: handibot-2 macro_77 uses
// `END "message"`, which the modern parser rejects.
const SKIP_PROFILES = new Set(["fabmo-profile-handibot-2"]);

// Collect every .sbp file under any profile's macros/ tree (including
// feature subdirectories like atc/).
function collectMacroFiles() {
    const found = [];
    for (const profile of fs.readdirSync(PROFILES_DIR)) {
        if (SKIP_PROFILES.has(profile)) continue;
        const macrosDir = path.join(PROFILES_DIR, profile, "macros");
        if (!fs.existsSync(macrosDir)) continue;
        const stack = [macrosDir];
        while (stack.length) {
            const dir = stack.pop();
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    stack.push(full);
                } else if (entry.name.toLowerCase().endsWith(".sbp")) {
                    found.push(full);
                }
            }
        }
    }
    return found;
}

function findDuplicateLabels(program) {
    const firstSeen = {};
    const duplicates = [];
    program.forEach((line, i) => {
        if (line && line.type === "label") {
            if (line.value in firstSeen) {
                duplicates.push(
                    `"${line.value}" at lines ${firstSeen[line.value] + 1} and ${i + 1}`
                );
            } else {
                firstSeen[line.value] = i;
            }
        }
    });
    return duplicates;
}

const macroFiles = collectMacroFiles();

describe("shipped macros lint", () => {
    test("found macros to lint", () => {
        expect(macroFiles.length).toBeGreaterThan(0);
    });

    test.each(macroFiles.map((f) => [path.relative(PROFILES_DIR, f), f]))(
        "%s parses with no duplicate labels",
        (rel, file) => {
            const text = fs.readFileSync(file, "utf8");
            let program;
            try {
                program = parser.parse(text);
            } catch (err) {
                throw new Error(`${rel}: syntax error at line ${err.line || "?"}: ${err.message}`);
            }
            const duplicates = findDuplicateLabels(program);
            expect(duplicates).toEqual([]);
        }
    );
});
