var configuration = require('./configuration');
var machine=require('./machine').machine;
var log=require('./log');

var ALLOWED_COMMANDS = ["1ma","1sa","1tr","1mi","1po","1pm","2ma","2sa",
"2tr","2mi","2po","2pm","3ma","3sa","3tr","3mi","3po","3pm","4ma",
"4sa","4tr","4mi","4po","4pm","5ma","5sa","5tr","5mi","5po","5pm",
"6ma","6sa","6tr","6mi","6po","6pm","xam","xvm","xfr","xtm","xjm",
"xjh","xjd","xsn","xsx","xsv","xlv","xzb","yam","yvm","yfr","ytm",
"yjm","yjh","yjd","ysn","ysx","ysv","ylv","yzb","zam","zvm","zfr",
"ztm","zjm","zjh","zjd","zsn","zsx","zsv","zlv","zzb","aam","avm",
"afr","atm","ajm","ajh","ajd","ara","asn","asx","asv","alv","azb",
"bam","bvm","bfr","btm","bjm","bjd","bra","cam","cvm","cfr","ctm",
"cjm","cjd","cra","p1frq","p1csl","p1csh","p1cpl","p1cph","p1wsl","p1wsh",
"p1wpl","p1wph","p1pof","fb","fv","hv","id","ja","ct","st","mt","ej",
"jv","tv","qv","sv","si","ic","ec","ee","ex","baud","gpl","gun","gco",
"gpa","gdi","sr","qr","qf","md","me","test","defa","boot","help","qr",
"qf","md","me","test","defa","boot","help","ml","ma","ms","qrh","qrl",
"st","xjh","xsn","xsx","xtm","xsv","xlv","xlb","xzb","yjh","ysn","ysx",
"ytm","ysv","ylv","ylb","yzb","zjh","zsn","zsx","ztm","zsv","zlv",
"zlb","zzb","asn","asx"];

var sent = 0;
var recv = 0;
function config_single(driver, cmd, success_callback) {
	driver.on('message', function handler(resp) {
		if (resp && (resp instanceof Object) && ('r' in resp)) { // filter for response
			r = resp.r
			cmd_key = Object.keys(cmd)[0].toLowerCase();
			try {
				r_key = Object.keys(r)[0].toLowerCase();
			} catch(e) {
				return;
			}
			if ( cmd_key === r_key ) { //check if response correspond to the request
				if(resp.f) { //check if there is a feedback
					if (resp.f[1] === 0) {
						driver.removeListener('message', handler)
						recv += 1;
						typeof success_callback === 'function' && success_callback(driver);
					}
					else {
						driver.removeListener('message', handler)
						log.error(cmd + 'not executed correctly! LOAD FAILED. EXIT.');
						exit(-1);
					}
				}
			}
		}
	});
	sent += 1;
	driver.command(cmd);
};

exports.load = function(driver, callback) {
	// HARD CODED QUEUE REPORT VERBOSITY
	configuration.unshift({"sr":{"posx":true, "posy":true, "posz":true, "posa":true, "posb":true, "vel":true, "stat":true, "hold":true, "line":true, "coor":true}})
	configuration.unshift({'qv':2});
	config_single(driver, configuration.shift(), function next() {
		next_cmd = configuration.shift()
		if(next_cmd) {
			config_single(driver, next_cmd, next);
		} else {
			typeof callback === 'function' && callback(driver);
		}
	});
}

function allowed_commands(command){
	if (ALLOWED_COMMANDS.indexOf(command.toLowerCase())!== -1)
	{
		return true;
	}
	else
	{
		return false;
	}
};
