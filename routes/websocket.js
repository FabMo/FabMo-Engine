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
		socket.emit('status', machine.status);
	});

	socket.on('code', function(data) {
		if('rt' in data) {
			machine.executeRuntimeCode(data.rt, data.data)
		}
	});

	socket.on('ping', function(data) {
		socket.emit('pong');
	});
};

module.exports = function(server) {
	server.io.on('connection', onConnect);
	setupStatusBroadcasts(server.io.sockets);
};


