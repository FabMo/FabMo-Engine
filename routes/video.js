var ps = require('child_process');

// create new ffmpeg processor instance using input stream
// instead of file path (can be any ReadableStream)
var ffmpeg = ps.spawn("ffmpeg", [
  "-re",
  "-y",
  "-i",
  "/dev/video0",
  "-preset",
  "ultrafast",
  "-f",
  "mjpeg",
  "pipe:1"
]);


module.exports = function(server) {
  ffmpeg.stdout.on('data', function (data) {
    var frame = new Buffer(data).toString('base64');
    server.io.of('/video').emit('video',frame);
  });
  ffmpeg.stderr.on('data',function(data){
    console.log(data);
  });
  ffmpeg.on('close',function(code){
    console.log("ffmpeg returns with code "+code);
  })
};
