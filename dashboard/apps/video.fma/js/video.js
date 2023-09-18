require('jquery');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo();
var camera1_on = false;
var camera2_on = false; 

window.onload = function() {

  // set up 2 cameras
  var img1 = document.getElementById('camera1');
  var img2 = document.getElementById('camera2');


  ////## th - experiment on FLOW "back" or (Esc) re: Sb4 and similar apps

    // get info for setting up exit-back behavior
    let this_App = "video";
    let default_App = localStorage.getItem("defaultapp");
    let back_App = localStorage.getItem("backapp");
    let current_App = localStorage.getItem("currentapp");
    // do nothing if current (e.g. refreshes and returns)
    if (this_App != current_App) {
        back_App = current_App;
        if (back_App === null || back_App === "") {back_App = default_App};
        back_App = default_App; // * > always to here for video
        current_App = this_App;
        localStorage.setItem("currentapp", current_App);
        localStorage.setItem("backapp", back_App);
    } 

    //$(".exit-button").on("click", function(){
    //    fabmo.launchApp(back_App);
    //});

  document.onkeyup = function (evt) {
      if (evt.key === "Escape") {
          evt.preventDefault();
          fabmo.launchApp(back_App);
      }
  };

  // set focus at the end of 'ready'.

  // Check in config.engine for the existence of a 'video' object
  // If it exists, use it to populate the video sources
  // (at the moment, the config is determined manually and set in the config.json file)
  // TODO: add a UI for configuring the video sources
  fabmo.getConfig(function(err, data) {
    let videos = 0;
    if (err){
        console.log(err);
    } else {
        video_config = data.engine.video;
        if (video_config) { // if video config exists
            console.log("video_config exists");
            // if camera1 exists, use it
            if (video_config.camera1) {
                console.log("video_config.camera1 exists");
                localStorage.setItem("camera1", true)
                camera1_on = true;
                videos += 1;
                img1.src = 'http://' + location.hostname + ':3141?' + Math.random();
                // set the cam-label in display
                document.getElementById("cam-label").innerHTML = "camera 1";
            } else {  
                console.log("video_config.camera1 not defined");
            }
            // if camera2 exists, use it  
            if (video_config.camera2) {
                console.log("video_config.camera2 exists");
                localStorage.setItem("camera2", true)
                camera2_on = true;
                videos += 1;
                img2.src = 'http://' + location.hostname + ':3142?' + Math.random();
                document.getElementById("cam-label").innerHTML = "camera 2";
            } else {
                console.log("video_config.camera2 not defined");
            } 
        } else { // if video config does not exist  
            console.log("video_config does not exist");
            videos = 0;
        }
        localStorage.setItem("videos", videos);
    }
  });

  // hardcoding 2 cameras for now
  function resize() {
    var width = window.innerWidth;
    var height = window.innerHeight;
    //var aspect1 = img1.naturalHeight / img1.naturalWidth;
    //var aspect2 = img2.naturalHeight / img2.naturalWidth;

    if (!width) return;
    // Size the images to fill the window not considering aspect ratio
    img1.height = height; 
    img1.width = width;
    img2.height = height;
    img2.width = width;
    //img1.width = Math.min(width, height / aspect1);
    //img1.height = Math.min(height, width * aspect1);
    //img2.width = Math.min(width, height / aspect2);
    //img2.height = Math.min(height, width * aspect2);
  }

  function reload() {
    img1.onload = resize;
    img2.onload = resize;
  }

  window.addEventListener('resize', resize, false);
  
  // Set or Toggle between full size img1 and img2 on click (for testing)
  var doToggles = localStorage.getItem("videos");

  img1.onclick = function() {
    if (doToggles === "1" && camera1_on) {  // on single camera don't toggle
      img1.style.display = 'block';
      img2.style.display = 'none';
      document.getElementById("cam-label").innerHTML = "camera 1 only";
    } else if (doToggles === "2" || camera2_on) {
      img1.style.display = 'none';
      img2.style.display = 'block';
      document.getElementById("cam-label").innerHTML = "camera 2";
    } 
  }
  img2.onclick = function() {
    if (doToggles === "1" && camera2_on) {  // on single camera don't toggle
      img1.style.display = 'none';
      img2.style.display = 'block';
      document.getElementById("cam-label").innerHTML = "camera 2";
    } else if (doToggles === "2" || camera1_on) {
      img1.style.display = 'block';
      img2.style.display = 'none';
      document.getElementById("cam-label").innerHTML = "camera 1";
    }
  }  
  reload();
  
}
