// var upload = require('./util').upload;
// var util = require('../util')
// var exec = require('child_process').exec;
// var fs = require('fs-extra')

// var flashFirmWare = function(req, res, next) {
    
//     upload(req, res, next, function(err, upload) {
//         upload = upload.files
//         fs
//         exec("systemctl stop hostapd wpa_supplicant",function(err,result){});
//     });
//     util.move(upload, full_path, function(err) {
// 		if(err) {
// 			return callback(err);
// 		}
// 		// delete the temporary file, so that the temporary upload dir does not get filled with unwanted files
// 		fs.unlink(pathname, function(err) {
// 			if (err) {
// 				// Failure to delete the temporary file is bad, but non-fatal
// 				log.warn("failed to remove the job from temporary folder: " + err);
// 			}

// 			var file = new File(friendly_filename, full_path);
// 			file.hash = hash;
// 			file.save(function(err, file){
// 				if(err) {
// 					return callback(err);
// 				}
// 				log.info('Saved a file: ' + file.filename + ' (' + file.path + ')');

// 				callback(null, file)
// 			}.bind(this)); // save
// 			//set off async file size update
// 		}.bind(this)); // unlink
// 	}); // move
// }

// module.exports = function(server) {
//     server.post('/firmware', flashFirmWare);
// }