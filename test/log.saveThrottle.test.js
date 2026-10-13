/*jshint esversion: 6 */
//
// log.saveCurrentLogThrottled: the one entry point for automatic log saves
// (engine on error, explicit save button). A save for a given source inside
// the cooldown must not write another file; the caller gets the previous one
// back with throttled=true. Different sources are throttled independently.

const fs = require("fs");
const path = require("path");
const os = require("os");

const mockLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "fabmo-log-test-"));
jest.mock("../config", () => ({
    getDataDir: () => mockLogDir,
    getProfileDir: () => mockLogDir,
}));

const log = require("../log");

function savedFiles() {
    return fs
        .readdirSync(mockLogDir)
        .filter((f) => f.startsWith("fabmo-"))
        .sort();
}

function save(source, cooldown) {
    return new Promise((resolve, reject) => {
        log.saveCurrentLogThrottled(source, cooldown, (err, filename, throttled) => {
            if (err) reject(err);
            else resolve({ filename, throttled });
        });
    });
}

afterAll(() => {
    fs.rmSync(mockLogDir, { recursive: true, force: true });
});

test("first save for a source writes fabmo-<source>-<ts>-log.txt", async () => {
    log.logger("test").info("hello from the throttle test");
    const r = await save("error", 60000);
    expect(r.throttled).toBe(false);
    expect(path.basename(r.filename)).toMatch(/^fabmo-error-\d+-log\.txt$/);
    expect(fs.readFileSync(r.filename, "utf8")).toContain("hello from the throttle test");
    expect(savedFiles().length).toBe(1);
});

test("a second save for the same source inside the cooldown is throttled and writes nothing", async () => {
    const before = savedFiles();
    const r = await save("error", 60000);
    expect(r.throttled).toBe(true);
    expect(path.basename(r.filename)).toBe(before[0]);
    expect(savedFiles()).toEqual(before);
});

test("a different source is not throttled by the first", async () => {
    const r = await save("user-saved", 60000);
    expect(r.throttled).toBe(false);
    expect(path.basename(r.filename)).toMatch(/^fabmo-user-saved-\d+-log\.txt$/);
    expect(savedFiles().length).toBe(2);
});

test("a zero cooldown always writes", async () => {
    const r = await save("user-saved", 0);
    expect(r.throttled).toBe(false);
    expect(savedFiles().length).toBe(3);
});

test("the default cooldown is 30 seconds", () => {
    expect(log.AUTO_SAVE_COOLDOWN).toBe(30000);
});
