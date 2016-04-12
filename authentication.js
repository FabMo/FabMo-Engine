var passport = require('passport-restify');
var LocalStrategy   = require('passport-local').Strategy;
var User = require('./db').User;

var currentUser = null; // keep track of the current registered user
var userTimer = 10*60*1000; // 10 minutes
var currentUserTimer = null;
var isCurrentUserKickeable = false;

function startUserTimer(){
  var currentUserTimer = setTimeout(userTimeout,userTimer);
}

function resetUserTimer(){
  clearTimeout(currentUserTimer);
  currentUserTimer = startUserTimer();
}
function userTimeout(){
  isCurrentUserKickeable = true;
}


exports.configure = function(){
  passport.use(new LocalStrategy(
    function(username, password, done) {
      if (currentUser && currentUser.username !== username && isCurrentUserKickeable && !currentUser.isAdmin){ // check if the current user is inactive, and not an admin.
        // ask the user if he really wants to kick out the current user
        // if so, then kick out the current user
        // log in the new user

      }else if(currentUser && currentUser.username !== username){ // checl allow only one user at the time
          console.log(currentUser);
          return done(null, false, { message: 'The user '+currentUser.username+' is already controlling the tool'});

      }else{ // no one log in , the machine is all yours !
        User.findOne(username, function(err, user) {
          if (err) { return done(err); }
          if (!user) {
            return done(null, false, { message: 'Incorrect username.' });
          }
          if (!user.validPassword(password)) {
            return done(null, false, { message: 'Incorrect password.' });
          }
          // success !
          currentUser = user;
          isCurrentUserKickeable = false;
          startUserTimer();
          return done(null, user);
        });
      }
    }
  ));
};

var signup = function(username,password,callback){
  User.add(username,password,callback);
};

passport.serializeUser(function(user, done) {
    done(null, user._id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

exports.signup = signup;

exports.passport = passport;

exports.getCurrentUser = function(u){return currentUser;}
exports.setCurrentUser = function(u){currentUser = u;}
