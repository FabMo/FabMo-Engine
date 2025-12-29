// Generate probe file from parameters
function generateProbeFile(params) {
    var sbpCode = `'==============================================================================
' AUTO-GENERATED PROBE FILE
' Generated: ${new Date().toLocaleString()}
' Grid: ${params.xStart} to ${params.xEnd} by ${params.yStart} to ${params.yEnd}
' Step: ${params.step}
'==============================================================================

' Initialize probe parameters
&grid_x_start = ${params.xStart}
&grid_y_start = ${params.yStart}
&grid_x_end = ${params.xEnd}
&grid_y_end = ${params.yEnd}
&grid_step = ${params.step}
&probe_speed = ${params.speed}
&probe_input = ${params.input}
&safe_z = ${params.safeZ}

' Move to safe starting position
MZ,&safe_z
PAUSE ${params.startDelay || 10} 'Time to start logger app

' Send initialization message
DATA_SEND,"probe_start",&grid_x_end,&grid_y_end,&grid_step

' Nested loop for grid probing
&x = &grid_x_start
x_loop:
    &y = &grid_y_start
    y_loop:
        ' Move to XY position
        M2,&x,&y
        
        ' Probe down
        PZ,${params.probeDepth},&probe_speed,&probe_input
        
        ' Send probe point data: channel, X, Y, Z, input
        DATA_SEND,"probe_point",%(1),%(2),%(3),%(${50 + params.input})
        
        ' Return to safe Z
        MZ,&safe_z
        
        ' Increment Y
        &y = &y + &grid_step
    IF &y <= &grid_y_end THEN GOTO y_loop
    ' Increment X
    &x = &x + &grid_step
IF &x <= &grid_x_end THEN GOTO x_loop

' Send completion message
DATA_SEND,"probe_complete",&x,&y

' Return home
MH
`;
    
    return sbpCode;
}

// Export formats
function exportToSTL(dataPoints) {
    // Simple ASCII STL point cloud representation
    var stl = 'solid ProbeData\n';
    
    // Create tiny triangular facets at each point
    dataPoints.forEach(function(point) {
        if (point.position) {
            var x = point.position.x;
            var y = point.position.y;
            var z = point.position.z;
            var size = 0.01; // Tiny triangle size
            
            stl += `  facet normal 0 0 1\n`;
            stl += `    outer loop\n`;
            stl += `      vertex ${x} ${y} ${z}\n`;
            stl += `      vertex ${x+size} ${y} ${z}\n`;
            stl += `      vertex ${x} ${y+size} ${z}\n`;
            stl += `    endloop\n`;
            stl += `  endfacet\n`;
        }
    });
    
    stl += 'endsolid ProbeData\n';
    return stl;
}

function exportToCSVWithHeaders(dataPoints) {
    var csv = '# Probe Data Export\n';
    csv += '# Generated: ' + new Date().toISOString() + '\n';
    csv += '# Point Count: ' + dataPoints.length + '\n';
    csv += '#\n';
    csv += 'Index,Channel,X,Y,Z,Data,Timestamp\n';
    
    dataPoints.forEach(function(point, index) {
        var x = point.position ? point.position.x : '';
        var y = point.position ? point.position.y : '';
        var z = point.position ? point.position.z : '';
        var data = point.data ? JSON.stringify(point.data).replace(/"/g, '""') : '';
        var timestamp = new Date(point.timestamp).toISOString();
        
        csv += (index + 1) + ',' + point.channel + ',' + x + ',' + y + ',' + z + ',"' + data + '",' + timestamp + '\n';
    });
    
    return csv;
}

// Export as simple XYZ point cloud (for Transforms/Previewer)
function exportToPointCloud(dataPoints) {
    var xyz = '';
    
    // Filter to only probe_point data and sort by Y then X for organized output
    var points = dataPoints.filter(function(p) {
        return p.channel === 'probe_point' && p.position;
    });
    
    // Sort by Y (rows) then X (columns within rows)
    points.sort(function(a, b) {
        if (Math.abs(a.position.y - b.position.y) < 0.0001) {
            return a.position.x - b.position.x;
        }
        return a.position.y - b.position.y;
    });
    
    // Output simple space-separated XYZ format
    points.forEach(function(point) {
        xyz += point.position.x.toFixed(5) + ' ' +
               point.position.y.toFixed(5) + ' ' +
               point.position.z.toFixed(5) + '\n';
    });
    
    return xyz;
}

// Export as OpenSBP file to recreate surface
function exportToSBPFile(dataPoints, options) {
    options = options || {};
    var rasterDirection = options.rasterDirection || 'x'; // 'x' or 'y'
    var feedrate = options.feedrate || 3.0;  // Default 3 units/sec
    var safeZ = options.safeZ || 1.0;
    var plungeSpeed = options.plungeSpeed || 1.0;
    
    var sbp = '';
    sbp += "'==============================================================================\n";
    sbp += "' AUTO-GENERATED SURFACE MAPPING FILE\n";
    sbp += "' Generated: " + new Date().toLocaleString() + "\n";
    sbp += "' Raster Direction: " + rasterDirection.toUpperCase() + "\n";
    sbp += "' Points: " + dataPoints.length + "\n";
    sbp += "'==============================================================================\n\n";
    
    // Filter to only probe_point data
    var points = dataPoints.filter(function(p) {
        return p.channel === 'probe_point' && p.position;
    });
    
    if (points.length === 0) {
        return "' No probe points found\n";
    }
    
    // Sort points based on raster direction
    if (rasterDirection === 'x') {
        // Raster along X: sort by Y (rows) then X (columns)
        points.sort(function(a, b) {
            if (Math.abs(a.position.y - b.position.y) < 0.0001) {
                return a.position.x - b.position.x;
            }
            return a.position.y - b.position.y;
        });
    } else {
        // Raster along Y: sort by X (columns) then Y (rows)
        points.sort(function(a, b) {
            if (Math.abs(a.position.x - b.position.x) < 0.0001) {
                return a.position.y - b.position.y;
            }
            return a.position.x - b.position.x;
        });
    }
    
    // Set speeds
    sbp += "' Set movement speeds\n";
    sbp += "MS," + feedrate + "," + feedrate + "\n";
    sbp += "VS," + plungeSpeed + "," + plungeSpeed + "\n\n";
    
    // Move to safe Z
    sbp += "' Move to safe height\n";
    sbp += "MZ," + safeZ + "\n\n";
    
    // Group points into rows
    var rows = [];
    var currentRow = [];
    var tolerance = 0.0001;
    
    if (rasterDirection === 'x') {
        // Group by Y coordinate (rows)
        var currentY = points[0].position.y;
        points.forEach(function(point) {
            if (Math.abs(point.position.y - currentY) > tolerance) {
                rows.push(currentRow);
                currentRow = [];
                currentY = point.position.y;
            }
            currentRow.push(point);
        });
    } else {
        // Group by X coordinate (columns)
        var currentX = points[0].position.x;
        points.forEach(function(point) {
            if (Math.abs(point.position.x - currentX) > tolerance) {
                rows.push(currentRow);
                currentRow = [];
                currentX = point.position.x;
            }
            currentRow.push(point);
        });
    }
    if (currentRow.length > 0) rows.push(currentRow);
    
    // Generate code for each row
    var rowNum = 0;
    rows.forEach(function(row) {
        rowNum++;
        sbp += "' Row " + rowNum + " (" + row.length + " points)\n";
        
        if (row.length === 0) return;
        
        var firstPoint = row[0];
        
        // Move to start of row (XY position)
        sbp += "M2," + firstPoint.position.x.toFixed(5) + "," + 
               firstPoint.position.y.toFixed(5) + "\n";
        
        // Plunge to first Z height
        sbp += "MZ," + firstPoint.position.z.toFixed(5) + "\n";
        
        // Move through remaining points in row with M3
        for (var i = 1; i < row.length; i++) {
            var point = row[i];
            sbp += "M3," + point.position.x.toFixed(5) + "," + 
                   point.position.y.toFixed(5) + "," + 
                   point.position.z.toFixed(5) + "\n";
        }
        
        // Return to safe Z at end of row
        sbp += "MZ," + safeZ + "\n\n";
    });
    
    // Return to start
    sbp += "' Return to start position\n";
    sbp += "M2," + points[0].position.x.toFixed(5) + "," + 
           points[0].position.y.toFixed(5) + "\n";
    sbp += "MZ," + safeZ + "\n";
    sbp += "\n' End of surface mapping file\n";
    
    return sbp;
}

// Make functions available globally
window.ProbeFileGenerator = {
    generate: generateProbeFile,
    exportSTL: exportToSTL,
    exportCSV: exportToCSVWithHeaders,
    exportPointCloud: exportToPointCloud,
    exportSBP: exportToSBPFile
};