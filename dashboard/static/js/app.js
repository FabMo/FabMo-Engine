/* 
 * app.js is the application bootstrap script.  It configures require.js for including javascript modules
 * and launches the application entry point file which is main.js
 */
requirejs.config({
    baseUrl: '/js',
    urlArgs: "ts="+new Date().getTime(),
    paths: {
    	'jquery' : 'libs/jquery',
    	'backbone' : 'libs/backbone',
    	'foundation' : 'libs/foundation.min',
        'underscore' : 'libs/underscore',
        'fabmo' : 'libs/FabMo-latest',
        'fabmo-ui' : 'libs/FabMoUI-latest',
        'socket.io' : 'libs/socket.io',
        'handwheel' : 'libs/handwheel',
        'toastr' : 'libs/toastr.min'
    }
});

// Run the main application!
requirejs(['main']);