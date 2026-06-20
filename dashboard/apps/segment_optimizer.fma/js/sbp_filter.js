/*
 * sbp_filter.js  (Segment Optimizer app)
 *
 * Pure, dependency-free OpenSBP segment optimizer. Combines runs of very short
 * consecutive linear CUT moves (M2/M3/MX/MY/MZ) so the tool path has fewer,
 * larger segments that G2 can ingest efficiently. Everything that is not a
 * plain, literal-coordinate cut move is passed through byte-for-byte.
 *
 * This is the offline, file-to-file counterpart to the (now removed) live
 * G-code stream filter. Because it runs in the app -- not in the motion
 * pipeline -- there is no interaction with pauses, stack-breaks or priming.
 *
 * Algorithm (same as the validated G-code version, re-targeted to OpenSBP):
 *   - Nearly-straight runs (within `angleTol` degrees) merge into one move.
 *   - On curves, short segments coalesce into a chord until the accumulated
 *     length reaches `minSegLen`, bounded by `maxRun` source segments.
 *
 * Safety: we only merge moves whose coordinates are NUMERIC LITERALS in
 * ABSOLUTE mode. Any move that uses an expression (&var, $sys, math), any arc
 * (CG/CC/CP/CA/CR), jog, macro call, probe, zeroing, home, mode/units change,
 * or unrecognized command is a hard boundary: the pending chain is flushed and
 * the line is emitted unchanged. Whenever the resulting position can't be known
 * exactly, position tracking is invalidated so we never merge across a gap.
 *
 * UMD: usable as `require('./sbp_filter').filterSBP` in Node (for tests) and as
 * `window.SBPFilter.filterSBP` in the browser app.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.SBPFilter = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var DEG2RAD = Math.PI / 180.0;

    // A numeric literal argument (optionally signed/decimal). NOT &var/$sys/math.
    var LITERAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

    // Commands we will merge (linear XYZ cut moves) and the axes each carries.
    var CUT_AXES = {
        M2: ["X", "Y"],
        M3: ["X", "Y", "Z"],
        MX: ["X"],
        MY: ["Y"],
        MZ: ["Z"],
    };
    // Linear cut moves with rotary/extra axes we track but never merge.
    var CUT_TRACK_ONLY = { M4: ["X", "Y", "Z"], M5: ["X", "Y", "Z"], M6: ["X", "Y", "Z"] };
    // Jogs (rapids) -- tracked for position, never merged.
    var JOG_AXES = {
        J2: ["X", "Y"], J3: ["X", "Y", "Z"], J4: ["X", "Y", "Z"], J5: ["X", "Y", "Z"], J6: ["X", "Y", "Z"],
        JX: ["X"], JY: ["Y"], JZ: ["Z"], JA: [], JB: [], JC: [],
    };
    // Non-motion commands that are safe boundaries (position unchanged).
    var NON_MOTION_SAFE = { MS: 1, JS: 1, VS: 1, SO: 1, PAUSE: 1, DIALOG: 1, TR: 1, SK: 1 };

    function filterSBP(text, opts) {
        opts = opts || {};
        var minSegLen = isFinite(opts.minSegLen) ? Number(opts.minSegLen) : 0.03;
        var maxRun = isFinite(opts.maxRun) ? Math.max(1, Math.floor(opts.maxRun)) : 6;
        var angleTol = (isFinite(opts.angleTol) ? Number(opts.angleTol) : 0.5) * DEG2RAD;

        // Preserve the file's line ending and trailing-newline status.
        var crlf = /\r\n/.test(text);
        var eol = crlf ? "\r\n" : "\n";
        var endedWithNewline = /\n$/.test(text);
        var rawLines = text.split(/\r?\n/);
        if (endedWithNewline) rawLines.pop(); // drop the empty element after the final newline

        var out = [];
        var stats = { movesIn: 0, movesOut: 0, linesIn: rawLines.length, linesOut: 0, reductionPct: 0 };

        // Modal state.
        var pos = { X: 0, Y: 0, Z: 0 };
        var posKnown = false;
        var absolute = true;
        var chain = null; // pending merge chain

        function emit(line) {
            out.push(line);
        }

        // Flush the pending chain. If only one source segment was held (no real
        // merging happened) emit its ORIGINAL line verbatim, so the file is only
        // changed where segments are actually combined. When 2+ segments merged,
        // synthesize one combined move in minimal-axis form.
        function flushChain() {
            if (!chain) return;
            if (chain.count === 1) {
                emit(chain.rawFirst);
                stats.movesOut++;
                chain = null;
                return;
            }
            var s = chain.start, e = chain.end;
            var eps = 1e-9;
            var mX = Math.abs(e.X - s.X) > eps, mY = Math.abs(e.Y - s.Y) > eps, mZ = Math.abs(e.Z - s.Z) > eps;
            var line;
            if (mZ && !mX && !mY) {
                line = "MZ," + fmt(e.Z);
            } else if (mX && !mY && !mZ) {
                line = "MX," + fmt(e.X);
            } else if (mY && !mX && !mZ) {
                line = "MY," + fmt(e.Y);
            } else if (mZ) {
                line = "M3," + fmt(e.X) + "," + fmt(e.Y) + "," + fmt(e.Z);
            } else {
                line = "M2," + fmt(e.X) + "," + fmt(e.Y);
            }
            emit(line);
            stats.movesOut++;
            chain = null;
        }

        // Pass a line through verbatim, flushing any pending chain first so order
        // is preserved.
        function passthrough(raw) {
            flushChain();
            emit(raw);
        }

        for (var li = 0; li < rawLines.length; li++) {
            var raw = rawLines[li];
            var parsed = parseLine(raw);

            // Blank or comment -> safe boundary, position unchanged.
            if (!parsed) {
                passthrough(raw);
                continue;
            }

            var cmd = parsed.cmd;
            var args = parsed.args; // array of {n:Number}|{expr:true}|undefined(empty)

            // Mergeable literal cut move in absolute mode?
            if (absolute && CUT_AXES[cmd] && allLiteral(args)) {
                stats.movesIn++;
                var dest = applyAxes(pos, CUT_AXES[cmd], args, absolute);
                if (!posKnown) {
                    // Unknown start point -> can't merge this first move; seed
                    // position and emit it verbatim.
                    flushChain();
                    emit(raw);
                    stats.movesOut++;
                    pos = dest;
                    posKnown = true;
                    continue;
                }
                mergeMove(dest, raw);
                continue;
            }

            // From here down the line is NOT merged. Decide how it affects
            // position tracking, then pass it through unchanged.

            if (CUT_AXES[cmd] || CUT_TRACK_ONLY[cmd] || JOG_AXES[cmd]) {
                // A move/jog we won't merge. Track position if fully literal,
                // otherwise we no longer know where we are.
                var axes = CUT_AXES[cmd] || CUT_TRACK_ONLY[cmd] || JOG_AXES[cmd];
                if (allLiteral(args)) {
                    pos = applyAxes(pos, axes, args, absolute);
                    // posKnown stays as-is (true if it was true)
                } else {
                    posKnown = false;
                }
                passthrough(raw);
                continue;
            }

            if (cmd === "SA") { absolute = true; posKnown = false; passthrough(raw); continue; }
            if (cmd === "SR") { absolute = false; posKnown = false; passthrough(raw); continue; }

            if (NON_MOTION_SAFE[cmd]) {
                // Position unchanged; just a boundary.
                passthrough(raw);
                continue;
            }

            // Everything else (arcs CG/CC/CP/CA/CR, home MH/JH, zeroing Z*,
            // set-position VA, probes P*, macro calls C#/CN, units SU, flow
            // GOSUB/GOTO/IF/END, or anything unrecognized): boundary, and we can
            // no longer trust the position.
            posKnown = false;
            passthrough(raw);
        }

        // Flush a trailing chain at end of file.
        flushChain();

        stats.linesOut = out.length;
        if (stats.movesIn > 0) {
            stats.reductionPct = Math.round((1 - stats.movesOut / stats.movesIn) * 1000) / 10;
        }

        var result = out.join(eol);
        if (endedWithNewline) result += eol;
        return { text: result, stats: stats };

        // ---- merge core (identical logic to the validated G-code filter) ----
        function mergeMove(d, raw) {
            var seg = vec(pos, d);
            var segLen = len(seg);
            if (segLen === 0) {
                // Zero-length move: drop it (no motion, no side effects).
                return;
            }
            if (!chain) {
                chain = newChain(pos, d, seg, segLen, raw);
                pos = { X: d.X, Y: d.Y, Z: d.Z };
                return;
            }
            var turn = angleBetween(chain.dir, seg);
            var collinear = turn <= angleTol;
            var stillSmall = chain.len < minSegLen && chain.count < maxRun;
            if (collinear || stillSmall) {
                chain.end = { X: d.X, Y: d.Y, Z: d.Z };
                var chord = vec(chain.start, chain.end);
                chain.len = len(chord);
                if (chain.len > 0) chain.dir = scale(chord, 1 / chain.len);
                chain.count++;
                pos = { X: d.X, Y: d.Y, Z: d.Z };
                return;
            }
            // Corner: flush and start a fresh chain at the current position.
            flushChain();
            chain = newChain(pos, d, seg, segLen, raw);
            pos = { X: d.X, Y: d.Y, Z: d.Z };
        }

        function newChain(p, d, seg, segLen, raw) {
            return {
                start: { X: p.X, Y: p.Y, Z: p.Z },
                end: { X: d.X, Y: d.Y, Z: d.Z },
                dir: scale(seg, 1 / segLen),
                len: segLen,
                count: 1,
                rawFirst: raw,
            };
        }
    }

    // Parse a raw line into { cmd, args } or null for blank/comment lines.
    // cmd is the upper-cased 2-char mnemonic; args is an array where each entry
    // is { n: <number> } for a literal, { expr: true } for a non-literal, or
    // undefined for an empty slot (e.g. "M3,,,0.5").
    function parseLine(raw) {
        var s = raw.trim();
        if (s === "") return null;
        if (s.charAt(0) === "'") return null; // whole-line comment
        // Must start with a 2-character command mnemonic.
        var m = s.match(/^([A-Za-z][A-Za-z0-9])[ \t]*,?(.*)$/);
        if (!m) return null;
        var cmd = m[1].toUpperCase();
        var rest = m[2];
        // Strip an end-of-line comment (apostrophe) before splitting args. If the
        // command had a trailing comment, that's fine -- args before it still parse.
        var cpos = rest.indexOf("'");
        if (cpos !== -1) rest = rest.slice(0, cpos);
        rest = rest.trim();
        var args = [];
        if (rest !== "") {
            var parts = rest.split(",");
            for (var i = 0; i < parts.length; i++) {
                var a = parts[i].trim();
                if (a === "") {
                    args.push(undefined);
                } else if (LITERAL_RE.test(a)) {
                    args.push({ n: parseFloat(a) });
                } else {
                    args.push({ expr: true });
                }
            }
        }
        return { cmd: cmd, args: args };
    }

    // True if no arg is a non-literal expression (empties are allowed).
    function allLiteral(args) {
        for (var i = 0; i < args.length; i++) {
            if (args[i] && args[i].expr) return false;
        }
        return true;
    }

    // Compute a new position object by applying literal args to the given axes.
    // Empty/undefined args leave that axis unchanged. Honors absolute/relative.
    function applyAxes(cur, axes, args, absolute) {
        var p = { X: cur.X, Y: cur.Y, Z: cur.Z };
        for (var i = 0; i < axes.length; i++) {
            var ax = axes[i];
            var a = args[i];
            if (a && typeof a.n === "number") {
                if (ax === "X" || ax === "Y" || ax === "Z") {
                    p[ax] = absolute ? a.n : p[ax] + a.n;
                }
            }
        }
        return p;
    }

    // ---- vector helpers (XYZ) ----
    function vec(a, b) { return { X: b.X - a.X, Y: b.Y - a.Y, Z: b.Z - a.Z }; }
    function len(v) { return Math.sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z); }
    function scale(v, s) { return { X: v.X * s, Y: v.Y * s, Z: v.Z * s }; }
    function angleBetween(dir, seg) {
        var sl = len(seg);
        if (sl === 0) return 0;
        var dot = (dir.X * seg.X + dir.Y * seg.Y + dir.Z * seg.Z) / sl;
        if (dot > 1) dot = 1;
        if (dot < -1) dot = -1;
        return Math.acos(dot);
    }
    // Format a coordinate: up to 5 decimals, trailing zeros trimmed.
    function fmt(v) { return Number(v.toFixed(5)).toString(); }

    return { filterSBP: filterSBP, _parseLine: parseLine };
});
