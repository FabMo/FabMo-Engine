//require JQUERY
function MakerMo(ip,port) //ip and port of the tool
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



MakerMo.prototype.list_files = function(callback)
{
	$.ajax({
		url: this.url.file,
		type: "GET",
		dataType : 'json', 
		success: function( data ){
			 	callback(data.files);
			 }
	});
}
MakerMo.prototype.get_status = function(callback)
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

MakerMo.prototype.get_config = function(callback)
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



MakerMo.prototype.download_by_id = function(id)
{
	window.location =this.url.file+ "/" + id;
}
MakerMo.prototype.download = function(file)
{
	this.download_by_id(file._id);
}

MakerMo.prototype.delete_by_id = function(id,callback)
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
MakerMo.prototype.delete = function(file,callback)
{
	this.delete_by_id(file._id,callback);
}


MakerMo.prototype.run_by_id = function(id,callback)
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
			console.log(data);
			var err = 'run failed'; 
	    		callback();
			}
	});
}
MakerMo.prototype.run = function(file,callback)
{
	this.run(file._id,callback);
}

MakerMo.prototype.stop = function(){
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



MakerMo.prototype.goto =  function(x,y,z)
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

MakerMo.prototype.gcode = function(gcode_line,callback)
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


MakerMo.prototype.start_move =  function(dir)
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

MakerMo.prototype.stop_move =  function()
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

