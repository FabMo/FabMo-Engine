#!/usr/bin/env node
// Test script to verify config variable parsing

var parser = require('./sbp_parser.js');
var fs = require('fs');

// Test cases
var testCases = [
    '%machine.envelope.xmax',
    '%machine.units',
    '%opensbp.movexy_speed',
    '%driver.g55x',
    '%(71)',  // Traditional format should still work
];

console.log('Testing OpenSBP parser with config variables:\n');

testCases.forEach(function(testCase) {
    try {
        var result = parser.parse(testCase);
        console.log('✓ PASS: ' + testCase);
        console.log('  Result:', JSON.stringify(result, null, 2));
        console.log('');
    } catch (e) {
        console.log('✗ FAIL: ' + testCase);
        console.log('  Error:', e.message);
        console.log('');
    }
});

// Test parsing the test file
console.log('\nTesting test_config_vars.sbp file:\n');
try {
    var content = fs.readFileSync('./test_config_vars.sbp', 'utf8');
    var lines = content.split('\n').filter(function(line) {
        return line.trim() && !line.trim().startsWith("'");
    });

    lines.forEach(function(line) {
        try {
            var result = parser.parse(line);
            console.log('✓ PASS: ' + line);
            console.log('  Result:', JSON.stringify(result, null, 2));
            console.log('');
        } catch (e) {
            console.log('✗ FAIL: ' + line);
            console.log('  Error:', e.message);
            console.log('');
        }
    });
} catch (e) {
    console.log('Error reading test file:', e.message);
}
