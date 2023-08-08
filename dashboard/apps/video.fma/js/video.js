require('jquery');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo();

window.onload = function() {

  // set up 2 cameras
  var img1 = document.getElementById('camera1');
  var img2 = document.getElementById('camera2');


  ////## th - experiment on FLOW back re: Sb4 and similar apps

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
  // If it doesn't exist, use the default sources
  // If the default sources don't exist, use the hard-coded sources
  fabmo.getConfig(function(err, data) {
    if (err){
        console.log(err);
    } else {
        video_config = data.engine.video;
        if (video_config) { // if video config exists
            console.log("video_config exists");
            // if camera1 exists, use it
            if (video_config.camera1) {
                console.log("video_config.camera1 exists");
                img1.src = 'http://' + location.hostname + ':3141?' + Math.random();
            } else {  
                console.log("video_config.camera1 does not exist");
                img1.src = 'http://' + location.hostname + ':3141?' + Math.random();
            }
            // if camera2 exists, use it  
            if (video_config.camera2) {
                console.log("video_config.camera2 exists");
                img2.src = 'http://' + location.hostname + ':3142?' + Math.random();
            } else {
                console.log("video_config.camera2 does not exist");
                img2.src = 'http://' + location.hostname + ':3142?' + Math.random();
            } 
        } else { // if video config does not exist  
            console.log("video_config does not exist");
            img1.src = 'http://' + location.hostname + ':3141?' + Math.random(); // hardcode 2 cameras for now
            img2.src = 'http://' + location.hostname + ':3142?' + Math.random();
        }
    }
  });

  

  
  // hardcode 2 cameras for now
  function resize() {
    var width = window.innerWidth;
    var height = window.innerHeight;
    var aspect1 = img1.naturalHeight / img1.naturalWidth;
    var aspect2 = img2.naturalHeight / img2.naturalWidth;

    if (!width) return;

    img1.width = Math.min(width, height / aspect1);
    img1.height = Math.min(height, width * aspect1);
    img2.width = Math.min(width, height / aspect2);
    img2.height = Math.min(height, width * aspect2);
  }


  function reload() {
    img1.onload = resize;
//    img1.src = 'http://' + location.hostname + ':3141?' + Math.random()
    img2.onload = resize;
//    img2.src = 'http://' + location.hostname + ':3142?' + Math.random()
  }


  window.addEventListener('resize', resize, false);
// toggle between img1 and img2 on click (for testing)
  img1.onclick = function() {
    img1.style.display = 'none';
    img2.style.display = 'block';
  }
  img2.onclick = function() {
    img1.style.display = 'block';
    img2.style.display = 'none';
  }
    // img1.onclick = reload;
    // img2.onclick = reload;
  reload();
}
