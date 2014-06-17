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
	this.url.pause=this.url.base + '/pause';
	this.url.quit=this.url.base + '/quit' ;
	this.url.resume=this.url.base + '/resume';
	this.url.direct=this.url.base + '/direct';
	this.url.gcode=this.url.direct+'/gcode';
	this.url.move=this.url.direct+'/move';
	this.url.jog=this.url.direct+'/jog';
	this.url.goto=this.url.direct+'/goto';
	this.url.stop = this.url.quit;
	
	// default error message definitions
	this.default_error = {};
	this.default_error.status = 
		{'state':'disconnected',
		 'line':"???",
  		 "posx":"???",
		 "posy":"???",
		 "posz":"???",
		 "posa":"???",
		 "posb":"???",
		 "posc":"???",
		 "feed":"???",
		 "vel":"???",
		 "unit":"???",
		 "coor":"???",
		 "dist":"???",
		 "path":"???",
		 "frmo":"???",
		 "momo":"???",
		 "stat":"???"
		};
	this.default_error.config = {};
	this.default_error.run = {};
}



FabMo.prototype.list_files = function(callback)
{
	$.ajax({
		url: this.url.file,
		type: "GET",
		dataType : 'json', 
		success: function( data ){
			 	callback(data.files);
			 },
		error: function( data ){
			 	
			 }
	});
}
FabMo.prototype.get_status = function(callback)
{
	$.ajax({
		url: this.url.status,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			callback(data.status);
			},
		error: function(data) {
	    		callback(this.default_error.status);
			}
	});
}

FabMo.prototype.get_config = function(callback)
{
	$.ajax({
		url: this.url.config,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			callback(data.config);
			},
		error: function(data) {
	    		callback(this.default_error.config);
			}
	});
}



FabMo.prototype.download_by_id = function(id)
{
	window.location =this.url.file+ "/" + id;
}
FabMo.prototype.download = function(file)
{
	this.download_by_id(file._id);
}

FabMo.prototype.delete_by_id = function(id,callback)
{
	$.ajax({
		url: this.url.file + '/' + id,
		type: "DELETE",
		dataType : 'json', 
		success: function( data ) {
			callback();
			},
		error: function(data) {
			var err = 'delete failed'; 
	    		callback(err);
			}
	});
}
FabMo.prototype.delete = function(file,callback)
{
	this.delete_by_id(file._id,callback);
}


FabMo.prototype.run_by_id = function(id,callback)
{
	var that=this;
	$.ajax({
		url: this.url.run + '/' + id,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			callback();
			},
		error: function(data) {
			var err = 'run failed'; 
	    		callback();
			}
	});
}
FabMo.prototype.run = function(file,callback)
{
	this.run(file._id,callback);
}

FabMo.prototype.stop = function(){
	$.ajax({
		url: this.url.stop,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			return true;
			},
		error: function(data) {
	    		return false;
			}
	});
}
FabMo.prototype.quit = FabMo.prototype.stop;

FabMo.prototype.pause = function(){
	$.ajax({
		url: this.url.pause,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			return true;
			},
		error: function(data) {
	    		return false;
			}
	});
}

FabMo.prototype.resume = function(){
	$.ajax({
		url: this.url.resume,
		type: "GET",
		dataType : 'json', 
		success: function( data ) {
			return true;
			},
		error: function(data) {
	    		return false;
			}
	});
}

FabMo.prototype.goto =  function(x,y,z)
{
	$.ajax({
		url: this.url.status,
		type: "POST",
		dataType : 'json', 
		data : {'x' : x, 'y' :y, 'z':z},
		success: function( data ) {
			return true;
			},
		error: function(data) {
	    		return false;
			}
	});
}

FabMo.prototype.gcode = function(gcode_line,callback)
{
	$.ajax({
		url: this.url.gcode,
		type: "POST",
		dataType : 'json', 
		data : {'cmd':gcode_line},
		success: function( data ) {
			var err=undefined;
			callback(err,data);
			},
		error: function(data) {
			console.log(this.url);
			var err = 'gcode command failed'; 
	    		callback(err,data);
			}
	});
}


FabMo.prototype.start_move =  function(dir)
{
	$.ajax({
		url: this.url.move,
		type: "POST",
		dataType : 'json', 
		data :{"move" : dir},
		success: function( data ) {
			return true;
			},
		error: function(data) {
	    		return false;
			}
	});
}

FabMo.prototype.stop_move =  function()
{
	$.ajax({
		url: this.url.move,
		type: "POST",
		dataType : 'json', 
		data : {"move" : "stop"},
		success: function( data ) {
			return true;
			},
		error: function(data) {
	    		return false;
			}
	});
}


// take a form data, look for a file field, and upload the file load in it
FabMo.prototype.upload_file =  function(formdata,callback)
{
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
			statusCode: {
				302: function(res) {
					if (res.responseJSON && res.responseJSON[0])
						callback(res.responseJSON[0]);
					else if(res.responseJSON)
						callback(res.responseJSON);
					else
						callback(JSON.parse(res.responseText));
				},
				400: function(res) {
					alert('file upload error : bad request');
					callback(res); 
				},
				415: function(res) {
					alert('file upload error : not allowed format');
					callback(res); 
				}
			}
		});
	}
}

// non persistent mode : upload, run & delete.
FabMo.prototype.run_local_file =  function(file,callback)
{
	var formData = new FormData();
	formData.append('file', file, file.name);
	var that = this;
	that.upload_file(formData,function(file_obj,callback){
		console.log(file_obj);
		that.run_by_id(file_obj._id,function(){
			that.delete(file_obj,function(){
				if (callback)
					callback('file executed once');
			});
		});
	});
}



function FabMoAutoConnect(callback){
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
	console.log(tool);
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

