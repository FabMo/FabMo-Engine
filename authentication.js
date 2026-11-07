/*
 * authentication.js
 *
 * Manages user authentication to access the FabMo dashboard
 */
var passport = require("passport-restify");
var LocalStrategy = require("passport-local").Strategy;
var config = require("./config");
var machine = require("./machine");
var events = require("events");
var userConfig = require("./config/user_config");
var eventEmitter = new events.EventEmitter();

// Build the canonical user object handed around the system from a stored
// record. role normalizes from isAdmin for records predating the field.
function publicUser(username, data) {
    var role = userConfig.normalizeRole(data);
    return {
        username: username,
        password: data.password,
        isAdmin: role === "admin",
        role: role,
        created_at: data.created_at,
    };
}

// FabMo is a single-user system, and this variable keeps track of the current one.
var currentUser = null;
var userTimer = 5 * 60 * 1000; // 5 minutes
var currentUserTimer = null;
var isCurrentUserKickeable = false;
var userToKickout = undefined;

function startUserTimer() {
    currentUserTimer = setTimeout(userTimeout, userTimer);
}

function resetUserTimer() {
    clearTimeout(currentUserTimer);
    currentUserTimer = startUserTimer();
}

function userTimeout() {
    isCurrentUserKickeable = true;
}

// This function is never called, do we need it? Commenting out to observe result
// function logOutUser(user) {
//     var property = "user";
//     if (this._passport && this._passport.instance) {
//         property = this._passport.instance._userProperty || "user";
//     }

//     this[property] = null;
//     if (this._passport && this._passport.session) {
//         delete this._passport.session.user;
//     }
// }

exports.configure = function () {
    passport.use(
        new LocalStrategy({ passReqToCallback: true }, function (
            req,
            username,
            password,
            done
        ) {
            config.user.findOne(username, function (err, data) {
                if (err) {
                    return done(err);
                }
                if (!data) {
                    return done(null, false, {
                        message: "Incorrect username.",
                    });
                }
                if (!config.user.validPassword(username, password)) {
                    return done(null, false, {
                        message: "Incorrect password.",
                    });
                }

                var user = publicUser(username, data);
                // success ! the usert that did the request is registered in the database.

                // check if the user can take the control of the tool.

                if (userToKickout && userToKickout.username === username) {
                    // the freshly kicked out user is doing a request.
                    //no boy. you can't do that anymore.
                    req.logout(); // remove his session information.
                    userToKickout = undefined;
                    return done(null, false, {
                        message:
                            "you have been kicked by user " +
                            currentUser.username +
                            ".",
                    });
                }

                if (currentUser && currentUser.username !== username) {
                    // a user is already connected
                    if (req.params.kickout !== true) {
                        // there is no request to kick the current user out.
                        return done(null, false, {
                            message:
                                "The user " +
                                currentUser.username +
                                " is already controlling the tool",
                            userAlreadyLogedIn: true,
                        });
                    }

                    /****************************** Check the kickoutability of the user already connected ****************/
                    if (!user.isAdmin) {
                        // the user that wants to connect is not admin
                        if (currentUser.isAdmin) {
                            //you can't kick out an admin if your a simple user
                            return done(null, false, {
                                message:
                                    "The user " +
                                    currentUser.username +
                                    " is an admin.",
                            });
                        }
                        if (!isCurrentUserKickeable) {
                            //you can't kick out a user that is actively using the tool.
                            return done(null, false, {
                                message:
                                    "The user " +
                                    currentUser.username +
                                    " is still active.",
                            });
                        }
                        if (machine.machine.status.state === "running") {
                            //you can't kick a user that is running a file.
                            return done(null, false, {
                                message:
                                    "The user " +
                                    currentUser.username +
                                    " is running a file.",
                            });
                        }
                    }
                    userToKickout = currentUser;
                    eventEmitter.emit("user_kickout", currentUser);
                    currentUser = user;
                    isCurrentUserKickeable = false;
                    startUserTimer();

                    return done(null, user);
                    /*****************************r*************************************************************************/
                }

                if (!currentUser) {
                    // first authentication
                    //We can login the user !
                    currentUser = user;
                    isCurrentUserKickeable = false;
                    startUserTimer();
                }
                return done(null, user);
            });
        })
    );
};

var addUser = function (username, password, callback, role) {
    if (role !== undefined && userConfig.ROLES.indexOf(role) === -1) {
        callback("Unknown role: " + role);
        return;
    }
    config.user.add(
        username,
        password,
        function (err, user) {
            if (err) {
                callback(err);
                return;
            } else {
                user = publicUser(username, (user && user[username]) || {});
                user.password = undefined; // remove password from user object.
                callback(null, user);
            }
        },
        role
    );
};

// True when `username` is the only admin account — the one you must never
// demote or delete, or nobody can manage the tool anymore.
var isLastAdmin = function (username, callback) {
    config.user.getAll(function (data) {
        var admins = [];
        for (var key in data) {
            if (userConfig.normalizeRole(data[key]) === "admin") {
                admins.push(key);
            }
        }
        callback(admins.length === 1 && admins[0] === username);
    });
};

var getUsers = function (callback) {
    var users = [];
    config.user.getAll(function (data) {
        for (var key in data) {
            var user = publicUser(key, data[key]);
            user.password = undefined;
            users.push(user);
        }
        callback(null, users);
    });
};

var getUser = function (username, callback) {
    if (!username) {
        callback(null, currentUser);
        return;
    }
    config.user.findOne(username, function (err, data) {
        if (data) {
            var user = publicUser(username, data);
            user.password = undefined; // remove password from user object.
            callback(null, user);
        } else {
            callback(err);
        }
    });
};

var modifyUser = function (username, user_fields, callback) {
    // Refuse to demote the only admin — there'd be nobody left to manage users
    var demotes =
        user_fields &&
        (("role" in user_fields && user_fields.role !== "admin") ||
            ("isAdmin" in user_fields && !user_fields.isAdmin));
    if (demotes) {
        return isLastAdmin(username, function (last) {
            if (last) {
                return callback(
                    "Cannot change the role of the only admin account.",
                    null
                );
            }
            applyModifyUser(username, user_fields, callback);
        });
    }
    applyModifyUser(username, user_fields, callback);
};

var applyModifyUser = function (username, user_fields, callback) {
    config.user.findOne(username, function (err, data) {
        var user = data ? publicUser(username, data) : null;
        if (err) {
            callback(err);
            return;
        } else {
            if (user_fields.username !== undefined) {
                delete user_fields.username;
            }
            for (var field in user_fields) {
                switch (field) {
                    case "_id":
                    case "created_at":
                    case "username":
                        callback(
                            "your object contains an unchangeable field ! : " +
                                field,
                            null
                        );
                        return;
                    case "password":
                        var password = config.user.verifyAndEncryptPassword(
                            user_fields["password"]
                        );
                        if (!password) {
                            callback(
                                'Password not valid, it should contain between 5 and 15 characters. The only special characters authorized are "@ * #".',
                                null
                            );
                            return;
                        }
                        user["password"] = password;
                        break;
                    case "role":
                        if (userConfig.ROLES.indexOf(user_fields.role) === -1) {
                            callback("Unknown role: " + user_fields.role, null);
                            return;
                        }
                        user.role = user_fields.role;
                        break;
                    default:
                        user[field] = user_fields[field];
                        break;
                }
            }
            // role and the legacy isAdmin flag travel together: an explicit
            // role wins; a bare isAdmin change (the old grant/revoke path)
            // maps onto the role.
            if ("role" in user_fields) {
                user.isAdmin = user.role === "admin";
            } else if ("isAdmin" in user_fields) {
                user.isAdmin = !!user_fields.isAdmin;
                user.role = user.isAdmin
                    ? "admin"
                    : user.role === "admin"
                      ? "user"
                      : user.role;
            }
            var newData = {};
            newData[username] = {};
            for (field in user) {
                switch (field) {
                    case "username":
                        break;
                    default:
                        newData[username][field] = user[field];
                        break;
                }
            }
            config.user.update(newData, function (err, user) {
                if (user) user.password = undefined; // don't transmit the password back
                callback(err, user);
                return;
            });
        }
    });
};

var deleteUser = function (username, callback) {
    isLastAdmin(username, function (last) {
        if (last) {
            return callback("Cannot delete the only admin account.");
        }
        config.user.delete(username, function (err, data) {
            if (err) callback(err);
            else {
                callback(null, data);
            }
        });
    });
};

// ---------------------------------------------------------------------------
// Operator gate
//
// Operator accounts exist so a shop can hand the machine to someone who may
// CUT but not CONFIGURE: they get the Console app and the manual keypad and
// nothing else. The dashboard hides the rest of the UI, but this middleware
// is the enforcement: for a session logged in as an operator, every
// state-mutating HTTP route is refused except the short allowlist below.
// (The manual keypad and console commands ride the session-authenticated
// socket.io channel — machine motion, pause/quit/resume — which is exactly
// the capability an operator is supposed to have, so sockets need no gate.)
//
// Requests with no session at all are passed through untouched — FabMo's
// API has never required authentication for direct HTTP access, and closing
// that is a separate project. This gate is about what a logged-in operator
// can reach from the dashboard.

var OPERATOR_ALLOWED = [
    /^\/authentication\//, // login/logout/self password (role changes are admin-gated in the route)
    /^\/code(\/check_bounds)?$/, // console command execution + bounds preflight
    /^\/eval$/, // SBP expression evaluation (read-only)
    /^\/(quit|pause|resume)$/, // safety — never block stopping the machine
    /^\/macros\/\d+\/run$/, // running admin-curated macros (editing them is blocked)
    /^\/uix\/fr_override$/, // feed-rate override knob
    /^\/acc\/spindle_speed$/, // spindle RPM (configuring the VFD is blocked)
];

var operatorGate = function (req, res, next) {
    var user = req.user;
    if (!user || userConfig.normalizeRole(user) !== "operator") {
        return next();
    }
    var method = req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        return next();
    }
    var path = req.getPath ? req.getPath() : req.path();
    for (var i = 0; i < OPERATOR_ALLOWED.length; i++) {
        if (OPERATOR_ALLOWED[i].test(path)) {
            return next();
        }
    }
    res.send(403, {
        status: "error",
        message:
            "This account is operator-only: running the machine is allowed, changing its setup is not.",
    });
};

passport.serializeUser(function (user, done) {
    done(null, user.username);
});

passport.deserializeUser(function (username, done) {
    config.user.findOne(username, function (err, data) {
        if (err) {
            done(null, false, { message: "User does not exist" });
        } else {
            done(err, publicUser(username, data));
        }
    });
});

exports.eventEmitter = eventEmitter;

exports.addUser = addUser;
exports.getUsers = getUsers;
exports.getUser = getUser;
exports.modifyUser = modifyUser;
exports.deleteUser = deleteUser;
exports.operatorGate = operatorGate;
exports.ROLES = userConfig.ROLES;

exports.passport = passport;

exports.getUserById = function (username, cb) {
    config.user.findOne(username, function (err, data) {
        if (data) {
            cb(null, publicUser(username, data));
        } else {
            cb("no user");
        }
    });
};

// eslint-disable-next-line no-unused-vars
exports.getCurrentUser = function (u) {
    return currentUser;
};
exports.setCurrentUser = function (u) {
    currentUser = u;
    eventEmitter.emit("user_change", currentUser);
};
exports.setUserAsActive = function () {
    resetUserTimer();
};
