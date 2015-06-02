var request = require('request').defaults({jar:true});
var jar = request.jar()
var GET_APPS_URL = 'http://handibot.net/app_instance/getAppInstanceByUser.php';
var LOGIN_URL = 'http://handibot.net/ajax_proc/login.php';
var log = require('../log').logger('handibot.net');


var HandibotProvider = function(options) {
	this.username = options.username;
	this.password = options.password;
	this._state = 'init';
	this.running = false;
	this.app_instances = [];
}

HandibotProvider.prototype.login = function(callback) {
	log.debug('Logging in');
	var data = {
		'email' : this.username,
		'password' : this.password,
		'who' : 'FabMo'
	}
	request.post(LOGIN_URL, 
		{
			'form':data,
			'jar':jar
		}, 
		function(err, res, body) {
			log.debug('Got login response');
			try {
				var data = JSON.parse(body);
				if('userId' in data) {
					this.userId = data.userId;
					callback(null, data);
				} else {
					if('error' in data) {
						callback(new Error(data.error))
					} else {
						callback(new Error(body));
					}
				}
			} catch(e) {
				callback(e);
			}
		}.bind(this)
	);
}

HandibotProvider.prototype._getAppInstances = function(callback) {
	var data = {
		'userId' : this.userId
	}
	request.post(
		GET_APPS_URL,
		{
			'form' : {'data' : JSON.stringify(data)}, 
			'jar' : jar
		},
		function(err, res, body) {
			log.debug('Got app instance response');
			if(err) {
				callback(err);
			} else {
				instances = JSON.parse(body);
				callback(null, instances);
			}
		}
	);
}

HandibotProvider.prototype._getAppInstanceDetail = function(id, callback) {
	var data = {
		'appInstanceId' : id
	}
	request.post(
		GET_APPS_URL,
		{
			'form' : {'data' : JSON.stringify(data)}, 
			'jar' : jar
		},
		function(err, res, body) {
			log.debug('Got app instance detail response');
			if(err) {
				callback(err);
			} else {
				instance_detail = JSON.parse(body);
				callback(null, instance_detail);
			}s
		}
	);
}
HandibotProvider.prototype.update = function(callback) {
	this._getAppInstances(function(err, results) {
		if(err) {
			callback(err);
		} else {
			var app_instances = results.appInstances;
			function updateAppInstanceDetail(appinstance, callback) {
				var id = appinstance.appInstanceId;
				this._getAppInstanceDetail(id, function(err, result) {
					if(err) {
						callback(err);
					} else {
						this.appInstances[]
					}
				})
			}.bind(this);
			async.map(app_instances, function)
			log.debug(JSON.stringify(this.app_instances));
			callback(null, results);
		}
	});
}

var hb = new HandibotProvider({'username':'ryansturmer@feringtech.com', 'password':'devpass'});
hb.login(function(err, result) {
	hb.update(function(err, result) {

	});
});
