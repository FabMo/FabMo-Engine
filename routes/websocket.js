var util = require("../util");
var machine = require("../machine").machine;
var log = require("../log").logger("websocket");
var authentication = require("../authentication");
var sessions = require("client-sessions");
var parseCookie = require("./util").parseCookie;
var server = null;

// eslint-disable-next-line no-unused-vars
function setupAuthentication(svr) {
    server.io.of("/private").use(function (socket, next) {
        var handshakeData = socket.request;
        // Check that the cookie header is present
        if (!handshakeData.headers.cookie) {
            return next(new Error("No cookie transmitted."));
        }
        // Get all the cookie objects
        var cookie = parseCookie(handshakeData.headers.cookie);

        if (!cookie["session"]) {
            var err = new Error("No session provided.");
            log.error(err);
            return next(err);
        }
        // Pull out the user from the cookie by using the decode function
        handshakeData.sessionID = sessions.util.decode(
            {
                cookieName: "session",
                secret: server.cookieSecret,
            },
            cookie["session"]
        );

        log.debug("SessionID: " + JSON.stringify(handshakeData.sessionID));
        if (
            handshakeData.sessionID &&
            handshakeData.sessionID.content &&
            handshakeData.sessionID.content.passport !== undefined
        ) {
            var user = handshakeData.sessionID.content.passport.user;
            if (user != undefined) {
                authentication.getUserById(user, function (err, data) {
                    if (err) {
                        err = new Error(err);
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
                    err = new Error("Wrong session.");

                    return next(err);
                }
            }
        } else {
            //log.error("Session content is undefined or passport is missing.");
            //next(new Error("Session content is undefined or passport is missing."));
            next();
        }
    });
}

function setupStatusBroadcasts(server) {
    machine.on("status", function (status) {
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
        server.io.of("/private").emit("status", status);
        server.io.of("/").emit("status", status);
    });

    machine.on("change", function (topic) {
        server.io.of("/private").emit("change", topic);
        server.io.of("/").emit("change", topic);
    });
}

var onPublicConnect = function (socket) {
    var client_address = util.getClientAddress(socket.client.request);
    log.info("Anonymous client at " + client_address + " connected.");
    //    socket.emit("status", machine.status.clientDisconnected);
    global.CLIENT_DISCONNECTED = false;

    socket.on("disconnect", function () {
        log.debug("Client disconnected");
        //driver.status.clientDisconnected = true;  // Used only here for case of disconnect during Manual motion
        global.CLIENT_DISCONNECTED = true;
    });

    // eslint-disable-next-line no-unused-vars
    socket.on("status", function (data) {
        socket.emit("status", machine.status);
    });

    // eslint-disable-next-line no-unused-vars
    socket.on("ping", function (data) {
        socket.emit("pong");
    });
};

var onPrivateConnect = function (socket) {
    if (!socket.request.sessionID.content.passport) {
        log.info("disconnect - no passport");
        return socket.disconnect();
    }

    var userId = socket.request.sessionID.content.passport.user;

    authentication.eventEmitter.on("user_change", function (data) {
        socket.emit("user_change", data);
    });

    authentication.eventEmitter.on("user_kickout", function user_kickout_listener(user) {
        authentication.eventEmitter.removeListener("user_kickout", user_kickout_listener);
        if (user.username == userId) {
            socket.emit("authentication_failed", "kicked out");
            log.info("disconnect - kickedout auth");
            return socket.disconnect();
        }
    });

    var client_address = util.getClientAddress(socket.client.request);
    log.info("Client #" + userId + " at " + client_address + " connected.");

    socket.on("code", function (data) {
        var handshakeData = socket.request;
        var cookie = parseCookie(handshakeData.headers.cookie);
        handshakeData.sessionID = sessions.util.decode(
            {
                cookieName: "session",
                secret: server.cookieSecret,
            },
            cookie["session"]
        );

        if (!authentication.getCurrentUser() || authentication.getCurrentUser().username != userId) {
            log.error(userId);
            log.error(authentication.getCurrentUser());
            socket.emit("authentication_failed", "not authenticated");
            log.info("disconnect: authentication_failed, code");
            return socket.disconnect();
        } // make sure that if the user logout, he can't talk through the socket anymore.
        if ("rt" in data) {
            try {
                machine.executeRuntimeCode(data.rt, data.data);
            } catch (e) {
                log.error(e);
            }
        }
    });

    socket.on("cmd", function (data, callback) {
        if (!authentication.getCurrentUser() || authentication.getCurrentUser().username != userId) {
            log.error(userId);
            log.error(authentication.getCurrentUser());
            socket.emit("authentication_failed", "not authenticated");
            log.info("disconnect: authentication_failed, cmd");
            return socket.disconnect();
        } // make sure that if the user logouts, he can't talk through the socket anymore.
        log.debug("This Command = " + data.name);
        try {
            switch (data.name) {
                case "pause":
                    machine.pause(callback);
                    break;

                case "quit":
                    machine.quit(callback);
                    break;

                case "resume":
                    if (data.args && data.args.var && data.args.type && data.args.val) {
                        machine.resume(callback, {
                            var: { expr: data.args.var, type: data.args.type },
                            val: data.args.val,
                        });
                    } else {
                        machine.resume(callback);
                    }
                    break;

                default:
                    // TODO: Logging needed?  Error handling?
                    log.debug("command switch hit default");
                    break;
            }
        } catch (e) {
            log.error(e);
        }
    });

    socket.on("user_kickout", function (data) {
        console.error(data);
    });

    onPublicConnect(socket); // inherit routes from the public function
};

module.exports = function (svr) {
    server = svr;
    setupAuthentication(server);
    server.io.of("/").on("connection", onPublicConnect);
    server.io.of("/private").on("connection", onPrivateConnect);
    setupStatusBroadcasts(server);
};
