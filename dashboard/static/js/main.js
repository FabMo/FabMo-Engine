/*
 * main.js is the entry point for the application.
 */
require('../css/font-awesome.css');
require("../css/normalize.css");
require("../css/foundation.min.css");
require("../css/style.css");
require("../css/toastr.min.css");




    // context is the application context
    // dashboard is the bridge between the application context and the apps
    var context = require('./context.js');
    var dashboard = require('./dashboard.js');

    // Vendor libraries
    require('jquery');
    require('backbone');
    var $ = require('jquery');
    var Backbone = require('backbone');
    var underscore = require('underscore');

    // Our libraries
    var FabMoAPI = require('./libs/fabmoapi.js');
    var FabMoUI = require('./libs/fabmoui.js');
    var Keyboard = require('./libs/keyboard.js');
    var Keypad = require('./libs/keypad.js');

    var keypad, keyboard;

    // API object defines our connection to the tool.
    var engine = new FabMoAPI();

    var modalIsShown = false;
    var daisyIsShown = false;
    var authorizeDialog = false;
    var isRunning = false;
    var isAuth = false;
    var lastInfoSeen = null;
    var consent = '';
    var disconnected = false;
    var last_state_seen = null;

    // Detect touch screen
    var supportsTouch = 'ontouchstart' in window || navigator.msMaxTouchPoints;


    // Initial read of engine configuration

    //check user 
    engine.getCurrentUser(function(err,user){
        if(user === undefined){
            window.location.href = '#/authentication';
        } 
    });

    engine.getUpdaterConfig(function(err, data){
       consent =  data.consent_for_beacon;

       if (consent === "none") {
            showConsent();
            $(document).keyup(function(e) {
                if (e.keyCode == 27) {
                    hideConsent();
                }
            });
            
       }
       return consent;
    });    


    engine.getVersion(function(err, version) {

        context.setEngineVersion(version);

        context.apps = new context.models.Apps();
        // Load the apps from the server
        context.apps.fetch({
            success: function() {


                // Create a FabMo object for the dashboard
                dashboard.setEngine(engine);
                dashboard.ui = new FabMoUI(dashboard.engine);
                dashboard.getNetworkIdentity();

                keyboard = setupKeyboard();
                keypad = setupKeypad();

                // Start the application
                router = new context.Router();
                router.setContext(context);

                dashboard.setRouter(router);

                // Sort of a hack, but works OK.
                $('.loader').hide();

                // Start backbone routing
                Backbone.history.start();

                // Request a status update from the tool
                engine.getStatus();

                dashboard.engine.on('change', function(topic) {
                    if (topic === 'apps') {
                        context.apps.fetch();
                    }
                });

                dashboard.engine.on('status', function(status) {
                    if(status.state == 'dead') {
                        dashboard.showModal({
                            title: 'An Error Occurred!',
                            message: status.info.error,
                            noButton : true
                        });
                        return;
                    }

                    if(status.state === "manual") {
                        $('.modalDim').show();
                        $('.manual-drive-modal').show();
                    }

                    if(status.state !== "manual") {
                        $('.modalDim').hide();
                        $('.manual-drive-modal').hide();
                    }

                    if(status.state === "idle") {
                        engine.getConfig(function(err, config){
                            if(err){
                                console.log(err);
                            } else {
                                var manual_config = config.machine.manual;
                                $('.xy-fixed').val(manual_config.xy_increment);
                                $('.z-fixed').val(manual_config.z_increment);
                                $('#manual-move-speed').val(manual_config.xy_speed);
                                $('#manual-move-speed').attr('min', manual_config.xy_min);
                                $('#manual-move-speed').attr('max', manual_config.xy_max);
                            }
                        });
                    }

                    if (status.state != "armed" && last_state_seen === "armed" || status.state != "paused" && last_state_seen === "paused") {
                        dashboard.hideModal();
                        modalIsShown = false;
                    }


                    if (last_state_seen != status.state) {
                        last_state_seen = status.state;

                    }
                    switch (status.state) {
                        case 'running':
                        case 'paused':
                        case 'stopped':
                            dashboard.handlers.showFooter();
                            break;
                        default:
                            dashboard.handlers.hideFooter();
                            break;
                    }

                    if (status.state != 'idle') {
                        $('#position input').attr('disabled', true);
                        // authenticate.setIsRunning(true);
                    } else {
                        $('#position input').attr('disabled', false);
                        // authenticate.setIsRunning(false);
                    }

                    if (status['info'] && status['info']['id'] != lastInfoSeen) {
                        lastInfoSeen = status['info']['id'];
                        if (status.info['message']) {
                            if(status.state ==="manual"){
                                $('.manual-drive-message').show();
                                $('.manual-drive-message').html(status.info.message);

                            } else {
                                keypad.setEnabled(false);
                                keyboard.setEnabled(false);
                                dashboard.showModal({
                                    message: status.info.message,
                                    okText: 'Resume',
                                    cancelText: 'Quit',
                                    ok: function() {
                                        dashboard.engine.resume();
                                    },
                                    cancel: function() {
                                        dashboard.engine.quit();
                                    }
                                });
                                modalIsShown = true;
                            }
                        } else if (status.info['error']) {
                            if (dashboard.engine.status.job) {
                                var detailHTML = '<p>' +
                                    '<b>Job Name:  </b>' + dashboard.engine.status.job.name + '<br />' +
                                    '<b>Job Description:  </b>' + dashboard.engine.status.job.description +
                                    '</p>'
                            } else {
                                var detailHTML = '<p>Check the <a style="text-decoration: underline;" href="/log">debug log</a> for more information.</p>';
                            }
                            dashboard.showModal({
                                title: 'An Error Occurred!',
                                message: status.info.error,
                                detail: detailHTML,
                                cancelText: status.state === 'dead' ? undefined : 'Quit',
                                cancel: status.state === 'dead' ? undefined : function() {
                                    dashboard.engine.quit();
                                }
                            });
                            modalIsShown = true;
                        }
                    } else if (status.state == 'armed') {
                        authorizeDialog = true;
                            keypad.setEnabled(false);
                            keyboard.setEnabled(false);
                        dashboard.showModal({
                            title: 'Authorization Required!',
                            message: 'To authorize your tool, press and hold the start button for one second.',
                            cancelText: 'Quit',
                            cancel: function() {
                                authorizeDialog = false;
                                dashboard.engine.quit();
                            }
          
                        });
                    }
                });
            }
        });
    });


    function getManualMoveSpeed(move) {
        var speed_ips = null;
        if ($('#manual-move-speed').val()){
            speed_ips = $('#manual-move-speed').val();
        }
        // try {
        //     switch (move.axis) {
        //         case 'x':
        //         case 'y':
        //             speed_ips = engine.config.machine.manual.xy_speed;
        //             break;
        //         case 'z':
        //             speed_ips = engine.config.machine.manual.z_speed;
        //             break;
        //     }
        // } catch (e) {
        //     console.error(e);
        // }
        return speed_ips;
    }

    function getManualMoveJerk(move){
        var jerk = null;
        try {
            switch (move.axis) {
                case 'x':
                case 'y':
                    jerk = engine.config.machine.manual.xy_jerk;
                    break;
                case 'z':
                    jerk = engine.config.machine.manual.z_jerk;
                    break;
            }
        } catch (e) {
            console.error(e);
        }
        return jerk;
    }

    function getManualNudgeIncrement(move) {
        var increment_inches = null;
        try {
            switch (move.axis) {
                case 'x':
                case 'y':
                    increment_inches = engine.config.machine.manual.xy_increment;
                    break;
                case 'z':
                    increment_inches = engine.config.machine.manual.z_increment;
                    break;
                case 'a':
                case 'b':
                    increment_inches = engine.config.machine.manual.ab_increment;
                    break;
            }
        } catch (e) {
            console.error(e);
        }
        return increment_inches;
    }

    function setupKeyboard() {
        var keyboard = new Keyboard();
        keyboard.on('go', function(move) {
            if (move) {
                dashboard.engine(move.axis, move.dir * 60.0 * (getManualMoveSpeed(move) || 0.1));
            }
        });

        keyboard.on('stop', function(evt) {
            dashboard.engine.manualStop();
        });

        keyboard.on('nudge', function(nudge) {
            dashboard.engine.manualMoveFixed(nudge.axis, 60 * getManualMoveSpeed(nudge), nudge.dir * getManualNudgeIncrement(nudge))
        });

        return keyboard;
    }

    function setupKeypad() {
        var keypad = new Keypad('#keypad');
        keypad.on('go', function(move) {
            if (move.second_axis) {
                dashboard.engine.manualStart(move.axis, move.dir * 60.0 * (getManualMoveSpeed(move) || 0.1), move.second_axis, move.second_dir * 60.0 * (getManualMoveSpeed(move) || 0.1));
            } else {
                dashboard.engine.manualStart(move.axis, move.dir * 60.0 * (getManualMoveSpeed(move) || 0.1));
            }
        });

        keypad.on('stop', function(evt) {
            dashboard.engine.manualStop();
        });

        keypad.on('nudge', function(nudge) {
            var speed = getManualMoveSpeed(nudge);
            var increment = getManualNudgeIncrement(nudge);
            // var jerk = getManualMoveJerk(nudge);
            if( nudge.second_axis){
                dashboard.engine.manualMoveFixed(nudge.axis, 60 * speed, nudge.dir * increment, nudge.second_axis, nudge.second_dir * increment);
                
            } else {
                dashboard.engine.manualMoveFixed(nudge.axis, 60 * getManualMoveSpeed(nudge), nudge.dir * getManualNudgeIncrement(nudge));
            }
        });

        // keypad.on('enter', function() {
        //     if(dashboard.engine.status.state == 'manual') {
        //         dashboard.engine.manualExit();
        //         keyboard.setEnabled(false);
        //     } else {                
        //         dashboard.engine.manualEnter();
        //         keyboard.setEnabled(true);
        //     }
        // });

        // keypad.on('exit', function() {
        //     dashboard.engine.manualExit();
        // });
        return keypad;
    }

    $('.manual-drive-exit').click(function(){
        $('.manual-drive-message').html('');
        $('.manual-drive-message').hide();
        dashboard.engine.manualExit();
    })

    $('.manual-drive-enter').click(function(){
        dashboard.engine.manualEnter();
    })


    function showConsent () {
           $('.modalDim').show();
           $('#beacon_consent_container').show();
         
    }
    function hideConsent (){
        $('.modalDim').hide();
        $('#beacon_consent_container').hide();
    }

    $('#beacon_consent_button').on('click', function(conf){
                conf = {consent_for_beacon : "true"};
                dashboard.engine.setUpdaterConfig(conf,function(err){
                if(err){
                    return;
                }
                });
                consent = "true";
            $('.modalDim').hide();
            $('#beacon_consent_container').hide();
    });

    function showDaisy(callback) {

        if (daisyIsShown) {
            return;
        } else {
            dashboard.hideModal();
            daisyIsShown = true;
             dashboard.showModal({
                    title: 'Waiting for FabMo...',
                    message: '<i class="fa fa-cog fa-spin" aria-hidden="true" style="font-size:40px;color:#313366" ></i>',
                    noButton: true,
                    noLogo: true
                });
        }
    }

    function hideDaisy(callback) {
        var callback = callback || function() {};
        if (!daisyIsShown) {
            return callback();
        }
        daisyIsShown = false;
        dashboard.hideModal();
    }

    // listen for escape key press to quit the engine
    $(document).on('keyup', function(e) {
        if (e.keyCode == 27) {
            console.warn("ESC key pressed - quitting engine.");
            dashboard.engine.quit();
        }
    });

    

    //goto this location
    var axisValues = [];
    $('.axi').each(function() {
        var strings = this.getAttribute('class').split(" ")[0];
        var axis = strings.slice(-1).toUpperCase();
        axisValues.push({
            "className": ("." + strings),
            "axis": axis
        });
    });

    $('.go-to').on('mousedown', function() {
        var move = {}
        $('.modal-axi:visible').each(function(){
            move[$(this).attr('id')] = parseFloat($(this).val());
        });
        dashboard.engine.goto(move);
    });

    $('.set-coordinates').on('mousedown', function() {
        var move = {}
        $('.modal-axi:visible').each(function(){
            move[$(this).attr('id')] = parseFloat($(this).val());
        });
        dashboard.engine.set(move);
    });

    $('.fixed-switch input').on('change', function(){

        if  ($('.fixed-switch input').is(':checked')) {
            $('.drive-button').addClass('drive-button-fixed');
            $('.slidecontainer').hide();
            $('.fixed-input-container').show();
            $('.fixed-input-container').css('display', 'flex');

        } else {
            $('.drive-button').removeClass('drive-button-fixed');
            $('.slidecontainer').show();
            $('.fixed-input-container').hide();
        }
    });


    $('.xy-fixed').on('change', function(){
        newDefault = $('.xy-fixed').val();
                dashboard.engine.setConfig({machine:{manual:{xy_increment:newDefault}}}, function(err, data){
                    if(err){
                        console.log(err);
                    }else {
                        dashboard.engine.getConfig();
                    }
                });
        });
    $('.z-fixed').on('change', function(){
        newDefault = $('.z-fixed').val();
                dashboard.engine.setConfig({machine:{manual:{z_increment:newDefault}}}, function(err, data){
                    if(err){
                        console.log(err);
                    }else {
                        dashboard.engine.getConfig();
                    }
                });
            
    });   
    

    $('.go-here').on('mousedown', function() {
        var gcode = "G0 ";
        for (var i = 0; i < axisValues.length; i++) {
            if ($(axisValues[i].className).attr('value', '')[1].value.length > 0) {
                if ($(axisValues[i].className).attr('value', '')[1].value != $(axisValues[i].className).val()) {
                    gcode += axisValues[i].axis + $(axisValues[i].className).attr('value', '')[1].value + " ";
                }
            }
        }
        dashboard.engine.gcode(gcode);
        $('.go-here').hide();
        if ( $(window).width() < 900) {
            $('#right-menu').css('right', '0');
        }
    });

    $('.axi').on('click', function(e) {
        var goString = 'Go to ';
        e.stopPropagation();
        $('.go-here').show();
        $('#keypad').hide();
        $('.go-to-container').show();
        $('.go-to-container').css('display', 'flex');

        
    });

    $('.axi').on('focus', function(e) {
        e.stopPropagation();
        $(this).val(parseFloat($(this).val().toString()));
        $(this).select();
    });

    $(document).on('click', function() {
        $('.posx').val($('.posx').val());
        $('.posy').val($('.posy').val());
        $('.posz').val($('.posz').val());
        $('.posa').val($('.posa').val());
        $('.posb').val($('.posb').val());
        $('.go-here').hide();
        $('#keypad').show();
        $('.go-to-container').hide();
    });

    $('.axi').keyup(function(e) {
        if (e.keyCode == 13) {
            var gcode = "G0 ";
            for (var i = 0; i < axisValues.length; i++) {
                if ($(axisValues[i].className).attr('value', '')[1].value.length > 0) {
                    if ($(axisValues[i].className).attr('value', '')[1].value != $(axisValues[i].className).val()) {
                        gcode += axisValues[i].axis + $(axisValues[i].className).attr('value', '')[1].value + " ";
                    }
                }
            }
            dashboard.engine.gcode(gcode);
            $('.go-here').hide();
        }
    });

    $('.zero-button').click(function() {
        var axi = $(this).parent('div').find('input').attr('id');
        var obj = {};
        obj[axi] = 0;
        dashboard.engine.set(obj)
    });


    $('#connection-strength-indicator').click(function(evt) {
        dashboard.launchApp('network-manager');
    });

	engine.on('authentication_failed',function(message){
	    console.log('authentication failed');
	    if(message==="not authenticated"){
	        window.location='#/authentication?message=not-authenticated';
	    }
	    else if(message==="kicked out"){
	        window.location='#/authentication?message=kicked-out';
	    }
	});


    engine.on('disconnect', function() {
        if (!disconnected) {
            disconnected = true;
            setConnectionStrength(null);
            hideConsent();
            showDaisy();
            
        }
    });

    engine.on('connect', function() {
        if (disconnected) {
            disconnected = false;
            setConnectionStrength(5);
        }
        hideDaisy(null);
        if (consent === "none") {
            showConsent();
        }
    });

    

    function setConnectionStrength(level) {
        var onclass = 'on';
        if (level === null) {
            level = 4;
            onclass = 'err';
        }
        for (i = 1; i < 5; i++) {
            var bar = $('#cs' + i);
            if (i <= level) {
                bar.attr('class', onclass);
            } else {
                bar.attr('class', 'off');
            }
        }
    }

    var signal_window = [];
    var err_count = 0;

    function ping() {
        engine.ping(function(err, time) {
            // 5-point Moving average
            signal_window.push(time);
            if (signal_window.length > 5) {
                signal_window.shift(0);
            }
            var sum = 0;
            for (var i = 0; i < signal_window.length; i++) {
                sum += signal_window[i];
            }
            var avg = sum / signal_window.length;

            if (err) {
                console.error(err);
            } else {
                if (avg < 100) {
                    setConnectionStrength(4);
                } else if (avg < 200) {
                    setConnectionStrength(3);
                } else if (avg < 400) {
                    setConnectionStrength(2);
                } else if (avg < 800) {
                    setConnectionStrength(1);
                } else {
                    setConnectionStrength(0);
                }
            }
            setTimeout(ping, 2000);
        });
    };

// var range_el = document.querySelector('input[type=range]'), style_el, sel, pref, comps, a, b;

// if(range_el) {
//   style_el = document.createElement('style');
//   sel = '.js[class*="webkit"] input[type=range]';
//   pref = '-webkit-slider-';
//   comps = ['runnable-track', 'thumb'];
//   a = ':after'; b = ':before';
  
//   document.body.appendChild(style_el);
  
//   range_el.addEventListener('input', function() {
//     var str = '', 
//         curr_val = this.value, 
//         min = this.min || 0, 
//         max = this.max || 100, 
//         perc = 100*(curr_val - min)/(max - min), 
//         fill_val = ((perc <= 5)?'30px':((~~perc) + '%')) + ' 100%', 
//         s_total = 60*curr_val, 
//         ss = ~~(s_total%60), 
//         m = Math.floor(s_total/60), 
//         speaker_rules;

//     if(ss < 10) { ss = '0' + ss; }
    
//    console.log($(sel + '::' + pref + comps[0]).css('background-size', fill_val ));
    
    
//     str += sel + '::' + pref + comps[0] + '{background-size:' + fill_val + '}';
//     str += sel + '::' + pref + comps[1] + a + ', ' + 
//       sel + ' /deep/ #' + comps[1] + a + '{content:"' + m + ':' + ss + '"}';
    
//     speaker_rules = 'opacity:' + Math.min(1, perc/50).toFixed(2) + ';' + 
//       'color:rgba(38,38,38,' + 
//       ((perc <= 50) ? 0 : (((perc - 50)/50).toFixed(2))) + ')';
    
//     str += sel + '::' + pref + comps[0] + b + ',' + 
//       sel + ' /deep/ #' + comps[0] + b + '{' + speaker_rules + '}';
        
//     style_el.textContent = str;
//     console.log(style_el);
//   }, false);

// }

    ping();

    engine.sendTime();

    function touchScreen() {
        if (supportsTouch && window.innerWidth < 800) {
            $('#app-client-container').css({
                '-webkit-overflow-scrolling': 'touch',
                'overflow-y': 'scroll'
            });
        }
    }
    touchScreen();

        $('#icon_sign_out').on('click', function(e){
            e.preventDefault();
            dashboard.showModal({
                title : 'Log Out?',
                message : 'Are you sure you want to sign out of this machine?',
                okText : 'Yes',
                cancelText : 'No',
                ok : function() {
                    window.location.href = '#/authentication';
                },
                cancel : function() {}
            });
        });



