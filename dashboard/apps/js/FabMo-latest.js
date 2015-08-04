//require JQUERY
function FabMo(ip,port) //ip and port of the tool
{
	this.ip = ip || '127.0.0.1';
	this.port = port || '8080';
	this.url = {};
	this.tool_moving = undefined;//for the moving thing
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
	this.url.jog=this.url.direct+'/jog';
	this.url.goto=this.url.direct+'/goto';
	this.url.sbp=this.url.direct+'/sbp';
	this.url.job=this.url.base+'/job';
	this.url.jobs=this.url.base+'/jobs';

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



FabMo.prototype.list_files = function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.file,
		type: "GET",
		dataType : 'json', 
		success: function( data ){
			 	callback(undefined,data.files);
			 },
		error: function( data, err ){
				var error = that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			 }
	});
};
FabMo.prototype.get_status = function(callback)
{
	if (!callback) {
		throw "this function need a callback to work !";
	}
	var that=this;
	$.ajax({
		url: this.url.status,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
				// test errors with the tool (not network error)
				if(!data){callback(that.default_error.status.no_content);}
				else if(!data.status){callback(that.default_error.status.wrong_format);}

				else{callback(undefined,data.status);}
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
			callback(undefined,data);
			},
		error: function(data,err) {
				var error =that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
	});
};

FabMo.prototype.get_info = function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.info,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			callback(undefined,data);
			},
		error: function(data,err) {
				var error =that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
	});
};


FabMo.prototype.download_by_id = function(id)
{
	window.location = this.url.file+ "/" + id;
};

FabMo.prototype.download = function(file)
{
	this.download_by_id(file._id);
};

FabMo.prototype.delete_by_id = function(id,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that = this;
	$.ajax({
		url: this.url.file + '/' + id,
		type: "DELETE",
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
FabMo.prototype.delete = function(file,callback)
{
	this.delete_by_id(file._id,callback);
};


FabMo.prototype.run_by_id = function(id,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.run + '/' + id,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			callback(undefined);
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
FabMo.prototype.run = function(file,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	this.run(file._id,callback);
};

FabMo.prototype.quit = function(callback){
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.quit,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			callback(undefined);
			},
		error: function(data,err) {
    			var error = that.default_error.no_device;
			error.sys_err = err;
		 	callback(error);
		}
	});
};

FabMo.prototype.pause = function(callback){
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.pause,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			callback(undefined);
			},
		error: function(data, err) {
    			var error = that.default_error.no_device;
			error.sys_err = err;
		 	callback(error);
		}
	});
};
 
FabMo.prototype.resume = function(callback){
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.resume,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			callback(undefined);
			},
		error: function(data, err) {
    			var error = that.default_error.no_device;
			error.sys_err = err;
		 	callback(error);
		}
	});
};

FabMo.prototype.goto =  function(x,y,z,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.status,
		type: "POST",
		dataType : 'json', 
		data : {'x' : x, 'y' :y, 'z':z},
		success: function( data ) {
			callback(undefined);
		},
		error: function(data, err) {
    			var error = that.default_error.no_device;
			error.sys_err = err;
		 	callback(error);
		}
	});
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
			callback(undefined,data);
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
			callback(undefined,data);
		},
		error: function(data,err) {
			var error = that.default_error.no_device;
			error.sys_err = err;
			callback(error);
		}
	});
};


FabMo.prototype.start_move =  function(dir,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.move,
		type: "POST",
		dataType : 'json', 
		data :{"move" : dir},
		success: function( data ) {
			if(!that.tool_moving){
				that.tool_moving=setInterval(that.start_move.bind(that,dir,function(){}),250);
				callback(undefined);
			}
		},
		error: function(data,err) {
	    		var error = that.default_error.no_device;
			error.sys_err = err;
		 	callback(error);
		}
	});
};

FabMo.prototype.stop_move =  function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	clearInterval(that.tool_moving);
	that.tool_moving = undefined;
	$.ajax({
		url: this.url.move,
		type: "POST",
		dataType : 'json', 
		data : {"move" : "stop"},
		success: function( data ) {
			callback(undefined);
		},
		error: function(data, err) {
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
			callback(undefined,data);
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
			callback(undefined,data);
			},
		error: function(data,err) {
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
			callback(undefined,data);
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
			callback(undefined);
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
			callback(undefined);
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
FabMo.prototype.resubmit_job =  function(id, callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	$.ajax({
		url: this.url.job + '/' + id,
		type: "POST",
		processData: false,
		contentType: false,
		DataType:'json',
		success: function( data ) {
			return callback(null, data);
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
};


// take a form data, look for a file field, and upload the file load in it
FabMo.prototype.add_job =  function(formdata,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	var formData;
	if (formdata instanceof jQuery){ //if it's a form
		var file = (formdata.find('input:file'))[0].files[0];
		// Create a new FormData object.
		formData = new FormData();
		formData.append('file', file, file.name);
	}
	else // else it's a formData
	{
		formData = formdata;
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
				return callback(null, data);
				console.log(data);
				if (data.responseJSON && data.responseJSON[0]) {
					callback(null,data.responseJSON[0]);
				}
				else if(data.responseJSON) {
					callback(null, data.responseJSON);
				}
				else {
					callback(null,JSON.parse(data.responseText));
				}
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
FabMo.prototype.upload_file =  function(formdata,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	var formData;
	if (formdata instanceof jQuery){ //if it's a form
		var file = (formdata.find('input:file'))[0].files[0];
		// Create a new FormData object.
		formData = new FormData();
		formData.append('file', file, file.name);
	}
	else // else it's a formData
	{
		formData = formdata;
	}		
	if (formData) {
		$.ajax({
			url: this.url.file,
			type: "POST",
			data: formData,
			processData: false,
			contentType: false,
			DataType:'json',

			success: function( data ) {
				if (data.responseJSON && data.responseJSON[0])
						callback(undefined,data.responseJSON[0]);
					else if(data.responseJSON)
						callback(undefined, data.responseJSON);
					else
						callback(undefined, JSON.parse(data.responseText));
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

// non persistent mode : upload, run & delete.
FabMo.prototype.run_local_file =  function(file,ext,callback)
{

	if (!callback)
		throw "this function need a callback to work !";
	var blob = new Blob([file]);
	var fD = new FormData();
	fD.append('file', blob, 'temp.'+ ext);
	var that = this;
	that.upload_file(fD,function(err,file_obj){
		that.run_by_id(file_obj._id,function(){
			that.delete(file_obj,function(){
				if (callback){
					callback('file executed once');}
			});
		});
	});
};



function FabMoAutoConnect(callback,linker_port){
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	DetectToolsOnTheNetworks(function(err,list_tools){
		if (err){ callback(err);return;} 
		SelectATool(list_tools,function(err,tool){
			if (err){ callback(err);return;}
			ChooseBestWayToConnect(tool,function(ip_address,port){
				console.log("Best way selected");
				console.log(ip_address);
				console.log(port);
				callback(undefined,new FabMo(ip_address,port ? port.toString() : '8080'));	
			});
		});
	},linker_port);
}



function ChooseBestWayToConnect(tool,callback){ //return an ip_adress
// automatic selection of the best way to talk to the tool
// base on this priority : usb > ethernet > wifi > wifi-direct
	if (!callback)
		throw "this function need a callback to work !";
	console.log("Choosing best way to connect");
	console.log(tool);
	tool.network.forEach(function(val,key){
		if(val.interface === "usb0")
		{
			callback(val.ip_address,tool.server_port);
			return;
		}
	});
	tool.network.forEach(function(val,key){
		
		if(val.interface === "eth0")
		{
			callback(val.ip_address,tool.server_port);
			return;
		}
	});

	tool.network.forEach(function(val,key){
		if(val.interface === "en0")
		{
			console.log("Choosing en0");
			callback(val.ip_address,tool.server_port);
			return;
		}
	});

	tool.network.forEach(function(val,key){
		if(val.interface === "wlan0")
		{
			callback(val.ip_address,tool.server_port);
			return;
		}
	});
	tool.network.forEach(function(val,key){
		if(val.interface === "wlan1")
		{
			callback(val.ip_address,tool.server_port);
			return;
		}
	});
}

function DetectToolsOnTheNetworks(callback, linker_port){
	if (!callback)
		throw "this function need a callback to work !";
	var port = linker_port || 8080; //port of the link API
	$.ajax({
		url: 'http://localhost:' + port + '/where_is_my_tool',
		type: "GET",
		dataType : 'json'
	}).done(function(data){
		callback(undefined,data);
	}).fail(function(){
		err="Link API not responding !";
		callback(err);
	});
}

function SelectATool(list_tools,callback){
	if (!callback)
		throw "this function need a callback to work !";
	if (list_tools.length === 0)
	{
		var err = "No tools detected";
		callback(err);
	}
	else if (list_tools.length === 1) // perfect case !, a single tool on the network !
	{
		callback(undefined,list_tools[0]);
	}
	else
	{	

		if($('#device_picker').length){
			list_tools.forEach(function(val,key){
				if(key===0){
					$('#device_picker').append('<input type="radio" name="devices" id="'+key+'" value=\''+JSON.stringify(val)+'\' checked="checked" /><label for="'+key+'"> '+ val.hostname+'</label><br>');
				}
				else{
					$('#device_picker').append('<input type="radio" name="devices" id="'+key+'" value=\''+JSON.stringify(val)+'\' /><label for="'+key+'"> '+ val.hostname+'</label><br>');
				}
			});
			$('#device_picker').append($('<button id="device_picker_button">Select</button>'));
			$('#device_picker_button').click(function(){
				if($("input[name='devices']:checked").length)
					callback(undefined,JSON.parse($("input[name='devices']:checked").val()));
			});
			$('#device_picker').trigger('activated',[this]);
		}
		else{
			var $dialog = $('<div/>').addClass('dialog');
			list_tools.forEach(function(val,key){
				$dialog.append('<input type="radio" name="devices" id="'+key+'" value=\''+JSON.stringify(val)+'\' /><label for="'+key+'"> '+ val.hostname+'</label><br>');
			});
			$('body').append($dialog);
			$dialog.dialog({
				autoOpen: true,
				title: "Select a device",
				height: 300,
				width: 350,
				modal: true,
				buttons: {
					Select: function() {
						callback(undefined,JSON.parse($("input[name='devices']:checked").val()));
						$( this ).dialog( "close" );
					}
				}
			});
		}
	} 
}

