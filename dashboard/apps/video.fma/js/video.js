window.onload = function() {
  var img = document.getElementById('video');


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
