/*
 * g2.js
 * 
 * TinyG2 driver for node.js
 * 
 * Dependencies: serialport
 *
 */
var serialport = require("serialport");
var fs = require("fs");
var lazy = require("lazy");
var events = require('events');
var util = require('util');
var Queue = require('./util').Queue;

// Constant Data
try {
	var G2_ERRORS = JSON.parse(fs.readFileSync('./data/g2_errors.json','utf8'));
} catch(e) {
	var G2_ERRORS = {};
}

// G2_SKID is how much space is left in the planner buffer before we STOP sending G-Code Lines
// There are as many as four planner buffer slots occupied by each g-code line
// So for now, 5 is a good number
G2_SKID = 5;

// G2 Constructor
function G2() {
	this.current_data = new Array();
	this.status = {'state':'idle'};
	this.gcode_queue = new Queue();
  	events.EventEmitter.call(this);	
};
util.inherits(G2, events.EventEmitter);

G2.prototype.connect = function(path, callback) {
	this.path = path;
	this.connect_callback = callback;
 	this.port = new serialport.SerialPort(path);
	this.port.on("open", this.onOpen.bind(this));
}

// Called when the serial port is actually opened.
G2.prototype.onOpen = function(callback) {
	// prototype.bind makes sure that the 'this' in the method is this object, not the event emitter
	this.port.on('data', this.onData.bind(this));
	this.command({'qv':1});				// Configure queue reports
	this.requestStatusReport(); 		// Initial status check
	if (this.connect_callback && typeof(this.connect_callback) === "function") {
	    this.connect_callback();
	}
};

G2.prototype.requestQueueReport = function() { this.command({'qv':2}); }
G2.prototype.requestStatusReport = function() { this.command({'sr':null}); }

// Called for every chunk of data returned from G2
G2.prototype.onData = function(data) {
	var s = data.toString('ascii');
	var len = s.length;
	for(var i=0; i<len; i++) {
		c = s[i];
		if(c == '\n') {
			var json_string = this.current_data.join('');
		    try {
		    	obj = JSON.parse(json_string);
		    	this.onResponse(obj);
		    }catch(e){
		    	// A JSON parse error usually means the asynchronous LOADER SEGMENT NOT READY MESSAGE
		    	if(json_string.trim() == '######## LOADER - SEGMENT NOT READY') {
		    		this.emit('error', [-1, 'LOADER_SEGMENT_NOT_READY', 'Asynchronous error: Segment not ready.'])
		    	} else {
		    		this.emit('error', [-1, 'JSON_PARSE_ERROR', 'Could not parse response: ' + json_string + '(' + e.toString() + ')'])
		    	}
		    }
			this.current_data = new Array();
		} else {
			this.current_data.push(c);			
		}
	}
};

// Called once a proper JSON response is decoded from the chunks of data that come back from G2
G2.prototype.onResponse = function(response) {
	
	// Deal with errors first.
	if(response.f) {
		if(response.f[1] != 0) {
			var err_code = response.f[1];
			var err_msg = G2_ERRORS[err_code];
			this.emit('error', [err_code, err_msg[0], err_msg[1]]);
		}		
	}

	// TODO more elegant way of dealing with "response" data.
	if(response.r) {
		r = response.r;
	} else {
		r = response;
	}

	// Handle a queue report, which determines how much g-code we're allowed to send.
	qr = r.qr;
	if (qr != undefined) {
		while(qr > G2_SKID) {
			if(this.gcode_queue.isEmpty()) {break;}
			this.gcode(this.gcode_queue.dequeue())
		}
	}

 	// Deal with G2 status
	if(r.sr) {
		for (var key in r.sr) {
		    this.status[key] = r.sr[key];
		}

		switch(this.status.stat) {
			case 1:
				this.status.state = 'idle';
				break;
			case 5:
				this.status.state = 'running';
				break;
			case 4:
				this.status.state = 'idle';
				break;
			case 3:
				this.status.state = 'idle';
				break;
			default:
				this.status.state = 'idle';
				break;
		} 
		this.emit('status', this.status);
	}
	this.emit('message', response);

};

// Send a command to G2 (accepts javascript object and converts to JSON)
G2.prototype.command = function(obj) {
	var cmd = JSON.stringify(obj) + '\n';
	this.port.write(cmd);
};

// Send a g-code line to G2 (just a plain old string)
G2.prototype.gcode = function(s) {
	this.port.write(s.trim() + '\n');
};

// Read a file from disk and stream it to the device
// TODO: Might be more efficient not to do lazy evalulation of the file and just read the whole thing
//       especially for highly segmented moves that might thrash the disk
G2.prototype.runFile = function(filename) {
	fs.readFile(filename, 'utf8', function (err,data) {
		  if (err) {
		    return console.log(err);
		  }
		  lines = data.split('\n');
		  for(var i=0; i<lines.length; i++) {
		  	this.gcode_queue.enqueue(lines[i]);
		  }

		  this.command({'qr':null});
		  //this.requestQueueReport();
		}.bind(this));
	};

// export the class
exports.G2 = G2;
