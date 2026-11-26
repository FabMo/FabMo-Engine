/*
 * Ghost run (dry-run of a queued job).
 *
 * A ghost run must not create a job or change saved settings: the queued job
 * stays pending at the top of the queue, the run uses a Job object that is
 * never written to the database, and the Z lift applies to that one run only.
 */
"use strict";

const config = require("../config");
const db = require("../db");
const { SBPRuntime } = require("../runtime/opensbp/opensbp");

function withTransforms(move) {
    var saved = {
        rotate: { apply: false },
        move: move,
    };
    config.opensbp = {
        get: function (key) {
            return key === "transforms" ? saved : undefined;
        },
    };
    return saved;
}

describe("ghost-run Z lift", function () {
    var previous;
    beforeEach(function () {
        previous = config.opensbp;
    });
    afterEach(function () {
        config.opensbp = previous;
    });

    test("lifts the run and leaves the saved transform alone", function () {
        var saved = withTransforms({ apply: false, x: 3, y: 4, z: 5 });
        var rt = { pendingZLift: 0.5 };
        SBPRuntime.prototype._setupTransforms.call(rt);
        // The Move transform was off, so its stale x/y/z must not be applied.
        expect(rt.transforms.move).toEqual({ apply: true, x: 0, y: 0, z: 0.5 });
        expect(saved.move).toEqual({ apply: false, x: 3, y: 4, z: 5 });
    });

    test("adds to a Move transform that is already on", function () {
        withTransforms({ apply: true, x: 1, y: 2, z: 0.25 });
        var rt = { pendingZLift: 0.5 };
        SBPRuntime.prototype._setupTransforms.call(rt);
        expect(rt.transforms.move).toEqual({ apply: true, x: 1, y: 2, z: 0.75 });
    });

    test("is used once and does not carry into the next run", function () {
        withTransforms({ apply: false, x: 0, y: 0, z: 0 });
        var rt = { pendingZLift: 0.5 };
        SBPRuntime.prototype._setupTransforms.call(rt);
        expect(rt.pendingZLift).toBe(0);
        SBPRuntime.prototype._setupTransforms.call(rt);
        expect(rt.transforms.move.apply).toBe(false);
    });

    test("a normal run is untouched", function () {
        withTransforms({ apply: false, x: 0, y: 0, z: 0 });
        var rt = {};
        SBPRuntime.prototype._setupTransforms.call(rt);
        expect(rt.transforms.move).toEqual({ apply: false, x: 0, y: 0, z: 0 });
    });
});

describe("ghost-run job", function () {
    function ghost(extra) {
        var job = new db.Job(
            Object.assign({ file_id: "abc", name: "part.sbp (ghost)", ghost: true, transient: true }, extra || {})
        );
        job.state = "running";
        return job;
    }

    // The jobs collection is not open in tests: a real save would throw.
    test("is never written to the database", function (done) {
        var job = ghost({ ghost_of: "queued-id" });
        job.finish(function (err, saved) {
            expect(err).toBeFalsy();
            expect(saved.state).toBe("finished");
            expect(saved._id).toBeUndefined();
            done();
        });
    });

    test("can be cancelled and failed without a database", function (done) {
        ghost().cancel(function (err) {
            expect(err).toBeFalsy();
            ghost().fail(function (err2) {
                expect(err2).toBeFalsy();
                done();
            });
        });
    });

    test("does not repeat", function (done) {
        var job = ghost({ repeat: true });
        job.finish(function () {
            // scheduleRepeatRestart would need the machine; reaching here
            // without a throw on the next tick means it was skipped.
            setImmediate(done);
        });
    });

    test("removes its generated file when the run ends", function (done) {
        var fs = require("fs");
        var os = require("os");
        var path = require("path");
        var tmp = path.join(os.tmpdir(), "fabmo_ghost_test_" + Date.now() + ".sbp");
        fs.writeFileSync(tmp, "'test\n");
        var job = ghost({ cleanup_path: tmp });
        job.save(function () {
            expect(fs.existsSync(tmp)).toBe(true); // still running: keep it
            job.finish(function () {
                setTimeout(function () {
                    expect(fs.existsSync(tmp)).toBe(false);
                    done();
                }, 50);
            });
        });
    });
});
