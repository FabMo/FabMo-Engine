//require JQUERY
function FabMo(ip,port) //ip and port of the tool
{
	this.ip = ip || '127.0.0.1';
	this.port = port || '8080';
	this.url = {};
	this.url.base = 'http://'+this.ip+':'+this.port;
	this.url.file=this.url.base+"/file";
	this.url.status=this.url.base+'/status';
	this.url.config=this.url.base+'/config';
	this.url.run=this.url.base+'/run';
		//this.url.pause=this.url.base + '/pause';
	this.url.quit=this.url.base + '/quit' ;
		//this.url.resume=this.url.base + '/resume';
	this.url.direct=this.url.base + '/direct';
	this.url.gcode=this.url.direct+'/gcode';
	this.url.move=this.url.direct+'/move';
	this.url.jog=this.url.direct+'/jog';
	this.url.goto=this.url.direct+'/goto';

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
				else if(!data.status){callback(that.default_error.status.wrong_format);}

				else{callback(undefined,data.status);}
			},
		error: function(data,err) {
				var error = that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
	});
}

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
			callback(undefined,data.config);
			},
		error: function(data,err) {
				var error =that.default_error.no_device;
				error.sys_err = err;
			 	callback(error);
			}
	});
}



FabMo.prototype.download_by_id = function(id)
{
	window.location = this.url.file+ "/" + id;
}

FabMo.prototype.download = function(file)
{
	this.download_by_id(file._id);
}

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
}
FabMo.prototype.delete = function(file,callback)
{
	this.delete_by_id(file._id,callback);
}


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
}
FabMo.prototype.run = function(file,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	this.run(file._id,callback);
}

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
}



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
}

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
		error: function(data) {
			var error = that.default_error.no_device;
			error.sys_err = err;
			callback(error);
		}
	});
}


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
			callback(undefined);
		},
		error: function(data,err) {
	    		var error = that.default_error.no_device;
			error.sys_err = err;
		 	callback(error);
		}
	});
}

FabMo.prototype.stop_move =  function(callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
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
}


// take a form data, look for a file field, and upload the file load in it
FabMo.prototype.upload_file =  function(formdata,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	if (formdata instanceof jQuery){ //if it's a form
		var file = (formdata.find('input:file'))[0].files[0];
		// Create a new FormData object.
		var formData = new FormData();
		formData.append('file', file, file.name);
	}
	else // else it's a formData
	{
		var formData = formdata;
	}		
	if (formData) {
		$.ajax({
			url: this.url.file,
			type: "POST",
			data: formData,
			processData: false,
			contentType: false,
			DataType:'json',
			/*statusCode: {
				302: function(res) {
					if (res.responseJSON && res.responseJSON[0])
						callback(undefined,res.responseJSON[0]);
					else if(res.responseJSON)
						callback(undefined, res.responseJSON);
					else
						callback(undefined, JSON.parse(res.responseText));
				},
				400: function(res,err) {
				 	callback(that.default_error.file.upload.bad_request);
				},
				415: function(res,err) {
				 	callback(that.default_error.file.upload.not_allowed);
				}
			},*/
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
}

// non persistent mode : upload, run & delete.
FabMo.prototype.run_local_file =  function(file,callback)
{
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	var formData = new FormData();
	formData.append('file', file, file.name);
	var that = this;
	that.upload_file(formData,function(file_obj,callback){
		that.run_by_id(file_obj._id,function(){
			that.delete(file_obj,function(){
				if (callback)
					callback(undefined, 'file executed once');
			});
		});
	});
}



function FabMoAutoConnect(callback){
	if (!callback)
		throw "this function need a callback to work !";
	var that=this;
	DetectToolsOnTheNetworks(function(err,list_tools){
		if (err){ callback(err);return;} 
		SelectATool(list_tools,function(err,tool){
			if (err){ callback(err);return;}
			ChooseBestWayToConnect(tool,function(ip_address){
				callback(undefined,new FabMo(ip_address));	
			});
		});
	});
}



function ChooseBestWayToConnect(tool,callback){ //return an ip_adress
// automatic selection of the best way to talk to the tool
// base on this priority : usb > ethernet > wifi > wifi-direct
	if (!callback)
		throw "this function need a callback to work !";
	tool.network.forEach(function(val,key){
		if(val.interface === "usb0")
		{
			callback(val.ip_address);
			return;
		}
		if(val.interface === "eth0")
		{
			callback(val.ip_address);
			return;
		}

		if(val.interface === "wlan0")
		{
			callback(val.ip_address);
			return;
		}

		if(val.interface === "wlan1")
		{
			callback(val.ip_address);
			return;
		}
	});
}

function DetectToolsOnTheNetworks(callback){
	if (!callback)
		throw "this function need a callback to work !";
	var port = 8080; //port of the link API
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
		var err = "No tools detected"
		callback(err);
	}
	else if (list_tools.length === 1) // perfect case !, a single tool on the network !
	{
		callback(undefined,list_tools[0]);
	}
	else
	{	
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

