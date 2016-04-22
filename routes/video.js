var ps = require('child_process');

// create new ffmpeg processor instance using input stream
// instead of file path (can be any ReadableStream)
var ffmpeg = ps.spawn("gst-launch", [
  "v4l2src",
  "device=/dev/video0",
  "!","image/jpeg,framerate=15/1",
  "!","queue",
  "!","fdsink"
]);


module.exports = function(server) {
  ffmpeg.stdout.on('data', function (data) {
    //console.log(data);
    var frame = new Buffer(data).toString('base64');
    server.io.of('/video').emit('video',frame);
  });
  ffmpeg.stderr.on('data',function(data){
    console.log(data);
  });
  ffmpeg.on('close',function(code){
    console.log("ffmpeg returns with code "+code);
  })

  server.io.of('/video').on('connection',function(){console.log("client connected");})
};
