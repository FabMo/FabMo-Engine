var ps = require('child_process');
var udev = require("udev");
var webcam="/dev/video0";


this.server;
var gstreamer;
var args=[
  "v4l2src",
  "device="+webcam,
  "!","image/jpeg,framerate=15/1",
  "!","queue",
  "!","fdsink"
];


dev_list = udev.list();
for(i in dev_list){
  if(dev_list[i].DEVNAME===webcam){
    //console.log("webcam hooked up");
    gstreamer = ps.spawn("gst-launch",args);
    configure_listener(gstreamer);
  }
}

var monitor = udev.monitor();
monitor.on('add', function (device) {
  if(device.DEVNAME===webcam){
    //console.log("webcam plugged");
    gstreamer = ps.spawn("gst-launch",args);
    configure_listener(gstreamer);
  }
});
monitor.on('remove', function (device) {
  if(device.DEVNAME===webcam){
    //console.log("webcam unplugged");
  }
});
monitor.on('change', function (device) {
  if(device.DEVNAME==="/dev/video0"){
    //console.log("webcam changed");
  }
});


function configure_listener(gstreamer){
  gstreamer.stdout.on('data', function (data) {
    //console.log(data);
    var frame = new Buffer(data).toString('base64');
    server.io.of('/video').emit('video',frame);
  });
  gstreamer.stderr.on('data',function(data){
    //console.log(data);
  });
  gstreamer.on('close',function(code){
    //console.log("gstreamer returns with code "+code);
  })


}


module.exports = function(server) {
  this.server=server;
  server.io.of('/video').on('connection',function(){
    //console.log("client connected");
  })
};
