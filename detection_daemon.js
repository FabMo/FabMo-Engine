var os=require('os');
var util=require('util');
var EventEmitter = require('events').EventEmitter;
var dgram = require('dgram');
var log = require('./log').logger('detection');
var settings = require('./settings');

var OK = "YES I M !\0";
var ERR = "I DNT UNDRSTND !\0";
var HOSTNAME = "U NAME ?\0";
var REQ = "R U A SBT ?\0";
var default_port = 24862; // = 7777 without conversion

var start = function(port) {
	var socket = dgram.createSocket('udp4');
	var that = this;
	var Port = port || default_port;	
		socket.bind(Port);
		
		socket.on("message", function ( data, rinfo ) {
			if(data.toString() == REQ)
			{
				log.info('scan in progress by '+ rinfo.address);
				socket.send(new Buffer(OK), 0, OK.length, rinfo.port, rinfo.address, function (err) {
							if (err) {
								console.log(err);
							}
							else {
								//console.log("reply yes to "+rinfo.address+" on port "+rinfo.port);
							}
						});
			}
			else if(data.toString() == HOSTNAME) // if the device is a sbt, continue the dialog.
			{
				//console.log("hostname asked");
				var result = {};
				result.hostname= os.hostname();
				result.networks=[];
				result.port = settings.server_port;
				Object.keys(os.networkInterfaces()).forEach(function(key,index,arr){ //val = ip adresses , key = name of interface
					var networks_list = this;
					networks_list[key].forEach(function(val2,key2,arr2){
						if (val2.internal === false && val2.family === 'IPv4')
						{
							result.networks.push({'interface' : key , 'ip_address' : val2.address});
						}
					});
				},os.networkInterfaces());
				socket.send(new Buffer(JSON.stringify(result)), 0, JSON.stringify(result).length, rinfo.port, rinfo.address, function (err) {
					if (err) log.error(err);
							//console.log("ask info");
					});
				that.emit('client_scan',rinfo.address);
			}
			else
			{
				log.info("[detection_tool.js] received from "+rinfo.address+" : unknown message : '"+ data.toString() +"'");
			}
		});



	this.on('newListener', function(listener) {});

};
util.inherits(start , EventEmitter);
module.exports = start;
