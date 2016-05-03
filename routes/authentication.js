var log = require('../log').logger('authentication');
var authentication = require('../authentication');
var fs = require('fs');

var static_files = {
  authentication:'./authentication/authentication.html'
};



var login = function(req, res, next) {
  authentication.passport.authenticate('local', function(err, user, info) {

    if (err) {
      return next(err); // will generate a 500 error
    }
    // Generate a JSON response reflecting authentication status
    if (! user) {
      return res.send(401,{ success : false, message : info.message, userAlreadyLogedIn:info.userAlreadyLogedIn});
    }
    req.login(user, function(err){
      if(err){
        return next(err);
      }
      return res.send({ success : true, message : 'authentication succeeded' });
    });
  })(req, res, next);
};

var signup = function(req, res, next) {
  if(req.params.username==undefined || req.params.username==undefined)
    res.send(200,{ success : false, message:'you need to provide a username AND a password'});
  else{
    authentication.signup(req.params.username,req.params.password,function(err,user){
      if(err){
        res.send(200,{ success : false, message:err});
      }else{
        res.send(200,{ success : true, message : 'registration succeeded'});
      }
    });
  }

};


var serveStaticPage = function(file,req,res,next){
  res.writeHead(200, {'Content-Type': 'text/html'});
	fs.createReadStream(file).pipe(res);
};


var serveAuthenticationPage=function(req,res,next){
  serveStaticPage(static_files.authentication,req,res,next);
};


var logout = function(req, res, next) {
  req.logout();
  authentication.setCurrentUser(null);
  res.redirect('/authentication',next);

};

module.exports = function(server) {
  server.get('/authentication', serveAuthenticationPage);
  server.post('/authentication/login', login);
  server.get('/authentication/logout',authentication.passport.authenticate('local'), logout);
  server.post('/authentication/signup', signup);
};
