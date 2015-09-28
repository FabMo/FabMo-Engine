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
/*
    <script type="text/javascript" src="js/libs/jquery.js">         </script>
    <script type="text/javascript" src="js/libs/foundation.min.js"> </script>
    <script type="text/javascript" src="socket.io/socket.io.js">      </script>
    <!--<script type="text/javascript" src="js/libs/touche.js">         </script> -->
    <script type="text/javascript" src="js/libs/toastr.min.js">     </script>
    <script type="text/javascript" src="js/libs/underscore.js">     </script>
    <script type="text/javascript" src="js/events.js">              </script>
    <script type="text/javascript" src="js/libs/backbone.js">       </script>
    <script type="text/javascript" src="js/libs/FabMo-latest.js">   </script>
    <script type="text/javascript" src="js/libs/FabMoUI-latest.js"> </script>
    <!--<script type="text/javascript" src="js/libs/Sortable.min.js"></script> -->
    <script type="text/javascript" src="js/libs/handwheel.js">     </script>
    <script data-main="js/app.js" src="js/libs/require.js">         </script>
*/

// Run the main application!
requirejs(['main']);