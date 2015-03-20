var fs = require('fs');
var machine = require('../machine').machine;
var log=require('../log').logger("websocket");
var socketio = require('socket.io');
var clients_limit = 1;
var nb_clients=0;



function bind_status_report(socket){
	machine.on('status',function(status){
		socket.broadcast.emit('status',status);
	});
}





connect = function(socket) {
	log.debug("new client by websocket");
	nb_clients++;
	if (nb_clients<=clients_limit){ // avoid too many connection on the app.
		socket_main(socket);
	}
	socket.on('disconnect', function() {
		log.debug("client disconnected");
		nb_clients--;
	});
};


function socket_main(socket){
	bind_status_report(socket);
}


module.exports = function(server) {
	server.io.on('connection', connect);
};


