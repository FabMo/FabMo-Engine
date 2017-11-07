var fs = require('fs');
var util = require('../util');
var machine = require('../machine').machine;
var log=require('../log').logger("websocket");
var authentication = require('../authentication');
var User = require('../db').User;
var passport = authentication.passport;
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
			var err = new Error('No session provided.');
			log.error(err);
			console.dir(cookie);
			return next(err);
		}
    // Pull out the user from the cookie by using the decode function
	handshakeData.sessionID = sessions.util.decode({cookieName: 'session', secret:server.cookieSecret}, cookie['session']);
	//console.log(handshakeData);
		var user = handshakeData.sessionID.content.passport.user;
		authentication.getUserById(user, function (err, data){
			if (err){
				log.error(err);
			} else {
				authentication.setCurrentUser(data);
			}
		});
		// authentication.configure();
		if(!handshakeData.sessionID){
			var err = new Error('Wrong session.');
			log.error(err);
			console.dir(handshakeData)
			console.dir(cookie)
			return next(err);
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
		server.io.of('/private').sockets.forEach(function (socket) {
			socket.emit('change',topic);
		});
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
	//console.log("connected through private mode !")

	if(!socket.request.sessionID.content.passport)
		return socket.disconnect();

	var userId = socket.request.sessionID.content.passport.user;

	authentication.eventEmitter.on('user_change', function(data){
		socket.emit('user_change', data);
	});

	authentication.eventEmitter.on('user_kickout',function user_kickout_listener(user){
		authentication.eventEmitter.removeListener('user_kickout',user_kickout_listener);
		//console.log("user kickout event");
		if(user._id == userId){
			socket.emit('authentication_failed','kicked out');
			console.dir(authentication.getCurrentUser());
			console.dir(userId);
			return socket.disconnect();
		}
	});

	var client_address = util.getClientAddress(socket.client.request)
	log.info("Client #"+userId+" at "+ client_address + " connected.");

	socket.on('code', function(data) {

		if(!authentication.getCurrentUser() || authentication.getCurrentUser()._id != userId){
			log.error(userId);
			log.error(authentication.getCurrentUser());
			socket.emit('authentication_failed','not authenticated');
			console.dir(authentication.getCurrentUser());
			console.dir(userId);
			return socket.disconnect();
		} // make sure that if the user logout, he can't talk through the socket anymore.
		if('rt' in data) {
			try {
				machine.executeRuntimeCode(data.rt, data.data)
			} catch(e) {
				log.error(e);
			}
		}
	});

	socket.on('cmd', function(data, callback) {
		if(!authentication.getCurrentUser() || authentication.getCurrentUser()._id != userId){
			log.error(userId);
			log.error(authentication.getCurrentUser());
			socket.emit('authentication_failed','not authenticated');
			return socket.disconnect();
		} // make sure that if the user logout, he can't talk through the socket anymore.
		try {
			switch(data.name) {
				case 'pause':
					machine.pause(callback);
					break;

				case 'quit':
					machine.quit(callback);
					break;

				case 'resume':
					machine.resume(callback);
					break;

				default:
					// Meh?
					break;
			}
		} catch(e) {
			// pass
		}
	});

	socket.on('user_kickout', function(data){
		console.error(data);
	});



	onPublicConnect(socket); // inherit routes from the public function

};

module.exports = function(server) {
	setupAuthentication(server);
	server.io.on('connection', onPublicConnect);
	server.io.of('/private').on('connection', onPrivateConnect);
	setupStatusBroadcasts(server);
};
