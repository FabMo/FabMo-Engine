var passport = require('passport-restify');
var LocalStrategy   = require('passport-local').Strategy;
var User = require('./db').User;

exports.configure = function(){
  passport.use(new LocalStrategy(
    function(username, password, done) {
      User.findOne(username, function(err, user) {
        if (err) { return done(err); }
        if (!user) {
          return done(null, false, { message: 'Incorrect username.' });
        }
        if (!user.validPassword(password)) {
          return done(null, false, { message: 'Incorrect password.' });
        }
        return done(null, user);
      });
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
