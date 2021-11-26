var fs = require('fs');
var util = require('../util');
var machine = require('../machine').machine;
var log=require('../log').logger("websocket");
var authentication = require('../authentication');
var passport = authentication.passport;
var sessions = require("client-sessions");
var parseCookie = require('./util').parseCookie;
var server = null;
var clients_limit = 5;
var nb_clients=0;

function setupAuthentication(svr) {
	log.info("setup of /private setupAuthentication function invoked"); //rmackie
	server.io.of('/private').use(function(socket, next) {
		log.info("/private authentication callback function invoked");      //rmackie
		var handshakeData = socket.request;
        // Check that the cookie header is present
        if (!handshakeData.headers.cookie) {
            return next(new Error('No cookie transmitted.'));
        }
        // Get all the cookie objects
		var cookie = parseCookie(handshakeData.headers.cookie);

        if (!cookie['session']) {
            var err = new Error('No session provided.');
            log.error(err);
            return next(err);
        }
        // Pull out the user from the cookie by using the decode function
        handshakeData.sessionID = sessions.util.decode({
            cookieName: 'session',
			secret: server.cookieSecret
		}, cookie['session']);
        if (handshakeData.sessionID.content.passport !== undefined) {
                var user = handshakeData.sessionID.content.passport.user;
                authentication.getUserById(user, function(err, data) {

                    if (err) {
						var err = new Error(err);
           				log.error(err);
						// delete socket.request.headers.cookie;
            			return next(err);
                    } else {
						authentication.setCurrentUser(data);
						next();
                    }
                });
                // authentication.configure();
                if (!handshakeData.sessionID) {
                    var err = new Error('Wrong session.');

                    return next(err);
                }
        } else {
            next();
        }
    });
}

function setupStatusBroadcasts(server) {

	machine.on('status', function(status) {
		//Add Server Timestamp to status updates
		status.server_ts = Date.now();
		/*
		  decoding the "emit" statements below due how many layers there are:
			e.g.: server.io.of('/private').emit('status', status);
			* "server" is a websocket object that has been passed in
			* "io" is the socket.io data member of server
			* "server.io.of('/someString')" is a function on socket.io that returns
				a server.io NameSpace object associated with "/someString"
					where the string: '/' is the default namespace.
			NameSpace objects use "emit" to send to all the sockets that are in their space
		*/
			log.debug("rmackie: /private socket emit status");
			server.io.of('/private').emit('status', status);

			log.debug("rmackie: socket emit status");
			server.io.of('/').emit('status', status);
	});

	machine.on('change', function(topic) {
		log.debug("rmackie:" + 'Change broadcast');
		log.debug("rmackie:" + JSON.stringify(status));

		server.io.of('/private').emit('change', topic);
		server.io.of('/').emit('change', topic);
	});
}


var onPublicConnect = function(socket) {
	var client_address = util.getClientAddress(socket.client.request)
	log.info("Anonymous client at "+ client_address + " connected.");

	socket.on('disconnect', function() {
		log.debug("Client disconnected");
	});

	socket.on('status', function(data) {
        log.debug("rmackie: PUBLIC CONNECT status sent");
		socket.emit('status', machine.status);
	});

	socket.on('ping', function(data) {
		socket.emit('pong');
	});


};


var onPrivateConnect = function(socket) {	

	log.info("Private client connected."); //rmackie

	if(!socket.request.sessionID.content.passport) {
        log.info("disconnect - no passport");
		return socket.disconnect();
	}
		
	var userId = socket.request.sessionID.content.passport.user;

	authentication.eventEmitter.on('user_change', function(data){
		socket.emit('user_change', data);
	});

	authentication.eventEmitter.on('user_kickout',function user_kickout_listener(user){
		authentication.eventEmitter.removeListener('user_kickout',user_kickout_listener);
		if(user.username == userId){
			socket.emit('authentication_failed','kicked out');
            log.info("disconnect - kickedout auth");
			return socket.disconnect();
		}
	});

	var client_address = util.getClientAddress(socket.client.request)
	log.info("Client #"+userId+" at "+ client_address + " connected.");

	socket.on('code', function(data) {
		var handshakeData = socket.request;
		var cookie = parseCookie(handshakeData.headers.cookie);
		handshakeData.sessionID = sessions.util.decode({
            cookieName: 'session',
			secret: server.cookieSecret
		}, cookie['session']);
		var user = handshakeData.sessionID;

		if(!authentication.getCurrentUser() || authentication.getCurrentUser().username != userId){
			log.error(userId);
			log.error(authentication.getCurrentUser());
			socket.emit('authentication_failed','not authenticated');
			log.info('disconnect: authentication_failed, code');
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
		if(!authentication.getCurrentUser() || authentication.getCurrentUser().username != userId){
			log.error(userId);
			log.error(authentication.getCurrentUser());
			socket.emit('authentication_failed','not authenticated');
			log.info('disconnect: authentication_failed, cmd');
			return socket.disconnect();
		} // make sure that if the user logouts, he can't talk through the socket anymore.
		log.debug('This Command = ' + data.name);
		try {
			switch(data.name) {
				case 'pause':
					machine.pause(callback);
					break;

				case 'quit':
					machine.quit(callback);
					break;

				case 'resume':
					if (data.args && data.args.var && data.args.type && data.args.val) {
						machine.resume(callback, {'var':{'expr':data.args.var, 'type':data.args.type}, 'val':data.args.val});
					}
					machine.resume(callback);
					break;

				default:
					// TODO: Logging needed?  Error handling?
					log.debug("command switch hit default");
					break;
			}
		} catch(e) {
			log.error(e);
		}
	});

	socket.on('user_kickout', function(data){
		console.error(data);
	});

	onPublicConnect(socket); // inherit routes from the public function

};

module.exports = function(svr) {
	server = svr
	setupAuthentication(server);
	server.io.of('/').on('connection', onPublicConnect);
	server.io.of('/private').on('connection', onPrivateConnect);
	setupStatusBroadcasts(server);
};

