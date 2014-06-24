var g2 = require('./g2')
var PLATFORM = require('process').platform
var Engine = require('tingodb')(),
    assert = require('assert');


switch(PLATFORM) {

	case 'linux':
		path = '/dev/ttyACM0';
		break;

	case 'darwin':
		path = '/dev/cu.usbmodem001';
		break;

	default:
		path = null;
		break;
}

if(path) {
	machine = Machine(path);
	driver = machine.driver;
	//driver.on('message', function(msg) { console.log('G2_MSG:  ');console.log(msg);});
	driver.on('error', function(msg) { console.log('G2_ERR:  ' + msg) });
	//driver.on('status', function(msg) { console.log('G2_STAT: ');console.log(msg);});
	//driver.on('error', function(msg) {});
} else {
	machine = null;
	driver = null;
}

function Machine(path, callback) {
	// Handle Inheritance
	events.EventEmitter.call(this);

	// Instantiate driver and connect to G2
	this.state = "not_ready";
	this.driver = new g2.G2();
	this.driver.connect(path, function(err, data) {
		this.state = "idle";
		// The callback comes from a machine
		this.driver.requestStatusReport(function(err, result) {
			typeof callback === "function" && callback(false, this);
		});
	}.bind(this));
};
util.inherits(Machine, events.EventEmitter);

// Run the provided string
// callback runs only when execution is complete.
Machine.prototype.runString = function(string, callback) {
	if(this.state === 'idle') {
		this.state = "running";
		typeof callback === "function" && this.once('job_complete', callback);
		this.driver.runString();		
	} else {
		typeof callback === "function" && callback(true, "Cannot run when in '" + this.state + "' state.");		
	}
}

Machine.prototype._onG2StateChange = function(data) {
	old_state = data[0];
	new_state = data[1];

	switch(this.state) {
		case "not_ready":
			// This shouldn't happen.
			console.log("Got a state change event from G2 before ready");
			break;

		case "running":
			switch(old_state) {
				case g2.STAT_RUNNING:
					switch(new_state) {
						case g2.STAT_STOP:
							this.emit('job_complete', this);
							break;
						case g2.STAT_HOLDING:
							this.emit('job_pause', this);
							break;
					}
					break;
				case g2.STAT_HOLDING:
					switch(new_state) {
						case g2.STAT_RUNNING:
							this.emit('job_resume', this);
							break;
						case g2.STAT_STOP:
							this.emit('job_complete', this);
							break;
					}
					break;
			}
			break;
	}
}

exports.driver = driver;
exports.machine = machine;
