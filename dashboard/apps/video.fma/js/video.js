require('jquery');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo();

$(document).ready(function () {
var canvas = document.getElementById('videostream');
var context = canvas.getContext('2d');
fabmo.startVideoStreaming(function(err){
  if (err){
    context.font = "30px Arial";
    context.fillStyle = "grey";
    context.textAlign = "center";
    context.fillText("No video input.", canvas.width/2, canvas.height/2);
    return;
  }
  fabmo.onVideoFrame(function(imageObj){
    context.height = imageObj.height;
    context.width = imageObj.width;
    canvas.width  = imageObj.width;
    canvas.height = imageObj.height;
    context.drawImage(imageObj,0,0,context.width,context.height);
  });

});
});
