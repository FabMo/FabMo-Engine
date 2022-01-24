/*jshint esversion: 6 */
const machine = require('../machine');

//Unit tests for decideNextAction function

//Current_state switch case default
test('if current_state is an unexpected value then next action should throw error', () => {
    expect(machine.private_decideNextAction(null, 'unexpected_state', null, null, null, null, null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'throw',
        "error_thrown":             new Error('Cannot arm the machine from the unexpected_state state.')});
});

//Current_state switch case idle
test('if current_state is idle then JSON interlock_action is set to action and JSON next_action is set_state_and_emit because require_auth is true', () => {
    expect(machine.private_decideNextAction(true, 'idle', null, null, null, 'some_action', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'some_action',
        "current_action":           null,
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

//Current_state switch case idle
test('if current_state is idle then JSON interlock_action is set to action and JSON next_action is fire because require_auth is false', () => {
    expect(machine.private_decideNextAction(false, 'idle', null, null, null, 'some_action', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         'some_action',
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

//Current_state switch case interlock first outcome
test('if current_state is interlock then JSON current_action is set to interlock_action, fire because require_auth false', () => {
    expect(machine.private_decideNextAction(null, 'interlock', null, null, 'interlock_action', 'current_action', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           'interlock_action',
        "next_action":              'fire',
        "error_thrown":             null});
});

//Current_state switch case interlock second outcome
test('if current_state is interlock then JSON current_action is set to current_action if interlock_action not defined, fire because require_auth false', () => {
    expect(machine.private_decideNextAction(null, 'interlock', null, null, null, 'current_action', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           'current_action',
        "next_action":              'fire',
        "error_thrown":             null});
});

//Current_state switch case interlock third outcome
test('if current_state is interlock then JSON current_action is set to interlock_action even if current_action is defined, fire because require_auth false', () => {
    expect(machine.private_decideNextAction(null, 'interlock', null, null, 'interlock_action', 'current_action', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           'interlock_action',
        "next_action":              'fire',
        "error_thrown":             null});
});

//Current_state switch case interlock fourth outcome, interlock_required and driver_status interlock defined
test('if current_state is interlock and JSON current_action is set to interlock_action, and interlock_required + driver_status_interlock true, abort', () => {
    expect(machine.private_decideNextAction(null, 'interlock', true, true, 'interlock_action', 'current_action', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           'interlock_action',
        "next_action":              'abort_due_to_interlock',
        "error_thrown":             null});
});

//Current_state switch case interlock fifth outcome
test('if current_state is interlock and JSON current_action is set to current_action, and interlock_required + driver_status_interlock true, abort', () => {
    expect(machine.private_decideNextAction(null, 'interlock', true, true, null, 'current_action', null)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           'current_action',
        "next_action":              'abort_due_to_interlock',
        "error_thrown":             null});
});

// /*   
//     I believe this test is "wrong". If the state is "interlock" there is no path in the original code that throws.
//     Errors are thrown only from the "manual" state (this test sets up a manual action but not `manual state) and from "stopped" state.
// */
//Current_state switch case interlock sixth outcome
// test('if current_state is interlock and JSON current_action is set to interlock_action, and current_action.payload.name is manual, interlock_required is false,and cmd is unexpected value', () => {
//     current_action = {};
//     current_action.payload = {};
//     current_action.payload.name = "manual",
//     current_action.payload.code = {};
//     current_action.payload.code.cmd = 'unexpected';
//     expect(machine.private_decideNextAction(null, 'interlock', null, null, 'interlock_action', current_action, null)).toStrictEqual(
//         {
//         "interlock_required":       false,
//         "interlock_action":         null,
//         "current_action":           'interlock_action',
//         "next_action":              null,
//         "error_thrown":             null});
// });
 

//switch case manual first outcome
test('if current_action is null then nothing changes, set state and emit', () => {
    expect(machine.private_decideNextAction('auth_required', 'manual', null, 'interlock_required', null, null, false)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

//switch case manual second outcome
test('if current_action.type is runtimeCode AND current_action.payload.name is manual then interlockRequired false', () => {
    current_action = {};
    current_action.type = 'runtimeCode';
    current_action.payload = {};
    current_action.payload.name = "manual",
    current_action.payload.code = {};
    current_action.payload.code.cmd = 'set';
    expect(machine.private_decideNextAction('auth_required', 'manual', null, 'interlock_required', null, current_action, false)).toStrictEqual(
        {
        "interlock_required":       false,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

// //Switch case manual third outcome
// //Need test, currnet action not null AND (current_action.type != 'runtimeCode' OR current_action.payload.name != 'manual')

// //switch case paused should throw error
test('if current state is paused and current_action.type != resume then error', () => {
    current_action = {};
    current_action.type = 'not_resume';
    expect(machine.private_decideNextAction('auth_required', 'paused', null, 'interlock_required', null, current_action, false)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'throw',
        "error_thrown":             new Error('Cannot arm the machine for not_resume when paused')});
});
// //Fine tune comments below this comment!
// //switch case stopped should throw error
test('if current_state is stopped and current_action.type != resume then error', () => {
    current_action = {};
    current_action.type = 'not_resume';
    expect(machine.private_decideNextAction('auth_required', 'stopped', null, 'interlock_required', null, current_action, false)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'throw',
        "error_thrown":             new Error('Cannot arm the machine for not_resume when stopped')});
});

// //switch case stopped or paused should resume and fire
test('if current_state is stopped and current_action.type == resume then set_state_and_emit', () => {
    current_action = {};
    current_action.type = 'resume';
    expect(machine.private_decideNextAction('auth_required', 'stopped', null, 'interlock_required', null, current_action, false)).toStrictEqual(
        {
        "interlock_required":       null,
        "interlock_action":         null,
        "current_action":           null,
        "next_action":              'set_state_and_emit',
        "error_thrown":             null});
});

// //Check to see if interlock is required, bypass is true
test('if current_action and current_action.payload exist and current_action.payload.name equals manual then interlock required = false, check while bypass false', () => {
    current_action = {};
    current_action.payload = {};
    current_action.payload.name = "manual";
    current_action.payload.code = {};
    current_action.payload.code.cmd = 'set';
    expect(machine.private_decideNextAction('auth_required', 'idle', null, 'interlock_required', null, current_action, true)).toStrictEqual(
        {
        "interlock_required":       false,
        "interlock_action":         current_action,
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});

// //Check to see if interlock is required, left side of || all true, right side set to true just to test both cases
test('if current_action and current_action.payload exist and current_action.payload.name equals manual then interlock required = false, check while bypass true', () => {
    current_action = {};
    current_action.payload = {};
    current_action.payload.name = "manual";
    current_action.payload.code = {};
    current_action.payload.code.cmd = 'set';
    expect(machine.private_decideNextAction('auth_required', 'idle', null, 'interlock_required', null, current_action, true)).toStrictEqual(
        {
        "interlock_required":       false,
        "interlock_action":         current_action,
        "current_action":           null,
        "next_action":              'fire',
        "error_thrown":             null});
});