/*
 * segment_filter.js
 *
 * SegmentFilter is a streaming G-code Transform that reduces the number of very
 * short linear (G1) segments in a tool path before they reach the G2 driver.
 *
 * Why this exists:
 *   Some CAM-generated files contain long strings of extremely short segments
 *   (often < 0.025"). G2's planner cannot ingest these fast enough, so motion
 *   gets throttled and the cut runs slower than commanded. Until faster
 *   processing hardware makes this moot, this filter "preprocesses" the stream
 *   to combine segments and keep G2 fed.
 *
 * What it does (collinear-merge + run-limited coalesce):
 *   - Consecutive G1 moves that stay nearly straight (within `angleTol`) are
 *     merged into a single longer G1 move. This is geometrically lossless
 *     apart from the angle tolerance and is the main win on straight runs that
 *     CAM broke into many points.
 *   - On curves (where each tiny segment turns), short segments are coalesced
 *     into one chord move until the accumulated length reaches `minSegLen`,
 *     bounded by `maxRun` source segments. This decimates dense curve points at
 *     the cost of a small, bounded chord deviation.
 *
 * What it deliberately leaves untouched (each flushes any pending merge and is
 * passed through verbatim, while still updating modal position/feed so the next
 * chain is computed correctly):
 *   - G0 rapids, G2/G3 arcs, dwells, M-codes, comments, settings, anything with
 *     rotary (A/B/C) or arc (I/J/K/R) words.
 *   - Incremental distance mode (G91) and unit changes (G20/G21) disable merging
 *     until absolute mode (G90) resumes, since merging relies on absolute coords.
 *
 * N-word preservation: each emitted (merged) line keeps the N-word of the LAST
 * source line it absorbed. Because N-words climb monotonically to the end of the
 * file, status.line -> nb_lines progress still reaches completion even though
 * intermediate lines are dropped.
 *
 * This module makes NO assumptions about units: thresholds are interpreted in
 * the same coordinate units as the G-code being streamed (which is whatever the
 * machine is configured for). Configure `minSegLen` accordingly per profile.
 */

var stream = require("stream");
var util = require("util");
var log = require("../log").logger("segflt");

var DEG2RAD = Math.PI / 180.0;

// Word-extraction regex: a letter followed by an optional signed/decimal number.
// Global so we can iterate every word on a line.
var WORD_RE = /([A-Za-z])\s*(-?\d*\.?\d+)?/g;

function SegmentFilter(opts) {
    if (!(this instanceof SegmentFilter)) {
        return new SegmentFilter(opts);
    }
    opts = opts || {};
    stream.Transform.call(this, {});

    // Tuning parameters (in current coordinate units / degrees).
    this.minSegLen = isFinite(opts.minSegLen) ? Number(opts.minSegLen) : 0.03;
    this.maxRun = isFinite(opts.maxRun) ? Math.max(1, Math.floor(opts.maxRun)) : 6;
    // Pre-convert the collinear tolerance to radians once.
    this.angleTol = (isFinite(opts.angleTol) ? Number(opts.angleTol) : 0.5) * DEG2RAD;

    // Line-buffering across chunk boundaries.
    this._buf = "";

    // Modal machine state we have to track to interpret bare/relative lines.
    this.pos = { X: 0, Y: 0, Z: 0 }; // absolute commanded position
    this.posKnown = false; // becomes true after the first move with coords
    this.modalMotion = null; // last G0/G1/G2/G3 motion mode
    this.absolute = true; // G90 (true) vs G91 (false)
    this.feed = null; // last commanded F

    // Pending merge chain. When active, `chain.start` is the last emitted point,
    // `chain.end` the current accumulated endpoint, `chain.dir` the unit vector
    // from start to end. `chain.axes` records which axes actually moved.
    this.chain = null;

    // Counters for diagnostics / logging.
    this._linesIn = 0;
    this._linesOut = 0;

    log.debug(
        "SegmentFilter active: minSegLen=" +
            this.minSegLen +
            " maxRun=" +
            this.maxRun +
            " angleTol(deg)=" +
            (this.angleTol / DEG2RAD)
    );
}
util.inherits(SegmentFilter, stream.Transform);

SegmentFilter.prototype._transform = function (chunk, enc, next) {
    this._buf += chunk.toString();
    var idx;
    // Process every complete line; keep the trailing partial in the buffer.
    while ((idx = this._buf.indexOf("\n")) !== -1) {
        var line = this._buf.slice(0, idx);
        this._buf = this._buf.slice(idx + 1);
        this._handleLine(line, "\n");
    }
    next();
};

SegmentFilter.prototype._flush = function (done) {
    // Process any trailing partial line, then emit any held chain.
    if (this._buf.length) {
        this._handleLine(this._buf, "");
        this._buf = "";
    }
    this._flushChain();
    log.debug("SegmentFilter done: in=" + this._linesIn + " out=" + this._linesOut);
    done();
};

// Emit a raw line through verbatim (after flushing any pending chain).
SegmentFilter.prototype._passthrough = function (rawLine, eol) {
    this._flushChain();
    this._linesOut++;
    this.push(rawLine + eol);
};

// Parse one line and route it: merge, coalesce, or pass through.
SegmentFilter.prototype._handleLine = function (rawLine, eol) {
    this._linesIn++;

    // Strip comments for analysis but preserve the raw line for passthrough.
    // OpenSBP/G-code comments: parenthesized or after a semicolon.
    var code = rawLine.replace(/\(.*?\)/g, "").replace(/;.*$/, "");

    // A line with no letters at all (blank / whitespace) is harmless to pass.
    if (!/[A-Za-z]/.test(code)) {
        this._passthrough(rawLine, eol);
        return;
    }

    // Extract words. Keep the N-word separately; gather coordinate/mode words.
    var nWord = null;
    var words = {}; // letter -> numeric value (last wins)
    var letters = {}; // set of letters present (incl. those w/o value)
    WORD_RE.lastIndex = 0;
    var m;
    while ((m = WORD_RE.exec(code)) !== null) {
        var letter = m[1].toUpperCase();
        var hasVal = m[2] !== undefined && m[2] !== "";
        var val = hasVal ? parseFloat(m[2]) : null;
        if (letter === "N" && hasVal) {
            nWord = m[2];
            continue;
        }
        letters[letter] = true;
        if (hasVal) words[letter] = val;
    }

    // Handle modal/unit/distance changes that affect how we interpret moves.
    // G-words can be multiple on a line (e.g. "G90 G1"). We re-scan for them.
    var gCodes = this._extractGCodes(code);
    var hasUnitOrDistChange = false;
    for (var i = 0; i < gCodes.length; i++) {
        var g = gCodes[i];
        if (g === 90) {
            this.absolute = true;
        } else if (g === 91) {
            this.absolute = false;
            hasUnitOrDistChange = true;
        } else if (g === 20 || g === 21) {
            hasUnitOrDistChange = true;
        }
    }

    // Determine effective motion mode for this line.
    var motion = this._lineMotionMode(gCodes);
    if (motion !== null) this.modalMotion = motion;

    var hasMove = "X" in words || "Y" in words || "Z" in words;

    // Conditions under which we never merge this line -> flush + passthrough,
    // but still keep modal position current.
    var rotaryOrArc = "A" in letters || "B" in letters || "C" in letters || "I" in letters || "J" in letters || "K" in letters || "R" in letters;

    // Track feed modally if present (used for both merge and passthrough).
    if ("F" in words) this.feed = words.F;

    // Only pure absolute G1 XYZ moves are mergeable.
    var mergeable =
        this.absolute &&
        !hasUnitOrDistChange &&
        !rotaryOrArc &&
        hasMove &&
        this.modalMotion === 1 &&
        this._onlyKnownWords(letters);

    if (!mergeable) {
        // Update modal position from any move (rapid/arc/abs move) so the next
        // chain starts from the right place, then pass the line through.
        if (hasMove) this._applyMove(words);
        this._passthrough(rawLine, eol);
        return;
    }

    // Mergeable G1 move. Compute the destination point in absolute coords.
    var dest = {
        X: "X" in words ? words.X : this.pos.X,
        Y: "Y" in words ? words.Y : this.pos.Y,
        Z: "Z" in words ? words.Z : this.pos.Z,
    };
    var movedAxes = {
        X: "X" in words,
        Y: "Y" in words,
        Z: "Z" in words,
    };

    if (!this.posKnown) {
        // We don't know where we started; can't safely merge the very first
        // move. Pass it through and seed position.
        this.pos = dest;
        this.posKnown = true;
        this._passthrough(rawLine, eol);
        return;
    }

    this._mergeMove(dest, movedAxes, this.feed, nWord, rawLine, eol);
};

// Add `dest` to the pending chain, or flush and start a new chain.
SegmentFilter.prototype._mergeMove = function (dest, movedAxes, feed, nWord, rawLine, eol) {
    var seg = this._vec(this.pos, dest);
    var segLen = this._len(seg);

    // Zero-length move: emit nothing for geometry but don't lose its N. Treat as
    // a no-op by passing through so any side effects/feed are preserved.
    if (segLen === 0) {
        this._passthrough(rawLine, eol);
        return;
    }

    if (!this.chain) {
        // Start a new chain. Hold this move (don't emit yet).
        // Note: chain.end and this.pos must NOT alias the same object, or a
        // later in-place position update (e.g. a passthrough G0) would corrupt
        // the held chain's endpoint.
        this.chain = {
            start: { X: this.pos.X, Y: this.pos.Y, Z: this.pos.Z },
            end: { X: dest.X, Y: dest.Y, Z: dest.Z },
            dir: this._scale(seg, 1 / segLen),
            len: segLen,
            count: 1,
            feed: feed,
            axes: { X: movedAxes.X, Y: movedAxes.Y, Z: movedAxes.Z },
            lastN: nWord,
        };
        this.pos = { X: dest.X, Y: dest.Y, Z: dest.Z };
        return;
    }

    // Decide: extend the existing chain or flush it and start anew.
    var turn = this._angle(this.chain.dir, seg); // direction change of this seg
    var feedChanged = feed !== this.chain.feed;

    var collinear = turn <= this.angleTol;
    var stillSmall = this.chain.len < this.minSegLen && this.chain.count < this.maxRun;

    if (!feedChanged && (collinear || stillSmall)) {
        // Absorb: extend the chord to the new destination.
        this.chain.end = { X: dest.X, Y: dest.Y, Z: dest.Z };
        var chord = this._vec(this.chain.start, dest);
        this.chain.len = this._len(chord);
        if (this.chain.len > 0) this.chain.dir = this._scale(chord, 1 / this.chain.len);
        this.chain.count++;
        this.chain.axes.X = this.chain.axes.X || movedAxes.X;
        this.chain.axes.Y = this.chain.axes.Y || movedAxes.Y;
        this.chain.axes.Z = this.chain.axes.Z || movedAxes.Z;
        this.chain.lastN = nWord;
        this.pos = { X: dest.X, Y: dest.Y, Z: dest.Z };
        return;
    }

    // Corner (or feed change): flush the held chord, then start a fresh chain at
    // the current position with this segment.
    this._flushChain();
    this.chain = {
        start: { X: this.pos.X, Y: this.pos.Y, Z: this.pos.Z },
        end: { X: dest.X, Y: dest.Y, Z: dest.Z },
        dir: this._scale(seg, 1 / segLen),
        len: segLen,
        count: 1,
        feed: feed,
        axes: { X: movedAxes.X, Y: movedAxes.Y, Z: movedAxes.Z },
        lastN: nWord,
    };
    this.pos = { X: dest.X, Y: dest.Y, Z: dest.Z };
};

// Emit the pending chain (if any) as a single G1 move.
SegmentFilter.prototype._flushChain = function () {
    if (!this.chain) return;
    var c = this.chain;
    var parts = [];
    if (c.lastN !== null && c.lastN !== undefined) parts.push("N" + c.lastN);
    parts.push("G1");
    if (c.axes.X) parts.push("X" + this._fmt(c.end.X));
    if (c.axes.Y) parts.push("Y" + this._fmt(c.end.Y));
    if (c.axes.Z) parts.push("Z" + this._fmt(c.end.Z));
    if (c.feed !== null && c.feed !== undefined) parts.push("F" + this._fmt(c.feed));
    this.push(parts.join(" ") + "\n");
    this._linesOut++;
    this.chain = null;
};

// Update modal position from a (possibly partial) absolute/relative move.
SegmentFilter.prototype._applyMove = function (words) {
    if (this.absolute) {
        if ("X" in words) this.pos.X = words.X;
        if ("Y" in words) this.pos.Y = words.Y;
        if ("Z" in words) this.pos.Z = words.Z;
    } else {
        if ("X" in words) this.pos.X += words.X;
        if ("Y" in words) this.pos.Y += words.Y;
        if ("Z" in words) this.pos.Z += words.Z;
    }
    this.posKnown = true;
};

// Return list of integer*10? -> we keep G-codes as numbers (e.g. 1, 90, 38.3).
SegmentFilter.prototype._extractGCodes = function (code) {
    var out = [];
    var re = /[Gg]\s*(-?\d*\.?\d+)/g;
    var m;
    while ((m = re.exec(code)) !== null) {
        out.push(parseFloat(m[1]));
    }
    return out;
};

// Effective motion mode for this line: 0,1,2,3 or null if none present.
SegmentFilter.prototype._lineMotionMode = function (gCodes) {
    for (var i = 0; i < gCodes.length; i++) {
        var g = gCodes[i];
        if (g === 0 || g === 1 || g === 2 || g === 3) return g;
    }
    return null;
};

// True if the line contains only words we understand for a plain linear move,
// so we don't merge lines carrying anything unexpected (M-codes, etc.).
SegmentFilter.prototype._onlyKnownWords = function (letters) {
    for (var k in letters) {
        if (k !== "G" && k !== "X" && k !== "Y" && k !== "Z" && k !== "F") {
            return false;
        }
    }
    return true;
};

// ---- small vector helpers ----
SegmentFilter.prototype._vec = function (a, b) {
    return { X: b.X - a.X, Y: b.Y - a.Y, Z: b.Z - a.Z };
};
SegmentFilter.prototype._len = function (v) {
    return Math.sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z);
};
SegmentFilter.prototype._scale = function (v, s) {
    return { X: v.X * s, Y: v.Y * s, Z: v.Z * s };
};
// Angle (radians) between a unit vector `dir` and a (non-unit) vector `seg`.
SegmentFilter.prototype._angle = function (dir, seg) {
    var segLen = this._len(seg);
    if (segLen === 0) return 0;
    var dot = (dir.X * seg.X + dir.Y * seg.Y + dir.Z * seg.Z) / segLen;
    if (dot > 1) dot = 1;
    if (dot < -1) dot = -1;
    return Math.acos(dot);
};
// Format a coordinate/feed value consistently with the rest of the codebase.
SegmentFilter.prototype._fmt = function (v) {
    return Number(v.toFixed(5)).toString();
};

// ---- module API ----

// Read the small-segment transform settings from opensbp config.
// Returns { enabled, minSegLen, maxRun, angleTol }.
SegmentFilter.getConfig = function (config) {
    var def = { enabled: false, minSegLen: 0.03, maxRun: 6, angleTol: 0.5 };
    try {
        var transforms = config.opensbp.get("transforms");
        var ss = transforms && transforms.smallsegments;
        if (!ss) return def;
        // `apply` may be a real boolean or the string "true"/"false" depending
        // on how it was written by the dashboard select.
        var enabled = ss.apply === true || ss.apply === "true";
        return {
            enabled: enabled,
            minSegLen: isFinite(ss.minSegLen) ? Number(ss.minSegLen) : def.minSegLen,
            maxRun: isFinite(ss.maxRun) ? Number(ss.maxRun) : def.maxRun,
            angleTol: isFinite(ss.angleTol) ? Number(ss.angleTol) : def.angleTol,
        };
    } catch (e) {
        log.warn("SegmentFilter.getConfig: " + e);
        return def;
    }
};

// Convenience: given a source stream and a config object, return either the
// source stream unchanged (when disabled) or the source piped through a filter.
SegmentFilter.maybeWrap = function (srcStream, config) {
    var cfg = SegmentFilter.getConfig(config);
    if (!cfg.enabled) return srcStream;
    log.info(
        "Small-segment filter enabled (minSegLen=" +
            cfg.minSegLen +
            ", maxRun=" +
            cfg.maxRun +
            ", angleTol=" +
            cfg.angleTol +
            ")"
    );
    return srcStream.pipe(new SegmentFilter(cfg));
};

module.exports = SegmentFilter;
