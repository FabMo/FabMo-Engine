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

FabMo.prototype.get_status = function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.status,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
				// test errors with the tool (not network error)
				if(!data){callback(that.default_error.status.no_content);}
				if(data.status === "success") {
					for(var key in data.data.status) {
						that.status_report[key] = data.data.status[key];
					}
					callback(undefined,data.data.status);
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

FabMo.prototype.get_config = function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.config,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data.configuration);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data,err) {
				var error =that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
	});
};

FabMo.prototype.set_config =  function(config, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.config,
		type: "POST",
		dataType : 'json', 
		data : config,
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

FabMo.prototype.resubmit_job = function(id,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that = this;
	$.ajax({
		url: this.url.job + '/' + id,
		type: "POST",
		dataType : 'json', 
		success: function( data ) {
			callback(undefined);
			},
		error: function(data,err) {
			if (data.status === 404){callback(that.default_error.file.no_file);}
			else{
				var error = that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}			
		}
	});
};

//TODO should be POST
FabMo.prototype.quit = function(callback){
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.quit,
		type: "GET",
		dataType : 'json', 
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

//TODO should be POST
FabMo.prototype.pause = function(callback){
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.pause,
		type: "GET",
		dataType : 'json', 
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
 
// TODO should be POST
FabMo.prototype.resume = function(callback){
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.resume,
		type: "GET",
		dataType : 'json', 
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

FabMo.prototype.gcode = function(gcode_line,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.gcode,
		type: "POST",
		dataType : 'json', 
		data : {'cmd':gcode_line},
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

FabMo.prototype.sbp = function(sbp_line,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.sbp,
		type: "POST",
		dataType : 'json', 
		data : {'cmd':sbp_line},
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


FabMo.prototype.list_jobs_by_id = function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.jobs,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data.jobs);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data,err) {
				var error =that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
	});
};


FabMo.prototype.list_jobs_in_queue = function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.jobs+'/queue',
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data.jobs);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data,err) {
				var error =that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
	});
};

FabMo.prototype.list_apps = function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.apps,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			if(data.status === "success") {
				callback(null,data.data.apps);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data,err) {
				var error =that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
	});
};

FabMo.prototype.delete_app = function(id, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.apps + '/' + id,
		type: "DELETE",
		dataType : 'json', 
		success: function( data ) {
			if(data.status === "success") {
				callback(null,data.data.app);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data,err) {
				console.error(err);
				var error =that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
	});
};

FabMo.prototype.get_job_history = function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.jobs+'/history',
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data.jobs);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data,err) {
				var error =that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
	});
};


FabMo.prototype.get_job_by_id = function(id,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.job + id,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data.job);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data,err) {
			if (data.status === 404){callback(that.default_error.file.no_file);}
			else if (data.status === 302){callback(undefined);}//success
			else{
				var error = that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
		}
	});
};

FabMo.prototype.get_job_in_queue = function(id,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.job + '/queue/' + id,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			if(data.status === "success") {
				callback(undefined,data.data.job);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data,err) {
			if (data.status === 404){callback(that.default_error.file.no_file);}
			else if (data.status === 302){callback(undefined);}//success
			else{
				var error = that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
		}
	});
};


// take a form data, look for a file field, and upload the file load in it
FabMo.prototype.add_job =  function(formdata,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	var formData;
	var file;
	if (formdata instanceof jQuery){ //if it's a form
		file = (formdata.find('input:file'))[0].files[0];
		// Create a new FormData object.
		formData = new FormData();
		formData.append('file', file, file.name);
	}
	else if (formdata instanceof FormData) {
		formData = formdata;
	} 
	else {
		var content = formdata.data || '';
		var filename = formdata.config.filename || 'job.nc';
		formData = new FormData();
		file = new Blob([content], {type : "text/plain"});
		formData.append('file', file, filename);
		formData.append('name', formdata.config.name || filename);
		formData.append('description', formdata.config.description || 'No Description');
	}
	if (formData) {
		$.ajax({
			url: this.url.job,
			type: "POST",
			data: formData,
			processData: false,
			contentType: false,
			DataType:'json',
			success: function( data ) {
				if(data.status === "success") {
					callback(undefined,data.data.job);
				} else if(data.status==="fail") {
					callback(data.data);
				}	else {
					callback(data.message);
				}
				return;
			},
			error : function(data, err) {
				if (data.status === 400){callback(that.default_error.file.upload.bad_request);}
				else if (data.status === 415){callback(that.default_error.file.upload.not_allowed);}
				else if (data.status === 302){
					if (data.responseJSON && data.responseJSON[0])
						callback(undefined,data.responseJSON[0]);
					else if(data.responseJSON)
						callback(undefined, data.responseJSON);
					else
						callback(undefined, JSON.parse(data.responseText));
				}
				else{
					var error = that.default_error.no_device;
					error.sys_err = err;
				 	callback(error);
				}
			}
		});
	}
};

// take a form data, look for a file field, and upload the file load in it
FabMo.prototype.submit_app =  function(formdata,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	var formData;
	var file;
	if (formdata instanceof jQuery){ //if it's a form
		file = (formdata.find('input:file'))[0].files[0];
		// Create a new FormData object.
		formData = new FormData();
		formData.append('file', file, file.name);
	}
	else if (formdata instanceof FormData) {
		formData = formdata;
	} 
	else {
		content = formdata.data || '';
		filename = formdata.config.filename || 'app.zip';
		formData = new FormData();
		file = new Blob([content], {type : "application/zip"});
		formData.append('file', file, filename);
	}
	if (formData) {
		$.ajax({
			url: this.url.apps,
			type: "POST",
			data: formData,
			processData: false,
			contentType: false,
			DataType:'json',
			success: function( data ) {
				if(data.status === "success") {
					callback(undefined,data.data.app);
				} else if(data.status==="fail") {
					callback(data.data);
				}	else {
					callback(data.message);
				}
				return;
			},
			error : function(data, err) {
				if (data.status === 400){callback(that.default_error.file.upload.bad_request);}
				else if (data.status === 415){callback(that.default_error.file.upload.not_allowed);}
				else if (data.status === 302){
					if (data.responseJSON && data.responseJSON[0])
						callback(undefined,data.responseJSON[0]);
					else if(data.responseJSON)
						callback(undefined, data.responseJSON);
					else
						callback(undefined, JSON.parse(data.responseText));
				}
				else{
					var error = that.default_error.no_device;
					error.sys_err = err;
				 	callback(error);
				}
			}
		});
	}
};

FabMo.prototype.job_run =  function(callback)
{
	var that=this;
	$.ajax({
		url: this.url.jobs + '/queue/run',
		type: "POST",
		dataType : 'json', 
		data : {},
		success: function( data ) {
			typeof callback == 'function' && callback(undefined);
		},
		error: function(data, err) {
			var error = that.default_error.no_device;
			error.sys_err = err;
			typeof callback == 'function' && callback(error);
		}
	});
};

FabMo.prototype.clear_job_queue =  function(callback)
{
	var that=this;
	$.ajax({
		url: this.url.jobs + '/queue',
		type: "DELETE",
		success: function( data ) {
			typeof callback == 'function' && callback(undefined);
		},
		error: function(data, err) {
			var error = that.default_error.no_device;
			error.sys_err = err;
			typeof callback == 'function' && callback(error);
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

FabMo.prototype.get_macros = function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.macros,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			if(data.status === "success") {
				callback(null,data.data);
			} else if(data.status==="fail") {
				callback(data.data);
			}	else {
				callback(data.message);
			}
		},
		error: function(data,err) {
				var error =that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
	});
};

FabMo.prototype.run_macro =  function(id, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.macros + '/' + id + '/run',
		type: "POST",
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

FabMo.prototype.update_macro =  function(id, macro, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.macros + '/' + id,
		type: "POST",
		dataType : 'json', 
		data : macro,
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


FabMo.prototype.delete_macro = function(id, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.macros + '/' + id,
		type: "DELETE",
		dataType : 'json', 
		success: function( data ) {
			if(data.status === "success") {
				callback(null);
			} else if(data.status==="fail") {
				callback(data.data);
			} else {
				callback(data.message);
			}
		},
		error: function(data,err) {
			console.error(err);
			var error =that.default_error.no_device;
			error.sys_err = err;
			callback(error);
		}
	});
};

return FabMo;
}));