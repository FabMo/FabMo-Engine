var configuration = require('./configuration');
var machine=require('./machine').machine;
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


exports.load = function(driver){
	
	configuration.forEach(function(val,index,array)
	{
//		console.log(val);
		for(var key in val)
		{
		
			if (allowed_commands(key))
			{
				var cmd = {};
				cmd[key]=val[key];
				driver.command(cmd);
				//console.log('load conf : '+ key + ' : '+ val[key]);
			}
			else
			{
				throw new Error('configuration file at line '+(index+1)+': command "'+key+'" is not a valid command');
			}
		}
	});
}

exports.single_load =function(driver, cmd_obj){
	for(var key in cmd_obj)
		{
			if (allowed_commands(key))
			{
				var cmd = {};
				cmd[key]=val[key];
				driver.command(cmd);
			}
			else
				throw new Error('command "'+key+'" is not a valid command');
		}

};

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
