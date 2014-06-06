var fs = require('fs');
var machine = require('./machine');
upload_folder = '/opt/shopbot/parts';
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
	fs.readdir(upload_folder, function(err, files){
		var filearray = [], i=0;
		for(var i=0; i<files.length; i++)
		{
			filearray.push([i , upload_folder+'/'+files[i]]);
		}		
		var full_path = filearray[req.params.id];
		console.log(full_path);
		machine.driver.runFile(full_path[1]);
	});
	res.header('Location', req.headers['referer']);
res.send(302);
};

