# Config Variable Access in OpenSBP

## Overview
This feature allows you to reference configuration values from any config file in `/opt/fabmo/config/` directly in your OpenSBP cut files using dot notation.

## Syntax
```
%<config_name>.<property>.<nested_property>
```

## Supported Config Objects
- `machine` - Machine configuration (machine.json)
- `driver` or `g2` - G2 driver configuration (g2.json)
- `opensbp` - OpenSBP runtime configuration (opensbp.json)
- `engine` - Engine configuration (engine.json)
- `instance` - Instance configuration (instance.json)

## Examples

### Accessing Machine Envelope Values
```opensbp
' Get the maximum X table limit (returns 36 for default config)
$xmax = %machine.envelope.xmax

' Get other envelope values
$ymax = %machine.envelope.ymax
$zmin = %machine.envelope.zmin
```

### Accessing Machine Units
```opensbp
' Get current units setting
$units = %machine.units
```

### Accessing OpenSBP Configuration
```opensbp
' Get move speeds
$xy_speed = %opensbp.movexy_speed
$z_speed = %opensbp.movez_speed

' Get jog speeds
$jog_speed = %opensbp.jogxy_speed
```

### Accessing Driver/G2 Configuration
```opensbp
' Get G55 offsets
$x_offset = %driver.g55x
$y_offset = %driver.g55y

' Or use g2 alias
$x_offset = %g2.g55x
```

### Using in Calculations
```opensbp
' Calculate center of table
$x_center = %machine.envelope.xmax / 2
$y_center = %machine.envelope.ymax / 2

' Move to center
MX, $x_center, $y_center
```

## Backward Compatibility
The traditional numeric system variable format `%(n)` continues to work:
```opensbp
' Traditional format still works
$movexy = %(71)
```

## Implementation Details

### Modified Files
1. **runtime/opensbp/sbp_parser.pegjs** - Grammar updated to support dot notation
2. **runtime/opensbp/sbp_parser.js** - Parser regenerated from grammar
3. **runtime/opensbp/opensbp.js** - Runtime evaluator updated to handle config paths

### How It Works
1. Parser recognizes `%identifier.property.property...` syntax
2. Creates a `configPath` array: `["MACHINE", "ENVELOPE", "XMAX"]`
3. Runtime evaluator:
   - Maps first element to config object (e.g., "MACHINE" → config.machine)
   - Navigates through `_cache` using remaining path elements
   - Returns the value

### Error Handling
- Unknown config object: `Error: Unknown config object: <name>`
- Invalid property path: `Error: Property <path> not found in config`
- Variable not defined: Proper error message with line number

## Testing
Test files created in `/fabmo/runtime/opensbp/`:
- `test_config_vars.sbp` - Sample OpenSBP code
- `test_config_parser.js` - Parser tests
- `test_runtime_config.js` - Runtime evaluation tests

Run tests:
```bash
cd /fabmo/runtime/opensbp
node test_config_parser.js
node test_runtime_config.js
```

## Notes
- Config names are case-insensitive
- Property names are case-insensitive
- Nested properties are fully supported
- Values are retrieved from the in-memory cache for performance
