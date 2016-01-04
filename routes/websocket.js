var fs = require('fs');
var util = require('../util');
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

	var client = util.getClientAddress(socket.client.request)
	log.info("Client " + client + " connected.");

	socket.on('disconnect', function() {
		log.debug("Client disconnected");
	});

	socket.on('status', function(data) {
		socket.emit('status', machine.status);
	});

	socket.on('code', function(data) {
		if('rt' in data) {
			try {
				machine.executeRuntimeCode(data.rt, data.data)
			} catch(e) {
				log.error(e);
			}
		}
	});

	socket.on('ping', function(data) {
		socket.emit('pong');
	});

	socket.on('cmd', function(data) {
		switch(data.name) {
			case 'pause':
				machine.pause();
				break;

			case 'quit':
				machine.quit();
				break;

			case 'resume':
				machine.resume();
				break;

			default:
				// Meh?
				break;
		}
	});
};

module.exports = function(server) {
	server.io.on('connection', onConnect);
	setupStatusBroadcasts(server.io.sockets);
};


