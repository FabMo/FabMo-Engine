
initVideo = function() {
  var img = document.getElementById('video');
  var img1 = document.getElementById('video1');

  function resize() {
    img.width = g.COnt_Width/2;
    img.height = g.COnt_Height;
    img1.width = g.COnt_Width/2;
    img1.height = g.COnt_Height;
  }

  function reload() {
    img.onload = resize;
    img.src = 'http://' + location.hostname + ':3141?' + Math.random()
    img1.onload = resize;
    img1.src = 'http://' + location.hostname + ':3142?' + Math.random()
  }

  $('#sbp-container').on('click', function () {
    img.onclick = reload;
    img1.onclick = reload;  
    reload();
    }
  )
};