var passport = require('passport-restify');
var LocalStrategy   = require('passport-local').Strategy;
var User = require('./db').User;

var currentUser = null; // keep track of the current registered user

exports.configure = function(){
  passport.use(new LocalStrategy(
    function(username, password, done) {
      if(currentUser && currentUser.username !== username){ // allow only one user at the time
          console.log(currentUser);
          return done(null, false, { message: 'The user '+currentUser.username+' is already controlling the tool'});
      }else{
        User.findOne(username, function(err, user) {
          if (err) { return done(err); }
          if (!user) {
            return done(null, false, { message: 'Incorrect username.' });
          }
          if (!user.validPassword(password)) {
            return done(null, false, { message: 'Incorrect password.' });
          }
          currentUser = user;
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
