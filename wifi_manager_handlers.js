var wifiscanner = require('node-simplerwifiscanner');
var log = require('./log').logger('wifi');
var fs= require('fs');

var profiles_folder = "/etc/netctl/";
var itr = "wlan0";


exports.detection = function(req, res, next) {

    // data is a wifi_info Object
    wifiscanner.scan(function(err,data){
    	if (err) {
        	log.error(err);
        	res.json(500,err);
        	return;
    	}
    	    res.json(200,data);
    });

};


exports.list_profiles = function(req, res, next) {
	profiles = [];
	fs.readdir(profiles_folder,function(err,files){
		if(err){
			log.error('bad wifi profiles folder : '+ profiles_folder + ' ['+err+']');
        	res.json(500,err); 
        	return;
        }
    	files.forEach(function(file,index,array){
    		if(file.indexOf(itr+"-")===0){
    			fs.readFile(profiles_folder+file, function (err, data) {
					if(err){
						log.error('error while reading wifi profile : '+ profiles_folder+file + ' ['+err+']');
			        	res.json(500,err); 
			        	return;
					}
					profiles.push(parse_profile(data));
					if (index===array.length-1)
						res.json(200,profiles);
				});
    		}
    	})

	});
};

exports.add_profile = function(req, res, next) {
    if(req.params.wifi_info !== undefined){
    	var wifi_info = req.params.wifi_info;
    	var file_string = create_profile(wifi_info);
    	if(file_string !== undefined){
    		fs.writeFile(profiles_folder+itr+'-'+wifi_info.ssid,file_string, function (err) { // write the profile file
			  if (err){
				log.error('error while writing wifi profile : '+ profiles_folder+itr+'-'+wifi_info.ssid + ' ['+err+']');
	        	res.json(500,err); 
	        	return;
			  } 
			  log.info('Wifi profile added for '+ wifi_info.ssid);
			  res.send(200);
			});
    	}else{
    		res.json({'error':'Bad network informations provided'});
    	}
    }
    else
    	res.json({'error':'No network informations provided'});
};

exports.delete_profile = function(req, res, next) {
    //TODO
    res.send(200);
};

// parse a profile string and convert it into a json Object
function parse_profile(profile_txt,callback){
	var profile = {};
	var lines = profile_txt.toString().split('\n');
	for(index in lines){
		var arg = lines[index].trim().split('=');
		log.debug(arg);
		if(arg[0])
			profile[arg[0]]=arg[1];
	}
	return profile;
};

// create a profile string from a wifi_info object
function create_profile(wifi_info){
	if(!wifi_info)
		return undefined;
	if(wifi_info.security !== "none" && wifi_info.security && "wep" && wifi_info.security !== "wpa" )
		return undefined;
	if(!wifi_info.ssid)
		return undefined;

	var profile_string="";

	profile_string+=	"Description='Generated profile through the FabMo Platform'\n";
	profile_string+=	"Interface="+itr+'\n';
	profile_string+=	"Connection=wireless\n";
	profile_string+=	"Security="+wifi_info.security+'\n';
	profile_string+=	"ESSID="+wifi_info.ssid+'\n';
	profile_string+=	"IP=dhcp\n";
	if(wifi_info.security!=="none" && wifi_info.key === undefined)
		return undefined;
	else
		profile_string+="Key="+wifi_info.key+'\n';


	return profile_string;

};