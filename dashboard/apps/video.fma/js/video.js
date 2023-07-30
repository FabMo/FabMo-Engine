window.onload = function() {
  var img = document.getElementById('video');
  var img1 = document.getElementById('video1');

  ////## th - Experiment on FLOW back re: Sb4 and similar apps; saved to local storage
    // Get info for setting up screen exit-back behavior
    let this_App = "video";
    let default_App = localStorage.getItem("defaultapp");
    let back_App = localStorage.getItem("backapp");
    let current_App = localStorage.getItem("currentapp");
    // Do nothing if current (e.g. refreshes and returns)
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
  ////##

  ////## th - Experiment on checking for available video saving to local storage

  function resize() {
    var width = window.innerWidth / 2;
    var height = window.innerHeight;
    var aspect = img.naturalHeight / img.naturalWidth;
    var aspect1 = img1.naturalHeight / img1.naturalWidth; 

    if (!width) return;

    if (img.src && img.canPlayType('video/mp4') !== '') {
      img.width = Math.min(width, height / aspect);
      img.height = Math.min(height, width * aspect);
    }

    if (img1.src && img1.canPlayType('video/mp4') !== '') {
      img1.width = Math.min(width, height / aspect1);
      img1.height = Math.min(height, width * aspect1);
    }
  }

  resize();
  window.addEventListener('resize', resize);


  function reload() {
    img.onload = resize;
    img1.onload = resize;
    img.src = 'http://' + location.hostname + ':3140?' + Math.random()
    img1.src = 'http://' + location.hostname + ':3142?' + Math.random()
  }


  //window.addEventListener('resize', resize, false);
  img.onclick = reload;
  img1.onclick = reload;
  reload();
}
