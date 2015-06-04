define(function(require) { 
	
	function SocketIO(){
		//var dashboard = require('dashboard');
		//var socket_io = require('libs/socket.io');
		var dashboard = require('dashboard');

		var socket = null;

		try{
			socket = io();
		} catch(ex){
			console.error('connection to the engine via websocket failed : '+ ex.message);
		}
		if(socket!==null){
			socket.on('connect', function() {});

			socket.on('message',function(message){});

			socket.on('status',function(status){
				//disable the GET loop to refresh the status
				try {
					clearInterval(dashboard.ui.auto_refresh);
				} catch(e) {}
				dashboard.machine.status_report = status;
				dashboard.updateStatus(status);
			});	

			socket.on('disconnect', function() {
				//reenable the GET loop to refresh the status
				dashboard.ui.auto_refresh = setInterval(dashboard.ui.updateStatus.bind(dashboard.ui),dashboard.ui.refresh);
			});
		}

		return socket;
	}
	this.SocketIO = SocketIO;
	return this;
});