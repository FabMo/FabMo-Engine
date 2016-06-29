var ps = require('child_process');
var config = require('../config');
var log = require('../log').logger('routes');

// Try to import udev - if it doesn't work, we don't have video support
var udev = null;
try {
  var udev = require('udev');
} catch(e) {
  log.warn("No video support.  (Could not load udev module)")
}

// video frame limited to 640*360 for now, because of streaming issue (spawn chunk the stdout data buffer to 65536)
var video_settings = config.engine.get('video');

this.server;
var gstreamer=null;
var args=[
  "v4l2src",
  "device="+video_settings.path,
  "!","video/x-raw,width="+video_settings.width+",heigth="+video_settings.height+",framerate="+video_settings.framerate+"/1",
  "!","jpegenc",
  "!","queue",
  "!","fdsink"
];

if(udev) {
  dev_list = udev.list();
  for(i in dev_list){
    if(dev_list[i].DEVNAME===video_settings.path) {
      log.info("Video device connected.");
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
    if(device.DEVNAME===webcam){
      //console.log("webcam changed");
    }
  });
}


function configure_listener(gstreamer){
  if(gstreamer) {
    gstreamer.stdout.on('data', function (data) {
      var frame = new Buffer(data).toString('base64');
      server.io.of('/video').emit('frame',frame);
    });

    gstreamer.stderr.on('data',function(data){
      log.debug(data);
    });
    gstreamer.on('close',function(code){
      log.debug("gstreamer returns with code "+code);
    })

    gstreamer.stdout.on('end',function(){
      log.debug("end!");
      // do something with var data
    });
  }
}

module.exports = function(server) {
  this.server=server;
  server.io.of('/video').on('connection',function(){
    log.debug("client connected to video endpoint");
  })
};
