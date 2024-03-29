/*jshint esversion: 6 */
const machine = require('../machine');

//<----------------------------Unit tests for decideNextAction function------------------------------------>

//Tests are organized to mimic the flow of the function
//Test descriptions are intended to follow the logic of the function from top to bottom

//Current_state_in switch case default
test("if current_state_in is an unexpected value then 'next_action' is 'throw'", () => {
    expect(machine.private_decideNextAction(null, 'unexpected_state', null, null, null, null, null, null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'throw',
        "error_thrown":             new Error('Cannot arm the machine from the unexpected_state state.')});
});

test("if current_state_in is 'idle' then 'interlock_action' is set to current_action_io and 'next_action' is 'set_state_and_emit' because require_auth_in is true", () => {
    expect(machine.private_decideNextAction('auth_required', 'idle', null, null, null, null, "current_action_io", null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'current_action_io',
        "current_action":           null,
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

test("if current_state_in is 'idle' then 'interlock_action' is set to current_action_io and 'next_action' is fire because require_auth is false", () => {
    expect(machine.private_decideNextAction(false, 'idle', null, null, null, null, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'current_action_io',
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

test("if current_state_in is 'interlock' and driver_status_inFeedHold is set to true, 'interlock_action' is set to current_action_io, fire because require_auth_in is false", () => {
    expect(machine.private_decideNextAction(false, 'interlock', null, null, null, true, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'current_action_io',
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

test("if current_state_in is 'interlock' and driver_status_inFeedHold is set to true, 'interlock_action' is set to current_action_io, set_state_and_emit because require_auth_in is true", () => {
    expect(machine.private_decideNextAction('require_auth_in', 'interlock', null, null, null, true, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'current_action_io',
        "current_action":           null,
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

test("if current_state_in is 'interlock' and driver_status_inFeedHold is set to false, 'interlock_action' is set to current_action_io (if interlock_action_io is null), fire because require_auth_in is false", () => {
    expect(machine.private_decideNextAction(false, 'interlock', null, null, null, true, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'current_action_io',
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

test("if current_state_in is 'interlock' and driver_status_inFeedHold is set to false, 'interlock_action' is set to interlock_action_io (even if current_action_io is defined), fire because require_auth_in is false", () => {
    expect(machine.private_decideNextAction(false, 'interlock', null, null, 'interlock_action_io', false, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           'interlock_action_io',
        "next_action":              'fire',
        "error_thrown":             null});
});

test("if current_state_in is 'interlock' and driver_status_inFeedHold is set to false, 'interlock_action' is set to current_action_io (if interlock_action_io is null), set_state_and_emit because require_auth_in is true", () => {
    expect(machine.private_decideNextAction('require_auth_in', 'interlock', null, null, null, true, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'current_action_io',
        "current_action":           null,
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

test("if current_state_in is 'interlock' and driver_status_inFeedHold is set to false, 'interlock_action' is set to interlock_action_io (even if current_action_io is defined), set_state_and_emit because require_auth_in is true", () => {
    expect(machine.private_decideNextAction('require_auth_in', 'interlock', null, null, 'interlock_action_io', false, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           'interlock_action_io',
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});
//
test("if current_state_in is 'lock' and driver_status_inFeedHold is set to true, 'interlock_action' is set to current_action_io, fire because require_auth_in is false", () => {
    expect(machine.private_decideNextAction(false, 'lock', null, null, null, true, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'current_action_io',
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

test("if current_state_in is 'lock' and driver_status_inFeedHold is set to true, 'interlock_action' is set to current_action_io, set_state_and_emit because require_auth_in is true", () => {
    expect(machine.private_decideNextAction('require_auth_in', 'lock', null, null, null, true, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'current_action_io',
        "current_action":           null,
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

test("if current_state_in is 'lock' and driver_status_inFeedHold is set to false, 'interlock_action' is set to current_action_io (if interlock_action_io is null), fire because require_auth_in is false", () => {
    expect(machine.private_decideNextAction(false, 'lock', null, null, null, true, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'current_action_io',
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

test("if current_state_in is 'lock' and driver_status_inFeedHold is set to false, 'interlock_action' is set to interlock_action_io (even if current_action_io is defined), fire because require_auth_in is false", () => {
    expect(machine.private_decideNextAction(false, 'interlock', null, null, 'interlock_action_io', false, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           'interlock_action_io',
        "next_action":              'fire',
        "error_thrown":             null});
});

test("if current_state_in is 'lock' and driver_status_inFeedHold is set to false, 'interlock_action' is set to current_action_io (if interlock_action_io is null), set_state_and_emit because require_auth_in is true", () => {
    expect(machine.private_decideNextAction('require_auth_in', 'lock', null, null, null, true, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'current_action_io',
        "current_action":           null,
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

test("if current_state_in is 'lock' and driver_status_inFeedHold is set to false, 'interlock_action' is set to interlock_action_io (even if current_action_io is defined), set_state_and_emit because require_auth_in is true", () => {
    expect(machine.private_decideNextAction('require_auth_in', 'lock', null, null, 'interlock_action_io', false, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           'interlock_action_io',
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

test("if current_state_in is 'interlock', BOTH current_action_io and interlock_required_io are defined, and interlock_required_io + driver_status_interlock_in true, then abort", () => {
    expect(machine.private_decideNextAction(null, 'interlock', 'driver_status_interlock_in', 'interlock_required_io', 'interlock_action_io', null, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           'interlock_action_io',
        "next_action":              'abort_due_to_interlock',
        "error_thrown":             null});
});

test("if current_state_in is 'interlock', driver_status_inFeedHold is set to true, 'current_action_io' is defined, and interlock_required_io + driver_status_interlock_in true, abort", () => {
    expect(machine.private_decideNextAction(null, 'interlock', 'driver_status_interlock_in', 'interlock_required_io', 'interlock_action_io', true, 'current_action_io', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'current_action_io',
        "current_action":           null,
        "next_action":              'abort_due_to_interlock',
        "error_thrown":             null});
});

test("if current_state_in is 'manual', current_action_io is null and require_auth_in is true, just set state and emit", () => {
    expect(machine.private_decideNextAction('require_auth_in', 'manual', null, null, null, null, null, false)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

test("if current_state_in is 'manual', current_action_io is null and require_auth_in is false, fire", () => {
    expect(machine.private_decideNextAction(false, 'manual', null, null, null, null, null, false)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

test("if current_state_in is 'manual', current_action_io.type is runtimeCode AND current_action.payload.name is manual then interlockRequired false, set_state_and_emit", () => {
    current_action_io = {};
    current_action_io.type = 'runtimeCode';
    current_action_io.payload = {};
    current_action_io.payload.name = "manual",
    current_action_io.payload.code = {};
    expect(machine.private_decideNextAction('require_auth_in', 'manual', null, null, null, null, current_action_io, false)).toStrictEqual(
        {
        "interlock_required":       false,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

test("if require_auth_in is false, and current_action_io.type is runtimeCode AND current_action.payload.name is manual then interlockRequired false, fire because require_auth_in is false", () => {
    current_action_io = {};
    current_action_io.type = 'runtimeCode';
    current_action_io.payload = {};
    current_action_io.payload.name = 'manual',
    current_action_io.payload.code = {};
    expect(machine.private_decideNextAction(false, 'manual', null, null, null, null, current_action_io, false)).toStrictEqual(
        {
        "interlock_required":       false,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

// //Need test, currnet action not null AND (current_action.type != 'runtimeCode' OR current_action.payload.name != 'manual')
test("if require_auth_in is false, current_action_io is defined but current_action_io.type is NOT runtimeCode AND current_action.payload.name is NOT manual then throw error", () => {
    current_action_io = {};
    current_action_io.type = 'not_runtimeCode';
    current_action_io.payload = {};
    current_action_io.payload.name = 'not_manual',
    current_action_io.payload.code = {};
    expect(machine.private_decideNextAction(false, 'manual', null, null, null, null, current_action_io, false)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'throw',
        "error_thrown":             new Error('Cannot arm machine for not_runtimeCode from the manual state')});
});

test("if current state is paused, current_action_io.type == resume, and driver_status_inFeedHold == true, then set_state_and_emit", () => {
    current_action_io = {};
    current_action_io.type = 'not_resume';
    expect(machine.private_decideNextAction('auth_required', 'paused', null, 'driver_status_interlock_required', null, true, current_action_io, false)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'throw',
        "error_thrown":             new Error('Cannot arm the machine for not_resume when paused')});
});

test("if current state is paused and current_action_io.type != resume then error", () => {
    current_action_io = {};
    current_action_io.type = 'not_resume';
    expect(machine.private_decideNextAction('auth_required', 'paused', null, 'driver_status_interlock_required', null, null, current_action_io, false)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'throw',
        "error_thrown":             new Error('Cannot arm the machine for not_resume when paused')});
});

test("if current_state is stopped and current_action.type != resume then error", () => {
    current_action_io = {};
    current_action_io.type = 'not_resume';
    expect(machine.private_decideNextAction('auth_required', 'stopped', null, 'interlock_required', null, null, current_action_io, false)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'throw',
        "error_thrown":             new Error('Cannot arm the machine for not_resume when stopped')});
});

test("if current_state_in is stopped and current_action.type == resume then set_state_and_emit", () => {
    current_action_io = {};
    current_action_io.type = 'resume';
    expect(machine.private_decideNextAction('auth_required', 'stopped', null, 'interlock_required', null, null, current_action_io, false)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

test("if current_action_io and current_action_io.payload exist and current_action_io.payload.name equals manual then interlock_required = false, check while bypass false", () => {
    current_action_io = {};
    current_action_io.payload = {};
    current_action_io.payload.name = "manual";
    current_action_io.payload.code = {};
    current_action_io.payload.code.cmd = 'set';
    expect(machine.private_decideNextAction('auth_required', 'idle', null, 'interlock_required', null, null, current_action_io, 'bypass_in')).toStrictEqual(
        {
        "interlock_required":       false,
        "interlock_action":         current_action_io,
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

test("if current_action_io and current_action_io.payload exist and current_action_io.payload.name equals manual then interlock required = false, check while bypass true", () => {
    current_action_io = {};
    current_action_io.payload = {};
    current_action_io.payload.name = "manual";
    current_action_io.payload.code = {};
    current_action_io.payload.code.cmd = 'set';
    expect(machine.private_decideNextAction('auth_required', 'idle', null, 'interlock_required', null, null, current_action_io, 'bypass_in')).toStrictEqual(
        {
        "interlock_required":       false,
        "interlock_action":         current_action_io,
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

//<--------------------------------------------------------------------------------------------------------->