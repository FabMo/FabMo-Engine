#!/usr/bin/env node
// Test script to verify config variable evaluation in runtime

// Set up minimal config mock
global.config = {
    machine: {
        _cache: {
            units: 'in',
            envelope: {
                xmin: 0,
                xmax: 36,
                ymin: 0,
                ymax: 24,
                zmin: -2,
                zmax: 6
            }
        }
    },
    opensbp: {
        _cache: {
            movexy_speed: 3,
            movez_speed: 1
        },
        get: function(key) {
            return this._cache[key];
        }
    },
    driver: {
        _cache: {
            g55x: 0,
            g55y: 0
        }
    }
};

var parser = require('./sbp_parser.js');

// Simple mock of the evaluateSystemVariable function
function evaluateSystemVariable(v) {
    if (v === undefined) {
        return undefined;
    }

    if (v.type != "system_variable") {
        return;
    }

    // Handle new dot notation config path format
    if (v.configPath) {
        var configName = v.configPath[0].toLowerCase();
        var configObj = null;

        // Map config names to config objects
        switch (configName) {
            case 'machine':
                configObj = config.machine;
                break;
            case 'driver':
            case 'g2':
                configObj = config.driver;
                break;
            case 'opensbp':
                configObj = config.opensbp;
                break;
            default:
                throw new Error(`Unknown config object: ${configName}`);
        }

        // Navigate the property path
        var value = configObj._cache;
        for (var i = 1; i < v.configPath.length; i++) {
            var prop = v.configPath[i].toLowerCase();
            if (value && typeof value === 'object' && prop in value) {
                value = value[prop];
            } else {
                throw new Error(`Property ${v.configPath.slice(0, i + 1).join('.')} not found in config`);
            }
        }
        return value;
    }

    // For this test, just handle traditional numeric system variables minimally
    return v.expr;
}

// Test cases
console.log('Testing runtime evaluation of config variables:\n');

var testCases = [
    { code: '$test = %machine.envelope.xmax', expected: 36, desc: 'machine.envelope.xmax' },
    { code: '$test = %machine.units', expected: 'in', desc: 'machine.units' },
    { code: '$test = %opensbp.movexy_speed', expected: 3, desc: 'opensbp.movexy_speed' },
];

testCases.forEach(function(test) {
    try {
        var parsed = parser.parse(test.code);
        var value = evaluateSystemVariable(parsed.expr);

        if (value === test.expected) {
            console.log('✓ PASS: ' + test.desc);
            console.log('  Expected: ' + test.expected + ', Got: ' + value);
        } else {
            console.log('✗ FAIL: ' + test.desc);
            console.log('  Expected: ' + test.expected + ', Got: ' + value);
        }
        console.log('');
    } catch (e) {
        console.log('✗ FAIL: ' + test.desc);
        console.log('  Error:', e.message);
        console.log('');
    }
});
