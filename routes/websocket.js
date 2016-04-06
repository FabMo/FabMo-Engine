var fs = require('fs');
var util = require('../util');
var machine = require('../machine').machine;
var log=require('../log').logger("websocket");
var passport = require('../authentication').passport;
var sessions = require("client-sessions");
var parseCookie = require('./util').parseCookie;

var clients_limit = 5;
var nb_clients=0;


function setupAuthentication(server){
	server.io.of('/private').use(function (socket, next) {
		var handshakeData = socket.request;
    // Check that the cookie header is present
    if (!handshakeData.headers.cookie) {
    	return next(new Error('No cookie transmitted.'));
    }
    // Get all the cookie objects
    var cookie = parseCookie(handshakeData.headers.cookie);

		if(!cookie['session']){
			return next(new Error('No session provided.'));
		}
    // Pull out the user from the cookie by using the decode function
    handshakeData.sessionID = sessions.util.decode({cookieName: 'session', secret:server.cookieSecret}, cookie['session']);

		if(!handshakeData.sessionID){
			return next(new Error('Wrong session'));
		}
    next();
	});
}

function setupStatusBroadcasts(server){
	var previous_status = {'state':null}
	machine.on('status',function(status){

		server.io.of('/private').sockets.forEach(function (socket) {
			if(status.state === 'idle' || status.state != previous_status.state) {
				socket.emit('status',status);
			} else {
				socket.volatile.emit('status', status);
			}
		});

		server.io.sockets.sockets.forEach(function (socket) {
			if(status.state === 'idle' || status.state != previous_status.state) {
				socket.emit('status',status);
			} else {
				socket.volatile.emit('status', status);
			}
		});
		previous_status.state = status.state;
	});

	machine.on('change', function(topic) {
		server.io.sockets.sockets.forEach(function (socket) {
			socket.emit('change',topic);
		});
	});
}


var onPublicConnect = function(socket) {
	var client_address = util.getClientAddress(socket.client.request)
	log.info("Anonymous client at "+ client_address + " connected.");

	socket.on('disconnect', function() {
		log.debug("Client disconnected");
	});

	socket.on('status', function(data) {
		socket.emit('status', machine.status);
	});

	socket.on('ping', function(data) {
		socket.emit('pong');
	});

};


var onPrivateConnect = function(socket) {
	console.log("connected through private mode !")
	var userId = socket.request.sessionID.content.passport.user;
	var client_address = util.getClientAddress(socket.client.request)
	log.info("Client #"+userId+" at "+ client_address + " connected.");

	socket.on('code', function(data) {
		if('rt' in data) {
			try {
				machine.executeRuntimeCode(data.rt, data.data)
			} catch(e) {
				log.error(e);
			}
		}
	});

	socket.on('cmd', function(data) {
		try {
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
		} catch(e) {
			// pass
		}
	});

	onPublicConnect(socket); // inherit routes from the public function

};

module.exports = function(server) {
	setupAuthentication(server);
	server.io.on('connection', onPublicConnect);
	server.io.of('/private').on('connection', onPrivateConnect);
	setupStatusBroadcasts(server);
};
