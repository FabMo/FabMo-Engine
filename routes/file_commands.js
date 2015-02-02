var fs = require('fs');
var machine = require('../machine').machine;
var db = require('../db');
var File=db.File;

// These are the only file extensions that are allowed for upload.
// File extension filtering is not case sensitive
ALLOWED_EXTENSIONS = ['.nc','.g','.sbp','.gc','.gcode'];


/**
 * @api {get} /file_commands/quit  stops the machine's motion and aborts the file
 * @apiGroup Files Commands
 * @apiSuccess {Object} {status:"success",data : null}
 */
quit = function(req, res, next) {
  machine.quit();
  var answer = {
		status:"success",
		data : null
	};
	res.json(answer);
};

/**
 * @api {get} /file_commands/pause   stops the machine's motion, but can generally be resumed
 * @apiGroup Files Commands
 * @apiSuccess {Object} {status:"success",data : null}
 */
pause = function(req, res, next) {
  machine.pause();
  var answer = {
		status:"success",
		data : null
	};
	res.json(answer);
};

/**
 * @api {get} /file_commands/resume   Resume from pause
 * @apiGroup Files Commands
 * @apiSuccess {Object} {status:"success",data : null}
 */
resume = function(req, res, next) {
  machine.resume();
  var answer = {
		status:"success",
		data : null
	};
	res.json(answer);
};


/**
 * @api {get} /file_commands/run/:id  run a file (by its file id)
 * @apiGroup Files Commands
 * @apiSuccess {Object} {status:"success",data : null}
 */
run = function(req, res, next) {
	File.get_by_id(req.params.id,function(file){
		if(!file){res.send(404);return;}
		file.saverun();//update last run and run count information
		machine.runFile(file.path);
    var answer = {
			status:"success",
			data : null
		};
		res.json(answer);
	});
};

module.exports = function(server) {
	server.get('/run/:id',run); //OK
	server.get('/quit',quit); //OK
	server.get('/pause',pause); //OK 
	server.get('/resume',resume); //OK 
};