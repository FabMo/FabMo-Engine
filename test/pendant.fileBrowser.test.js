/*jshint esversion: 6 */
const fileBrowser = require("../pendant/fileBrowser");
const EventEmitter = require("events");

function makeEmitter() {
    const e = new EventEmitter();
    e.events = [];
    e.on("pendant_file_select", (state) => e.events.push(state));
    return e;
}

function withBrowser(files, body) {
    const emitter = makeEmitter();
    const submitted = [];
    const fb = fileBrowser.create(emitter, {
        emitter: emitter,
        refreshMs: 1000 * 1000, // suppress periodic refresh in tests
        enumerate: (cb) => cb(null, files),
        submit: (file, cb) => {
            submitted.push(file);
            cb(null, { _id: "job-" + file.name });
        },
    });
    try {
        // Initial refresh runs synchronously with our stub enumerate.
        return body(fb, emitter, submitted);
    } finally {
        fb.close();
    }
}

const F = (name, drive) => ({
    name: name,
    path: `/media/pi/${drive}/${name}`,
    drive: drive,
    size: 100,
});

describe("fileBrowser: refresh + initial state", () => {
    test("empty list yields index -1 and current() null", () => {
        withBrowser([], (fb, emitter) => {
            expect(fb.getList()).toEqual([]);
            expect(fb.getIndex()).toBe(0);
            expect(fb.current()).toBeNull();
            // refresh emits even when empty so dashboard can render "no files"
            expect(emitter.events.length).toBeGreaterThan(0);
            expect(emitter.events[0]).toMatchObject({ total: 0, index: -1, file: null });
        });
    });

    test("populated list selects index 0 and emits", () => {
        const files = [F("a.sbp", "STICK"), F("b.nc", "STICK")];
        withBrowser(files, (fb, emitter) => {
            expect(fb.getList().length).toBe(2);
            expect(fb.getIndex()).toBe(0);
            expect(fb.current().name).toBe("a.sbp");
            const last = emitter.events[emitter.events.length - 1];
            expect(last).toMatchObject({ total: 2, index: 0, reason: "refresh" });
            expect(last.file.name).toBe("a.sbp");
        });
    });
});

describe("fileBrowser: scroll", () => {
    test("scroll(+1) advances index and emits", () => {
        const files = [F("a.sbp", "S"), F("b.sbp", "S"), F("c.sbp", "S")];
        withBrowser(files, (fb, emitter) => {
            emitter.events.length = 0;
            fb.scroll(1);
            expect(fb.getIndex()).toBe(1);
            expect(fb.current().name).toBe("b.sbp");
            expect(emitter.events[0]).toMatchObject({ index: 1, reason: "scroll" });
        });
    });

    test("scroll(-1) wraps backward from index 0 to last", () => {
        const files = [F("a", "S"), F("b", "S"), F("c", "S")];
        withBrowser(files, (fb) => {
            fb.scroll(-1);
            expect(fb.getIndex()).toBe(2);
            expect(fb.current().name).toBe("c");
        });
    });

    test("scroll(+1) wraps forward from last to 0", () => {
        const files = [F("a", "S"), F("b", "S")];
        withBrowser(files, (fb) => {
            fb.scroll(1);
            fb.scroll(1); // now back to 0
            expect(fb.getIndex()).toBe(0);
        });
    });

    test("scroll(0) is a no-op (no emit)", () => {
        const files = [F("a", "S"), F("b", "S")];
        withBrowser(files, (fb, emitter) => {
            emitter.events.length = 0;
            fb.scroll(0);
            expect(emitter.events.length).toBe(0);
            expect(fb.getIndex()).toBe(0);
        });
    });

    test("scroll on empty list triggers a refresh, no index change", () => {
        let calls = 0;
        const emitter = makeEmitter();
        const fb = fileBrowser.create(emitter, {
            emitter: emitter,
            refreshMs: 1000 * 1000,
            enumerate: (cb) => { calls++; cb(null, []); },
            submit: (f, cb) => cb(null, {}),
        });
        expect(calls).toBe(1); // initial
        fb.scroll(1);
        expect(calls).toBe(2);
        expect(fb.getIndex()).toBe(0);
        fb.close();
    });
});

describe("fileBrowser: select", () => {
    test("select() invokes submit with current file and emits 'submitted'", (done) => {
        const files = [F("a.sbp", "S"), F("b.sbp", "S")];
        withBrowser(files, (fb, emitter, submitted) => {
            fb.scroll(1);
            emitter.events.length = 0;
            fb.select((err, job) => {
                expect(err).toBeNull();
                expect(job).toMatchObject({ _id: "job-b.sbp" });
                expect(submitted).toEqual([files[1]]);
                const last = emitter.events[emitter.events.length - 1];
                expect(last).toMatchObject({ reason: "submitted" });
                expect(last.job.name).toBe("b.sbp");
                done();
            });
        });
    });

    test("select() on empty list errors and emits nothing", (done) => {
        withBrowser([], (fb, emitter) => {
            const before = emitter.events.length;
            fb.select((err) => {
                expect(err).toBeInstanceOf(Error);
                expect(emitter.events.length).toBe(before);
                done();
            });
        });
    });

    test("submit failure emits 'submit-failed' with error message", (done) => {
        const emitter = makeEmitter();
        const fb = fileBrowser.create(emitter, {
            emitter: emitter,
            refreshMs: 1000 * 1000,
            enumerate: (cb) => cb(null, [F("a.sbp", "S")]),
            submit: (f, cb) => cb(new Error("disk full")),
        });
        emitter.events.length = 0;
        fb.select((err) => {
            expect(err.message).toBe("disk full");
            const last = emitter.events[emitter.events.length - 1];
            expect(last).toMatchObject({ reason: "submit-failed", error: "disk full" });
            fb.close();
            done();
        });
    });
});

describe("fileBrowser: refresh preserves selection by path when possible", () => {
    test("same file at a different index keeps it highlighted", (done) => {
        const initial = [F("a", "S"), F("b", "S"), F("c", "S")];
        const after = [F("z", "S"), F("a", "S"), F("b", "S"), F("c", "S")];
        const emitter = makeEmitter();
        let callCount = 0;
        const fb = fileBrowser.create(emitter, {
            emitter: emitter,
            refreshMs: 1000 * 1000,
            enumerate: (cb) => {
                callCount++;
                cb(null, callCount === 1 ? initial : after);
            },
            submit: (f, cb) => cb(null, {}),
        });
        fb.scroll(1); // index → 1 → file "b"
        expect(fb.current().name).toBe("b");
        fb.refresh((err) => {
            expect(err).toBeNull();
            // "b" is now at index 2 in the new list
            expect(fb.current().name).toBe("b");
            expect(fb.getIndex()).toBe(2);
            fb.close();
            done();
        });
    });

    test("file removed from list snaps selection to index 0", (done) => {
        const initial = [F("a", "S"), F("b", "S")];
        const after = [F("z", "S")];
        const emitter = makeEmitter();
        let n = 0;
        const fb = fileBrowser.create(emitter, {
            emitter: emitter,
            refreshMs: 1000 * 1000,
            enumerate: (cb) => { n++; cb(null, n === 1 ? initial : after); },
            submit: (f, cb) => cb(null, {}),
        });
        fb.scroll(1); // on "b"
        fb.refresh(() => {
            expect(fb.getIndex()).toBe(0);
            expect(fb.current().name).toBe("z");
            fb.close();
            done();
        });
    });
});
