var zmq =require('zmq');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var port = '5556';

//Connect to shopbotd, send the provided object, and read the response
var shopbotd = function(d){
    var self = this;
    var socket = zmq.socket('pair');
    socket.connect("tcp://localhost:" + port); // on localhost
    socket.send(JSON.stringify(d));
    socket.on('message',function(msg){
        console.log('message : '+ msg);
        var data = JSON.parse(msg);
        socket.close();
        self.emit('getmessage',data);
    });
    this.on('newListener', function(listener) {
     });
};
util.inherits(shopbotd , EventEmitter);
module.exports = shopbotd;

