var net =require('net');
var port = 5556;
//Connect to shopbotd, send the provided object, and read the response
exports.shopbotd = function shopbotd(d){
    /*
    var socket = new net.Socket();
    socket.connect(port); // on localhost
    socket.write(JSON.stringify(d));
    socket.on('data',function(data){
        socket.end();
        return JSON.parse(data);
    });
    */
	return {"xpos":0,"ypos":0,"zpos":0,"a":0,"b":0,"c":0,"state":"idle"} ;
};