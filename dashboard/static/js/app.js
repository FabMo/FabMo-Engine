/* 
 * app.js is the application bootstrap script.  It configures require.js for including javascript modules
 * and launches the application entry point file which is main.js
 */
requirejs.config({
    baseUrl: '/js',
    /*urlArgs: "ts="+new Date().getTime(),*/
    paths: {
    	'jquery' : 'libs/jquery.min',
    	'backbone' : 'libs/backbone.min',
    	'foundation' : 'libs/foundation.min',
        'underscore' : 'libs/underscore',
        'fabmo' : 'libs/fabmoapi',
        'fabmo-ui' : 'libs/fabmoui',
        'socket.io' : 'libs/socket.io',
        'handwheel' : 'libs/handwheel',
        'hammer' : 'libs/hammer.min',
        'keyboard' : 'libs/keyboard',
        'keypad' : 'libs/keypad',
        'toastr' : 'libs/toastr.min',
        'lockr' : 'libs/lockr.min'
    },
    shim : {
        'foundation' : {'deps' : ['jquery']}
    }
});

// Run the main application!
requirejs(['main']);