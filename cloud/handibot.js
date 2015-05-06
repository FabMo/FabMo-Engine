var request = require('request');

var HandibotProvider = function(options) {
	this.username = options.username;
	this.password = options.password;
}

HandibotProvider.prototype.start = function() {

}

HandibotProvider.prototype.stop = function() {

}

HandibotProvider.prototype.update = function() {

}

HandibotProvider.prototype._login = function(callback) {
	var data = {
		'email' : this.username,
		'password' : this.password,
		'who' : 'FabMo'
	}
	request.post(
		'http://handibot.net/ajax_proc/login.php', 
		{	'content-type' : 'application/json', 
			'body' : JSON.stringify(data)
		}, 
		function(err, res, body) {
			console.log(body);
			console.log(res.toJSON())
		}
	);
}

var hb = new HandibotProvider({'username':'ryansturmer@feringtech.com', 'password':'devpass'});
hb._login();
