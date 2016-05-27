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

var addUser = function(req, res, next) {

  currentUser = authentication.getCurrentUser();
  if(currentUser && currentUser.isAdmin){
    if(req.params.username==undefined || req.params.username==undefined)
      res.send(200,{ success : false, message:'you need to provide a username AND a password'});
    else{
      authentication.addUser(req.params.username,req.params.password,function(err,user){
        if(err){
          res.send(200,{ success : false, message:err});
        }else{
          res.send(200,{ success : true, message : 'registration succeeded'});
        }
      });
    }
  }else {
    res.send(200,{success:false,message:"you need to be admin to register new users"});
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

var getUsers = function(req,res,next){
  currentUser = authentication.getCurrentUser();
  if(currentUser && currentUser.isAdmin){ // if admin
    authentication.getUsers(function(err,users){
      if(err){
        res.send(200,{success:false,message:err});
        return;
      }
      res.send(200,{success:true,data:users});
    });
  }else {
    res.send(200,{success:false,message:"you need to be admin to get users info"});
  }
};

var getUser = function(req,res,next){
  currentUser = authentication.getCurrentUser();
  if(currentUser &&( (currentUser._id == req.params.id ) || currentUser.isAdmin)){ // if current user or admin
    authentication.getUser(req.params.id,function(err,user){
      if(err){
        res.send(200,{success:false,message:err});
        return;
      }
      res.send(200,{success:true,data:user});
    });
  }else {
    res.send(200,{success:false,message:"you need to be admin or request your own id to get the user info"});
  }
};

var getCurrentUser = function(req,res,next){
  currentUser = authentication.getCurrentUser();
  if(currentUser){ // if current user
    authentication.getUser(currentUser._id,function(err,user){
      if(err){
        res.send(200,{success:false,message:err});
        return;
      }
      res.send(200,{success:true,data:user});
    });
  }else {
    res.send(200,{success:false,message:"you need to be connected to request your own user info"});
  }
};


var modifyUser = function(req,res,next){
  currentUser = authentication.getCurrentUser();
  if(currentUser &&(currentUser._id == req.params.id || currentUser.isAdmin)){ // if current user or admin
    if(!req.params.user){
      res.send(200,{success:false,message:"no user object provided"});
    }
    authentication.modifyUser(req.params.id,req.params.user,function(err,user){
      if(err){
        res.send(200,{success:false,message:err});
        return;
      }
      res.send(200,{success:true,data:user});
    });
  }else {
    res.send(200,{success:false,message:"you need to be admin or request your own id to modify the user info"});
  }
};

var deleteUser = function(req,res,next){ // if admin
  currentUser = authentication.getCurrentUser();
  if(currentUser && currentUser.isAdmin){ // if admin
    authentication.deleteUser(req.params.id,function(err,user){
      if(err){
        res.send(200,{success:false,message:err});
        return;
      }
      res.send(200,{success:true});
    });
  }else {
    res.send(200,{success:false,message:"you need to be admin to delete users"});
  }
};

module.exports = function(server) {
  server.get('/authentication', serveAuthenticationPage);
  server.post('/authentication/login', login);
  server.get('/authentication/logout',authentication.passport.authenticate('local'), logout);
  server.get('/authentication/user',authentication.passport.authenticate('local'), getCurrentUser);// return current user info.
  server.post('/authentication/user',authentication.passport.authenticate('local'), addUser);//only authenticated user can add new users.
  server.get('/authentication/users',authentication.passport.authenticate('local'), getUsers);
  server.get('/authentication/user/:id',authentication.passport.authenticate('local'), getUser);
  server.post('/authentication/user/:id',authentication.passport.authenticate('local'), modifyUser);
  server.del('/authentication/user/:id',authentication.passport.authenticate('local'), deleteUser);

};
