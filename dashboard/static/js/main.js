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

    engine.getConfig();
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
                            message: 'To authorize your tool, press and hold the green button for one second.',
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
        try {
            switch (move.axis) {
                case 'x':
                case 'y':
                    speed_ips = engine.config.machine.manual.xy_speed;
                    break;
                case 'z':
                    speed_ips = engine.config.machine.manual.z_speed;
                    break;
            }
        } catch (e) {
            console.error(e);
        }
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
            }
        } catch (e) {
            console.error(e);
        }
        return increment_inches;
    }

    function setupKeyboard() {
        var keyboard = new Keyboard('#keyboard');
        keyboard.on('go', function(move) {
            if (move) {
                dashboard.engine.manualStart(move.axis, move.dir * 60.0 * (getManualMoveSpeed(move) || 0.1));
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
            if (move) {
                dashboard.engine.manualStart(move.axis, move.dir * 60.0 * (getManualMoveSpeed(move) || 0.1));
            }
        });

        keypad.on('stop', function(evt) {
            dashboard.engine.manualStop();
        });

        keypad.on('nudge', function(nudge) {
            dashboard.engine.manualMoveFixed(nudge.axis, 60 * getManualMoveSpeed(nudge), nudge.dir * getManualNudgeIncrement(nudge), getManualMoveJerk(nudge));
        });
        return keypad;
    }


    function showConsent () {
           $('.modalDim').show();
           $('#beacon_consent_container').show();
         
    }
    function hideConsent (){
        $('.modalDim').hide();
        $('#beacon_consent_container').hide();
    }

    $('#beacon_consent_button').on('click', function(conf){
            if ($('#beacon_checkbox')[0].checked === true) {
                conf = {consent_for_beacon : "true"};
                dashboard.engine.setUpdaterConfig(conf,function(err){
                if(err){
                    console.log(err);
                    return;
                }
                });
                consent = "true";
            } else {
                conf = {consent_for_beacon : "false"};
                dashboard.engine.setUpdaterConfig(conf,function(err){
                    if(err){
                        console.log(err);
                        return;
                    }
                    });
                    consent = "false";
            }
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
        e.stopPropagation();
        $('.go-here').show();
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
        $('.go-here').hide();
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

    // Handlers for the home/probe buttons
    $('.button-zerox').click(function(e) {
        dashboard.engine.sbp('ZX');
    });
    $('.button-zeroy').click(function(e) {
        dashboard.engine.sbp('ZY');
    });
    $('.button-zeroz').click(function(e) {
        dashboard.engine.sbp('ZZ');
    });
    $('.button-zeroa').click(function(e) {
        dashboard.engine.sbp('ZA');
    });
    $('.button-zerob').click(function(e) {
        dashboard.engine.sbp('ZB');
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

    var disconnected = false;
    last_state_seen = null;
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



