var fs = require('fs');
var machine = require('./machine');
upload_folder = '/opt/shopbot/parts';
var db = require('./db');
var File=db.File;
ALLOWED_EXTENSIONS = ['.nc','.g','.sbp','.gc','.gcode'];

exports.quit = function(req, res, next) {
    machine.driver.stop();
    res.header('Location', req.headers['referer']);
    res.json({'success':true});
};

exports.pause = function(req, res, next) {
    res.header('Location', req.headers['referer']);
    res.json({'error':'Not implemented yet.'});
};

exports.resume = function(req, res, next) {
    res.header('Location', req.headers['referer']);
    res.json({'error':'Not implemented yet.'});
};

exports.run = function(req, res, next) {
	console.log('Running file');
	File.get_by_id(req.params.id,function(file){
		if(!file){res.send(404);return;}
		file.saverun();//update last run and run count information
		machine.driver.runFile(file.path);
		res.send(302);
	});
};

