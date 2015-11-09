;(function (root, factory) {

  /* CommonJS */
  if (typeof module == 'object' && module.exports) module.exports = factory()

  /* AMD module */
  else if (typeof define == 'function' && define.amd) define(factory)

  /* Browser global */
  else root.FabMo = factory()
}(this, function () {
  "use strict"

//require JQUERY
function FabMo(ip,port) //ip and port of the tool
{
	this.ip = ip || '127.0.0.1';
	this.port = port || '8080';
	this.url = {};
	this.tool_moving = undefined;//for the moving thing
	this.old_lock_status = null;
	this.interval_moving = 250;//Default was 250
	this.status_report = {};
	this.url.base = 'http://'+this.ip+':'+this.port;
	this.url.file=this.url.base+"/file";
	this.url.status=this.url.base+'/status';
	this.url.config=this.url.base+'/config';
	this.url.info=this.url.base+'/info';
	this.url.run=this.url.base+'/run';
	this.url.pause=this.url.base + '/pause';
	this.url.quit=this.url.base + '/quit' ;
	this.url.resume=this.url.base + '/resume';
	this.url.direct=this.url.base + '/direct';
	this.url.gcode=this.url.direct+'/gcode';
	this.url.move=this.url.direct+'/move';
	this.url.fixed_move = this.url.direct+'/fixed_move';
	this.url.jog=this.url.direct+'/jog';
	this.url.goto=this.url.direct+'/goto';
	this.url.sbp=this.url.direct+'/sbp';
	this.url.job=this.url.base+'/job';
	this.url.jobs=this.url.base+'/jobs';
	this.url.apps=this.url.base+'/apps';
	this.url.wifi = this.url.base + '/network/wifi';
	this.url.hotspot = this.url.base + '/network/hotspot';
	this.url.macros = this.url.base + '/macros';

	// default error message definitions
	// that method allow to give more details on error
	this.default_error = {};
	this.default_error = {
			         'no_device' : {
				     'message' :'the device you try to acccess is not reacheable !',
				     'sys_err' : '' //give the error returned by javascript interpreter
				 }
			     };
	this.default_error.status = {
				'no_core' : {
				    'message' : 'The  core system is not plug via USB to the SBC',
				    'sys_err' : ''
				    },
				'core_not_responding' :{
				    'message' : 'The  core system is not responding',
				    'sys_err' : ''
				    },
				'no_content' :{
				    'message' : 'The device return a void response',
				    'sys_err' : ''
				    },
				'wrong_format' :{
				    'message' : 'The format of the status is wrong',
				    'sys_err' : ''
				    }

				};
	this.default_error.config = {};
	this.default_error.run = {};
	this.default_error.file = {
		'no_file' :{
			'message' : "The file you requested doesn't exist",
			'sys_err' : ''
		},
		'upload' :{
			'bad_request' : {
				'message' : "The request you sent was wrong",
				'sys_err' : ''
			},
			'not_allowed' : {
				'message' : "The file extension is not allowed",
				'sys_err' : ''
			}
		}
	};
}


FabMo.prototype.fixed_move =  function(dir,step,speed,callback)
{
//	if (!callback)
//		throw "this function need a callback to work !";

	var that=this;
	$.ajax({
		url: this.url.fixed_move,
		type: "POST",
		dataType : 'json', 
		data :{"move" : dir, "step" : step, "speed" : speed},
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data,err) {
			var error = that.default_error.no_device;
			error.sys_err = err;
		 	callback(error);
		}
	});
};

FabMo.prototype.connect_to_wifi =  function(ssid, key, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.wifi + '/connect',
		type: "POST",
		dataType : 'json', 
		data : {"ssid" : ssid, "key" : key},
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data, err) {
			var error = that.default_error.no_device;
			error.sys_err = err;
			callback(error);
		}
	});
};

FabMo.prototype.disconnect_from_wifi =  function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.wifi + '/disconnect',
		type: "POST",
		dataType : 'json',
		data : {disconnect:true}, 
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data, err) {
			var error = that.default_error.no_device;
			error.sys_err = err;
			callback(error);
		}
	});
};

FabMo.prototype.forget_wifi =  function(ssid, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.wifi + '/forget',
		type: "POST",
		dataType : 'json', 
		data : {"ssid" : ssid},
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data, err) {
			var error = that.default_error.no_device;
			error.sys_err = err;
			callback(error);
		}
	});
};

FabMo.prototype.enable_wifi =  function(ssid, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.wifi + '/state',
		type: "POST",
		dataType : 'json', 
		data : {"enabled" : true},
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data, err) {
			var error = that.default_error.no_device;
			error.sys_err = err;
			callback(error);
		}
	});
};

FabMo.prototype.disable_wifi =  function(ssid, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.wifi + '/state',
		type: "POST",
		dataType : 'json', 
		data : {"enabled" : false},
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data, err) {
			var error = that.default_error.no_device;
			error.sys_err = err;
			callback(error);
		}
	});
};

FabMo.prototype.enable_hotspot =  function(ssid, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.hotspot + '/state',
		type: "POST",
		dataType : 'json', 
		data : {"enabled" : true},
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data, err) {
			var error = that.default_error.no_device;
			error.sys_err = err;
			callback(error);
		}
	});
};

FabMo.prototype.disable_hotspot =  function(ssid, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.hotspot + '/state',
		type: "POST",
		dataType : 'json', 
		data : {"enabled" : false},
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data, err) {
			var error = that.default_error.no_device;
			error.sys_err = err;
			callback(error);
		}
	});
};

return FabMo;
}));