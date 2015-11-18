var fs = require('fs');
var machine = require('../machine').machine;
var log=require('../log').logger("websocket");
var clients_limit = 5;
var nb_clients=0;


function setupStatusBroadcasts(clients_sockets){
	machine.on('status',function(status){
		clients_sockets.emit('status',status);
	});
}

var onConnect = function(socket) {

	log.debug("Client connected");

	socket.emit('status', machine.status)

	socket.on('disconnect', function() {
		log.debug("Client disconnected");
	});

	socket.on('status', function(data) {
		console.log("Emitting status message as requested.")
		socket.emit('status', machine.status);
	});

	socket.on('code', function(data) {
		if('rt' in data) {
			machine.executeRuntimeCode(data.rt, data.data)
		}
	});
};

module.exports = function(server) {
	server.io.on('connection', onConnect);
	setupStatusBroadcasts(server.io.sockets);
};


