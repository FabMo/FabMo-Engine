var log = require('../log').logger('authentication');
var authentication = require('../authentication');
var fs = require('fs');

var static_files = {
  login:'./authentication/login.html',
  signup:'./authentication/signup.html'
};



var login = function(req, res, next) {
  authentication.passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/authentication/login',
  })(req,res,next);
};

var signup = function(req, res, next) {
  if(req.params.username==undefined || req.params.username==undefined)
    res.send(200,'you need to provide a username AND a password');
  else{
    authentication.signup(req.params.username,req.params.password,function(err,user){
      if(err){
        res.send(200,err);
      }else{
        res.setHeader('Content-Type', 'text/html');
        res.send(200,'User succesfully created ! <a href="/authentication/login">Go to log in page</a>');
      }


    });
  }

};


var serveStaticPage = function(file,req,res,next){
  res.writeHead(200, {'Content-Type': 'text/html'});
	fs.createReadStream(file).pipe(res);
};


var serveLoginPage=function(req,res,next){
  serveStaticPage(static_files.login,req,res,next);
};

var serveSignUpPage=function(req,res,next){
  serveStaticPage(static_files.signup,req,res,next);
};

var logout = function(req, res, next) {
  req.logout();
  console.log("login out !");
  res.redirect('/authentication/login',next);

};

module.exports = function(server) {
  server.get('/authentication/login', serveLoginPage);
  server.post('/authentication/login', login);
  server.get('/authentication/logout',authentication.passport.authenticate('local'), logout);
  server.get('/authentication/signup', serveSignUpPage);
  server.post('/authentication/signup', signup);
};
