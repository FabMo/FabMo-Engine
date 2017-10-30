var fs = require('fs-extra')
var path = require('path')
var async = require('async')
var config = require('./config')
var log = require('./log').logger('macro');
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

var _createMacroFilename = function(id, type) {
	var macro_path = config.getDataDir('macros');
	switch(type) {
		case 'nc':
			return path.join(macro_path, 'macro_' + id + '.nc');
			break;

		case 'sbp':
			return path.join(macro_path, 'macro_' + id + '.sbp');
			break;

		default:
			throw new Error('Invalid macro type: ' + type)
			break;
	}
}

var _createMacroDefaultContent = function(macro) {
	switch(macro.type) {
		case 'nc':
			//return 	'( ' + macro.name + ' )\n( ' + macro.description + ' )\n\n';
			return ''
            break;

		case 'sbp':
			//return 	"' " + macro.name + "\n' " + macro.description + "\n\n";
			return ''
            break;

		default:
			throw new Error('Invalid macro type: ' + type)
			break;
	}
}

var _parseMacroFile = function(filename, callback) {
	var re = /[\(']!FABMO!(\w+):([^\)]*)\)?/
	var obj = {}
	var ok = false;
	fs.readFile(filename, function(err, data) {
		if(err) {
			log.error(err)
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
				obj.content = lines.slice(i,lines.length).join('\n');
				callback(null, obj);
			} else {
				try {
					log.error('File ' + filename + ' failed to parse.  Unlinking it so it can be replaced.')
					fs.unlink(filename);
				} finally {
					callback(null, undefined)
				}
			}
		}
	});
}

var update = function(id, macro, callback) {
	var old_macro = get(id);
	if(old_macro) {
		function savemacro(id, callback) {
			old_macro.name = macro.name || old_macro.name;
			old_macro.description = macro.description || old_macro.description;
			old_macro.content = macro.content || old_macro.content;
			old_macro.index = macro.index || old_macro.index;
			old_macro.type = macro.type || old_macro.type;
			old_macro.filename = _createMacroFilename(old_macro.index, old_macro.type);
			save(id, callback);
		}

		if(macro.index) {
			var new_index = parseInt(macro.index);
			if(get(new_index)) {
				return callback(new Error("There is already a macro #" + new_index));
			}
			if(new_index != old_macro.index) {
				macros[new_index] = old_macro;
				delete macros[old_macro.index];
				_deleteMacroFile(old_macro.index, function(err) {
					savemacro(new_index, callback);
				});
			} else {
				savemacro(id, callback);
			}
		} else {
			savemacro(id, callback);
		}

	} else {
		new_macro = {
			name : macro.name || 'Untitled Macro',
			description : macro.description || 'Macro Description',
			type : macro.type || 'sbp',
			enabled : macro.enabled || true, // TODO fix this
			index : id
		}
		new_macro.filename = _createMacroFilename(id, new_macro.type);
		new_macro.content = macro.content || _createMacroDefaultContent(new_macro);
		macros[id] = new_macro;
		save(id, callback);
	}
}

var save = function(id, callback) {
	macro = get(id);
	if(macro) {
		var macro_path = config.getDataDir('macros');
		var file_path = path.join(macro_path, 'macro_' + macro.index + '.' + macro.type);
		switch(macro.type) {
			case 'nc':
				var header = _createGCodeHeader(macro);
				break;			
			case 'sbp':
				var header = _createOpenSBPHeader(macro);
				break;
			default:
				setImmediate(callback, new Error('Invalid macro type: ' + macro.type));
				break;
		}
		fs.open(file_path, 'w', function(err, fd) {
			if(err) {
				log.error(err);
				return callback(err);
			}
			var contents = new Buffer(header + macro.content);
			fs.write(fd, contents, 0, contents.length, 0, function(err, written, string) {
				if(err) {
					log.error(err);
					return callback(err);
				}
				fs.fsync(fd, function(err) {
					if(err) {
						log.error(err);
					}
					fs.closeSync(fd);
					log.debug('fsync()ed ' + file_path);
					callback(err, macro);
				});
			});
		});
	} else {
		callback(new Error("No such macro " + id));
	}
}

var load = function(callback) {
	var macro_path = config.getDataDir('macros');
	var re = /macro_([0-9]+)\.(nc|sbp)/
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
						if(groups) {
							idx = parseInt(groups[1]);
							ext = groups[2];
							info.index = idx;
							info.type = ext;
							macros[idx] = info;							
						}
					}
				});
				callback(null);
			});
		}
	})
}

var list = function() {
	retval = [];
	for(key in macros) {
		retval.push(getInfo(key));
	}
	return retval;
}

var getInfo = function(idx) {
	var macro = get(idx);
	if(macro) {
		return 	{
			'name' : macro.name,
			'description' : macro.description,
			'enabled' : macro.enabled,
			'type' : macro.type,
			'index' : parseInt(macro.index)
		}
	} else {
		return null; 
	}
}

var get = function(idx) {
	return macros[idx] || null;
}

var run = function(idx) {
	var machine = require('./machine').machine;

	info = macros[idx];
	if(info) {
			machine.runFile(info.filename);
	} else {
		throw new Error("No such macro.")
	}
}

var del = function(idx, callback) {
	info = macros[idx];
	if(info) {
		_deleteMacroFile(idx, function(err) {
			if(err) {
				callback(err);
			} else {
				delete macros[idx];
				callback(null);
			}
		});
	} else {
		callback(new Error('No such macro: ' + idx))
	}
}

var loadProfileMacros = function(callback) {
	var installedMacrosDir = config.getDataDir('macros');
	var profileMacrosDir = config.getProfileDir('macros');
	var copyIfNotExists = function(fn, callback) {
		var a = path.join(profileMacrosDir, fn);
		var b = path.join(installedMacrosDir, fn);
		fs.stat(b, function(err, stats) {
			if(!err && stats.isFile()) {
				log.debug('Not Copying ' + a + ' -> ' + b + ' because it already exists.');					
				callback();
			} else {
				log.debug('Copying ' + a + ' -> ' + b + ' because it doesnt already exist.');
				fs.copy(a,b, function(err, data) {
					callback(err);
				});
			}
		});
	}

	fs.readdir(profileMacrosDir, function(err, files) {
		if(err) { return callback(err); }
		async.map(files, copyIfNotExists, callback);
	})
}

exports.load = load;
exports.list = list;
exports.get = get;
exports.del = del;
exports.run = run;
exports.getInfo = getInfo;
exports.update = update;
exports.save = save;
exports.loadProfile = loadProfileMacros;
