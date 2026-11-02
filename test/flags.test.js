/*jshint esversion: 6 */

// Unit tests for flags.js — named, latching machine condition flags.

jest.mock("../log", () => ({
    logger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
    }),
}));

jest.mock("../config", () => {
    const mockState = {
        defs: {}, // machine.flags definitions
        saved: {}, // instance-persisted flag state
    };
    return {
        __mockState: mockState,
        machine: {
            get: (key) => (key === "flags" ? mockState.defs : undefined),
        },
        instance: {
            get: (key) => (key === "flags" ? mockState.saved : undefined),
            update: (data, cb) => {
                if (data && data.flags) {
                    mockState.saved = data.flags;
                }
                if (cb) cb(null);
            },
        },
    };
});

const config = require("../config");
const flags = require("../flags");

function makeMachine() {
    return {
        status: { flags: {}, info: null },
        info_id: 0,
        driver: { status: { in15: 0 } },
        emit: jest.fn(),
    };
}

const FAULT_DEF = {
    label: "Driver Fault",
    message: "Re-home the machine before running jobs.",
    action: "block_runs",
    input: 15,
    edge: "on",
    set_on_startup: false,
};

let machine;

beforeEach(() => {
    config.__mockState.defs = { DRIVER_FAULT: Object.assign({}, FAULT_DEF) };
    config.__mockState.saved = {};
    machine = makeMachine();
    flags.initialize(machine);
});

test("no flags are active after a clean initialize", () => {
    expect(flags.isSet("DRIVER_FAULT")).toBe(false);
    expect(machine.status.flags).toEqual({});
    expect(flags.getBlockingFlag()).toBeNull();
});

test("set_on_startup latches the flag at initialize", () => {
    config.__mockState.defs.DRIVER_FAULT.set_on_startup = true;
    flags.initialize(machine);
    expect(flags.isSet("DRIVER_FAULT")).toBe(true);
    expect(machine.status.flags.DRIVER_FAULT.action).toBe("block_runs");
    expect(flags.getBlockingFlag().name).toBe("DRIVER_FAULT");
});

test("persisted state is restored at initialize", () => {
    config.__mockState.saved = {
        DRIVER_FAULT: { set: true, at: 123, source: "input 15" },
    };
    flags.initialize(machine);
    expect(flags.isSet("DRIVER_FAULT")).toBe(true);
    expect(machine.status.flags.DRIVER_FAULT.source).toBe("input 15");
});

test("first status report seeds edge detection without firing", () => {
    flags.checkInputs({ in15: 1 }); // boot-time active input: seed only
    expect(flags.isSet("DRIVER_FAULT")).toBe(false);
});

test("inactive-to-active edge latches an edge:on flag", () => {
    flags.checkInputs({ in15: 0 });
    flags.checkInputs({ in15: 1 });
    expect(flags.isSet("DRIVER_FAULT")).toBe(true);
    expect(machine.status.flags.DRIVER_FAULT.source).toBe("input 15");
    // a one-time info message was surfaced
    expect(machine.status.info.message).toMatch(/Driver Fault/);
});

test("active-to-inactive edge latches an edge:off flag", () => {
    config.__mockState.defs.DOOR = {
        label: "Door",
        message: "Close the door.",
        action: "warn",
        input: 7,
        edge: "off",
    };
    flags.initialize(machine);
    flags.checkInputs({ in7: 1 });
    flags.checkInputs({ in7: 0 });
    expect(flags.isSet("DOOR")).toBe(true);
    // warn flags do not block runs
    expect(flags.getBlockingFlag()).toBeNull();
});

test("no repeated latch while input stays active", () => {
    flags.checkInputs({ in15: 0 });
    flags.checkInputs({ in15: 1 });
    const at = machine.status.flags.DRIVER_FAULT.at;
    flags.checkInputs({ in15: 1 });
    expect(machine.status.flags.DRIVER_FAULT.at).toBe(at);
});

test("clear is refused while the bound input is still active", () => {
    flags.checkInputs({ in15: 0 });
    flags.checkInputs({ in15: 1 });
    machine.driver.status.in15 = 1;
    const refused = flags.clear("DRIVER_FAULT", "file");
    expect(refused.error).toMatch(/still active/);
    expect(flags.isSet("DRIVER_FAULT")).toBe(true);

    machine.driver.status.in15 = 0;
    const ok = flags.clear("DRIVER_FAULT", "file");
    expect(ok.error).toBeUndefined();
    expect(flags.isSet("DRIVER_FAULT")).toBe(false);
    expect(machine.status.flags).toEqual({});
});

test("setting or clearing an undefined flag is an error", () => {
    expect(flags.set("TYPO", "file").error).toMatch(/No such flag/);
    expect(flags.clear("TYPO", "file").error).toMatch(/No such flag/);
});

test("flag state persists through the instance config across initialize", () => {
    flags.set("DRIVER_FAULT", "api");
    // simulate engine restart: fresh machine, same persisted store
    machine = makeMachine();
    flags.initialize(machine);
    expect(flags.isSet("DRIVER_FAULT")).toBe(true);
    expect(flags.getBlockingFlag().name).toBe("DRIVER_FAULT");
});
