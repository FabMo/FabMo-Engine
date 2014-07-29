var csv = require('csv');  // Requires this at 0.3.7: npm install csv@0.3.7
var fs = require('fs');

prm = fs.readFileSync('../data/shopbotw.prm','utf8');
cmd = fs.readFileSync('../data/shopbotw.cmd','utf8');

function scrubName(name) {
	name = name.replace(/\[\&([A-Za-z0-9#])\]/, '$1') // Normalize [&H]otkeys
	name = name.replace(/\s*\*\s*/, '');              // Remove astrixes
	return name
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
		commands.cmd = command;
		console.log(command);
	}
});


row_count = 0;
var param_list;
var prm_done = false;
var params = {};
var current_cmd = null;

csv().from.string(prm).on('record', function(record, idx) {
	if(row_count < 2) {
		row_count += 1;
		return;
	}
	row_count += 1;

	if(record[0] != '') {
		if(current_cmd != null) {
			params[current_cmd] = param_list;
		}
		current_cmd = record[1];
		nparams = parseInt(record[0]);
		console.log(param_list)
		param_list = [];
	}
	param = {}
	param.name = record[4];
	param.desc = record[5];
	param.abrev = record[6];
	param.type = record[7];
	param.typeext = parseInt(record[8]);
	param.default = record[10];
	console.log(param);
	param_list.push(param);
}).on('end', function(count) {
	fs.writeFile("prm.json",JSON.stringify(params, null, 3));
});
 

console.log('for real.')

//fs.writeFile("cmd.json",JSON.stringify(commands));