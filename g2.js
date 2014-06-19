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
var events = require('events');
var util = require('util');
var Queue = require('./util').Queue;
var config = require('./configuration')

// Constant Data
try {
	var G2_ERRORS = JSON.parse(fs.readFileSync('./data/g2_errors.json','utf8'));
} catch(e) {
	var G2_ERRORS = {};
}

// G2 Constructor
function G2() {
	this.current_data = new Array();
	this.status = {'state':'idle', 'posx':0, 'posy':0, 'posz':0};
	this.gcode_queue = new Queue();
	this.pause_flag = false;
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
	this.command({'qv':2});				// Configure queue reports to verbose
	this.requestStatusReport(); 		// Initial status check
	
	// Load the configuration file
	for(var i=0; i<config.length; i++) {
		this.command(config[i]);
	}
	
	// Flush 
	this.command("%\n");

	if (this.connect_callback && typeof(this.connect_callback) === "function") {
	    this.connect_callback();
	}
};
// request the status of G2
G2.prototype.requestStatusReport = function() { this.command({'sr':null}); }
//request a queue report of G2
G2.prototype.requestQueueReport = function() { this.command({'qr':null}); }

// Called for every chunk of data returned from G2
G2.prototype.onData = function(data) {
	var s = data.toString('ascii');
	var len = s.length;
	for(var i=0; i<len; i++) {
		c = s[i];
		if(c === '\n') {
			var json_string = this.current_data.join('');
		    try {
		    	obj = JSON.parse(json_string);
		    	this.onResponse(obj);
		    }catch(e){
		    	// A JSON parse error usually means the asynchronous LOADER SEGMENT NOT READY MESSAGE
		    	if(json_string.trim() === '######## LOADER - SEGMENT NOT READY') {
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

G2.prototype.handleQueueReport = function(r) {
	var MIN_FLOOD_LEVEL = 20;
	var MIN_QR_LEVEL = 5;

	if(this.pause_flag) {
		// If we're here, a pause is requested, and we don't send anymore g-codes.
		return;
	}
	var qr = r.qr;
	var qo = r.qo || 0;
	var qi = r.qi || 0;
	
	if((qr != undefined)) {
		var lines_to_send = 0 ;
		if(qr > MIN_FLOOD_LEVEL) {
			lines_to_send = qr;
		} else if((qo > 0)/* && (qr > MIN_QR_LEVEL)*/) {
			lines_to_send = qo;
		}  
		if(lines_to_send > 0) {
			//console.log('qi: ' + qi + '  qr: ' + qr + '  qo: ' + qo + '   lines: ' + lines_to_send);
			var cmds = [];
			while(lines_to_send > 0) {
				if(this.gcode_queue.isEmpty()) {break;}
				cmds.push(this.gcode_queue.dequeue());
				lines_to_send -= 1;
			}
			cmds.push('\n');
			var outstring = cmds.join('\n');
			this.port.write(outstring); 
			//console.log('    ' + cmds.join(' '));
		}
	}
}

G2.prototype.handleFooter = function(response) {
	if(response.f) {
		if(response.f[1] != 0) {
			var err_code = response.f[1];
			var err_msg = G2_ERRORS[err_code];
			this.emit('error', [err_code, err_msg[0], err_msg[1]]);
		}
	}
}
/*
0	machine is initializing
1	machine is ready for use
2	machine is in alarm state (shut down)
3	program stop or no more blocks (M0, M1, M60)
4	program end via M2, M30
5	motion is running
6	motion is holding
7	probe cycle active
8	machine is running (cycling)
9	machine is homing
*/
G2.prototype.handleStatusReport = function(response) {
	if(response.sr) {
		for (var key in response.sr) {
			this.status[key] = r.sr[key];
		}
		this.emit('status', response.sr);
		//console.log(this.status.stat);
		switch(this.status.stat) {
			case 0:
			case 1:
			case 4:
				this.status.state = 'idle';
				break;
			case 2:
			case 3:
				this.status.state = 'hold';
				break;
			case 6:
				this.status.state = 'limit';
				break;
			case 5:
			case 9:
				this.status.state = 'running';
				break;
			default:
				this.status.state = 'idle';
				break;
		} 
		this.emit('status', this.status);
	}

}
// Called once a proper JSON response is decoded from the chunks of data that come back from G2
G2.prototype.onResponse = function(response) {
	
	// TODO more elegant way of dealing with "response" data.
	if(response.r) {
		r = response.r;
	} else {
		r = response;
	}

	// Deal with streaming (if response contains a queue report)
	this.handleQueueReport(r);

	// Deal with footer
	this.handleFooter(response);

	this.handleStatusReport(response);
	// Deal with G2 status
	this.emit('status', r.sr);

	// Emitted everytime a message is received, regardless of content
	this.emit('message', response);
};

G2.prototype.feedHold = function(callback) {
	this.pause_flag = true;
	this.port.write('!'); // feedhold command character
}

G2.prototype.resume = function() {
	if(this.pause_flag) {
		this.port.write('~\n'); //cycle start command character
		this.pause_flag = false;
		this.requestQueueReport();
	} else {
		//console.log('SKIPPING RESUME BECAUSE TOOL IS NOT PAUSED');
	}
}

G2.prototype.quit = function() {
/*
	this.gcode_queue.clear();
	if(this.pause_flag) {
		console.log('just clearing the queue because we"re paused')
		this.port.write('\n%\n'); // Queue Flush command character
		console.log('thats better');
		this.pause_flag = false;
		this.requestStatusReport();
	} else {
		this.port.write('!%');
		this.pause_flag = false;
		this.requestStatusReport();
	}
	*/
	//TODO: Fix this function, not working currently.
	// what about deenergize all the motors ?
}


// Send a command to G2
G2.prototype.command = function(obj) {
	if((typeof obj) == 'string') {
		var cmd = obj.trim();
	} else {
		var cmd = JSON.stringify(obj);
	}
	this.port.write(cmd + '\n');
};

// Send a g-code line to G2 (just a plain old string)
G2.prototype.gcode = function(s) {
	this.port.write(s.trim() + '\n');
	this.requestStatusReport();
};

G2.prototype.runString = function(data) {
	lines = data.split('\n');
	for(var i=0; i<lines.length; i++) {
		line = lines[i].trim();
		if(line != '') {
			this.gcode_queue.enqueue(line);
		}
	}
	this.gcode_queue.enqueue('M2');
	this.pause_flag = false;
	this.command({'qr':null})
};

G2.prototype.runFile = function(filename) {
	fs.readFile(filename, 'utf8', function (err,data) {
		  if (err) {
		    return console.log(err);
		  }
		  this.runString(data);
		}.bind(this));
};


// export the class
exports.G2 = G2;
