var fs = require('fs');
var machine = require('../machine').machine;
var log=require('../log').logger("websocket");
var socketio = require('socket.io');
var clients_limit = 5;
var nb_clients=0;


function broadcast_status_report(clients_sockets){
	machine.on('status',function(status){
		clients_sockets.emit('status',status);
	});
}

connect = function(socket) {
	nb_clients++;
	if (nb_clients<=clients_limit){ // avoid too many connection on the app.
		socket_main(socket);
		socket.emit('status', machine.status)
	}
	socket.on('disconnect', function() {
		socket_close(socket);
		nb_clients--;
	});
};

function socket_main(socket){
	log.debug("client connected");
}

function socket_close(socket){
	log.debug("client disconnected");
}


module.exports = function(server) {
	server.io.on('connection', connect);
	broadcast_status_report(server.io.sockets);
};


