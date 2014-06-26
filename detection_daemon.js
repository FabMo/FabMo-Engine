var os=require('os');
var util=require('util');
var EventEmitter = require('events').EventEmitter;
var dgram = require('dgram');

var OK = "YES I M !\0";
var ERR = "I DNT UNDRSTND !\0";
var HOSTNAME = "U NAME ?\0";
var REQ = "R U A SBT ?\0";
var default_port = 24862; // = 7777 without conversion

var start = function(port) {
	var socket = dgram.createSocket('udp4');
	var that = this;
	var Port= port || default_port;
	
		socket.bind(Port);
		
		socket.on("message", function ( data, rinfo ) {
			console.log('scan in progress by '+ rinfo.address);
			if(data.toString() == REQ)
			{
				console.log("are you a sbt asked");
				socket.send(new Buffer(OK), 0, OK.length, Port, rinfo.address, function (err) {
							if (err) console.log(err);
							console.log("reply yes");
						});
			}
			else if(data.toString() == HOSTNAME) // if the device is a sbt, continue the dialog.
			{
				console.log("hostname");
				var result = {};
				result.hostname= os.hostname();
				result.networks=[];
				os.networkInterfaces().forEach(function(val,key,arr){ //val = ip adresses , key = name of interface
					val.forEach(function(val2,key2,arr2){
						if (val2.internal === false && val2.family === 'IPv4')
						{
							result.networks.push({'interface' : key , 'ip_address' : val2.address});
						}
					});
				});
				socket.send(new Buffer(JSON.stringify(result)), 0, JSON.stringify(result).length, Port, rinfo.address, function (err) {
					if (err) console.log(err);
							//console.log("ask info");
					});
				that.emit('client_scan',rinfo.address);
			}
			else
			{
				console.log("[detection_tool.js] received from "+rinfo.address+" : unknow message : '"+ data.toString() +"'");
			}
		});



	//this.on('newListener', function(listener) {});

};
util.inherits(start , EventEmitter);
module.exports.start = start;