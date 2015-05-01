/* 
 * app.js is the application bootstrap script.  It configures require.js for including javascript modules
 * and launches the application entry point file which is main.js
 */
requirejs.config({
    baseUrl: 'js',
    urlArgs: "ts="+new Date().getTime(),
    paths: {}
});

// Run the main application!
requirejs(['main']);