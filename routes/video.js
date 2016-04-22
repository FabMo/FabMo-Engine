var ps = require('child_process');

// create new ffmpeg processor instance using input stream
// instead of file path (can be any ReadableStream)
var ffmpeg = ps.spawn("gst-launch", [
  "v4l2src",
  "device=/dev/video0",
  "!","video/x-raw-yuv,framerate=30/1",
  "!","queue",
  "!","jpegenc",
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
