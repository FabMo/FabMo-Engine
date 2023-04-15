window.onload = function() {
  var img = document.getElementById('video');

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

////##


  function resize() {
    var width = window.innerWidth;
    var height = window.innerHeight;
    var aspect = img.naturalHeight / img.naturalWidth;

    if (!width) return;

    img.width = Math.min(width, height / aspect);
    img.height = Math.min(height, width * aspect);
  }


  function reload() {
    img.onload = resize;
    img.src = 'http://' + location.hostname + ':3141?' + Math.random()
  }


  window.addEventListener('resize', resize, false);
  img.onclick = reload;
  reload();
}
