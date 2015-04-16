var fs = require('fs')
var config = require('./config')
var MARKER = '!FABMO!'

var macros = {}

var _createGCodeHeader = function(options) {
	name = options.name || "Untitled Macro"
	description = options.description || ""
	enabled = options.enabled || true
	return "(" + MARKER + "name:" + name + ")\n" + 
	       "(" + MARKER + "description:" + description + ")\n" + 
	       "(" + MARKER + "enabled:" + enabled + ")\n"
}

var _createOpenSBPHeader = function(options) {
	name = options.name || "Untitled Macro"
	description = options.description || ""
	enabled = options.enabled || true
	return "'" + MARKER + "name:" + name + "\n" + 
	       "'" + MARKER + "description:" + description + "\n"
	       "'" + MARKER + "enabled:" + enabled + "\n"

}

var _deleteMacroFile = function(index, callback) {
	var macro_path = config.getDataDir('macros');
	var opensbp = path.join(macro_path, 'macro_' + index + '.sbp')
	var gcode = path.join(macro_path, 'macro_' + index + '.nc')
	fs.unlink(opensbp, function(err) {
		fs.unlink(gcode, function(err) {
			callback(null);
		});
	});
}

var _parseMacroFile = function(filename, callback) {
	var re = /[\(']!FABMO!(\w+):(.*)/
	var obj = {}
	var ok = false;
	fs.readFile(filename, function(err, data) {
		if(err) {
			console.log(err)
		} else {
			lines = data.toString().split('\n');
			i = 0;
			while(i < lines.length) {
				var line = lines[i];
				var groups = line.match(re);
				if(groups) {
					ok = true;
					var key = groups[1];
					var value = groups[2];
					obj[key] = value;
				} else {
					break;
				}
				i+=1;
			}
			if(ok) {
				obj.filename = filename;
				callback(null, obj);
			} else {
				callback(null, undefined)
			}
		}
	});
}

var create = function(path, options, callback) {
	var macro_path = config.getDataDir('macros');
	if(util.allowedFile(path)) {
		fs.readFile(path, function(err, data) {
			if(err) {
				callback(err);
			} else {
				_deleteMacroFile(options.index, function(err, data) {
					if(util.isGCodeFile(path)) {
						file = path.join(macro_path, 'macro_' + index + '.nc');
						header = _createGCodeHeader(options)
					} else if(util.isOpenSBPFile(path)) {
						file = path.join(macro_path, 'macro_' + index + '.sbp');
						header = _createOpenSBPHeader(options)
					} else {
						// Bad
					}
					fs.writeFile(header + data, function(err, data) {
						if(err) {
							callback(err);
						} else {
							macros[options.index] = options
							callback(null);
						}
					});
				});
			}
		});
	} else {
		callback("File is not allowed.");
	}
}

var load = function(callback) {
	var macro_path = config.getDataDir('macros');
	var re = /macro_([0-9]+)\.(?:nc|sbp)/
	macros = {};
	fs.readdir(macro_path, function(err, files) {
		if(err) {
			callback(err);
		} else {
			for(i=0; i<files.length; i++) {
				files[i] = path.join(macro_path, files[i]);
			}
			async.map(files, _parseMacroFile, function(err, results) {
				results.forEach(function(info) {
					if(info) {
						groups = info.filename.match(re);
						idx = parseInt(groups[1]);
						info.index = idx;
						macros[idx] = info;
					}
				});
				console.log(macros)
			});
		}
	})
}

var list = function() {
	retval = [];
	for(key in macros) {
		retval.push(macros[key]);
	}
	return retval;
}

var get = function(idx) {
	info = macros[idx];
	if(info) {
		return info.filename;
	} else {
		return null;
	}
}

var run = function(idx) {
	var machine = require('./machine').machine;

	info = macros[idx];
	if(info) {
		machine.runFile(info.filename);
	} else {
		throw "No such macro."
	}
}

exports.load = load;
exports.list = list;
exports.get = get;
exports.create = create;
exports.run = run;
