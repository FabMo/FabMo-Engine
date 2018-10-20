/*
 * macros.js
 *
 * Functions and data relating to macros.
 *
 * Macros are sort of "canned routines" that are analagous to the "custom cuts" in SB3.
 * They are in fact, invoked in the same way in the OpenSBP runtime as they were in SB3,
 * by using the C# command (C3 to home the tool, C2 for Z-zero, etc.)
 * 
 * Macros are stored on disk at (for example) /opt/fabmo/macros - anything in this directory is scanned
 * at startup and files containing an appropriate header are loaded into memory.  Ideally macros can be
 * in any file format, but the OpenSBP format is the only one that is actually implemented right now.
 * When macros are modified by the user they are saved back to the files that they were loaded from. The
 * header in each macro file contains metadata that identifies the macro, its custom-cut number, and description
 *
 * The macro headers are part of the files, but they are not displayed to the user when editing.  The user
 * is able to edit those fields, but only as exposed through the UI in the macro manager.  This prevents
 * users from corrupting the headers and creating a bunch of edge cases when editing macros.
 */
var fs = require('fs-extra')
var path = require('path')
var async = require('async')
var config = require('./config')
var log = require('./log').logger('macro');

// The marker in the header that signifies a macro.
// TODO - This is used to create files, but not in the regexs used to parse them (see below)
var MARKER = '!FABMO!'

// All the loaded macros will be stored here
var macros = {}


// These functions create macro headers from the specified options
// options:
//         name - The macro display name
//  description - The macro description
//      enabled - Whether or not the macro is enabled (TODO: Is this used?)


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

// Given a number and a type, construct a path to the corresponding macro file
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

// Create default macro content for the specified macro.
// (Use if you want "new" macros to be non-empty)
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

// Iterate over the lines in the macro file, and parse out lines that appear to be part of the header
// filename - The filename of the macro to parse out
// callback - called with the parsed contents of the macro file, eg:
//            {name : 'My Macro', description:'Move to X=10',content : 'MZ,0.5\nMX,10'}
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

// Update an existing macro with new content
//       id - The macro to update
//    macro - The macro object that contains the new content
// callback - called on completion, with an error if appropriate
var update = function(id, macro, callback) {
	// Get the old macro data
	var old_macro = get(id);

	if(old_macro) {
		// Here, we're updating an existing macro
		// We only update fields that were provided in the macro passed in
		// Other fields, we leave alone.
		function savemacro(id, callback) {
			old_macro.name = macro.name || old_macro.name;
			old_macro.description = macro.description || old_macro.description;
			old_macro.content = macro.content || old_macro.content;
			old_macro.index = macro.index || old_macro.index;
			old_macro.type = macro.type || old_macro.type;
			old_macro.filename = _createMacroFilename(old_macro.index, old_macro.type);
			save(id, callback);
		}

		// 
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
