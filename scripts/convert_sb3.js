var csv = require('csv');  // Requires this at 0.3.7: npm install csv@0.3.7
var fs = require('fs');

prm = fs.readFileSync('../data/shopbotw.prm','utf8');
cmd = fs.readFileSync('../data/shopbotw.cmd','utf8');

function scrubName(name) {
	name = name.replace(/\[\&([A-Za-z0-9#])\]/, '$1'); // Normalize [&H]otkeys
	name = name.replace(/\s*\*\s*/, '');              // Remove astrixes
	return name;
}

function parseDefault(dflt) {
	parts = dflt.split(/[-=](?![0-9])/);
	return new Array(parts[0].trim(), parts[1].trim());
}

// Deal with commands 
var commands = {};

var cmd_done = false;
row_count = 0;
csv().from.string(cmd).on('record', function(record, idx) {
	if(row_count < 9) {
		row_count += 1;
		return;
	}
	row_count += 1;

	cmd = record[0];
	fullname = record[1];
	order = record[2];
	nparam = record[3];
	line = record[4];
	type = record[5];
	disptype = record[6];
	dispset = record[7];
	lastcur = record[8];

	command = {};
	command.cmd = cmd;
	command.name = scrubName(fullname);

	if(command.name != "<seperator>" && cmd != 'H5') {
		commands[cmd] = command;
	}
}).on('end', function(count) {
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

		if(record[0] !== ''){
			if(current_cmd !== null) {
				console.log(current_cmd);
				console.log(param_list);
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
			case 'ck':
				if(record[6] === '') {
					df = parseDefault(record[10]);
					opt = {};
					opt.value = df[0];
					opt.desc = df[1];
					current_param.opts.push({'value':df[0], 'desc':df[1]});
				} else {
					current_param = {};
					current_param.name = record[4];
					current_param.desc = record[5];
					current_param.abrev = record[6];
					current_param.typeext = parseInt(record[8]);
					df = parseDefault(record[10]);
					current_param.default = df[0];
					current_param.default_desc = df[1];
					current_param.opts = [];
					param_list.push(current_param);
					current_param.sysvar = record[13];
				}

			break;

			case 'sep':
			case 'rel':
			break;
			
			default:
				current_param = {};
				current_param.name = record[4];
				current_param.desc = record[5];
				current_param.abrev = record[6];
				current_param.typeext = parseInt(record[8]);
				current_param.default = record[10];
				lo = record[11] || null;
				hi = record[12] || null;
				current_param.sysvar = parseInt(record[13]);
				current_param.range = new Array(lo,hi);
				param_list.push(current_param);

			break;		
		}

	}).on('end', function(count) {
		fs.writeFile("../data/sb3_commands.json",JSON.stringify(commands, null, 3));
	});
});


