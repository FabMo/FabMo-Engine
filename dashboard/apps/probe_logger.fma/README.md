# Probe Data Logger - Reference App for DATA_SEND

## Overview

The Probe Logger demonstrates the **DATA_SEND** pattern for lightweight data exchange between OpenSBP part files and dashboard applications. This is a **one-way communication system** - files send data to apps, apps log/process/export it.

## Architecture Pattern: File-to-App Data Flow

```
OpenSBP Part File  →  DATA_SEND  →  Machine Events  →  WebSocket  →  Dashboard App
```

### Key Principles

1. **Part Files do systematic motion** - Simple, i.e. repeatable probe patterns
2. **Apps handle complex logic** - Data processing, file I/O, visualization
3. **One-way data flow** - No request/response blocking
4. **Apps start before files** - Logger must be running to receive data

## Using DATA_SEND

### In OpenSBP Files

```opensbp
' Send a probe point
PZ, -0.5, 1.0, 1
DATA_SEND, "probe_point", %(1), %(2), %(3), %(51)

' Send completion signal
DATA_SEND, "probe_complete", &total_points
```

**Arguments:**
- First argument: **channel name** (string) - identifies message type
- Remaining arguments: **data values** - can be system vars, user vars, or literals

**Behavior:**
- Non-blocking - execution continues immediately
- System variables evaluated at send time
- No response expected or waited for

### In Dashboard Apps

```javascript
var fabmo = new FabMoDashboard();

fabmo.on('data_send', function(message) {
    console.log('Channel:', message.channel);
    console.log('Data:', message.data);        // Array of arguments
    console.log('Timestamp:', message.timestamp);
    console.log('Source:', message.source);     // 'opensbp'
    console.log('Position:', message.position); // {x, y, z, a, b, c}
    console.log('Line:', message.line);         // Line number in file
    
    // Process based on channel
    switch(message.channel) {
        case 'probe_point':
            var x = message.data[0];
            var y = message.data[1];
            var z = message.data[2];
            logProbePoint(x, y, z);
            break;
            
        case 'probe_complete':
            exportData();
            break;
    }
});
```

## Features

### 1. Auto-Generate Probe Files

Set parameters and generate a custom probe grid file:
- Grid dimensions (X/Y start/end)
- Step size
- Probe speed and depth
- Input number for probe trigger

The app generates the SBP code and submits it as a job automatically.

### 2. Real-Time Data Logging

- Displays incoming probe points in a table
- Updates point count live
- Shows current operation status
- Filters by channel

### 3. Export Formats

**CSV** - Structured data with headers:
```csv
# Probe Data Export
# Generated: 2025-01-27T10:30:00.000Z
# Point Count: 12
#
Index,Channel,X,Y,Z,Data,Timestamp
1,probe_point,0.0000,0.0000,0.5432,"",2025-01-27T10:30:01.000Z
...
```

**JSON** - Full metadata export:
```json
{
  "metadata": {
    "exportDate": "2025-01-27T10:30:00.000Z",
    "pointCount": 12,
    "channels": ["probe_point", "probe_complete"]
  },
  "points": [ ... ]
}
```

**STL** - Point cloud for CAD import:
```stl
solid ProbeData
  facet normal 0 0 1
    outer loop
      vertex 0.0000 0.0000 0.5432
      vertex 0.0100 0.0000 0.5432
      vertex 0.0000 0.0100 0.5432
    endloop
  endfacet
...
```

## Workflow Example

### Method 1: Use Generated File

1. Open Probe Logger app
2. Click "Show Generator"
3. Set grid parameters
4. Click "Generate & Run File"
5. Wait 10 seconds for app to initialize
6. File runs, data appears in table
7. Export when complete

### Method 2: Run Existing File

1. Open Probe Logger app  
2. Load your probe file in file manager
3. Run the file
4. Data appears in real-time
5. Export to desired format

## Example Probe File

See [`examples/probe_digitize_example.sbp`](examples/probe_digitize_example.sbp) for a complete reference implementation.

## Common Patterns

### Pattern 1: Systematic Grid Probing
```opensbp
&x = 0
x_loop:
    &y = 0
    y_loop:
        M2, &x, &y
        PZ, -0.5, 1.0, 1
        DATA_SEND, "probe_point", %(1), %(2), %(3)
        &y = &y + 1
    IF &y <= 3 THEN GOTO y_loop
    &x = &x + 1
IF &x <= 3 THEN GOTO x_loop
DATA_SEND, "probe_complete"
```

### Pattern 2: Event Logging
```opensbp
DATA_SEND, "cut_started", &part_number
' ... cutting operations ...
DATA_SEND, "cut_complete", &part_number, %(3)  ' Send Z depth
```

### Pattern 3: Error Reporting
```opensbp
IF &temp > &max_temp THEN DATA_SEND, "error", "Temperature exceeded"
```

## Building Your Own App

### Minimal Example

```html
<!DOCTYPE html>
<html>
<head>
    <title>My Data Logger</title>
    <script src="../../js/libs/fabmo.js"></script>
</head>
<body>
    <div id="log"></div>
    <script>
        var fabmo = new FabMoDashboard();
        var logDiv = document.getElementById('log');
        
        fabmo.on('data_send', function(msg) {
            var line = document.createElement('p');
            line.textContent = msg.channel + ': ' + JSON.stringify(msg.data);
            logDiv.appendChild(line);
        });
    </script>
</body>
</html>
```

### Best Practices

1. **Always listen before running** - Start app before file
2. **Use descriptive channels** - "probe_point" not "data1"
3. **Include metadata** - Timestamps, positions, etc.
4. **Handle completion** - Use a "done" channel
5. **Validate data** - Check for missing/invalid values
6. **Provide exports** - Let users save their data

## When NOT to Use DATA_SEND

- **User input during file execution** → Use `DIALOG` command
- **Complex control flow** → Write app that calls `fabmo.runSBP()`  
- **File I/O within OpenSBP** → Not yet supported, use DATA_SEND to app instead
- **Real-time machine control** → Use manual runtime API

## Troubleshooting

**No data appearing?**
- Is the app running before you start the file?
- Check browser console for errors
- Verify channel names match

**Data missing fields?**
- System variables evaluate to current position - move may still be pending
- Add `PAUSE 0.1` before DATA_SEND if needed

**Performance issues with large datasets?**
- Limit table display (filter/pagination)
- Export data periodically during long runs
- Consider batch processing in app

## See Also

- [`examples/probe_digitize_example.sbp`](examples/probe_digitize_example.sbp) - Complete probe file
- [FabMo Dashboard API](http://docs.fabmo.io/api/dashboard.html) - Full API reference
- [OpenSBP Command Reference](https://shopbottools.com/wp-content/uploads/2025/07/ComRef.pdf)