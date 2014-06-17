var fs = require('fs');
var machine = require('./machine');
upload_folder = '/opt/shopbot/parts';
var db = require('./db');
var File=db.File;
ALLOWED_EXTENSIONS = ['.nc','.g','.sbp','.gc','.gcode'];

exports.quit = function(req, res, next) {
    machine.driver.quit();
    res.header('Location', req.headers['referer']);
    res.json({'success':true});
    res.send(200);
};

exports.pause = function(req, res, next) {
    machine.driver.feedHold();
    res.header('Location', req.headers['referer']);
    res.json({'success':true});
    res.send(200);
};

exports.resume = function(req, res, next) {
    machine.driver.resume();
    res.header('Location', req.headers['referer']);
    res.json({'success':true});
    res.send(200);
};

exports.run = function(req, res, next) {
	console.log('Running file');
	File.get_by_id(req.params.id,function(file){
		file.saverun();//update last run and run count information
		machine.driver.runFile(file.path);
	});
    res.header('Location', req.headers['referer']);
    res.send(200);
};

