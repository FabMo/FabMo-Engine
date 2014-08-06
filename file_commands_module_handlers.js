var fs = require('fs');
var machine = require('./machine').machine;
upload_folder = '/opt/shopbot/parts';
var db = require('./db');
var File=db.File;
ALLOWED_EXTENSIONS = ['.nc','.g','.sbp','.gc','.gcode'];

exports.quit = function(req, res, next) {
    machine.quit();
    res.json(200,{'success':true});
};

exports.pause = function(req, res, next) {
    machine.pause();
    res.json(200,{'success':true});
};

exports.resume = function(req, res, next) {
    machine.resume();
    res.json(200,{'success':true});
};

exports.run = function(req, res, next) {
	File.get_by_id(req.params.id,function(file){
		if(!file){res.send(404);return;}
		file.saverun();//update last run and run count information
		machine.runFile(file.path);
		res.send(302);
	});
};

