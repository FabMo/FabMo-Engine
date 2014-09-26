var fs = require('fs');
var machine = require('../machine').machine;
var log=require('../log').logger("passthrough");
var socketio = require('socket.io');
var restify = require('restify');
var path_to_passthrough_app =  "./static/passthrough.html";
var clients_limit = 1;
var nb_clients=0;

connect = function(socket) {

	log.debug("new_client for passthrough");
	nb_clients++;
	if (nb_clients<=clients_limit){ // avoid too many connection on the g2 passthrough functionnality.
		machine.enable_passthrough(function(err,err_msg){
			if(err){socket.emit("err",err_msg);return;}
			socket.on('msg',function(msg){
				var data =msg;
				data+="\n";
				data.trim();
				machine.driver.write(data);
			});
			machine.on('raw_data',function(data){
					socket.emit("msg",data);
			});
		});
	}
	socket.on('disconnect', function() {
		log.debug("client disconnected");
		nb_clients--;
		machine.disable_passthrough();
	});
};

passthrough_app = function(req,res,next) {
	// serve a static file
	res.writeHead(200, {'Content-Type': 'text/html'});
	fs.createReadStream(path_to_passthrough_app ).pipe(res);
};


module.exports = function(server) {
	var io = socketio.listen(server.server);
	server.get("/passthrough",passthrough_app);
	io.of('/passthrough').on('connection', connect);
	server.get(/.*/, restify.serveStatic({
		directory: './static',
		default: 'index.html'
	}));
};
