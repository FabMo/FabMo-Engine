var csv = require('csv');  // Requires this at 0.3.7: npm install csv@0.3.7
var fs = require('fs');

prm = fs.readFileSync('../data/shopbotw.prm','utf8');
cmd = fs.readFileSync('../data/shopbotw.cmd','utf8');

function scrubName(name) {
	name = name.replace(/\[\&([A-Za-z0-9#])\]/, '$1') // Normalize [&H]otkeys
	name = name.replace(/\s*\*\s*/, '');              // Remove astrixes
	return name
}

function parseDefault(dflt) {
	parts = dflt.split(/[-=](?![0-9])/);
	console.log(parts);
	return new Array(parts[0].trim(), parts[1].trim())
}

// Deal with commands 
var commands = {}

var cmd_done = false;
row_count = 0;
csv().from.string(cmd).on('record', function(record, idx) {
	if(row_count < 9) {
		row_count += 1;
		return;
	}
	row_count += 1;

	cmd = record[0]
	fullname = record[1]
	order = record[2]
	nparam = record[3]
	line = record[4]
	type = record[5]
	disptype = record[6]
	dispset = record[7]
	lastcur = record[8]

	command = {}
	command.cmd = cmd
	command.name = scrubName(fullname)

	if(command.name != "<seperator>" && cmd != 'H5') {
		commands[cmd] = command;
	}
}).on('end', function(count) {
	console.log(commands);
	var	row_count = 0;
	var param_list = [];
	var prm_done = false;
	var params = {};
	var current_cmd = null;
	var current_param = {};

	csv().from.string(prm).on('record', function(record, idx) {
		if(row_count < 2) {
			row_count += 1;
			return;
		}
		row_count += 1;

		if(record[0] != '') {
			param_list.push(current_param);
			current_param = {}
			if(current_cmd != null) {
				console.log(current_cmd);
				commands[current_cmd].params = param_list;
			}
			current_cmd = record[1];
			nparams = parseInt(record[0]);
			param_list = [];
		}
		current_param.type = record[7];
		switch(current_param.type) {
			case 'ops':
			case 'opt':
				if(record[6] == '') {
					current_param.name = record[4];
					current_param.desc = record[5];
					current_param.abrev = record[6];
					current_param.typeext = parseInt(record[8]);
					current_param.default = parseDefault(record[10]);
				} else {
					current_param.opts = [];
				}
				current_param.opts.push(parseDefault(record[10]));
			break;
			default:
				current_param.name = record[4];
				current_param.desc = record[5];
				current_param.abrev = record[6];
				current_param.typeext = parseInt(record[8]);
				current_param.default = record[10];
			break;		
		}
	}).on('end', function(count) {
		fs.writeFile("cmd.json",JSON.stringify(commands, null, 3));
	});
});


