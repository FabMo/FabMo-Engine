/*jshint esversion: 6 */

//These are unit tests for functions within util.js

const util = require('../util');

//Setup to test listify function
var xArray = [1];
var x = 1;

//if x is an array this should return x unchanged
test('x IN an array return x IN an array', () => {
    expect(util.private_listify(xArray)).toEqual(xArray);
});

//if x is NOT an array, this should return x as an array
test('x NOT in an array return x IN an array', () => {
    expect(util.private_listify(x)).toEqual(xArray);
});

/*===========================================================*/

//This is a unit test for the mm2in function in util.js

test('MM to IN conversion work correctly', () => {
    expect(util.private_mm2in(25.4)).toEqual(1);
});

/*===========================================================*/

//This is a unit test for the in2mm function in util.js

test('IN to MM conversion work correctly', () => {
    expect(util.private_in2mm(1)).toEqual(25.4);
});

/*===========================================================*/

//These are unit tests for the unitType function in util.js

test('input with whitespace will have spaces removed', () => {
  expect(util.private_unitType('       in        ')).toBe('in');
});

test('input in capital letters will be changed to lowercase', () => {
  expect(util.private_unitType('MM')).toBe('mm');
});

test('input with whitespace and in capital letters will be adjusted both ways', () => {
  expect(util.private_unitType('       MM     ')).toBe('mm');
});

//.trim() only removes white space from the beginning and end of input
test('input with whitespace in middle of input throws exception', () => {
  expect(() => util.private_unitType('       M   M     ')).toThrow(Error);
});

test('input in sets units to inches', () => {
  expect(util.private_unitType('in')).toBe('in');
});

test('input 1 sets units to mm', () => {
  expect(util.private_unitType('1')).toBe('mm');
});

test('input mm sets units to mm', () => {
  expect(util.private_unitType('mm')).toBe('mm');
});

test('unexpected input throws exception', () => {
  expect(() => util.private_unitType('unexpected')).toThrow(Error);
});

/*===========================================================*/

//Mocking dummy test
test("returns undefined by default", () => {
  mock = jest.fn();
  let result = mock("Kyle");

  expect(result).toBeUndefined();
  expect(mock).toHaveBeenCalled();
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock).toHaveBeenCalledWith("Kyle");
});

/*===========================================================*/
