## Universal Unit Variables (UU Variables)

Variables ending with "UU" automatically store values in both inch and millimeter units. When you assign to a UU variable, the value is interpreted according to current system units and both conversions are stored.

### Syntax
```opensbp
' Direct assignment - interprets value based on current units
&variableUU = value
$variableUU = value

' Access specific unit value
&variableUU[0]  ' Inch value
&variableUU[1]  ' Millimeter value

' Access using current unit index
&variableUU[%(25)]  ' Current units (0=in, 1=mm)
```

### Examples

#### Basic Usage
```opensbp
' Set units to inches
VD,0

' Assign a distance (interpreted as inches)
&lengthUU = 10.5
' Now &lengthUU[0] = 10.5 inches
'     &lengthUU[1] = 266.7 mm

' Switch to millimeters
VD,1

' Assign another distance (interpreted as mm)
&widthUU = 250
' Now &widthUU[0] = 9.8425 inches
'     &widthUU[1] = 250 mm
```

#### Using in Motion Commands
```opensbp
' Define cutting dimensions in current units
&cut_depthUU = 0.5
&cut_lengthUU = 12.0

' Move using appropriate units automatically
MZ, &cut_depthUU[%(25)]
MX, &cut_lengthUU[%(25)]

' Works across unit changes
VD,1  ' Switch to mm
' Same variables now return mm values when accessed with %(25)
MZ, &cut_depthUU[%(25)]  ' Uses mm value automatically
```

#### Manual Override
```opensbp
' You can still set specific unit values manually
&heightUU[0] = 2.5     ' Set inch value directly
&heightUU[1] = 63.5    ' Set mm value directly (not auto-converted)
```

#### Persistent Universal Units
```opensbp
' Works with permanent variables too
$table_lengthUU = 48  ' 48 inches (if in inch mode)
' $table_lengthUU[0] = 48
' $table_lengthUU[1] = 1219.2

' Value persists across files
' Access in any subsequent file with appropriate units
MX, $table_lengthUU[%(25)]
```

### Use Cases

**Multi-Unit Workflows**
```opensbp
' Designer provides dimensions in mm
VD,1
&design_widthUU = 250
&design_heightUU = 180

' Machine operator prefers inches
VD,0
' Can still see/use values
' &design_widthUU[%(25)] now returns 9.8425 inches
```

**Configuration Files**
```opensbp
' Setup file that works regardless of user's preferred units
$material_thicknessUU = 0.75  ' Set while in inches
$spoilboard_heightUU = 1.0

' Later in cutting file (user may have switched units)
MZ, $spoilboard_heightUU[%(25)] + $material_thicknessUU[%(25)]
```

### Naming Convention
- Variable names **must** end with "UU" (case insensitive)
- Works with both `&` (temporary) and `$` (permanent) variables
- Examples: `&distUU`, `&PART_LENGTHUU`, `$offsetUU`

### Notes
- Assignment **without** array index interprets value based on current system units [%(25)]
- Assignment **with** array index (0 or 1) sets that specific value without conversion
- Reading always uses array access: `[0]` for inches, `[1]` for mm
- Use `%(25)` to automatically select current units: `&varUU[%(25)]`
