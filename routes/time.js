
var getTime = function(req, res, next) {
	var now = new Date();
  	var answer = {
		status:"success",
		data : {'utc' : now.getTime()}
	};
	res.json(answer);
};

var updateTime = function(req, res, next) {
	var engine = require('../server').engine;
	if('utc' in req.params) {
		engine.setTime(req.params);
	}

	var answer = {
		status:"success",
		data : null
	}

	res.json(answer);
}

module.exports = function(server) {
	server.get('/time',getTime);
	server.post('/time', updateTime);
};