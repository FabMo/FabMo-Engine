# Universal Unit Variables (UU Variables)

Variables ending with "UU" automatically store values in both inch and millimeter units using an explicit placeholder syntax. When you assign to a UU variable with `[]`, the value is interpreted according to current system units and both conversions are stored.

## Syntax

```opensbp
' Universal Unit assignment - requires [] placeholder and UU suffix
$variableUU[].property = value
$variableUU[index][].property = value

' Explicit unit assignment - value interpreted as the specified unit
$variableUU[in].property = value    ' Value is in inches, regardless of system units
$variableUU[mm].property = value    ' Value is in mm, regardless of system units
$variableUU[index][in].property = value
$variableUU[index][mm].property = value

' Access using current units
value = $variable[index][%(25)].property  ' %(25) = current unit (0=in, 1=mm)
```

## Rules

1. **Variable names MUST end with "UU"** (case insensitive)
2. **Assignments MUST use `[]` placeholder** (or `[in]`/`[mm]` for explicit units) for the unit index position
3. **Access requires explicit index** (typically `%(25)` for current units, or `0`/`1` for specific units)
4. **Only one `[]`/`[in]`/`[mm]` placeholder** allowed per assignment
5. The placeholder creates indices `[0]` for inches and `[1]` for mm
6. **`[in]` and `[mm]` are case-insensitive** (`[IN]`, `[In]`, `[MM]`, `[Mm]` all work)

## Examples

### Tool Table with Universal Units

```opensbp
' Set units to inches
VD, 0

' Define tool 3 positions - UU suffix + [] placeholder required
$toolUU[3][].x = 5.5      ' Creates [3][0].x = 5.5 in, [3][1].x = 139.7 mm
$toolUU[3][].y = 2.0      ' Creates [3][0].y = 2.0 in, [3][1].y = 50.8 mm  
$toolUU[3][].z = -0.5     ' Creates [3][0].z = -0.5 in, [3][1].z = -12.7 mm

' Access in current units
MX, $toolUU[3][%(25)].x
MY, $toolUU[3][%(25)].y
MZ, $toolUU[3][%(25)].z

' Switch to mm - same access works
VD, 1
MX, $toolUU[3][%(25)].x   ' Now uses mm values automatically
```

### Simple Configuration

```opensbp
' Single-level array with properties
$configUU[].safe_height = 1.0     ' [0].safe_height = 1.0 in, [1].safe_height = 25.4 mm
$configUU[].plunge_depth = 0.25   ' [0].plunge_depth = 0.25 in, [1].plunge_depth = 6.35 mm

' Use in moves
MZ, $configUU[%(25)].safe_height
```

### Material Library

```opensbp
' Define materials with thickness in current units
VD, 0  ' Inches

$materialUU[1][].thickness = 0.75    ' 3/4" plywood
$materialUU[1][].name = "Plywood 3/4"

$materialUU[2][].thickness = 0.5     ' 1/2" MDF
$materialUU[2][].name = "MDF 1/2"

' Later, select material and cut
&current_material = 2
MZ, $materialUU[&current_material][%(25)].thickness
```

## Error Checking

The system validates your syntax and provides helpful error messages:

### Missing Placeholder Error

```opensbp
' ❌ ERROR: Missing [] placeholder
$toolUU[3][0].x = 5.5
' Error: Universal Unit variable $TOOLUU requires empty bracket [] 
'        placeholder for unit index.
'        Example: $TOOLUU[].property = value
```

### Wrong Suffix Error

```opensbp
' ❌ ERROR: [] used without UU suffix
$tool[3][].x = 5.5
' Error: Empty bracket [] placeholder can only be used with 
'        Universal Unit variables (ending in "UU").
```

### Correct Usage

```opensbp
' ✅ CORRECT: UU suffix + [] placeholder
$toolUU[3][].x = 5.5
```

## How It Works

1. **Assignment**: When you write `$toolUU[3][].x = 5.5`, the system:
   - Checks that variable ends with "UU" ✓
   - Checks that `[]` placeholder is present ✓
   - Reads current units with `%(25)` (0 = inches, 1 = mm)
   - If in inches: stores 5.5 at `[3][0].x` and 139.7 at `[3][1].x`
   - If in mm: stores 2.165 at `[3][0].x` and 5.5 at `[3][1].x`

2. **Access**: When you read `$toolUU[3][%(25)].x`:
   - `%(25)` evaluates to current unit (0 or 1)
   - Returns the appropriate value automatically

3. **Unit Changes**: Values remain correct when switching units with `VD` command

## Benefits

- **Explicit syntax**: The `[]` makes it visually clear where unit conversion happens
- **Error prevention**: Catches mistakes like `$toolUU[3][0].x` at runtime
- **Intent validation**: "UU" suffix signals this variable needs dual units
- **Single-line assignments**: No helper functions or GOSUBs needed
- **Works with any nesting**: `$varUU[a][b][].prop` is valid
- **Safe by default**: Can't accidentally create single-unit UU variables

## Notes

- Works with both `&` (temporary) and `$` (permanent) variables
- The "UU" suffix is **required** and case-insensitive (`tooluu`, `ToolUU`, `TOOLUU` all work)
- You cannot assign directly to `[0]` or `[1]` in a UU variable; use regular variables if needed
- Works with expressions: `$toolUU[&num][].x = %(1) + 2.5` evaluates before conversion
- The `[]` placeholder can appear anywhere in the chain, not just at the end