var dashboard = require('./dashboard');
var log = require('./log').logger('debug');
var config = require('./config');
var path = require('path');
var pathIsInside = require('path-is-inside');

var watch_semaphore = 0;
var NCP_TIMEOUT = 4000;

var appReloader = function(event, pth, details) {
  var pth = path.normalize(details.watchedPath || details.path);

  // Don't watch for changes if there is an update in progress
  if(watch_semaphore) { 
    log.warn("Not reloading " + pth + " because a reload is already in progress.");
    return; 
  }

  // Determine which app changed, and re-copy that app
  app_index = dashboard.getAppIndex();
  for(var app_id in app_index) {
    app_path = app_index[app_id].app_archive_path;
    app_path = path.normalize(app_path);
    // if(pathIsInside(app_path, pth) || pathIsInside(pth, app_path)) {
    //   log.info(app_id + ' was changed. Reloading...');
    //   watch_semaphore+=1;
    //   var timeout = setTimeout(function() {
    //     log.warn('Timeout waiting for reload of ' + app_id);
    //     watch_semaphore-=1;
    //     watch_semaphore = watch_semaphore < 0 ? 0 : watch_semaphore;
    //   }, NCP_TIMEOUT);
    //   return dashboard.reloadApp(app_id, function(err, result) {
    //     clearTimeout(timeout);
    //     log.info(app_id + ' updated.');
    //     watch_semaphore-=1;  
    //     watch_semaphore = watch_semaphore < 0 ? 0 : watch_semaphore;
    //   });        
    // }
  } 
}; 

function startDebug() {
  log.info("Starting debug watcher...");
  var chokidar = require('chokidar');
  var pth = path.resolve('./dashboard/apps');
  log.debug('Watching '+ pth + ' for changes...');
  var watcher = chokidar.watch(pth, {
    ignored: /[\/\\]\./,
    persistent: true
  });
  watcher.on('raw', appReloader);
  var watcher = chokidar.watch(config.getDataDir('apps'), {
    ignored: /[\/\\]\./,
    persistent: true
  });
  watcher.on('raw', appReloader);
}

exports.start = startDebug;