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

function exportCSV() {
    if (dataPoints.length === 0) {
        console.log('No data to export');
        fabmo.notify('info', 'No data to export');
        return;
    }
    
    var csv = 'Index,Channel,X,Y,Z,Data,Timestamp\n';
    
    dataPoints.forEach(function(point, index) {
        var x = point.position ? point.position.x : '';
        var y = point.position ? point.position.y : '';
        var z = point.position ? point.position.z : '';
        var data = point.data ? JSON.stringify(point.data).replace(/"/g, '""') : '';
        var timestamp = new Date(point.timestamp).toISOString();
        
        csv += (index + 1) + ',' + point.channel + ',' + x + ',' + y + ',' + z + ',"' + data + '",' + timestamp + '\n';
    });
    
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
    console.log('CSV exported:', dataPoints.length, 'points');
}

function exportJSON() {
    if (dataPoints.length === 0) {
        console.log('No data to export');
        fabmo.notify('info', 'No data to export');
        return;
    }
    
    var exportData = {
        metadata: {
            exportDate: new Date().toISOString(),
            pointCount: dataPoints.length,
            channels: Array.from(channels)
        },
        points: dataPoints
    };
    
    var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'probe_data_' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    fabmo.notify('info', 'Exported ' + dataPoints.length + ' points to JSON');
    console.log('JSON exported:', dataPoints.length, 'points');
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
    
    if (clearBtn) {
        clearBtn.addEventListener('click', clearData);
    }
    
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', exportCSV);
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
    
    $('#status').text('Ready. Waiting for probe data...');
    console.log('Probe Logger ready');
});

console.log('Probe Logger script loaded');