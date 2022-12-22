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
var eventEmitter = new events.EventEmitter();

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

                var user = {
                    username: username,
                    password: data.password,
                    isAdmin: data.isAdmin,
                    created_at: data.created_at,
                };
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

var addUser = function (username, password, callback) {
    config.user.add(username, password, function (err, user) {
        if (err) {
            callback(err);
            return;
        } else {
            user = {
                username: username,
                password: user.password,
                isAdmin: user.isAdmin,
                created_at: user.created_at,
            };
            user.password = undefined; // remove password from user object.
            callback(null, user);
        }
    });
};

var getUsers = function (callback) {
    var users = [];
    config.user.getAll(function (data) {
        for (var key in data) {
            var user = {
                username: key,
                password: undefined,
                isAdmin: data[key].isAdmin,
                created_at: data[key].created_at,
            };
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
            var user = {
                username: username,
                password: undefined,
                isAdmin: data.isAdmin,
                created_at: data.created_at,
            }; // remove password from user object.
            callback(null, user);
        } else {
            callback(err);
        }
    });
};

var modifyUser = function (username, user_fields, callback) {
    config.user.findOne(username, function (err, data) {
        var user = {
            username: username,
            password: data.password,
            isAdmin: data.isAdmin,
            created_at: data.created_at,
        };
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
                    default:
                        user[field] = user_fields[field];
                        break;
                }
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
    config.user.delete(username, function (err, data) {
        if (err) callback(err);
        else {
            callback(null, data);
        }
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
            var user = {
                username: username,
                password: data.password,
                isAdmin: data.isAdmin,
                created_at: data.created_at,
            };
            done(err, user);
        }
    });
});

exports.eventEmitter = eventEmitter;

exports.addUser = addUser;
exports.getUsers = getUsers;
exports.getUser = getUser;
exports.modifyUser = modifyUser;
exports.deleteUser = deleteUser;

exports.passport = passport;

exports.getUserById = function (username, cb) {
    config.user.findOne(username, function (err, data) {
        if (data) {
            var user = {
                username: username,
                password: data.password,
                isAdmin: data.isAdmin,
                created_at: data.created_at,
            };
            cb(null, user);
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
