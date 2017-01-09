var fs = require('fs');
var serialport = require('serialport');
var jsesc = require('jsesc');

var CONTROL_PATH = '/dev/ttyACM0';
var DATA_PATH = '/dev/ttyACM1';
var FLIGHT_RECORD_PATH = '/opt/fabmo/log/g2-flight-log.json';

function loadFlightRecord(filename, callback) {
  fs.readFile(filename, function(err, data) {
    if(err) { return callback(err); }
    flightData = JSON.parse(data);
    callback(null, flightData);
  });
}

control_port = new serialport.SerialPort(CONTROL_PATH, {rtscts:true}, false);
control_buffer = [];
data_port = new serialport.SerialPort(DATA_PATH, {rtscts:true}, false);
data_buffer = [];

var onControlData = function(data) {
	var s = data.toString('utf8');
	var len = s.length;
	for(var i=0; i<len; i++) {
		c = s[i];
		if(c === '\n') {
			console.log(' <--C-- ' + control_buffer.join(''));
			control_buffer = [];
		} else {
			control_buffer.push(c);
		}
	}
};

function connect(callback) {
  control_port.open(function(err) {
    if(err) { return callback(err); }
    control_port.on('data', onControlData);

    if(this.control_port !== this.gcode_port) {
      data_port.open(function(err) {
        if(err) { return callback(err); }
        callback();
      });
    } else {
      callback();
    }
  });
}

function replay(records, callback) {
  var startTime = new Date().getTime();
  function consume(records) {
    if(records.length === 0) {
      return callback();
    }

    var record = records[0];
    if(record.dir === 'out') {
      var currentTime = new Date().getTime() - startTime;
      var recordTime = record.t;
      var timeLeft = recordTime - currentTime;
      // Sleep until it's time to execute this record
      if(timeLeft >= 0) {
        setTimeout(consume, timeLeft, records);
      } else {
        // Consume the record
        records.shift()

        // Decode the data payload
        var data = new Buffer(record.data, 'base64').toString('utf8');

        // Write it to the appropriate channel
        switch(record.ch) {
          case 'C':
            console.log(' ---C-> ' + jsesc(data));
            control_port.write(data);
            break;
          case 'D':
            console.log(' ---D-> ' + jsesc(data));
            data_port.write(data);
            break;
          default:
            console.error("Unknown channel in flight data: " + record.ch);
            break;
        }
        setImmediate(consume, records);
      }
    } else {
      records.shift();
      setImmediate(consume, records);
    }
  }
  consume(records);
}
loadFlightRecord(FLIGHT_RECORD_PATH, function(err, flightData) {
  if(err) { return console.error(err); }
  connect(function(err, data) {
      replay(flightData.records, function() {
        console.log("Replay complete.")
        process.exit();
      })
  });
});
