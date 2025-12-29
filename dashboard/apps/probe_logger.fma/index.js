var fabmo = new FabMoDashboard();
var dataPoints = [];
var channels = new Set();
var currentFilter = '';

console.log('Probe Logger script starting...');

// Register event listeners BEFORE document.ready
fabmo.on('data_send', function(message) {
    console.log('*** PROBE LOGGER: Received data_send event:', message);
    
    // Add timestamp if not present
    if (!message.timestamp) {
        message.timestamp = Date.now();
    }
    
    // Handle different channel types
    switch(message.channel) {
        case 'probe_start':
            var xEnd = message.data[0];
            var yEnd = message.data[1];
            var step = message.data[2];
            $('#status').text('Probing started: ' + xEnd + 'x' + yEnd + ' grid, ' + step + ' step');
            clearData();
            console.log('Probe grid initialized:', xEnd, yEnd, step);
            break;
            
        case 'probe_point':
            // Data format: [x, y, z, input_state]
            var x = message.data[0];
            var y = message.data[1];
            var z = message.data[2];
            var input = message.data[3];
            
            console.log('Processing probe point:', x, y, z, input);
            
            // Add to dataPoints array with structured format
            var point = {
                channel: message.channel,
                position: { x: x, y: y, z: z },
                data: { input: input },
                timestamp: message.timestamp
            };
            dataPoints.push(point);
            console.log('Data points length:', dataPoints.length);
            
            // Track unique channels
            channels.add(message.channel);
            updateChannelFilter();
            
            // Add to table if it matches current filter
            if (!currentFilter || message.channel === currentFilter) {
                addDataRow(point, dataPoints.length);
            }
            
            // Update display
            $('#status').text('Point ' + dataPoints.length + ': X' + x.toFixed(3) + ' Y' + y.toFixed(3) + ' Z' + z.toFixed(3));
            updatePointCount();
            break;
            
        case 'probe_complete':
            var finalX = message.data[0];
            var finalY = message.data[1];
            $('#status').text('Probing complete! ' + dataPoints.length + ' points collected at X' + finalX.toFixed(3) + ' Y' + finalY.toFixed(3));
            console.log('Probing completed:', dataPoints.length, 'points');
            break;
            
        default:
            console.log('Generic channel data received:', message.channel);
            var genericPoint = {
                channel: message.channel,
                data: message.data,
                timestamp: message.timestamp
            };
            dataPoints.push(genericPoint);
            channels.add(message.channel);
            updateChannelFilter();
            if (!currentFilter || message.channel === currentFilter) {
                addDataRow(genericPoint, dataPoints.length);
            }
            updatePointCount();
    }
});

fabmo.on('data_request', function(message) {
    console.log('Received data_request:', message);
});

function addDataRow(point, index) {
    console.log('Adding data row for point', index);
    var tbody = document.getElementById('data-body');
    if (!tbody) {
        console.error('data-body element not found!');
        return;
    }
    
    var row = tbody.insertRow(0); // Insert at top
    
    row.insertCell(0).textContent = index;
    row.insertCell(1).textContent = point.channel;
    
    // Handle position data
    if (point.position) {
        row.insertCell(2).textContent = point.position.x.toFixed(4);
        row.insertCell(3).textContent = point.position.y.toFixed(4);
        row.insertCell(4).textContent = point.position.z.toFixed(4);
    } else {
        row.insertCell(2).textContent = '-';
        row.insertCell(3).textContent = '-';
        row.insertCell(4).textContent = '-';
    }
    
    // Handle additional data
    if (point.data && typeof point.data === 'object') {
        row.insertCell(5).textContent = JSON.stringify(point.data);
    } else if (Array.isArray(point.data)) {
        row.insertCell(5).textContent = point.data.join(', ');
    } else if (point.data !== undefined) {
        row.insertCell(5).textContent = String(point.data);
    } else {
        row.insertCell(5).textContent = '-';
    }
    
    // Timestamp
    var date = new Date(point.timestamp);
    row.insertCell(6).textContent = date.toLocaleTimeString();
    
    console.log('Row added successfully');
}

function updateChannelFilter() {
    var select = document.getElementById('channel-select');
    if (!select) return;
    
    var currentValue = select.value;
    select.innerHTML = '<option value="">All Channels</option>';
    
    channels.forEach(function(channel) {
        var option = document.createElement('option');
        option.value = channel;
        option.textContent = channel;
        select.appendChild(option);
    });
    
    if (currentValue && channels.has(currentValue)) {
        select.value = currentValue;
    }
}

function updatePointCount() {
    var pointCountEl = document.getElementById('point-count');
    if (!pointCountEl) return;
    
    var count = currentFilter ? 
        dataPoints.filter(function(p) { return p.channel === currentFilter; }).length : 
        dataPoints.length;
    pointCountEl.textContent = count + ' points';
}

function exportJSON() {
    if (dataPoints.length === 0) {
        fabmo.notify('info', 'No data to export');
        return;
    }
    
    // Create metadata
    var metadata = {
        exportDate: new Date().toISOString(),
        pointCount: dataPoints.length,
        channels: Array.from(channels)
    };
    
    // Create export object
    var exportData = {
        metadata: metadata,
        points: dataPoints
    };
    
    // Convert to JSON string with pretty formatting
    var json = JSON.stringify(exportData, null, 2);
    
    // Create and download file
    var blob = new Blob([json], { type: 'application/json' });
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'probe_data_' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    fabmo.notify('info', 'Exported ' + dataPoints.length + ' points to JSON');
}

function clearData() {
    dataPoints = [];
    channels.clear();
    currentFilter = '';
    var tbody = document.getElementById('data-body');
    if (tbody) {
        tbody.innerHTML = '';
    }
    updateChannelFilter();
    updatePointCount();
    $('#status').text('Data cleared. Waiting for new data...');
    console.log('Data cleared');
}

// DOM ready - set up UI event listeners
$(document).ready(function() {
    console.log('Probe Logger DOM ready');
    
    // Don't call foundation - not needed for this app
    // $(document).foundation();
    
    var clearBtn = document.getElementById('clear-btn');
    var exportCsvBtn = document.getElementById('export-csv-btn');
    var exportJsonBtn = document.getElementById('export-json-btn');
    var channelSelect = document.getElementById('channel-select');
    var showGeneratorBtn = document.getElementById('show-generator-btn');
    var generatorForm = document.getElementById('generator-form');
    var generateBtn = document.getElementById('generate-btn');
    var exportStlBtn = document.getElementById('export-stl-btn');
    var exportXyzBtn = document.getElementById('export-xyz-btn');
    var exportSbpBtn = document.getElementById('export-sbp-btn');
    
    if (clearBtn) {
        clearBtn.addEventListener('click', clearData);
    }
    
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', function() {
            if (dataPoints.length === 0) {
                fabmo.notify('info', 'No data to export');
                return;
            }
            
            var csv = window.ProbeFileGenerator.exportCSV(dataPoints);
            var blob = new Blob([csv], { type: 'text/csv' });
            var url = window.URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'probe_data_' + Date.now() + '.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            fabmo.notify('info', 'Exported ' + dataPoints.length + ' points to CSV');
        });
    }
    
    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', exportJSON);
    }
    
    if (channelSelect) {
        channelSelect.addEventListener('change', function() {
            currentFilter = this.value;
            var tbody = document.getElementById('data-body');
            if (tbody) {
                tbody.innerHTML = '';
            }
            
            var filteredPoints = currentFilter ? 
                dataPoints.filter(function(p) { return p.channel === currentFilter; }) : 
                dataPoints;
            
            filteredPoints.forEach(function(point, index) {
                addDataRow(point, index + 1);
            });
            
            updatePointCount();
        });
    }
    
    if (showGeneratorBtn && generatorForm) {
        showGeneratorBtn.addEventListener('click', function() {
            if (generatorForm.style.display === 'none') {
                generatorForm.style.display = 'block';
                showGeneratorBtn.textContent = 'Hide Generator';
            } else {
                generatorForm.style.display = 'none';
                showGeneratorBtn.textContent = 'Show Generator';
            }
        });
    }
    
    if (generateBtn) {
        generateBtn.addEventListener('click', function() {
            var params = {
                xStart: parseFloat($('#x-start').val()),
                xEnd: parseFloat($('#x-end').val()),
                yStart: parseFloat($('#y-start').val()),
                yEnd: parseFloat($('#y-end').val()),
                step: parseFloat($('#step').val()),
                speed: parseFloat($('#speed').val()),
                probeDepth: parseFloat($('#depth').val()),
                safeZ: parseFloat($('#safe-z').val()),
                input: parseInt($('#input').val()),
                startDelay: 10
            };
            
            var sbpCode = window.ProbeFileGenerator.generate(params);
            
            // NEED TO SET UP TO RUN after clearing QUEUE
            // Create file and submit as job
            var blob = new Blob([sbpCode], { type: 'text/plain' });
            fabmo.submitJob({
                file: blob,
                filename: 'probe_grid_' + Date.now() + '.sbp',
                name: 'Auto Probe Grid',
                description: 'Generated probe grid file'
            }, function(err, result) {
                if (err) {
                    fabmo.notify('error', 'Failed to submit job: ' + err);
                } else {
                    fabmo.notify('success', 'Probe file generated and submitted!');
                    generatorForm.style.display = 'none';
                    showGeneratorBtn.textContent = 'Show Generator';
                }
            });
        });
    }
    
    if (exportStlBtn) {
        exportStlBtn.addEventListener('click', function() {
            if (dataPoints.length === 0) {
                fabmo.notify('info', 'No data to export');
                return;
            }
            
            var stl = window.ProbeFileGenerator.exportSTL(dataPoints);
            var blob = new Blob([stl], { type: 'application/sla' });
            var url = window.URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'probe_data_' + Date.now() + '.stl';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            fabmo.notify('info', 'Exported ' + dataPoints.length + ' points to STL');
        });
    }
    
    if (exportXyzBtn) {
        exportXyzBtn.addEventListener('click', function() {
            if (dataPoints.length === 0) {
                fabmo.notify('info', 'No data to export');
                return;
            }
            
            var xyz = window.ProbeFileGenerator.exportPointCloud(dataPoints);
            var blob = new Blob([xyz], { type: 'text/plain' });
            var url = window.URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'probe_pointcloud_' + Date.now() + '.xyz';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            fabmo.notify('info', 'Exported ' + dataPoints.length + ' points as XYZ point cloud');
        });
    }
    
    if (exportSbpBtn) {
        exportSbpBtn.addEventListener('click', function() {
            if (dataPoints.length === 0) {
                fabmo.notify('info', 'No data to export');
                return;
            }
            
            // Show options dialog
            var rasterDir = confirm('Raster along X axis?\n\nOK = Raster along X (rows in Y direction)\nCancel = Raster along Y (columns in X direction)');
            
            var feedrate = prompt('Enter feedrate (units/sec):', '3.0');
            if (!feedrate) return;
            feedrate = parseFloat(feedrate);
            
            var safeZ = prompt('Enter safe Z height:', '1.0');
            if (!safeZ) return;
            safeZ = parseFloat(safeZ);
            
            var plungeSpeed = prompt('Enter plunge speed (units/sec):', '1.0');
            if (!plungeSpeed) return;
            plungeSpeed = parseFloat(plungeSpeed);
            
            var options = {
                rasterDirection: rasterDir ? 'x' : 'y',
                feedrate: feedrate,
                safeZ: safeZ,
                plungeSpeed: plungeSpeed
            };
            
            var sbp = window.ProbeFileGenerator.exportSBP(dataPoints, options);
            var blob = new Blob([sbp], { type: 'text/plain' });
            var url = window.URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'surface_map_' + Date.now() + '.sbp';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            fabmo.notify('success', 'Exported surface mapping SBP file');
        });
    }
    
    $('#status').text('Ready. Waiting for probe data...');
    console.log('Probe Logger ready');
});

console.log('Probe Logger script loaded');