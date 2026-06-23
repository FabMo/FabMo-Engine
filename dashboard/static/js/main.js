/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
/*
 * main.js is the entry point for the application.
 */
require("../css/font-awesome.css");
require("../css/normalize.css");
require("../css/fonts.css");
require("../css/foundation.min.css");
require("../css/style.css");
require("../css/toastr.min.css");
require("../css/tips.css");

// context is the application context
// dashboard is the bridge between the application context and the apps
var context = require("./context.js");
var dashboard = require("./dashboard.js");

// Vendor libraries
var $ = require("jquery");
var Backbone = require("backbone");
var underscore = require("underscore");

// Our libraries
require("./libs/i18n.js");   // installs window.t / window.i18nReady
var FabMoAPI = require("./libs/fabmoapi.js");
var FabMoUI = require("./libs/fabmoui.js");
var Keyboard = require("./libs/keyboard.js");
var Keypad = require("./libs/keypad.js");
var KeypadOrientation = require("./libs/keypad_orientation.js");

var keypad, keyboard;

// API object defines our connection to the tool.
var engine = new FabMoAPI(); // Not sure that "engine" was the name we wanted to use here

var modalIsShown = false;
var daisyIsShown = false;
var authorizeDialog = false;
var interlockDialog = false;
var isRunning = false;
var keyPressed = false;
var isAuth = false;
var lastInfoSeen = null;
var lastErrorSeen = null;
var lastSoftLimitPromptId = null;
var consent = "";
var disconnected = false;
var calledFromModal = ""; // variable for passing action from Keypad modal to engine
var last_state_seen = null;
var in_goto_flag = false;
var fixedTimeStart = 0; // variable for measuring response latency in keypad fixed moves
var fixedTimeEnd = 0;

// Declare a variable to track the current input being processed
let currentInputName = null;

// move timer cutoff to var so it can be set in settings later
var TIMER_DISPLAY_CUTOFF = 5;
// Detect touch screen
var supportsTouch = "ontouchstart" in window || navigator.msMaxTouchPoints;

// Initial read of engine configuration

// check user
engine.getCurrentUser(function (err, user) {
    if (user === undefined) {
        window.location.href = "#/authentication";
    }
});

var setUpManual = function () {
    return new Promise((resolve, reject) => {
        calledFromModal = "";
        
        // Turn off fixed-distance
        $(".drive-button").removeClass("drive-button-fixed");
        $(".slidecontainer").show();
        $(".fixed-input-container").hide();
        $(".fixed-switch input").prop("checked", false);
        $("#action-5").css("background-color", "#ce6402");

        engine.getConfig(function (err, config) {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                var manual_config = config.machine.manual;
                if (manual_config.xy_increment) {
                    $(".xy-fixed").val(manual_config.xy_increment);
                    $(".z-fixed").val(manual_config.z_increment);
                    $(".abc-fixed").val(manual_config.abc_increment);
                } else {
                    $(".xy-fixed").val(0.1);
                    $(".z-fixed").val(0.01);
                }
                $("#manual-move-speed").attr("min", manual_config.xy_min);
                $("#manual-move-speed").attr("max", manual_config.xy_max);
                $("#manual-move-speed").val(manual_config.xy_speed);
                
                // FIXED: Don't call setLocationDisplays here either
                // The status handler will update axis visibility
                // Just update what we need for the modal
                adjustModalHeight();
                setVideoStyle();
                
                // Initialize drag functionality
                setTimeout(() => {
                    initializeKeypadModal();
                }, 100);
                
                resolve();
            }
        });
    });
};

var startManualExit = function () {
    return new Promise((resolve, reject) => {
        // // Turn off fixed-distance if it is on (someone may want remembering to be an option?)
        // $(".drive-button").removeClass("drive-button-fixed");
        // $(".slidecontainer").show();
        // $(".fixed-input-container").hide();
        // $(".fixed-switch input").prop("checked", false);
        // // Clean up spindle which will automatically turn off
        // $("#action-5 img").attr("src", "../img/icon_spindle_off.png");
        // $("#action-5").css("background-color", "#ce6402");

        // // Function to set location displays and then set video style
        // function setLocationAndVideoStyle() {
        //     setLocationDisplays();
        //     setVideoStyle();
        //     resolve(); // Resolve the promise after setting location displays and video style
        // }
        // setLocationAndVideoStyle();


        // FIXED: Prevent config updates during exit
        window._manualExitInProgress = true;
        
        // Turn off fixed-distance if on
        $(".drive-button").removeClass("drive-button-fixed");
        $(".slidecontainer").show();
        $(".fixed-input-container").hide();
        $(".fixed-switch input").prop("checked", false);

        // Clean up spindle icon
        $("#action-5 img").attr("src", "../img/icon_spindle_off.png");
        $("#action-5").css("background-color", "#ce6402");

        // FIXED: Don't call setLocationDisplays during exit
        // Just update video style and resolve
        setVideoStyle();
        
        // Clear exit flag after a delay
        setTimeout(() => {
            window._manualExitInProgress = false;
        }, 1000);
        
        resolve();

        
    });
};

// Set the location displays by triggering an enable update
function setLocationDisplays() {
    engine.getConfig(function (err, config) {
        if (err) {
            console.log(err);
        } else {
            ///hack to get extra axes to show up
            var enabledAxes = {};
            var checkEnabled = ["xam", "yam", "zam", "aam", "bam", "cam"];
            checkEnabled.forEach(function (axi) {
                enabledAxes[axi] = config.driver[axi];
            });
            engine.setConfig({ driver: enabledAxes }, function (err, data) {});
            setTimeout(adjustModalHeight, 100); // Small delay to ensure DOM updates
        }
    });
}

// Customize for video
function setVideoStyle() {
    let current_App = localStorage.getItem("currentapp");
    let app_in_video = localStorage.getItem("fabmo_sb4_video_button");
    if (current_App === "video" || (current_App === "fabmo-sb4" && app_in_video == "2")) {
        // just kludged for moment
        $("#keypad-modal").css("opacity", "0.65");
        $(".manual-drive-modal").css("background-color", "rgba(0,0,0,0)");
        $(".modalDim").css("background-color", "rgba(0,0,0,0)");
    } else {
        $("#keypad-modal").css("opacity", "1.00");
        $(".manual-drive-modal").css("background-color", "#ffda29");
        $(".modalDim").css("background-color", "rgba(0,0,0,0.45)");
    }
}

// Check if we're expecting a restart and handle authentication accordingly
$(document).ready(function() {
    const expectingRestart = sessionStorage.getItem('fabmo_expect_restart');
    
    if (expectingRestart) {
        console.log("DEBUG: Detected expected restart: " + expectingRestart);
        sessionStorage.removeItem('fabmo_expect_restart');
        sessionStorage.removeItem('fabmo_authenticated');
        
        // Force auth check after short delay
        setTimeout(function() {
            checkAuthenticationStatus(true);
        }, 1500);
    }

    // // Fix for mobile viewport height issues - only run on very small screens
    // function setVHProperty() {
    //     // Only apply viewport height fix on screens that need it
    //     if (window.innerHeight <= 500 || window.innerWidth <= 400) {
    //         const vh = window.innerHeight * 0.01;
    //         document.documentElement.style.setProperty('--vh', `${vh}px`);
    //     }
    // }

    // for Keypad debugging
    const isTouchDevice = 'ontouchstart' in window;
    const isRealMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    console.log("Touch device:", isTouchDevice, "Mobile:", isRealMobile);

});

function checkForGlobalBackupRestore() {
    // console.log("DEBUG: Global dashboard backup restore check");

    // IMPORTANT: Only check for backup restore AFTER user is authenticated
    // This prevents the modal from appearing during login and stealing focus
    setTimeout(function() {
        // console.log("DEBUG: Checking authentication before backup restore check");
        
        // First verify user is authenticated
        engine.getCurrentUser(function (err, user) {
            if (err || user === undefined || user === null) {
                // console.log("DEBUG: User not authenticated, deferring backup check");
                // User not logged in yet - check again in 2 seconds
                setTimeout(checkForGlobalBackupRestore, 2000);
                return;
            }
            
            // console.log("DEBUG: User authenticated, making API call to check backup status");
            
            $.ajax({
                url: '/config/backup-restore-status',
                method: 'GET',
                success: function(response) {
                    // console.log("DEBUG: Global backup status response:", response);
                    
                    // Check both backup_available AND should_prompt
                    if (response.status === 'success' && 
                        response.data.backup_available && 
                        response.data.should_prompt) {
                        // console.log("DEBUG: Global backup available and should prompt, showing modal");
                        showGlobalBackupRestoreModal(response.data.backup_info);
                    } else {
                        // console.log("DEBUG: No global backup available or should not prompt");
                        if (response.data.backup_available && !response.data.should_prompt) {
                        // console.log("DEBUG: Backup exists but not showing modal (not from recent auto-profile)");
                        }
                    }
                },
                error: function(xhr, status, error) {
                    // console.log("DEBUG: Error in global backup status check:", error);
                }
            });
        });
    }, 3000); 
}

function showGlobalBackupRestoreModal(backupInfo) {
    // console.log("DEBUG: Showing global backup restore modal");
    
    var backupDate = new Date(backupInfo.created_at).toLocaleString();
    var message =
        window.t("status.backup.found_message") + '<br>' +
        window.t("status.backup.created_at") + ' ' + backupDate + '<br>' +
        window.t("status.backup.restore_question");

    dashboard.showModal({
        title: window.t("status.backup.title"),
        message: message,
        okText: window.t("status.backup.ok"),
        cancelText: window.t("status.backup.cancel"),
        ok: function() {
            // console.log("DEBUG: User chose to restore global backup");
            
            // Show progress message
            dashboard.notification('info', window.t("status.backup.restoring"));
            
            // Use direct API call
            $.ajax({
                url: '/config/restore-backup',
                method: 'POST',
                success: function(response) {
                    // console.log("DEBUG: Restore backup response:", response);
                    if (response.status === 'success') {
                        dashboard.notification('success', window.t("status.backup.restored"));
                        
                        // Set up authentication check for after restart
                        sessionStorage.setItem('fabmo_expect_restart', 'backup_restore');
                        sessionStorage.removeItem('fabmo_authenticated');
                        
                        // Monitor for restart completion
                        monitorRestartAndAuth();
                        
                    } else {
                        dashboard.notification('error', window.t("status.backup.restore_failed") + ' ' + response.message);
                    }
                },
                error: function(xhr, status, error) {
                    // console.log("DEBUG: Error restoring backup:", error);
                    dashboard.notification('error', window.t("status.backup.restore_failed") + ' ' + error);
                }
            });
        },
        cancel: function() {
            // console.log("DEBUG: User chose to keep current config - cleaning up markers");
            
            // Clean up the marker files so modal doesn't appear again
            $.ajax({
                url: '/config/dismiss-backup-restore',
                method: 'POST',
                success: function(response) {
                    // console.log("DEBUG: Cleanup response:", response);
                    dashboard.notification('info', window.t("status.backup.keeping"));
                },
                error: function(xhr, status, error) {
                    // console.log("DEBUG: Error during cleanup:", error);
                    dashboard.notification('info', window.t("status.backup.keeping"));
                }
            });
        }
    });
}

// Enhanced authentication checker
function checkAuthenticationStatus(forceCheck = false) {
    // console.log("DEBUG: Checking authentication status (force=" + forceCheck + ")");
    
    // Check current user status
    engine.getCurrentUser(function (err, user) {
        // console.log("DEBUG: Authentication check result - err:", err, "user:", user);
        
        if (err || user === undefined || user === null) {
            // console.log("DEBUG: User not authenticated, showing login");
            
            // Clear any cached authentication state
            sessionStorage.removeItem('fabmo_authenticated');
            localStorage.removeItem('fabmo_authenticated');
            
            // Force redirect to authentication - but only if we're not already there
            // This prevents stealing focus from the login form during periodic checks
            if (window.location.hash !== "#/authentication") {
                setTimeout(function() {
                    // console.log("DEBUG: Redirecting to authentication");
                    window.location.href = "#/authentication";
                }, 100);
            }
        } else {
            // console.log("DEBUG: User authenticated:", user.username);
            sessionStorage.setItem('fabmo_authenticated', 'true');
        }
    });
}

// Enhanced startup authentication check
function performStartupAuthCheck() {
    // console.log("DEBUG: Performing startup authentication check");
    
    // Initial check
    checkAuthenticationStatus(true);
    
    // Also check after a short delay in case there are timing issues
    // But skip it if we're already on the auth page to avoid disrupting login
    setTimeout(function() {
        if (window.location.hash !== "#/authentication") {
            checkAuthenticationStatus(true);
        }
    }, 2000);
    
    // Set up periodic checks for the first 30 seconds after startup
    let checkCount = 0;
    const maxChecks = 6; // 6 checks over 30 seconds
    
    const periodicCheck = setInterval(function() {
        checkCount++;
        
        // Stop checking if user is authenticated
        if (sessionStorage.getItem('fabmo_authenticated') === 'true') {
            // console.log("DEBUG: Authentication confirmed, stopping periodic checks");
            clearInterval(periodicCheck);
            return;
        }

        // Don't re-check if we're already on the authentication page to avoid disrupting login
        if (window.location.hash === "#/authentication") {
            // console.log("DEBUG: Already on auth page, skipping check #" + checkCount);
            if (checkCount >= maxChecks) {
                clearInterval(periodicCheck);
            }
            return;
        }

        // console.log("DEBUG: Periodic auth check #" + checkCount);
        checkAuthenticationStatus(false);
        
        if (checkCount >= maxChecks) {
            clearInterval(periodicCheck);
        }
    }, 5000);
}

// Monitor for restart completion and handle authentication
function monitorRestartAndAuth() {
    // console.log("DEBUG: Starting restart monitoring");
    
    let attempts = 0;
    const maxAttempts = 30; // Monitor for up to 3 minutes
    const recheckInterval = 6000; // Check every 6 seconds
    
    const restartMonitor = setInterval(function() {
        attempts++;

        // console.log("DEBUG: Restart monitor attempt #" + attempts);

        // Try to ping the server
        $.ajax({
            url: '/status',
            method: 'GET',
            timeout: 3000,
            success: function(response) {
                // console.log("DEBUG: Server responded after restart");
                clearInterval(restartMonitor);
                
                // Clear restart expectation
                sessionStorage.removeItem('fabmo_expect_restart');
                
                // Force authentication check after restart
                setTimeout(function() {
                    // console.log("DEBUG: Forcing auth check after restart");
                    checkAuthenticationStatus(true);
                }, 1000);
            },
            error: function() {
                if (attempts >= maxAttempts) {
                    // console.log("DEBUG: Restart monitor timeout - stopping");
                    clearInterval(restartMonitor);
                    sessionStorage.removeItem('fabmo_expect_restart');
                    
                    // Force a page reload as fallback
                    setTimeout(function() {
                        // console.log("DEBUG: Forcing page reload due to restart timeout");
                        window.location.reload();
                    }, 2000);
                }
                // Otherwise keep checking
            }
        });
    }, recheckInterval);
}

function adjustModalHeight() {
    const modal = document.getElementById("keypad-modal");
    if (!modal) return;
    
    // Check if we're on mobile first
    const isMobile = window.innerWidth <= 650; // Your mobile breakpoint
    const isVeryShortScreen = window.innerHeight <= 500;
    
    if (isVeryShortScreen) {
        // Let CSS handle very short screens - don't override
        modal.style.height = '';
        modal.style.width = '';
        $(".manual-drive-container").css("margin-top", '');
        return;
    }
    
    if (isMobile) {
        // Let CSS handle mobile - don't override mobile styles
        modal.style.height = '';
        $(".manual-drive-container").css("margin-top", '');
        return;
    }
    
    // For Keypad apply dynamic sizing 
    const visibleAxes = document.querySelectorAll('.axis:not([style*="display: none"])').length;
    
    let marginTop, keypadHeight;
    if (visibleAxes <= 4) {
//        keypadHeight = 450;
        marginTop = '0%';
    } else if (visibleAxes === 5) {
//        keypadHeight = 450;
        marginTop = '3%';
    } else { // 6 or more axes
//        keypadHeight = 450;
        marginTop = '3%';
    }

//    $(".manual-drive-modal").css("height", keypadHeight);
    $(".manual-drive-container").css("margin-top", marginTop);

    // console.log(`Adjusted modal height to ${marginTop} for ${visibleAxes} axes`);
}

function handleResponsiveKeypad() {
    // Debounce the resize handler
    let resizeTimeout;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function() {
            adjustModalHeight();
        }, 250);
    });
}

handleResponsiveKeypad();

// Add mobile cache busting before engine.getVersion call
function handleMobileCaching() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const touchDevice = 'ontouchstart' in window || navigator.msMaxTouchPoints;
    
    if (isMobile || touchDevice) {
        console.log("MOBILE CACHE BUST: Detected mobile device - version " + Date.now());
        
        // Clear any cached module references
        if (window.Keyboard) {
            console.log("MOBILE CACHE BUST: Clearing Keyboard cache");
            delete window.Keyboard;
        }
        if (window.Keypad) {
            console.log("MOBILE CACHE BUST: Clearing Keypad cache");
            delete window.Keypad;
        }
        
        // Add timestamp to prevent aggressive mobile caching
        window._fabmo_mobile_cache_bust = Date.now();
        
        // Force a small delay before initializing
        setTimeout(() => {
            console.log("MOBILE CACHE BUST: Ready for fresh initialization");
        }, 100);
    }
}

// Then existing engine.getVersion call continues...
engine.getVersion(function (err, version) {
    context.setEngineVersion(version);

    context.apps = new context.models.Apps();
    // Load the apps from the server
    context.apps.fetch({
        success: function () {
            // Create a FabMo object for the dashboard
            dashboard.setEngine(engine);
            console.log("Configuring this FabMo ...");
            dashboard.ui = new FabMoUI(dashboard.engine);
            dashboard.getNetworkIdentity();

            // Load config before setting up keyboard/keypad so manual control settings are available
            engine.getConfig(function (err, cfg) {
                if (!err && cfg) {
                    engine.config = cfg;
                }
                keyboard = setupKeyboard();
                keypad = setupKeypad();
            });

            // Check authentication status early
            performStartupAuthCheck();

            // BACKUP RESTORE CHECK HERE - BEFORE APP ROUTING STARTS
            checkForGlobalBackupRestore();

            // Start the application
            router = new context.Router();
            router.setContext(context);
            dashboard.setRouter(router);

            // Sort of a hack, but works OK.
            $(".loader").hide();

            // Start backbone routing
            Backbone.history.start();

            // Request a status update from the tool
            engine.getStatus();

            dashboard.engine.on("change", function (topic) {
                if (topic === "apps") {
                    context.apps.fetch();
                }
            });

            // Pendant joystick direction indicator (keypad center cell).
            // The pendant adapter publishes post-deadzone deflection on each
            // perceptible change; we just translate it into the dot's SVG
            // position. The ring is unit-radius in the SVG viewBox so the
            // deflection vector maps 1:1 to dot coordinates.
            //
            // The dot is also draggable on PC/tablet — see setupVirtualJoystick
            // below. While a local drag is in flight, remote pendant updates
            // are suppressed so the two inputs don't fight each other.
            var virtualJoystick = { dragging: false };
            dashboard.engine.on("pendant_joystick", function (state) {
                if (virtualJoystick.dragging) return;
                var dot = document.getElementById("joystick-dot");
                if (!dot) return;
                var x = Math.max(-1, Math.min(1, state.x || 0));
                var y = Math.max(-1, Math.min(1, state.y || 0));
                dot.setAttribute("cx", String(x));
                // Invert Y for screen coordinates: stick up (+y) should show
                // dot above center, but SVG y grows downward.
                dot.setAttribute("cy", String(-y));
                if (x === 0 && y === 0) {
                    dot.classList.remove("active");
                } else {
                    dot.classList.add("active");
                }
            });
            setupVirtualJoystick(virtualJoystick);

            // Canned-cuts sidebar — slides out from the keypad modal, lets
            // the operator arm/adjust/commit cuts without the gamepad. Stays
            // in lockstep with the pendant via toolbox_state broadcasts.
            setupToolboxSidebar(dashboard.engine);

            // PRINT OUTPUT widget — docked in the top bar (detachable later).
            setupPrintWidget(dashboard.engine);

            // Canned-cut HUD — compact readout pinned top-right, shown on
            // canned_cut_state events.
            setupCannedCutHud(dashboard.engine);

            setLocationDisplays();

            // ------------------------------------------------------------ STATUS HANDLER
            dashboard.engine.on("status", function (status) {
                fixedTimeEnd = Date.now();
                console.log(status);
                if (status.state == "dead") {
                    dashboard.showModal({
                        title: window.t("status.error_occurred_title"),
                        message: status.info.error,
                        noButton: true,
                    });
                    return;
                }
                if (status.currentCmd === "fixed") {
                    // report on keypad response latency
                    console.log(fixedTimeEnd - fixedTimeStart);
                }
                if (status.state === "manual") {
                    if (!status["hideKeypad"]) {
                        $(".modalDim").show();
                        $(".manual-drive-modal").show();
                        adjustModalHeight();
                        console.log("Status: " + status.state + "  Cmd: " + status.currentCmd);
                        if (status.stat === 5 && (status.currentCmd === "goto" || status.currentCmd === "resume")) {
                            $(".manual-stop").show();
                            $(".go-to, .set-coordinates").hide();
                            keyboard.setEnabled(false);
                            $("#keypad").hide();
                            $(".go-to-container").show();
                        } else {
                            // if an axis input has focus for go-to or set, keep showing the controls
                            if (in_goto_flag) {
                                $(".manual-stop").hide();
                                $(".go-to, .set-coordinates").show();
                                keyboard.setEnabled(false);
                                $("#keypad").hide();
                                $(".go-to-container").show();
                                // Otherwise switch to default manual keypad
                            } else {
                                $(".manual-stop").hide();
                                $(".go-to, .set-coordinates").show();
                                keyboard.setEnabled(true);
                                $("#keypad").show();
                                $(".go-to-container").hide();
                            }
                        }
                    }
                }

                // Hide modal whenever the server isn't reporting "manual".
                // Previously this only fired on a transition (last_state_seen
                // === "manual"), but if the websocket missed an early status
                // update (common right after a page refresh — sometimes the
                // first status arrives before last_state_seen is set, or the
                // socket misses messages during reconnect), the transition
                // condition would never be satisfied and the modal would
                // stay stuck even though the server was idle.
                if (status.state !== "manual" && $(".manual-drive-modal").is(":visible")) {
                    $(".modalDim").hide();
                    $(".manual-drive-modal").hide();
                    keyboard.setEnabled(false);
                }

                syncAuthorizeOverlay(status);

                if (
                    (status.state != "armed" && last_state_seen === "armed") ||
                    (status.state != "paused" && last_state_seen === "paused") ||
                    (status.state != "interlock" && last_state_seen === "interlock") ||
                    (status.state != "driverFault" && last_state_seen === "driverFault") ||
                    (status.state != "lock" && last_state_seen === "lock")
                ) {
                    dashboard.hideModal();
                    modalIsShown = false;
                }

                if (last_state_seen != status.state) {
                    last_state_seen = status.state;
                }

                switch (status.state) {
                    case "running":
                    case "probing":
                    case "paused":
                    case "stopped":
                        if (modalIsShown === false) {
                            dashboard.handlers.showFooter();
                        }
                        break;
                    default:
                        dashboard.handlers.hideFooter();
                        break;
                }

                if (status.state != "idle") {
                    $("#position input").attr("disabled", true);
                    // authenticate.setIsRunning(true);
                } else {
                    // NOW IN IDLE
                    // Send a requested ACTION from KEYPAD modal when we get back to "idle"
                    // Might be able to add a return to Keypad if that becomes a desired feature
                    engine.getStatus();
                    if (status.currentCmd === "exit" && calledFromModal && status.stat === 4) {
                        // Institute a 0.5 second delay to allow G2 to get back to idle
                        setTimeout(function () {
                            // Sort out the type of action requested
                            console.log("Action called From Modal: " + calledFromModal);
                            var match = calledFromModal.match(/(\d{1,2})$|([a-zA-Z]{2})$/);
                            if (match) {
                                if (match[1]) {
                                    calledFromModal = match[1];
                                    dashboard.engine.runMacro(calledFromModal);
                                } else {
                                    calledFromModal = match[2].toUpperCase();
                                    engine.sbp(calledFromModal);
                                    // Had trouble gettgin this to run reliably and added timeout
                                    //   Tried with dashboard.engine., and engine. calls
                                    //   Perhaps runCode might have been better?
                                }
                            }
                            calledFromModal = "";
                        }, 500);
                    } else {
                        $("#position input").attr("disabled", false);
                        //##calledFromModal = "";
                        // authenticate.setIsRunning(false);
                    }
                }
                // Sync soft-limit DRO indicator from persistent status.softLimit
                // (driven by server; survives arm/disarm wiping status.info)
                if (status.state === "manual" && status.softLimit) {
                    var limAxis = String(status.softLimit.axis).toUpperCase();
                    var $limAxis = $("#" + limAxis).closest(".axis");
                    if (!$limAxis.hasClass("at-limit")) {
                        $(".axis.at-limit").not($limAxis).removeClass("at-limit");
                        $limAxis.addClass("at-limit");
                    }
                    // Override prompt — third-step escalation. promptId bumps
                    // each emit so we re-show on a re-prompt but not on every
                    // status frame after a single emit. Rendered inline inside
                    // the keypad modal so Allow/Cancel clicks aren't seen as
                    // click-outside (which would close the keypad).
                    if (status.softLimit.prompt && status.softLimit.promptId !== lastSoftLimitPromptId) {
                        lastSoftLimitPromptId = status.softLimit.promptId;
                        showSoftLimitPrompt(limAxis);
                    }
                } else if ($(".axis.at-limit").length) {
                    $(".axis.at-limit").removeClass("at-limit");
                    lastSoftLimitPromptId = null;
                    hideSoftLimitPrompt();
                }
                if (status["info"] && status["info"]["id"] != lastInfoSeen) {
                    lastInfoSeen = status["info"]["id"];
                    if (status.info["message"]) {
                        if (status.state === "manual") {
                            $(".manual-drive-message").show();
                            $("#title_goto").css("visibility", "hidden");
                            $(".manual-drive-message").html(status.info.message);
                            $(".manual-drive-message").addClass("blinking-text");
                            $("#action-1").css("visibility", "hidden");
                            $("#action-2").css("visibility", "hidden");
                            $("#action-3").css("visibility", "hidden");
                            $("#action-4").css("visibility", "hidden");
                            $("#action-5").css("visibility", "hidden");
                            $(".title-container").css("display", "none");
                        } else if (status.info["timer"] && status.info["timer"] <= TIMER_DISPLAY_CUTOFF) {
                            keypad.setEnabled(false);
                            keyboard.setEnabled(false);
                        } else {
                            keypad.setEnabled(false);
                            keyboard.setEnabled(false);
                            console.log(status["info"]);

                            // MODAL DISPLAY SYSTEM:
                            // This system is responsible for displaying modal dialogs with customizable options.
                            // It integrates older modal behavior (e.g., default buttons like "Resume" and "Quit")
                            // with new features such as dynamic input handling, custom titles, and detailed messages.
                            // The modal options allow for flexible configurations, including hiding buttons,
                            // defining custom actions for "OK" and "Cancel" buttons, and handling input variables
                            // for user interaction. This ensures backward compatibility while enabling enhanced functionality.
                            modalOptions = {
                                message: status.info.message,
                            };
                            // Initialize modalOptions
                            modalOptions.ok = null;
                            modalOptions.cancel = null;
                            modalOptions.okText = null;
                            modalOptions.cancelText = null;
                            modalOptions.input = null;
                            // Carry the pause timer (seconds) through to the modal
                            // so it can render a countdown and label the OK button "Skip".
                            if (status.info["timer"]) {
                                modalOptions.timer = status.info["timer"];
                            }

                            // "Resume" and "Cancel" functions are called after a MODAL is shown to offer to different exits
                            // or actions.  The "resume" function is used to resume the engine, while the "cancel" function
                            // is used to quit the engine.  These functions are defined here so that they can be used in the
                            // modalOptions for the "ok" and "cancel" buttons.
                            // The "resume" function is used to resume the engine, while the "cancel" function is used to quit the engine.
                            // If the modal is shown with an "input" request, then the resume function will handle that
                            // request by extracting the value of a varialbe and its type from the modal input and sending it back to the server.
                            var resumeFunction = function (args) {
                                var value = args;
                                console.log("Extracted value: ", value);
                                if (modalOptions.input && modalOptions.input.name) {
                                    console.log("Name: ", modalOptions.input.name);
                                    console.log("Type: ", modalOptions.input.type);
                                    dashboard.engine.resume({
                                        var: modalOptions.input.name,
                                        type: modalOptions.input.type,
                                        val: value || "",
                                    });
                                } else {
                                    dashboard.engine.resume();
                                }
                            };
                            var cancelFunction = function () {
                                dashboard.engine.quit();
                            };
                            var reconnectFunction = function () {
                                dashboard.engine.reconnect(function (err) {
                                    if (err) {
                                        console.error("Reconnect request failed:", err);
                                    }
                                });
                            };
                            var cancelReconnectFunction = function () {
                                dashboard.engine.cancelReconnect(function (err) {
                                    if (err) {
                                        console.error("Cancel reconnect request failed:", err);
                                    }
                                });
                            };

                            // Check for presence of an "input" request in "name"
                            if (status.info["input"] && status.info.input["name"]) {
                                var wrkName = status.info.input["name"];
                                if (typeof wrkName === "object") {
                                    modalOptions.input = {
                                        name: wrkName.name,
                                        type: wrkName.type || "user_variable",
                                    };
                                } else {
                                    modalOptions.input = {
                                        name: wrkName,
                                        type: status.info.input["type"] || "user_variable",
                                    };
                                }
                                console.log("Name: ", modalOptions.input.name);
                                console.log("Type: ", modalOptions.input.type);
                            }

                            if (status.info["custom"]) {
                                // Handle custom title
                                if (status.info.custom["title"]) {
                                    modalOptions["title"] = status.info.custom["title"];
                                }

                                // Handle custom detail
                                if (status.info.custom["detail"]) {
                                    modalOptions["detail"] = status.info.custom["detail"];
                                }

                                // Handle noButton
                                if (status.info.custom["noButton"]) {
                                    modalOptions.noButton = true;
                                }

                                // Handle OK button
                                if (Object.prototype.hasOwnProperty.call(status.info.custom, "ok")) {
                                    if (status.info.custom.ok) {
                                        // OK button should be displayed
                                        modalOptions.okText = status.info.custom.ok["text"];
                                        switch (status.info.custom.ok["func"]) {
                                            case "resume":
                                                modalOptions.ok = resumeFunction;
                                                break;
                                            case "quit":
                                                modalOptions.ok = cancelFunction;
                                                break;
                                            case "reconnect":
                                                modalOptions.ok = reconnectFunction;
                                                break;
                                            case "cancelReconnect":
                                                modalOptions.ok = cancelReconnectFunction;
                                                break;
                                            default:
                                                modalOptions.ok = function () {
                                                    modalIsShown = false;
                                                };
                                        }
                                    } else {
                                        // OK button should be hidden
                                        modalOptions.ok = null;
                                        modalOptions.okText = null;
                                    }
                                }

                                // Handle Cancel button
                                if (Object.prototype.hasOwnProperty.call(status.info.custom, "cancel")) {
                                    if (status.info.custom.cancel) {
                                        // Cancel button should be displayed
                                        modalOptions.cancelText = status.info.custom.cancel["text"];
                                        switch (status.info.custom.cancel["func"]) {
                                            case "resume":
                                                modalOptions.cancel = resumeFunction;
                                                break;
                                            case "quit":
                                                modalOptions.cancel = cancelFunction;
                                                break;
                                            case "reconnect":
                                                modalOptions.cancel = reconnectFunction;
                                                break;
                                            case "cancelReconnect":
                                                modalOptions.cancel = cancelReconnectFunction;
                                                break;
                                            default:
                                                modalOptions.cancel = function () {
                                                    modalIsShown = false;
                                                };
                                        }
                                    } else {
                                        // Cancel button should be hidden
                                        modalOptions.cancel = null;
                                        modalOptions.cancelText = null;
                                    }
                                }

                                //Set defaults if both buttons are still null
                                if (modalOptions.ok === null && modalOptions.cancel === null && !modalOptions.noButton) {
                                    modalOptions.okText = modalOptions.timer ? window.t("actions.skip_button") : window.t("actions.resume_button");
                                    modalOptions.ok = resumeFunction;
                                    modalOptions.cancelText = window.t("actions.quit_button");
                                    modalOptions.cancel = cancelFunction;
                                }
                            } else {
                                // No custom parameters; use default buttons
                                modalOptions.okText = modalOptions.timer ? window.t("actions.skip_button") : window.t("actions.resume_button");
                                modalOptions.cancelText = window.t("actions.quit_button");
                                modalOptions.ok = resumeFunction;
                                modalOptions.cancel = cancelFunction;
                            }

                            // Clear spinners before showing the modal (handles programmed PAUSE case)
                            try {
                                if (dashboard && dashboard.ui && typeof dashboard.ui.clearSpinners === "function") {
                                    dashboard.ui.clearSpinners();
                                } else {
                                    // fallback: best-effort jQuery cleanup if UI object not ready
                                    $(".pauseJob-wrapper .pauseJob div div:first-child").removeClass("spinner red");
                                    $(".resumeJob div:first-child").removeClass("spinner green");
                                    $(".stopJob div:first-child").removeClass("spinner red");
                                }
                            } catch (e) {
                                console.debug("Spinner clear before modal failed", e);
                            }

                            // Show the modal
                            dashboard.showModal(modalOptions);
                            modalIsShown = true;
                            dashboard.handlers.hideFooter();
                        }

                        $("#keypad-modal").focus();
                    } else if (status.info["error"]) {
                        // Check if this is a new error (not already shown)
                        // Use status.info.id if available, otherwise create unique identifier from error message
                        var errorId = status.info.id || JSON.stringify(status.info.error);
                        
                        if (errorId !== lastErrorSeen) {
                            lastErrorSeen = errorId; // Mark this error as shown
                            
                            // SAVE LOG ON ERROR
                            console.log('ERROR MODAL - saving log');
                            fetch('/log/save', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            })
                            .then(function(response) {
                                return response.json();
                            })
                            .then(function(result) {
                                if (result.status === 'success') {
                                    console.log('Log auto-saved due to error modal:', result.data.filename);
                                }
                            })
                            .catch(function(err) {
                                console.error('Failed to auto-save log on error modal:', err);
                            });

                        }

                            if (dashboard.engine.status.job) {
                            var detailHTML =
                                "<p>" +
                                "<b>" + window.t("status.error.job_name") + "  </b>" +
                                dashboard.engine.status.job.name +
                                "<br />" +
                                "<b>" + window.t("status.error.job_description") + "  </b>" +
                                dashboard.engine.status.job.description +
                                "</p>";
                        } else {
                            detailHTML =
                                '<p>' + window.t("status.error.check_log_prefix") + ' <a href="/log" target="_blank"><span style="color: blue"> ' + window.t("status.error.check_log_link") + '</span>.</a></p>';
                        }
                        dashboard.showModal({
                            title: window.t("status.error_occurred_title"),
                            message: status.info.error,
                            detail: detailHTML,
                            cancelText: window.t("status.close_button"),
                            cancel: function () {
                                modalIsShown = false;
                            },
                        });
                        modalIsShown = true;
                        dashboard.handlers.hideFooter();
                    }
                    // quitFlag prevents authorize dialog from popping up
                    // after quitting from authorize dialog
                } else if (status.state === "armed" && status.quitFlag === false) {
                    // The soft overlay + disabled keypad/keyboard prevent jog
                    // commands from reaching the server while unauthorized, so
                    // any armed-state transition that reaches here is from a
                    // command that genuinely warrants the strong popup
                    // (file/macro/editor run, or spindle toggle from the
                    // manual pad).
                    authorizeDialog = true;
                    keypad.setEnabled(false);
                    keyboard.setEnabled(false);
                    dashboard.showModal({
                        title: window.t("status.authorize.title"),
                        message: window.t("status.authorize.message"),
                        cancelText: window.t("actions.quit_button"),
                        cancel: function () {
                            authorizeDialog = false;
                            dashboard.engine.quit(function (err, result) {
                                if (err) {
                                    console.log("ERRROR: " + err);
                                }
                            });
                        },
                    });
                } else if (status.state === "limit" && status.resumeFlag === false) {
                    interlockDialog = true;
                    keypad.setEnabled(false);
                    keyboard.setEnabled(false);
                    dashboard.showModal({
                        title: window.t("status.limit_alert.title"),
                        message: window.t("status.limit_alert.message"),
                        cancelText: window.t("actions.quit_button"),
                        cancel: function () {
                            interlockDialog = false;
                            dashboard.engine.quit(function (err, result) {
                                if (err) {
                                    console.log("ERRROR: " + err);
                                }
                            });
                        },
                    });
                } else if (status.state === "interlock" && status.resumeFlag === false) {
                    interlockDialog = true;
                    keypad.setEnabled(false);
                    keyboard.setEnabled(false);
                    dashboard.showModal({
                        title: window.t("status.interlock_alert.title"),
                        message: window.t("status.interlock_alert.message"),
                        cancelText: window.t("actions.quit_button"),
                        cancel: function () {
                            interlockDialog = false;
                            dashboard.engine.quit(function (err, result) {
                                if (err) {
                                    console.log("ERRROR: " + err);
                                }
                            });
                        },
                        okText: window.t("actions.resume_button"),
                        ok: function () {
                            dashboard.engine.resume();
                        },
                    });
                } else if (status.state === "driverFault" && status.resumeFlag === false) {
                    interlockDialog = true;
                    keypad.setEnabled(false);
                    keyboard.setEnabled(false);
                    dashboard.showModal({
                        title: window.t("status.drive_fault_alert.title"),
                        message: window.t("status.drive_fault_alert.message"),
                        cancelText: window.t("actions.quit_button"),
                        cancel: function () {
                            interlockDialog = false;
                            dashboard.engine.quit(function (err, result) {
                                if (err) {
                                    console.log("ERRROR: " + err);
                                }
                            });
                        },
                        okText: window.t("actions.resume_button"),
                        ok: function () {
                            dashboard.engine.resume();
                        },
                    });
                } else if (status.state === "lock" && status.resumeFlag === false) {
                    interlockDialog = true;
                    keypad.setEnabled(false);
                    keyboard.setEnabled(false);
                    dashboard.showModal({
                        title: window.t("status.lock.title"),
                        message: window.t("status.lock.message"),
                        cancelText: window.t("actions.quit_button"),
                        cancel: function () {
                            interlockDialog = false;
                            dashboard.engine.quit(function (err, result) {
                                if (err) {
                                    console.log("ERRROR: " + err);
                                }
                            });
                        },
                        okText: window.t("actions.resume_button"),
                        ok: function () {
                            dashboard.engine.resume();
                        },
                    });
                }
            });
        },
    });
});

function getManualMoveSpeed(move) {
    var speed_ips = null;
    try {
        switch (move.axis) {
            case "x":
            case "y":
                // Use the slider value for XY axes
                if ($("#manual-move-speed").val()) {
                    speed_ips = $("#manual-move-speed").val();
                }
                break;
            case "z":
                // Z speed is handled separately in the keypad setup
                if ($("#manual-move-speed").val()) {
                    speed_ips = $("#manual-move-speed").val();
                }
                break;
            case "a":
                // Use OpenSBP config for A axis
                speed_ips = engine.config.opensbp.movea_speed;
                break;
            case "b":
                // Use OpenSBP config for B axis
                speed_ips = engine.config.opensbp.moveb_speed;
                break;
            case "c":
                // Use OpenSBP config for C axis
                speed_ips = engine.config.opensbp.movec_speed;
                break;
            default:
                // Fallback to slider value
                if ($("#manual-move-speed").val()) {
                    speed_ips = $("#manual-move-speed").val();
                }
                break;
        }
    } catch (e) {
        console.error("Error getting manual move speed:", e);
        // Fallback to slider value
        if ($("#manual-move-speed").val()) {
            speed_ips = $("#manual-move-speed").val();
        }
    }
    return speed_ips || 1.0; // Default fallback
}

function getManualMoveJerk(move) {
    var jerk = null;
    try {
        switch (move.axis) {
            case "x":
            case "y":
                jerk = engine.config.machine.manual.xy_jerk;
                break;
            case "z":
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
            case "x":
            case "y":
                increment_inches = engine.config.machine.manual.xy_increment;
                break;
            case "z":
                increment_inches = engine.config.machine.manual.z_increment;
                break;
            case "a":
            case "b":
            case "c":
                increment_inches = engine.config.machine.manual.abc_increment;
                break;
        }
    } catch (e) {
        console.error(e);
    }
    return increment_inches;
}

// Make the on-screen joystick indicator draggable. Active only while the
// machine is in manual mode — drags outside that state are ignored so the
// dot stays in sync with whatever the (real) pendant is doing.
//
// Coordinate flow:
//   pointer position -> SVG-local (x, y in [-1.1, +1.1])
//   -> clamp magnitude to 1.0 (radial)
//   -> deadzone 0.25 (matches the visible ring)
//   -> unit-vector ratios (x/mag, y/mag) for engine analog jog
//   -> speed = 60 * manual-keypad slider IPS (same units the keypad uses)
//
// A 50 ms ticker (20 Hz) re-issues manualStart while the drag is active,
// matching the F310 pendant's processMotion cadence — well inside the
// firmware velocity-jog watchdog (500 ms) so the cycle stays alive.
// ------------------------------------------------------------ TOOLBOX SIDEBAR
//
// Right-side slide-out attached to the manual keypad modal. Operator can
// arm cut mode, nudge params with ± buttons, and commit at the current
// machine position — no gamepad required. The same controller backs the
// F310 pendant, so both surfaces stay in sync via toolbox_state.
//
// Architecture mirrors the pendant adapter: clicks turn into intents
// (toolbox_command WS sends), the controller responds, and the
// broadcast tells us what state we're now in. We re-render purely from
// the broadcast — never from local optimistic state.
// Tool registry — the toolbox grid is built from this. Add a new entry
// here to grow the launcher; the matching <div class="toolbox-tool-view"
// data-tool="..."> in the HTML supplies that tool's settings panel.
//
// `controller` flags tools that are driven by the server-side
// ToolboxController (the only one today is drill_press, which maps to
// circular_bore). For controller-backed tools, an incoming toolbox_state
// event with state !== "idle" auto-opens the sidebar and selects the tool.
// Non-controller tools (stubs for now) are click-only from the dashboard.
var TOOLBOX_TOOLS = [
    {
        id: "drill_press",
        label: "Drill Press",
        labelKey: "toolbox.tools.drill_press",
        controller: true,
        cutType: "circular_bore",
        // Drill-press silhouette by user (Inkscape source cleaned and
        // re-fitted to currentColor so it picks up tile/hover colour).
        icon:
            '<svg viewBox="0 0 50 50" fill="currentColor" aria-hidden="true">' +
              '<path d="M 2.5998 22.0999 V 47.0999 H 47.6002 V 22.0999 H 34.9095 V 36.9094 H 15.0906 V 22.0999 Z"/>' +
              '<path transform="matrix(-0.97803,0,0,-0.60089,47.2547,33.6161)" d="M 25.7224 34.2575 V 10.9110 H 30.3229 L 26.5387 4.3560 L 22.7540 -2.1989 L 18.9698 4.3560 L 15.1851 10.9110 H 19.7867 V 34.2575 Z"/>' +
              '<circle cx="25" cy="11.5" r="7.4218"/>' +
            '</svg>',
    },
    {
        id: "table_saw",
        label: "Table Saw",
        labelKey: "toolbox.tools.table_saw",
        controller: true,
        cutType: "straight_line",
        // Table-saw silhouette by user (Inkscape source cleaned).
        icon:
            '<svg viewBox="0 0 50 50" fill="currentColor" aria-hidden="true">' +
              '<path d="M 27.9037 34.4282 V 20.3996 H 32.4032 L 28.7021 16.4609 L 25.0006 12.5221 L 21.2995 16.4609 L 17.5979 20.3996 H 22.0984 V 34.4282 Z"/>' +
              '<path d="M 2.6004 2.6004 V 47.3992 H 16.3546 V 18.8407 A 8.6588 8.6588 0 0 1 16.3411 18.6562 A 8.6588 8.6588 0 0 1 25.0000 9.9978 A 8.6588 8.6588 0 0 1 33.6589 18.6562 A 8.6588 8.6588 0 0 1 33.6455 18.8423 V 47.3992 H 47.3992 V 2.6004 Z"/>' +
            '</svg>',
    },
    {
        id: "planer",
        label: "Planer",
        labelKey: "toolbox.tools.planer",
        controller: true,
        cutType: "planer",
        // Planer silhouette by user (Inkscape source cleaned).
        icon:
            '<svg viewBox="0 0 50 50" fill="currentColor" aria-hidden="true">' +
              '<path d="M 45.7877 14.5321 H 31.7590 V 10.0327 L 27.8203 13.7338 L 23.8815 17.4354 L 27.8203 21.1364 L 31.7590 24.8380 V 20.3375 H 45.7877 Z"/>' +
              '<rect x="2.5697" y="22.5697" width="19.8606" height="24.8606"/>' +
              '<rect x="2.5992" y="25.0992" width="44.8017" height="22.3017"/>' +
              '<path transform="matrix(-1.13925,0,0,0.65400,-5.1158,18.3481)" d="m -15.3626,6.3846 2.1444,-3.7143 2.1444,-3.7143 2.1444,3.7143 2.1444,3.7143 -4.2889,0 z"/>' +
              '<path transform="matrix(-1.13925,0,0,0.65400,4.8842,18.3481)" d="m -15.3626,6.3846 2.1444,-3.7143 2.1444,-3.7143 2.1444,3.7143 2.1444,3.7143 -4.2889,0 z"/>' +
            '</svg>',
    },
];

function setupPrintWidget(engine) {
    var STORAGE_KEY = "fabmo_print_output";
    var MAX_LINES = 200; // hard cap on retained lines

    var widget = document.getElementById("print-widget");
    var latestEl = document.getElementById("print-widget-latest");
    var streamEl = document.getElementById("print-widget-stream");
    var docklineEl = document.getElementById("print-widget-dockline");
    var expandBtn = document.getElementById("print-widget-expand");
    if (!widget || !latestEl) return;

    var lines = []; // newest first
    try {
        var saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) lines = JSON.parse(saved) || [];
    } catch (e) {
        lines = [];
    }

    function persist() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
        } catch (e) {
            // storage full/unavailable — non-fatal, still works in-memory
        }
    }

    function renderStream() {
        if (!streamEl) return;
        if (!lines.length) {
            streamEl.innerHTML = '<div class="print-widget-empty">(no output)</div>';
            return;
        }
        // textContent (not innerHTML) avoids HTML injection from PRINT strings.
        var frag = document.createDocumentFragment();
        for (var i = 0; i < lines.length; i++) {
            var div = document.createElement("div");
            div.className = "print-widget-line";
            div.textContent = lines[i];
            frag.appendChild(div);
        }
        streamEl.innerHTML = "";
        streamEl.appendChild(frag);
        streamEl.scrollTop = 0; // newest (top) in view
    }

    function makeLine(text, isEmpty, incoming) {
        var d = document.createElement("div");
        d.className =
            "print-widget-latest-line" +
            (isEmpty ? " empty" : "") +
            (incoming ? " incoming" : "");
        d.textContent = text;
        return d;
    }

    // Docked single-line "ticker": queue incoming lines and roll them up one at
    // a time so every line in a burst is seen, not just the last. (Collapsing
    // to the most recent line meant intermediate lines were inserted silently.)
    var scrollQueue = [];
    var scrolling = false;
    var SCROLL_MS = 360; // per-line roll duration (>= CSS transition)
    var SCROLL_QUEUE_MAX = 12; // bound lag on huge bursts (the stream has all)

    function setLatestDirect(text, isEmpty) {
        scrollQueue.length = 0;
        scrolling = false;
        latestEl.innerHTML = "";
        latestEl.appendChild(makeLine(text, isEmpty, false));
    }

    function processScrollQueue() {
        if (scrolling || !scrollQueue.length) return;
        if (!isDocked()) {
            // Floating: the modal shows the full stream, so just settle the
            // docked line to the most recent without animating.
            setLatestDirect(scrollQueue[scrollQueue.length - 1], false);
            return;
        }
        scrolling = true;
        var text = scrollQueue.shift();
        // Keep only the current resting line as the outgoing "old" line.
        var all = latestEl.querySelectorAll(".print-widget-latest-line");
        var oldLine = all.length ? all[all.length - 1] : null;
        for (var i = 0; i < all.length - 1; i++) {
            if (all[i].parentNode) all[i].parentNode.removeChild(all[i]);
        }
        var newLine = makeLine(text, false, true);
        latestEl.appendChild(newLine);
        void newLine.offsetWidth; // commit the incoming (below) start position
        if (oldLine) oldLine.classList.add("outgoing");
        newLine.classList.remove("incoming"); // transition up into view
        window.setTimeout(function () {
            if (oldLine && oldLine.parentNode) oldLine.parentNode.removeChild(oldLine);
            scrolling = false;
            processScrollQueue(); // roll the next queued line
        }, SCROLL_MS);
    }

    function updateLatest(text, isEmpty, animate) {
        if (!latestEl) return;
        if (!animate || !isDocked()) {
            setLatestDirect(text, isEmpty);
            return;
        }
        scrollQueue.push(text);
        if (scrollQueue.length > SCROLL_QUEUE_MAX) scrollQueue.shift();
        processScrollQueue();
    }

    function render() {
        updateLatest(
            lines.length ? lines[0] : "(no print output)",
            !lines.length,
            false
        );
        renderStream();
        layout();
    }

    function flash() {
        if (!docklineEl) return;
        docklineEl.style.animation = "none";
        void docklineEl.offsetWidth; // reflow to restart
        docklineEl.style.animation = "print-widget-flash 0.5s ease-in-out 2";
    }

    function addLine(text) {
        var s = String(text);
        lines.unshift(s);
        if (lines.length > MAX_LINES) lines.length = MAX_LINES;
        persist();
        renderStream();
        updateLatest(s, false, true); // animated scroll-in (docked)
        flash();
        layout();
    }

    function clear() {
        lines = [];
        persist();
        render();
    }

    // ---- Docked placement ---------------------------------------------------
    // The widget sits between the machine-name block (left, in flow) and the
    // mini-DRO (absolute, right). Both have dynamic widths, so measure them and
    // set the widget's left/right to fill the gap.
    var bar = document.querySelector(".tab-bar");
    var leftEl =
        document.querySelector("#left-position-container .svg-container") ||
        document.getElementById("tool-name");
    var miniDro = document.getElementById("right-position-container");
    // The visible yellow keypad button is the #icon_keypad <img>, which is
    // absolutely positioned (right:105%) and rendered to the LEFT of its
    // #man-start container — so measure the icon's own rendered box, not the
    // container, for both the right boundary and the vertical alignment.
    var keypadBtn = document.getElementById("icon_keypad");
    var GAP = 16; // min gap from the machine name
    var RIGHT_PAD = 12; // gap before the keypad button
    var BOTTOM_GAP = 4; // gap above the top bar's bottom edge
    var MAX_WIDTH = 400; // capped docked width

    function layout() {
        if (!widget.classList.contains("docked")) return; // floating: skip
        if (!bar) return;
        var barRect = bar.getBoundingClientRect();
        var leftX = leftEl ? leftEl.getBoundingClientRect().right : barRect.left + 200;
        var rightAnchor = keypadBtn || miniDro;
        var rightRect = rightAnchor ? rightAnchor.getBoundingClientRect() : null;
        var rightX = rightRect ? rightRect.left : barRect.right;
        var rightPx = Math.max(0, barRect.right - rightX + RIGHT_PAD);
        // Pin to the right (against the keypad button) and cap the width, but
        // never run past the machine name on the left.
        var rightEdgeX = barRect.right - rightPx; // widget's right edge
        var available = rightEdgeX - (leftX + GAP); // room before the machine name
        var width = Math.min(MAX_WIDTH, available);
        widget.style.left = "auto";
        widget.style.right = rightPx + "px";
        widget.style.width = Math.max(0, width) + "px";
        // Sit the docked module a few pixels above the bar's bottom edge.
        widget.style.paddingBottom = BOTTOM_GAP + "px";
        // Hide if there isn't enough room to be useful (small screens).
        widget.style.visibility = width < 80 ? "hidden" : "visible";
    }

    window.addEventListener("resize", layout);
    // The keypad button is an <img>; its box isn't final until it loads.
    if (keypadBtn && !keypadBtn.complete) {
        keypadBtn.addEventListener("load", layout);
    }
    if (window.ResizeObserver) {
        var ro = new ResizeObserver(layout);
        if (miniDro) ro.observe(miniDro);
        if (keypadBtn) ro.observe(keypadBtn);
        if (leftEl) ro.observe(leftEl);
    }
    // Recompute after first paint and once more after layout/fonts settle.
    setTimeout(layout, 0);
    setTimeout(layout, 500);

    engine.on("data_send", function (message) {
        if (!message || !message.channel) return;
        if (message.channel === "print") {
            var d = message.data;
            addLine(Array.isArray(d) ? d.join("") : d == null ? "" : d);
        } else if (message.channel === "print_clear") {
            clear();
        }
    });

    // ---- Expand / detach / redock / persistence ----------------------------
    var STATE_KEY = "fabmo_print_widget";
    var gripEl = document.getElementById("print-widget-grip");
    var closeBtn = document.getElementById("print-widget-close");
    // Remember the dock location so the modal can return to the same spot.
    var dockParent = widget.parentNode;
    var dockNext = widget.nextSibling;
    var floatPos = null; // {x, y} of the floating modal

    function isDocked() {
        return widget.classList.contains("docked");
    }

    function persistState() {
        try {
            window.localStorage.setItem(
                STATE_KEY,
                JSON.stringify({
                    floating: widget.classList.contains("floating"),
                    expanded: widget.classList.contains("expanded"),
                    x: floatPos ? floatPos.x : null,
                    y: floatPos ? floatPos.y : null,
                })
            );
        } catch (e) {
            // non-fatal
        }
    }

    function moveTo(left, top) {
        var w = widget.offsetWidth;
        var h = widget.offsetHeight;
        left = Math.max(4, Math.min(window.innerWidth - w - 4, left));
        top = Math.max(4, Math.min(window.innerHeight - h - 4, top));
        widget.style.left = left + "px";
        widget.style.top = top + "px";
        floatPos = { x: left, y: top };
    }

    // Pull the module off the bar into a floating modal at the given screen
    // position. Re-parents to <body> so it isn't trapped in the bar's stacking
    // context.
    function detach(left, top) {
        widget.classList.remove("docked", "expanded");
        widget.classList.add("floating");
        widget.style.right = "";
        widget.style.width = "";
        widget.style.paddingBottom = "";
        widget.style.visibility = "";
        document.body.appendChild(widget);
        renderStream();
        moveTo(left, top);
    }

    // Send the modal back to its original spot in the top bar.
    function redock() {
        widget.classList.remove("floating");
        widget.classList.add("docked");
        widget.style.left = "";
        widget.style.top = "";
        widget.style.width = "";
        if (dockNext && dockNext.parentNode === dockParent) {
            dockParent.insertBefore(widget, dockNext);
        } else {
            dockParent.appendChild(widget);
        }
        floatPos = null;
        layout();
        persistState();
    }

    // Drag the grip: in docked mode, crossing a small threshold detaches into a
    // floating modal; in floating mode it repositions. A plain click (no drag)
    // does nothing, so the grip stays click-safe.
    var GRAB_THRESHOLD = 6;
    var pending = null;
    var dragging = false;

    function onGripDown(e) {
        if (e.button != null && e.button !== 0) return;
        var rect = widget.getBoundingClientRect();
        pending = {
            startX: e.clientX,
            startY: e.clientY,
            offX: e.clientX - rect.left,
            offY: e.clientY - rect.top,
            pointerId: e.pointerId,
        };
        if (gripEl.setPointerCapture) {
            try { gripEl.setPointerCapture(e.pointerId); } catch (err) {}
        }
        e.preventDefault();
    }
    function onGripMove(e) {
        if (!pending) return;
        if (!dragging) {
            if (Math.abs(e.clientX - pending.startX) + Math.abs(e.clientY - pending.startY) < GRAB_THRESHOLD) {
                return;
            }
            dragging = true;
            gripEl.style.cursor = "grabbing";
            document.body.style.userSelect = "none";
            if (isDocked()) {
                var rect = widget.getBoundingClientRect();
                detach(rect.left, rect.top);
                // The floating modal differs in size/parent from the docked
                // module, so re-anchor the drag to the grip's position within
                // it (keeps it under the cursor), and re-acquire pointer
                // capture, which re-parenting to <body> releases.
                var wRect = widget.getBoundingClientRect();
                var gRect = gripEl.getBoundingClientRect();
                pending.offX = gRect.left + gRect.width / 2 - wRect.left;
                pending.offY = gRect.top + gRect.height / 2 - wRect.top;
                if (gripEl.setPointerCapture) {
                    try { gripEl.setPointerCapture(pending.pointerId); } catch (err) {}
                }
            }
        }
        moveTo(e.clientX - pending.offX, e.clientY - pending.offY);
    }
    function onGripUp() {
        if (pending && gripEl.releasePointerCapture) {
            try { gripEl.releasePointerCapture(pending.pointerId); } catch (err) {}
        }
        if (dragging) {
            dragging = false;
            gripEl.style.cursor = "";
            document.body.style.userSelect = "";
            persistState();
        }
        pending = null;
    }
    if (gripEl) {
        gripEl.addEventListener("pointerdown", onGripDown);
        gripEl.addEventListener("pointermove", onGripMove);
        gripEl.addEventListener("pointerup", onGripUp);
        gripEl.addEventListener("pointercancel", onGripUp);
    }

    // Expand caret — toggle the docked dropdown.
    if (expandBtn) {
        expandBtn.addEventListener("click", function () {
            if (!isDocked()) return;
            widget.classList.toggle("expanded");
            persistState();
        });
    }
    // Close (X) — redock the floating modal.
    if (closeBtn) {
        closeBtn.addEventListener("click", redock);
    }
    // Click outside collapses the docked dropdown.
    document.addEventListener("click", function (e) {
        if (
            widget.classList.contains("docked") &&
            widget.classList.contains("expanded") &&
            !widget.contains(e.target)
        ) {
            widget.classList.remove("expanded");
            persistState();
        }
    });
    // Keep a floating modal within the viewport on resize.
    window.addEventListener("resize", function () {
        if (widget.classList.contains("floating") && floatPos) {
            moveTo(floatPos.x, floatPos.y);
        }
    });

    // Restore persisted mode/position/expanded state.
    (function restoreState() {
        var st = null;
        try {
            st = JSON.parse(window.localStorage.getItem(STATE_KEY) || "null");
        } catch (e) {
            st = null;
        }
        if (!st) return;
        if (st.floating) {
            detach(st.x != null ? st.x : 80, st.y != null ? st.y : 80);
        } else if (st.expanded) {
            widget.classList.add("expanded");
        }
    })();

    render();
}

function setupCannedCutHud(engine) {
    var hud = document.getElementById("canned-cut-hud");
    if (!hud) return;

    var elType     = document.getElementById("canned-cut-hud-type");
    var elDiameter = document.getElementById("canned-cut-hud-diameter");
    var elDepth    = document.getElementById("canned-cut-hud-depth");
    var elCutter   = document.getElementById("canned-cut-hud-cutter");
    var elMode     = document.getElementById("canned-cut-hud-mode");
    var elPosition = document.getElementById("canned-cut-hud-position");
    var elState    = document.getElementById("canned-cut-hud-state");

    var visible = false;

    function show() {
        if (visible) return;
        hud.classList.add("visible");
        hud.setAttribute("aria-hidden", "false");
        visible = true;
    }
    function hide() {
        if (!visible) return;
        hud.classList.remove("visible");
        hud.setAttribute("aria-hidden", "true");
        visible = false;
    }

    function fmtIn(v) {
        if (v == null || isNaN(v)) return "—";
        return Number(v).toFixed(4) + '"';
    }

    function shortCutType(type) {
        if (!type) return "—";
        // "circular_bore" → "BORE", future "rectangular_cut" → "RECT", etc.
        var label = String(type).split("_").pop();
        return label.toUpperCase();
    }

    function renderParams(params) {
        if (!params) return;
        elDiameter.textContent = fmtIn(params.diameter);
        elDepth.textContent    = fmtIn(params.depth);
        elCutter.textContent   = fmtIn(params.cutterDiameter);
        elMode.textContent     = params.mode || "—";
    }

    function setState(label, executing) {
        elState.textContent = label;
        if (executing) {
            elState.classList.add("executing");
        } else {
            elState.classList.remove("executing");
        }
    }

    // Live machine position drives the "at" row when the HUD is open.
    engine.on("status", function (status) {
        if (!visible) return;
        if (!status || status.posx == null || status.posy == null) return;
        elPosition.textContent =
            "(" + Number(status.posx).toFixed(3) +
            ", " + Number(status.posy).toFixed(3) + ")";
    });

    engine.on("canned_cut_state", function (payload) {
        if (!payload) return;
        elType.textContent = shortCutType(payload.cutType);
        renderParams(payload.params);

        var reason = payload.reason || "";
        if (payload.state === "idle") {
            hide();
            return;
        }
        // For all non-idle states, the HUD should be visible.
        show();
        if (payload.state === "executing") {
            setState("cutting…", true);
        } else if (payload.state === "active") {
            // "done" comes through with state=active, reason=done — show
            // a brief "ready" indicator to acknowledge completion; the
            // next param adjust or further activity will overwrite it.
            if (reason === "done") {
                setState("ready", false);
            } else {
                setState("active", false);
            }
        }
    });
}


function setupToolboxSidebar(engine) {
    var sidebar = document.getElementById("toolbox-sidebar");
    if (!sidebar) return;

    var panel    = document.getElementById("toolbox-sidebar-panel");
    var grip     = document.getElementById("toolbox-grip");
    var titleEl  = document.getElementById("toolbox-sidebar-title");
    var backBtn  = document.getElementById("toolbox-back");
    var toolbox  = document.getElementById("toolbox-toolbox");
    // Multiple tool views can each have a CUT button with the same
    // class — collect all and treat as a group.
    var btnCuts = sidebar.querySelectorAll(".toolbox-btn-cut");

    var toolViews   = sidebar.querySelectorAll(".toolbox-tool-view");
    var homeSections = sidebar.querySelectorAll(".toolbox-home-section");

    // Mirrors of the server's ADJUST_STEPS / DEFAULT_PARAMS for
    // circular_bore in toolboxController.js. The dashboard needs
    // these locally because bit-section ± buttons compute the new
    // value client-side and send `set` (works any state) instead of
    // `adjust` (only works when armed). Keep in sync if server defaults
    // change.
    var TOOLBOX_STEPS = {
        diameter:       0.0625,
        depth:          0.0625,
        cutterDiameter: 0.0625,
        plungePerPass:  0.0625,
        feedRateXY:     5,
        feedRateZ:      5,
        plungeHeight:   0.0625,
    };
    var TOOLBOX_DEFAULTS = {
        diameter:       0.5,
        depth:          0.25,
        cutterDiameter: 0.25,
        plungePerPass:  0.125,
        feedRateXY:     60,
        feedRateZ:      30,
        plungeFrom:     "zero",
        plungeHeight:   0,
    };

    // Cached current Z, kept fresh by the status listener. Used to seed
    // plungeHeight when the operator flips to "Plunge from HEIGHT" mode
    // — that should default to "right here" without making them type.
    var currentZ = 0;

    // Local cache of the server's current params, kept up to date by
    // toolbox_state events. Bit ± click handlers read from this to
    // compute the new value.
    var currentParams = Object.assign({}, TOOLBOX_DEFAULTS);

    // Pick the displayed name for a tool — translated if a labelKey is
    // registered, else the English `label` literal. Used for tiles and
    // for the sidebar title when a tool is shown.
    function toolDisplayName(tool) {
        if (tool.labelKey && typeof window.t === "function") {
            return window.t(tool.labelKey);
        }
        return tool.label;
    }

    // --- Build the toolbox grid from the registry. Each tile is a button
    //     so it's keyboard-focusable and gets free click semantics.
    //     data-i18n on the label lets the i18n walker re-render on
    //     language change without re-creating the tile.
    TOOLBOX_TOOLS.forEach(function (tool) {
        var tile = document.createElement("button");
        tile.type = "button";
        tile.className = "toolbox-tile";
        tile.setAttribute("data-tool", tool.id);
        var labelAttr = tool.labelKey ? ' data-i18n="' + tool.labelKey + '"' : "";
        tile.innerHTML =
            '<span class="toolbox-tile-icon">' + tool.icon + '</span>' +
            '<span class="toolbox-tile-label"' + labelAttr + '>' + toolDisplayName(tool) + '</span>';
        tile.addEventListener("click", function () { showTool(tool.id); });
        toolbox.appendChild(tile);
    });

    // Tiles were created above; the global i18n walker may have already
    // run before setupToolboxSidebar() was called. Re-walk this subtree
    // once the dict is ready so the labels translate either way.
    if (window.i18nReady && window.i18nApply) {
        window.i18nReady.then(function () { window.i18nApply(sidebar); });
    }

    // Track which tool view is showing so we know when to auto-cancel.
    // Null means we're on the home (toolbox grid).
    var currentToolId = null;

    function showHome() {
        toolbox.hidden = false;
        for (var i = 0; i < toolViews.length; i++) toolViews[i].hidden = true;
        for (var k = 0; k < homeSections.length; k++) homeSections[k].hidden = false;
        titleEl.textContent = (typeof window.t === "function")
            ? window.t("toolbox.title")
            : "Toolbox";
        titleEl.setAttribute("data-i18n", "toolbox.title");
        backBtn.hidden = true;
        // Leaving a tool view → drop the controller back to idle so a
        // stray F310 press can't fire a cut for a tool the user is no
        // longer looking at.
        if (currentToolId && lastState === "active") {
            engine.toolboxCommand("cancel");
        }
        currentToolId = null;
    }

    function showTool(toolId) {
        var tool = null;
        for (var i = 0; i < TOOLBOX_TOOLS.length; i++) {
            if (TOOLBOX_TOOLS[i].id === toolId) { tool = TOOLBOX_TOOLS[i]; break; }
        }
        if (!tool) return;
        toolbox.hidden = true;
        for (var k = 0; k < homeSections.length; k++) homeSections[k].hidden = true;
        for (var j = 0; j < toolViews.length; j++) {
            toolViews[j].hidden = toolViews[j].getAttribute("data-tool") !== toolId;
        }
        titleEl.textContent = toolDisplayName(tool);
        if (tool.labelKey) titleEl.setAttribute("data-i18n", tool.labelKey);
        else titleEl.removeAttribute("data-i18n");
        backBtn.hidden = false;
        currentToolId = toolId;
        // Switch the server-side cut type to match this tool. The
        // controller carries bit/plunge settings across, so only the
        // cut-specific params reset to the new cut's defaults.
        if (tool.cutType) {
            engine.toolboxCommand("setCutType", { cutType: tool.cutType });
        }
        // Auto-arm so per-tool ± adjusts and the CUT button work without
        // an explicit Arm step — picking a tool is the user expressing
        // intent to use it.
        if (lastState === "idle") {
            engine.toolboxCommand("toggle");
        }
    }

    backBtn.addEventListener("click", showHome);

    // Mirror of the last controller state so click handlers know which
    // intent to fire. Server is authoritative; this is just a cache.
    var lastState = "idle";

    // Param-aware formatter: feedrates display as integer IPM (no quote),
    // angle in degrees, everything else as inches with 3dp + ". Used
    // both for live display and for reverting on edit-cancel.
    function fmtParam(name, v) {
        if (v == null || isNaN(v)) return "—";
        if (name === "feedRateXY" || name === "feedRateZ") {
            return String(Math.round(Number(v)));
        }
        if (name === "angleDeg" || name === "grainDeg") {
            return String(Math.round(Number(v))) + "°";
        }
        if (name === "stepoverPct") {
            return String(Math.round(Number(v))) + "%";
        }
        return Number(v).toFixed(3) + '"';
    }

    function setOpen(open) {
        if (open) sidebar.classList.add("open");
        else      sidebar.classList.remove("open");
        sidebar.setAttribute("aria-hidden", open ? "false" : "true");
        // Echo the open state on the grip so it reads as "pressed in"
        // while the panel is out.
        if (grip) {
            if (open) grip.classList.add("active");
            else      grip.classList.remove("active");
        }
    }

    function renderParams(params) {
        if (!params) return;
        // Multiple tool views can share param names (depth, plungeHeight,
        // etc.) with separate <input> elements. Query the DOM directly
        // so every input bound to a given param name updates together.
        var inputs = sidebar.querySelectorAll(".toolbox-param-value");
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            var paramEl = input.closest(".toolbox-param");
            if (!paramEl) continue;
            var name = paramEl.getAttribute("data-param");
            if (!name || !(name in params)) continue;
            if (document.activeElement !== input) {
                input.value = fmtParam(name, params[name]);
            }
            if (params[name] != null) currentParams[name] = params[name];
        }
        // Drive slide-toggle visuals: which side label is bolded, and
        // which way the knob sits (.right class → translate the knob
        // and recolour the track).
        var slides = sidebar.querySelectorAll(".toolbox-slide");
        for (var s = 0; s < slides.length; s++) {
            var slide = slides[s];
            var pname = slide.getAttribute("data-param");
            var cur = params[pname];
            var valRight = slide.getAttribute("data-value-right");
            slide.classList.toggle("right", cur === valRight);
            var labels = slide.querySelectorAll(".toolbox-slide-label");
            for (var li = 0; li < labels.length; li++) {
                labels[li].classList.toggle(
                    "selected",
                    labels[li].getAttribute("data-value") === cur
                );
            }
        }
        // The Height input row only makes sense in "Plunge from HEIGHT"
        // mode; hide it when we're plunging from Z0 so the panel doesn't
        // dangle an unused field.
        var heightRows = sidebar.querySelectorAll(".toolbox-plunge-height-row");
        var showHeight = params.plungeFrom === "height";
        for (var hr = 0; hr < heightRows.length; hr++) {
            heightRows[hr].hidden = !showHeight;
        }
    }

    function renderState(state, reason) {
        lastState = state;
        // CUT is the only action button now. Enabled whenever the
        // controller could plausibly accept a commit — i.e. armed
        // (active). Disabled while a cut is executing.
        var isActive    = state === "active";
        var isExecuting = state === "executing";

        for (var ci = 0; ci < btnCuts.length; ci++) {
            btnCuts[ci].disabled = !isActive || isExecuting;
        }

        // Per-tool ± buttons (e.g. diameter / depth inside the drill-press
        // view) only meaningful while active — they fire `adjust` which
        // the server gates on state. Bit ± buttons on the home view stay
        // enabled at all times (they fire `set`, which works any state).
        var toolAdjusts = sidebar.querySelectorAll(
            ".toolbox-tool-view .toolbox-adjust"
        );
        for (var i = 0; i < toolAdjusts.length; i++) {
            toolAdjusts[i].disabled = !isActive;
        }
    }

    // --- Grip click: open / close the panel.
    if (grip) {
        grip.addEventListener("click", function () {
            setOpen(!sidebar.classList.contains("open"));
        });
    }

    // --- CUT: single primary action. Auto-arming happens when the user
    //     opens the tool view, so by the time they hit CUT the controller
    //     is already active and ready to commit. Each tool view has its
    //     own CUT button — wire them all to the same handler.
    for (var ci2 = 0; ci2 < btnCuts.length; ci2++) {
        btnCuts[ci2].addEventListener("click", function () {
            if (lastState !== "active") return;
            engine.toolboxCommand("commit");
        });
    }

    // --- Two-state slide toggles for enum params (e.g. profile/pocket
    //     mode). Clicking either label sets that side; clicking the
    //     track flips. `set` works in any state so this matches the
    //     bit-param pattern.
    //
    //     plungeFrom→HEIGHT has a side-effect: also seed plungeHeight
    //     with the current Z so the operator gets "plunge from right
    //     here" without typing anything. They can still override after.
    function applySlideValue(name, val) {
        engine.toolboxCommand("set", { name: name, value: val });
        if (name === "plungeFrom" && val === "height") {
            engine.toolboxCommand("set", { name: "plungeHeight", value: currentZ });
        }
    }

    var slides = sidebar.querySelectorAll(".toolbox-slide");
    for (var sl = 0; sl < slides.length; sl++) {
        (function (slide) {
            var name      = slide.getAttribute("data-param");
            var valLeft   = slide.getAttribute("data-value-left");
            var valRight  = slide.getAttribute("data-value-right");
            var labels    = slide.querySelectorAll(".toolbox-slide-label");
            var track     = slide.querySelector(".toolbox-slide-track");

            for (var i = 0; i < labels.length; i++) {
                labels[i].addEventListener("click", function (ev) {
                    var val = ev.currentTarget.getAttribute("data-value");
                    if (val) applySlideValue(name, val);
                });
            }
            if (track) {
                track.addEventListener("click", function () {
                    var nextVal = slide.classList.contains("right") ? valLeft : valRight;
                    applySlideValue(name, nextVal);
                });
                track.addEventListener("keydown", function (ev) {
                    if (ev.key === " " || ev.key === "Enter") {
                        ev.preventDefault();
                        track.click();
                    }
                });
            }
        })(slides[sl]);
    }

    // --- Param ± buttons. Two flavors:
    //     - Bit params (.toolbox-bit-param, on the home view) compute
    //       the new value client-side and send `set` so they work
    //       regardless of armed state.
    //     - Tool params (inside a .toolbox-tool-view) send `adjust`
    //       and let the server's per-param step + state gate apply.
    var params = sidebar.querySelectorAll(".toolbox-param");
    for (var p = 0; p < params.length; p++) {
        (function (paramEl) {
            var name = paramEl.getAttribute("data-param");
            var isBit = paramEl.classList.contains("toolbox-bit-param");
            var buttons = paramEl.querySelectorAll(".toolbox-adjust");
            for (var b = 0; b < buttons.length; b++) {
                buttons[b].addEventListener("click", function (ev) {
                    var delta = parseInt(ev.currentTarget.getAttribute("data-delta"), 10);
                    if (!delta) return;
                    if (isBit) {
                        var step = TOOLBOX_STEPS[name] || 0.0625;
                        var current = currentParams[name];
                        if (current == null) current = TOOLBOX_DEFAULTS[name] || 0;
                        var next = current + step * delta;
                        engine.toolboxCommand("set", { name: name, value: next });
                    } else {
                        engine.toolboxCommand("adjust", { name: name, delta: delta });
                    }
                });
            }

            // --- Direct edit: type a value and commit with Enter or by
            //     blurring. Sends `set` for any param (server clamps to
            //     bounds + snaps to 4dp, then echoes via state event).
            //     Select-on-focus so a tap lets you replace the value.
            var input = paramEl.querySelector(".toolbox-param-value");
            if (input) {
                input.addEventListener("focus", function () {
                    input.select();
                });
                input.addEventListener("keydown", function (ev) {
                    if (ev.key === "Enter") {
                        ev.preventDefault();
                        input.blur();    // triggers commit below
                    } else if (ev.key === "Escape") {
                        // Revert visible text to last known value and bail.
                        input.value = fmtParam(name, currentParams[name]);
                        input.blur();
                    }
                });
                input.addEventListener("blur", function () {
                    var raw = String(input.value).replace(/[^\d.\-]/g, "");
                    var v = parseFloat(raw);
                    if (isNaN(v)) {
                        // Reject — restore the last known value
                        input.value = fmtParam(name, currentParams[name]);
                        return;
                    }
                    engine.toolboxCommand("set", { name: name, value: v });
                });
            }
        })(params[p]);
    }

    // --- Live "at (X, Y, Z)" readout, gated by sidebar being open so we
    //     don't churn the DOM on every status tick when collapsed.
    engine.on("status", function (status) {
        if (!status) return;
        // Track Z whenever it changes — even while the sidebar is closed
        // — so flipping to HEIGHT mode immediately after opening still
        // gets an accurate seed value.
        if (status.posz != null) currentZ = Number(status.posz);
    });

    // --- Server-driven state. Single source of truth for the UI.
    engine.on("toolbox_state", function (payload) {
        if (!payload) return;
        renderParams(payload.params);
        renderState(payload.state, payload.reason || "");
        // Auto-open and jump to the tool matching the active cutType
        // (so e.g. the F310 arming the controller pops the dashboard
        // open on the correct tool view).
        if (payload.state !== "idle") {
            if (!sidebar.classList.contains("open")) setOpen(true);
            var targetToolId = null;
            for (var ti = 0; ti < TOOLBOX_TOOLS.length; ti++) {
                if (TOOLBOX_TOOLS[ti].cutType === payload.cutType) {
                    targetToolId = TOOLBOX_TOOLS[ti].id;
                    break;
                }
            }
            var activeView = sidebar.querySelector(".toolbox-tool-view:not([hidden])");
            if (targetToolId &&
                (!activeView || activeView.getAttribute("data-tool") !== targetToolId)) {
                showTool(targetToolId);
            }
        }
    });

    // Initial view: home (toolbox). Per-tool views start hidden in markup.
    showHome();

    // Initial render with client-side defaults so the bit + tool readouts
    // show real numbers before the first toolbox_state event lands.
    // The server will overwrite these as soon as it emits.
    renderParams(TOOLBOX_DEFAULTS);
    renderState("idle", "");
}

function setupVirtualJoystick(state) {
    var indicator = document.getElementById("joystick-indicator");
    var svg = indicator ? indicator.querySelector("svg") : null;
    var dot = document.getElementById("joystick-dot");
    if (!indicator || !svg || !dot) return;

    var DEADZONE = 0.25;
    var TICK_MS = 50;

    var currentX = 0;
    var currentY = 0;
    var activePointerId = null;
    var tickTimer = null;

    function inManualMode() {
        return dashboard.engine && dashboard.engine.status && dashboard.engine.status.state === "manual";
    }

    function pointerToSvgCoords(evt) {
        // Use the SVG's own CTM so the math respects any responsive scaling
        // applied by the keypad layout. Fall back to bounding-rect math if
        // getScreenCTM returns null (older browsers / detached node).
        var pt;
        if (svg.createSVGPoint && svg.getScreenCTM()) {
            pt = svg.createSVGPoint();
            pt.x = evt.clientX;
            pt.y = evt.clientY;
            var ctm = svg.getScreenCTM();
            if (ctm) {
                var local = pt.matrixTransform(ctm.inverse());
                return { x: local.x, y: local.y };
            }
        }
        var rect = indicator.getBoundingClientRect();
        var nx = (evt.clientX - rect.left) / rect.width;
        var ny = (evt.clientY - rect.top) / rect.height;
        return { x: nx * 2.2 - 1.1, y: ny * 2.2 - 1.1 };
    }

    function setRatiosFromEvent(evt) {
        var p = pointerToSvgCoords(evt);
        // Clamp to unit circle (radial), then apply deadzone.
        var x = p.x;
        var yScreen = p.y; // SVG y grows downward
        var mag = Math.sqrt(x * x + yScreen * yScreen);
        if (mag > 1) {
            x = x / mag;
            yScreen = yScreen / mag;
            mag = 1;
        }
        if (mag < DEADZONE) {
            currentX = 0;
            currentY = 0;
        } else {
            // Map [DEADZONE, 1] -> [0, 1] so the user gets full range with a
            // proportional deadzone, matching the F310's deflection helper.
            var scaled = (mag - DEADZONE) / (1 - DEADZONE);
            currentX = (x / mag) * scaled;
            currentY = (-yScreen / mag) * scaled; // flip back to stick-up = +Y
        }
        // Update dot visually at the raw pointer position (clamped). Showing
        // the dot inside the deadzone too gives natural drag feedback even
        // when no motion is happening yet.
        dot.setAttribute("cx", String(x));
        dot.setAttribute("cy", String(yScreen));
        dot.classList.add("active");
    }

    function sendMotion() {
        if (!inManualMode()) {
            stopDrag(null, true);
            return;
        }
        // Read the keypad speed slider every tick so the user can re-tune
        // mid-drag if they want. axis 'x' picks up the XY slider value.
        var ips = (typeof getManualMoveSpeed === "function" ? getManualMoveSpeed({ axis: "x" }) : null) || 0.1;
        var speed = 60.0 * ips;
        if (currentX === 0 && currentY === 0) {
            dashboard.engine.manualStop();
            return;
        }
        // Always emit X primary, Y secondary (matches F310 — keeps the axis
        // pair stable across the cardinal/diagonal boundary so the engine
        // does in-place ratio updates instead of axis-swap restarts).
        dashboard.engine.manualStart("X", speed, "Y", speed, currentX, currentY);
    }

    function startDrag(evt) {
        if (!inManualMode()) return;
        if (activePointerId !== null) return;
        if (evt.button !== undefined && evt.button !== 0) return; // left button / primary only
        if (evt.preventDefault) evt.preventDefault();
        activePointerId = evt.pointerId != null ? evt.pointerId : 1;
        state.dragging = true;
        if (indicator.setPointerCapture && evt.pointerId != null) {
            try { indicator.setPointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
        }
        indicator.classList.add("dragging");
        setRatiosFromEvent(evt);
        sendMotion();
        tickTimer = setInterval(sendMotion, TICK_MS);
    }

    function moveDrag(evt) {
        if (activePointerId === null) return;
        if (evt.pointerId != null && evt.pointerId !== activePointerId) return;
        if (evt.preventDefault) evt.preventDefault();
        setRatiosFromEvent(evt);
    }

    function stopDrag(evt, silent) {
        if (activePointerId === null) return;
        if (evt && evt.pointerId != null && evt.pointerId !== activePointerId) return;
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        if (indicator.releasePointerCapture && evt && evt.pointerId != null) {
            try { indicator.releasePointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
        }
        activePointerId = null;
        currentX = 0;
        currentY = 0;
        indicator.classList.remove("dragging");
        // Snap dot back to center.
        dot.setAttribute("cx", "0");
        dot.setAttribute("cy", "0");
        dot.classList.remove("active");
        if (!silent) dashboard.engine.manualStop();
        // Defer clearing the dragging flag so the next inbound pendant
        // update doesn't race the snap-to-center.
        setTimeout(function () { state.dragging = false; }, 100);
    }

    indicator.addEventListener("pointerdown", startDrag);
    indicator.addEventListener("pointermove", moveDrag);
    indicator.addEventListener("pointerup", stopDrag);
    indicator.addEventListener("pointercancel", stopDrag);
    // Belt-and-braces for the rare case the pointer is released without an
    // event reaching us (e.g. context menu interception).
    window.addEventListener("blur", function () { stopDrag(null); });
}

function setupKeyboard() {
    var manual = engine.config.machine ? engine.config.machine.manual : {};
    var keyboard = new Keyboard(null, {
        refreshInterval: manual.refresh_interval || 50,
        nudgeTimeout: manual.press_delay != null ? manual.press_delay : 200
    });
    keyboard.on("go", function (move) {
        if (move.axis === "z") {
            dashboard.engine.manualStart(move.axis, move.dir * 60.0 * (getManualMoveSpeed(move) / 2 || 0.1));
        } else if (move) {
            dashboard.engine.manualStart(move.axis, move.dir * 60.0 * (getManualMoveSpeed(move) || 0.1));
        }
    });

    keyboard.on("stop", function (evt) {
        dashboard.engine.manualStop();
    });

    keyboard.on("nudge", function (nudge) {
        fixedTimeStart = Date.now(); // for measuring keypad response latency
        dashboard.engine.manualMoveFixed(
            nudge.axis,
            60 * getManualMoveSpeed(nudge),
            nudge.dir * getManualNudgeIncrement(nudge)
        );
    });

    return keyboard;
}

function setupKeypad() {
    var manual = engine.config.machine ? engine.config.machine.manual : {};
    var keypad = new Keypad("#keypad", {
        refreshInterval: manual.refresh_interval || 50,
        pressTime: manual.press_delay != null ? manual.press_delay : 150
    });
    // Apply the user's manual-control orientation mapping (set in
    // Configuration > Layout). Class-swaps the keypad buttons so the
    // physical layout matches where the operator stands.
    KeypadOrientation.apply("#keypad", manual.layout_mapping);
    // Live updates from the Configuration tab arrive via the storage
    // event — when the Layout tab saves a new mapping, it writes the
    // JSON to localStorage which fires this listener in other tabs.
    window.addEventListener("storage", function (ev) {
        if (ev.key !== "fabmo.layout_mapping") return;
        try {
            var newMapping = ev.newValue ? JSON.parse(ev.newValue) : null;
            KeypadOrientation.apply("#keypad", newMapping);
        } catch (e) { /* ignore parse errors */ }
    });
    // Make sure the spindle icon is off when entering manual mode
    keypad.on("go", function (move) {
        if (move.second_axis) {
            dashboard.engine.manualStart(
                move.axis,
                move.dir * 60.0 * (getManualMoveSpeed(move) || 0.1),
                move.second_axis,
                move.second_dir * 60.0 * (getManualMoveSpeed(move) || 0.1)
            );
        } else if (move.axis === "z_fast") {
            dashboard.engine.manualStart("z", move.dir * 60.0 * engine.config.machine.manual.z_fast_speed);
        } else if (move.axis === "z_slow") {
            dashboard.engine.manualStart("z", move.dir * 60.0 * engine.config.machine.manual.z_slow_speed);
        } else if (move) {
            dashboard.engine.manualStart(move.axis, move.dir * 60.0 * (getManualMoveSpeed(move) || 0.1));
        }
    });

    keypad.on("stop", function (evt) {
        keyPressed = false;
        dashboard.engine.manualStop();
    });

    keypad.on("nudge", function (nudge) {
        var speed = getManualMoveSpeed(nudge);
        var increment = getManualNudgeIncrement(nudge);
        // var jerk = getManualMoveJerk(nudge);
        fixedTimeStart = Date.now(); // for measuring keypad response latency
        if (nudge.second_axis) {
            dashboard.engine.manualMoveFixed(
                nudge.axis,
                60 * speed,
                nudge.dir * increment,
                nudge.second_axis,
                nudge.second_dir * increment
            );
        } else {
            dashboard.engine.manualMoveFixed(
                nudge.axis,
                60 * getManualMoveSpeed(nudge),
                nudge.dir * getManualNudgeIncrement(nudge)
            );
        }
    });

    $("#keypad").focus();
    return keypad;
}

$(".action-button").on("click", function (evt) {
    // Stop all event propagation immediately
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    
    console.log("Action button clicked - preventing other handlers");
    
    // Stop any ongoing motion before action
    if (keypad && keypad.going) {
        keypad.stop();
    }
    
    // Clear any touch state
    if (keypad) {
        keypad.touchStartTime = null;
        keypad.currentTouchElement = null;
        keypad.enabled = false; // Disable keypad immediately
    }
    
    // Add a flag to prevent any delayed events
    window._actionButtonClicked = Date.now();
    
    // Get the action from the generic button
    var exitKeypad = true;
    var action = $(this).attr("id");
    switch (
        action // We'll leave keypad to accomplish most of this stuff
    ) {
        case "action-1":
            calledFromModal = "macro2";
            break;
        case "action-2":
            calledFromModal = "macro3";
            break;
        case "action-3":
            calledFromModal = "JH";
            break;
        case "action-4":
            calledFromModal = "macro79";
            break;
        case "action-5": {
            exitKeypad = false;
            var newValue;
            if (dashboard.engine.status.out1 === 0) {
                $("#action-5 img").attr("src", "../img/icon_spindle_on.png");
                newValue = 1;
                $("#action-5").css("background-color", "orangered");
            } else {
                $("#action-5 img").attr("src", "../img/icon_spindle_off.png");
                newValue = 0;
                $("#action-5").css("background-color", "#ce6402");
            }
            // This approach uses the "raw" system of the Manual Runtime so we don't need to leave keypad
            let out = { output: 1, value: newValue };
            dashboard.engine.output(out);
            setTimeout(function () {}, 50);
            break;
        }
    }
    if (exitKeypad) {
        // for most actions we need to exit the keypad
        startManualExit()
            .then(() => {
                dashboard.engine.manualExit();
            })
            .catch((err) => {
                console.error("Error in ManualExit:", err);
            });
    }
});

$(".manual-drive-exit").on("click", function (evt) {
    // FIXED: Stop all event propagation immediately
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    
    console.log("Exit button clicked - preventing other handlers");
    
    // Stop any ongoing motion before exiting
    if (keypad && keypad.going) {
        keypad.stop();
    }
    
    // Clear any touch state
    if (keypad) {
        keypad.touchStartTime = null;
        keypad.currentTouchElement = null;
        keypad.enabled = false; // Disable keypad immediately
    }
    
    // Add a flag to prevent any delayed events
    window._exitButtonClicked = Date.now();
    
    // Remove changes for running manual from within a file
    $("#title_goto").css("visibility", "visible");
    $("#action-1").css("visibility", "visible");
    $("#action-2").css("visibility", "visible");
    $("#action-3").css("visibility", "visible");
    $("#action-4").css("visibility", "visible");
    $("#action-5").css("visibility", "visible");
    $(".title-container").css("display", "block");
    $(".manual-drive-message").html("");
    $(".manual-drive-message").hide();
    $(".manual-drive-message").removeClass("blinking-text");
    $(".axis.at-limit").removeClass("at-limit");
    $("#soft-limit-prompt").hide();
    lastSoftLimitPromptId = null;

    startManualExit()
        .then(() => {
            dashboard.engine.manualExit();
        })
        .catch((err) => {
            console.error("Error in ManualExit:", err);
        });
});

$(".manual-drive-enter").on("click", function () {
    setUpManual()
        .then(() => {
            dashboard.engine.manualEnter();
        })
        .catch((err) => {
            console.error("Error in setUpManual:", err);
        });
});

function showDaisy(callback) {
    if (daisyIsShown) {
        return;
    } else {
        dashboard.hideModal();
        daisyIsShown = true;
        dashboard.showModal({
            title: window.t("status.waiting_title"),
            message: '<i class="fa fa-cog fa-spin" aria-hidden="true" style="font-size:40px;color:#313366" ></i>',
            noButton: true,
            noLogo: true,
        });
    }
}

function hideDaisy(callback) {
    callback = callback || function () {};
    if (!daisyIsShown) {
        return callback();
    }
    daisyIsShown = false;
    dashboard.hideModal();
}

// Click outside the modal keypad to close it  //th: don't know if i like this now that it is done?
const modalKeyPad = document.getElementById("keypad-modal");

function setupSimpleClickOutside() {
    // For clicks in main window outside modal
    document.addEventListener("click", function (event) {
        // Use jQuery's :visible selector - most reliable
        if ($(modalKeyPad).is(":visible") && !modalKeyPad.contains(event.target) && last_state_seen === "manual") {
            console.log("Click outside modal detected");
            checkAndCloseModal();
        }
    });

    // For iframe clicks (detected as window blur)
    window.addEventListener("blur", function () {
        if ($(modalKeyPad).is(":visible") && last_state_seen === "manual") {
            console.log("Window blur detected - closing modal");
            setTimeout(checkAndCloseModal, 50);
        }
    });

    // Prevent modal clicks from bubbling
    modalKeyPad.addEventListener("click", function (e) {
        e.stopPropagation();
    });
}

function checkAndCloseModal() {
    if (last_state_seen === "manual" && $(modalKeyPad).is(":visible")) {
        startManualExit()
            .then(() => {
                dashboard.engine.manualExit();
            })
            .catch((err) => {
                console.error("Error in ManualExit:", err);
            });
    }
}

setupSimpleClickOutside();

// Access slider for using speed up/dn keys (could not make our jquery work for this, need ui version?)
const slider = document.getElementById("manual-move-speed");
function triggerSliderEvent(value) {
    if (slider) {
        slider.value = value;
        const changeEvent = new Event("change");
        slider.dispatchEvent(changeEvent);
        const inputEvent = new Event("input");
        slider.dispatchEvent(inputEvent);
    }
}
// Ensure the slider loses focus after a key-up event to prevent other keys from moving speed
if (slider) {
    slider.addEventListener("keyup", function () {
        slider.blur(); // Remove focus from the slider
    });
}

// Key action from keyboard in Modal Keypad
$(document).on("keydown", function (e) {
    // escape key press to quit the engine
    if (e.key === "Escape") {
        // Trigger exit any time the modal is visible. Checking modal
        // visibility avoids being blocked by a stale last_state_seen, which
        // can happen if the dashboard missed early status updates after a
        // page refresh.
        if ($(".manual-drive-modal").is(":visible")) {
            console.warn("ESC key pressed - quitting manual mode.");
            startManualExit()
                .then(() => {
                    dashboard.engine.manualExit();
                })
                .catch((err) => {
                    console.error("Error in ManualExit:", err);
                });
        }
    } else if (e.key === "k" && e.altKey) {
        // changed to alt but still not very useful, only working outside iframe
        setUpManual();
        // toggle "Fixed" moves
    } else if (e.key === "f") {
        $(".fixed-switch").trigger("click");
        // increase or decrease speed
    } else if ((e.key === "," || e.key === ".") && e.altKey) {
        // this is the alt+< and alt+> for speed up/dn
        let newSpeed;
        let adder = 0.1;
        if (dashboard.engine.status.unit === "mm") {
            adder = 1.0;
        }
        switch (e.key) {
            case ".":
                newSpeed = parseFloat($("#manual-move-speed").val()) + adder;
                triggerSliderEvent(newSpeed);
                break;
            case ",":
                newSpeed = parseFloat($("#manual-move-speed").val()) - adder;
                triggerSliderEvent(newSpeed);
                break;
        }
        $(".speed_read_out").show();
        $(".speed_read_out").html($("#manual-move-speed").val());
        setTimeout(function () {
            $(".speed_read_out").hide();
        }, 1500);
    // X, Y, Z, A, B, C keys — focus the axis input to enter goto/set mode
    } else if (last_state_seen === "manual" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        var axisKey = e.key.toUpperCase();
        if ("XYZABC".indexOf(axisKey) >= 0) {
            var activeTag = document.activeElement ? document.activeElement.tagName : "";
            // Only intercept if not already typing in an input
            if (activeTag !== "INPUT" && activeTag !== "TEXTAREA") {
                e.preventDefault();
                var axisInput = $("#" + axisKey);
                if (axisInput.length && axisInput.is(":visible")) {
                    axisInput.focus(); // triggers .axi focus handler → sets in_goto_flag
                    $("#keypad").hide();
                    $(".go-to-container").show();
                }
            }
        }
    }
});

// Goto this location
var axisValues = [];
var getAxis = function () {
    $(".axi").each(function () {
        var strings = this.getAttribute("class").split(" ")[0];
        var axis = strings.slice(-1).toUpperCase();
        axisValues.push({
            className: "." + strings,
            axis: axis,
        });
    });
};

$(".go-to").on("mousedown", function (evt) {
    // FIXED: Stop all event propagation and keypad events
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    
    console.log("Go To button clicked - preventing other handlers");
    
    // Stop any ongoing motion and disable keypad
    if (keypad && keypad.going) {
        keypad.stop();
    }
    
    if (keypad) {
        keypad.touchStartTime = null;
        keypad.currentTouchElement = null;
        keypad.enabled = false;
    }
    
    // Add protection flag
    window._gotoButtonClicked = Date.now();
    
    var move = {};
    $(".modal-axi:visible").each(function () {
        move[$(this).attr("id")] = parseFloat($(this).val());
    });
    dashboard.engine.goto(move);
});

$(".manual-stop").on("mousedown", function () {
    dashboard.engine.manualStop();
});

$(".set-coordinates").on("mousedown", function (evt) {
    // FIXED: Same protection as goto
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    
    console.log("Set Coordinates button clicked - preventing other handlers");
    
    if (keypad && keypad.going) {
        keypad.stop();
    }
    
    if (keypad) {
        keypad.touchStartTime = null;
        keypad.currentTouchElement = null;
        keypad.enabled = false;
    }
    
    window._setButtonClicked = Date.now();
    
    var move = {};
    $(".modal-axi:visible").each(function () {
        move[$(this).attr("id")] = parseFloat($(this).val());
    });
    dashboard.engine.set(move);
});

$(".fixed-switch input").on("change", function () {
    if ($(".fixed-switch input").is(":checked")) {
        $(".drive-button").addClass("drive-button-fixed");
        $(".slidecontainer").hide();
        $(".fixed-input-container").show();
        $(".fixed-input-container").css("display", "flex");
    } else {
        $(".drive-button").removeClass("drive-button-fixed");
        $(".slidecontainer").show();
        $(".fixed-input-container").hide();
    }
});

$("#manual-move-speed").on("change", function () {
    newDefault = $("#manual-move-speed").val();
    dashboard.engine.setConfig({ machine: { manual: { xy_speed: newDefault } } }, function (err, data) {
        if (err) {
            console.log(err);
        }
    });
});

$(".xy-fixed").on("change", function () {
    keyboard.setEnabled(false);
    newDefault = $(".xy-fixed").val();
    dashboard.engine.setConfig({ machine: { manual: { xy_increment: newDefault } } }, function (err, data) {
        if (err) {
            console.log(err);
        } else {
            engine.config.machine.manual.xy_increment = newDefault;
        }
    });
});

$(".z-fixed").on("change", function () {
    keyboard.setEnabled(false);
    newDefault = $(".z-fixed").val();
    dashboard.engine.setConfig({ machine: { manual: { z_increment: newDefault } } }, function (err, data) {
        if (err) {
            console.log(err);
        } else {
            engine.config.machine.manual.z_increment = newDefault;
        }
    });
});

$(".abc-fixed").on("change", function () {
    keyboard.setEnabled(false);
    newDefault = $(".abc-fixed").val();
    dashboard.engine.setConfig({ machine: { manual: { abc_increment: newDefault } } }, function (err, data) {
        if (err) {
            console.log(err);
        } else {
            engine.config.machine.manual.abc_increment = newDefault;
        }
    });
});

$(".axi").on("click", function (e) {
    e.stopPropagation();
    $("#keypad").hide();
    $(".go-to-container").show();
});

$(".axi").on("focus", function (e) {
    in_goto_flag = true;
    e.stopPropagation();
    var num = parseFloat($(this).val());
    if (!isNaN(num)) {
        $(this).val(num);
    }
    $(this).select();
    keyboard.setEnabled(false);
});

// Restore position from status if field is empty or invalid on blur
$(".axi").on("blur", function () {
    var val = $(this).val();
    if (val === "" || val === "-" || isNaN(parseFloat(val))) {
        var axis = this.id.toLowerCase(); // "X" → "x"
        var pos = dashboard.engine.status["pos" + axis];
        if (pos !== undefined && !isNaN(pos)) {
            var digits = dashboard.engine.status.unit === "mm" ? 2 : 3;
            $(this).val(pos.toFixed(digits));
        }
    }
});

$(".fixed-step-value").on("focus", function (e) {
    e.stopPropagation();
    $(this).select();
    keyboard.setEnabled(false);
});

// manual keypad movement
$(".manual-drive-modal")
    .not(".fixed-step-value")
    .on("click", function (e) {
        // Restore position values — use status if field is empty/invalid
        var digits = dashboard.engine.status.unit === "mm" ? 2 : 3;
        ["x", "y", "z", "a", "b", "c"].forEach(function (axis) {
            var $input = $("input.pos" + axis);
            var val = parseFloat($input.val());
            if (isNaN(val)) {
                var pos = dashboard.engine.status["pos" + axis];
                if (pos !== undefined && !isNaN(pos)) {
                    $input.val(pos.toFixed(digits));
                }
            }
        });
        in_goto_flag = false;
        $("#keypad").show();
        $(".go-to-container").hide();
        if ($(event.target).hasClass("fixed-step-value")) {
            keyboard.setEnabled(false);
        } else {
            keyboard.setEnabled(true);
        }
    });

$(".axi").on("keydown", function (e) {
    // Allow: backspace, delete, tab, escape, enter, decimal point, minus, arrows
    if ([8, 9, 13, 27, 46, 110, 190].indexOf(e.keyCode) >= 0 ||
        e.keyCode === 189 || e.keyCode === 109 || // minus key
        (e.keyCode >= 35 && e.keyCode <= 40) ||    // home, end, arrows
        (e.ctrlKey && (e.key === "a" || e.key === "c" || e.key === "v" || e.key === "x"))) {
        return;
    }
    // Allow: digits (top row and numpad)
    if ((e.keyCode >= 48 && e.keyCode <= 57) || (e.keyCode >= 96 && e.keyCode <= 105)) {
        return;
    }
    // Axis letter keys — switch to that axis input instead of typing the letter
    var axisKey = e.key.toUpperCase();
    if ("XYZABC".indexOf(axisKey) >= 0) {
        e.preventDefault();
        var axisInput = $("#" + axisKey);
        if (axisInput.length && axisInput.is(":visible")) {
            axisInput.focus();
        }
        return;
    }
    // Block all other keys
    e.preventDefault();
});

$(".axi").keyup(function (e) {
    keyboard.setEnabled(false);
    if (e.keyCode == 13) {
        var move = {};
        $(".modal-axi:visible").each(function () {
            move[$(this).attr("id")] = parseFloat($(this).val());
        });
        dashboard.engine.goto(move);
    }
});

$(".zero-button").on("click", function (evt) {
    // FIXED: Add protection for zero buttons
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
    
    console.log("Zero button clicked - preventing other handlers");
    
    if (keypad && keypad.going) {
        keypad.stop();
    }
    
    if (keypad) {
        keypad.touchStartTime = null;
        keypad.currentTouchElement = null;
    }
    
    window._zeroButtonClicked = Date.now();
    
    var axi = $(this).parent("div").find("input").attr("id");
    var obj = {};
    obj[axi] = 0;
    console.log("zero- ", axi, obj, obj[axi]);
    dashboard.engine.set(obj);
});

$("#connection-strength-indicator").on("click", function (evt) {
    dashboard.launchApp("network-manager");
});

// RIGHT DRO Actions (OUTPUTS, FEEDRATE, SPINDLE-SPEED) .........................................................

// Toggle Outputs
$(".toggle-out").on("click", function (evt) {
    event.stopPropagation();
    // get switch number and trim spaces at beginning and end
    var output = $(this).text().trim(); // get switch number
    var state = $(this).hasClass("on"); // ... and switchstate
    var base_command = "";
    var mult_cmds = [];
    if (state) {
        base_command = "SO ," + output + ", 0";
        // 1 and 2 need to be made permanent so they don't just turn off when toggeled on
        if (output === "1" || output === "2") {
            mult_cmds = [base_command, "SV"].join("\n"); // SV makes permanent
        } else {
            mult_cmds = [base_command].join("\n");
        }
        dashboard.handlers.runSBP(mult_cmds, function (err, result) {
            if (err) {
                console.error("An error occurred:", err);
            } else {
                console.log("The result is:", result);
            }
        });
    }
    if (!state) {
        base_command = "SO ," + output + ", 1";
        if (output === "1" || output === "2") {
            mult_cmds = [base_command, "SV"].join("\n"); // SV makes permanent
        } else {
            mult_cmds = [base_command].join("\n");
        }
        dashboard.handlers.runSBP(mult_cmds, function (err, result) {
            if (err) {
                console.error("An error occurred:", err);
            } else {
                console.log("The result is:", result);
            }
        });
    }
});

// ... get FOCUS out of OVERRIDE BOX if done
var ovBlurTimer;
function startOvBlurTimer() {
    clearTimeout(ovBlurTimer);
    ovBlurTimer = setTimeout(function () {
        $("#override").blur();
    }, 2500);
}
// Listener for focus on the overide input box
$("#override").on("focus", function (evt) {
    startOvBlurTimer();
});
// Listeners for activity in the override input box to restart the timer
$("#override").on("input keypress mousemove", function (evt) {
    startOvBlurTimer();
});
// -------------------------------------------------------------------------------

// UI for FEEDRATE OVERRIDE (%) -------------------------------------------------
// Requested OVERRIDE Feed Rate via setUix process (see uix.js)
var overrideFeedRate = function (new_override) {
    try {
        console.log("----> fr Override Request: " + new_override);
        engine.setUix("fr_override", new_override);
    } catch (error) {
        console.log("Failed to pass new Override: " + error);
    }
};

$("#override").on("change", function (evt) {
    if (engine.status.state != "idle") {
        var new_override = parseFloat($("#override").val());
        // Check against: feedrate override range (G2 firmware caps at 200%)
        if (new_override > 4 && new_override <= 200) {
            overrideFeedRate(new_override);
        }
    }
});

// Listener for focus on the override input box
$("#override").on("focus", function (evt) {
    startOvBlurTimer();
});
// Listeners for activity in the override input box to restart the timer
$("#override").on("input keypress mousemove", function (evt) {
    startOvBlurTimer();
});
// -------------------------------------------------------------------------------

// UI for Spindle Speed (RPM & AMP) -----------------------------------------------
const debouncedChangeSpindleSpeed = debounce(function (new_RPM) {
    changeSpindleSpeed(new_RPM);
}, 1500);
var changeSpindleSpeed = function (new_RPM) {
    try {
        console.log("----> new speed: " + new_RPM);
        engine.setAcc("spindle_speed", new_RPM);
        
        // Round to nearest 25 and update display
        const rounded = Math.round(new_RPM / 25) * 25;
        $("#sp-speed").val(rounded);
    } catch (error) {
        console.log("Failed to pass new RPM: " + error);
    }
};
function debounce(func, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
    };
}
$(".spindle-speed input").on("input", function () {
    const latestValue = $(this).val();
    $(".spindle-speed input").css("color", "black");
    debouncedChangeSpindleSpeed(latestValue);
});
// ... get FOCUS out of SPINDLE BOX if done
var blurTimer;
function startBlurTimer() {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(function () {
        $("#sp-speed").blur();
    }, 3000);
}
// By listening for update in the spindle input box to clear focus
$("#sp-speed").on("input", function () {
    startBlurTimer();
});
// -------------------------------------------------------------------------

// IFRAME COMMUNICATION =====================================================

// This is an exploratory effort to communicate happenings from the dash to the iframe app
// Function to sanitize the data and ensure only serializable properties are included
function sanitizeData(data) {
    const sanitizedData = {};
    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            const value = data[key];
            if (
                typeof value === "string" ||
                typeof value === "number" ||
                typeof value === "boolean" ||
                value === null
            ) {
                sanitizedData[key] = value;
            }
        }
    }
    return sanitizedData;
}

// Add event listener to capture click events in the parent window
document.addEventListener("mousedown", function (event) {
    //console.log("Mouse down on:", event.target);

    // Sanitize the data before sending it via postMessage
    const sanitizedData = sanitizeData({
        type: "click",
        target: event.target.tagName,
        id: event.target.id,
        className: event.target.className,
    });

    // Send the sanitized data to the current iframe
    var iframe = document.getElementById("app-iframe");
    if (iframe) {
        iframe.contentWindow.postMessage(sanitizedData, "*");
    }
});
// -------------------------------------------------------------------------

// ENGINE INTERACTIONS ========================================================

engine.on("authentication_failed", function (message) {
    if (message === "not authenticated") {
        window.location = "#/authentication?message=not-authenticated";
    } else if (message === "kicked out") {
        window.location = "#/authentication?message=kicked-out";
    }
});

engine.on("disconnect", function () {
    if (!disconnected) {
        disconnected = true;
        setConnectionStrength(null);
        showDaisy();
    }
});

engine.on("connect", function () {
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
    var onclass = "on";
    if (level === null) {
        level = 4;
        onclass = "err";
    }
    for (i = 1; i < 5; i++) {
        var bar = $("#cs" + i);
        if (i <= level) {
            bar.attr("class", onclass);
        } else {
            bar.attr("class", "off");
        }
    }
}

var signal_window = [];
signal_window = [3, 3, 3, 3, 3]; // preload circular buffer with 4s
var err_count = 0;

function ping() {
    engine.ping(function (err, time) {
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
}

ping();

engine.sendTime();

function touchScreen() {
    if (supportsTouch && window.innerWidth < 800) {
        $("#app-client-container").css({
            "-webkit-overflow-scrolling": "touch",
            "overflow-y": "scroll",
        });
    }
}
touchScreen();

$(".icon_sign_out").on("click", function (e) {
    e.preventDefault();
    dashboard.showModal({
        title: window.t("status.logout.title"),
        message: window.t("status.logout.message"),
        okText: window.t("status.yes"),
        cancelText: window.t("status.no"),
        ok: function () {
            window.location.href = "#/authentication";
        },
        cancel: function () {},
    });
});

// ========================================================================================= CALCULATOR
// Lightweight calculator modal driven by the sidebar Calculator icon. Backed
// by POST /eval, which uses the OpenSBP parser + evaluator — so expressions
// can include the full math library (SIN, SQRT, ROUND, ...), constants (PI),
// MOD, and references to live variables ($persistent, &temp, %(N), %config.path).
(function () {
    function openCalculator() {
        $(".calc-modal-dim").show();
        $(".calc-modal").show();
        $("#calc-error").hide().text("");
        // Focus expression input, place caret at end of any existing text
        var el = document.getElementById("calc-expr");
        if (el) {
            el.focus();
            var v = el.value;
            el.setSelectionRange(v.length, v.length);
        }
    }
    function closeCalculator() {
        $(".calc-modal").hide();
        $(".calc-modal-dim").hide();
    }
    function insertAtCursor(textarea, insertion) {
        var start = textarea.selectionStart, end = textarea.selectionEnd;
        var v = textarea.value;
        textarea.value = v.slice(0, start) + insertion + v.slice(end);
        // Place caret. For things like "POW(,)" / "ATAN2(,)" land between the
        // parens so the user can start typing the first argument.
        var landing = start + insertion.length;
        var m = insertion.match(/\(,/);
        if (m) landing = start + insertion.indexOf("(") + 1;
        textarea.focus();
        textarea.setSelectionRange(landing, landing);
    }
    function calculate() {
        var expr = $("#calc-expr").val();
        $("#calc-error").hide().text("");
        if (!expr || !expr.trim()) {
            $("#calc-result").val("");
            return;
        }
        engine.evalExpression(expr, function (err, data) {
            if (err || !data) {
                $("#calc-result").val("");
                $("#calc-error").text(typeof err === "string" ? err : "Could not evaluate.").show();
                return;
            }
            var v = data.value;
            var rendered;
            if (v === null || v === undefined) {
                rendered = "(undefined)";
            } else if (typeof v === "number") {
                rendered = (Math.abs(v) >= 1e6 || (v !== 0 && Math.abs(v) < 1e-4))
                    ? String(v)
                    : String(Math.round(v * 1e6) / 1e6);
            } else if (typeof v === "object") {
                try { rendered = JSON.stringify(v); } catch (e) { rendered = String(v); }
            } else {
                rendered = String(v);
            }
            $("#calc-result").val(rendered);
        });
    }

    $("#icon_calculator").on("click", function (e) {
        e.preventDefault();
        openCalculator();
    });
    $(".calc-close").on("click", closeCalculator);
    $(".calc-modal-dim").on("click", closeCalculator);
    $("#calc-button").on("click", calculate);
    $("#calc-expr").on("keydown", function (e) {
        // Enter (without shift) calculates; Shift+Enter inserts newline.
        if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
            e.preventDefault();
            calculate();
        } else if (e.key === "Escape") {
            closeCalculator();
        }
    });
    $("#calc-helper").on("change", function () {
        var v = this.value;
        if (!v) return;
        var ta = document.getElementById("calc-expr");
        insertAtCursor(ta, v);
        // Reset dropdown so picking the same item twice still fires.
        this.selectedIndex = 0;
    });
})();

// ========================================================================================= KEYPAD DRAGABILITY
// Keypad Modal Drag Functionality
function makeKeypadDraggable() {
    const modal = document.getElementById("keypad-modal");
    const dragHandle = modal.querySelector(".drag-handle");

    if (!dragHandle) {
        console.warn("Drag handle not found - modal not draggable");
        return;
    }

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    // Constrain modal to stay within viewport
    function constrainToViewport(left, top) {
        const modalRect = modal.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        left = Math.max(0, Math.min(left, viewportWidth - modalRect.width));
        top = Math.max(0, Math.min(top, viewportHeight - modalRect.height));

        return { left, top };
    }

    // SINGLE drag handle - no conflicts
    dragHandle.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return; // Only left click

        e.preventDefault();
        e.stopPropagation();

        isDragging = true;
        modal.classList.add("dragging");

        const modalRect = modal.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startLeft = modalRect.left;
        startTop = modalRect.top;

        console.log("Drag start - Modal rect:", modalRect, "Mouse:", { x: startX, y: startY });

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    });

    function handleMouseMove(e) {
        if (!isDragging) return;

        e.preventDefault();

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newLeft = startLeft + deltaX;
        let newTop = startTop + deltaY;

        const constrained = constrainToViewport(newLeft, newTop);

        modal.style.left = constrained.left + "px";
        modal.style.top = constrained.top + "px";
        modal.style.right = "auto";
        modal.style.bottom = "auto";
        modal.style.transform = "none";
        modal.style.margin = "0";
    }

    function handleMouseUp(e) {
        if (!isDragging) return;

        console.log("Drag end");
        isDragging = false;
        modal.classList.remove("dragging");

        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
    }

    // Touch support
    dragHandle.addEventListener("touchstart", function (e) {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent("mousedown", {
            clientX: touch.clientX,
            clientY: touch.clientY,
            button: 0,
        });
        dragHandle.dispatchEvent(mouseEvent);
    });

    document.addEventListener("touchmove", function (e) {
        if (!isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent("mousemove", {
            clientX: touch.clientX,
            clientY: touch.clientY,
        });
        document.dispatchEvent(mouseEvent);
    });

    document.addEventListener("touchend", function (e) {
        if (!isDragging) return;
        e.preventDefault();
        const mouseEvent = new MouseEvent("mouseup", {
            button: 0,
        });
        document.dispatchEvent(mouseEvent);
    });
}

// Initialize drag functionality when modal is shown
function initializeKeypadModal() {
    const modal = document.getElementById("keypad-modal");
    if (modal && !modal.hasAttribute("data-draggable-initialized")) {
        makeKeypadDraggable();
        modal.setAttribute("data-draggable-initialized", "true");
    }
}

// Helper functions to manage the top content
function showSpeedReadout(speed) {
    const speedElement = document.querySelector(".speed_read_out");
    speedElement.textContent = speed;
    speedElement.style.display = "block";
}

function hideSpeedReadout() {
    document.querySelector(".speed_read_out").style.display = "none";
}

function showKeypadMessage(message) {
    const messageElement = document.querySelector(".manual-drive-message");
    messageElement.textContent = message;
    messageElement.style.display = "block";
    // Hide title when showing message
    document.getElementById("title_goto").style.display = "none";
}

function hideKeypadMessage() {
    document.querySelector(".manual-drive-message").style.display = "none";
    // Show title when hiding message
    document.getElementById("title_goto").style.display = "block";
}

// Show/hide the soft authorize overlay over the manual control modal.
// Trigger condition: the manual drawer is visible AND auth_required is on
// AND auth_scope includes manual ("all") AND the machine is not currently
// authorized. While the overlay is up we also disable keypad and keyboard
// jog input so a key press can't slip past pointer-events.
function syncAuthorizeOverlay(status) {
    var $overlay = $(".authorize-overlay");
    var cfg = engine && engine.config && engine.config.machine;
    var scope = (cfg && cfg.auth_scope) || "all";
    var shouldShow =
        $(".manual-drive-modal").is(":visible") &&
        cfg && cfg.auth_required &&
        scope !== "file_only" &&
        !(status && status.auth);
    if (shouldShow) {
        $overlay.show();
        if (typeof keypad !== "undefined" && keypad) keypad.setEnabled(false);
        if (typeof keyboard !== "undefined" && keyboard) keyboard.setEnabled(false);
    } else {
        $overlay.hide();
    }
}

function showSoftLimitPrompt(axis) {
    var $prompt = $("#soft-limit-prompt");
    $prompt.find(".prompt-axis").text(axis);
    $prompt.data("axis", axis);
    $prompt.show();
}

function hideSoftLimitPrompt() {
    $("#soft-limit-prompt").hide();
}

// Bind directly on the prompt — the keypad-modal stops click propagation
// before it reaches `document`, so a delegated handler at the document level
// never fires.
$("#soft-limit-prompt").on("click", ".prompt-allow", function (e) {
    e.stopPropagation();
    var axis = $("#soft-limit-prompt").data("axis");
    if (axis) dashboard.engine.manualSoftLimitOverride(axis);
    hideSoftLimitPrompt();
});

$("#soft-limit-prompt").on("click", ".prompt-cancel", function (e) {
    e.stopPropagation();
    hideSoftLimitPrompt();
});

function showTitle() {
    document.getElementById("title_goto").style.display = "block";
}

function hideTitle() {
    document.getElementById("title_goto").style.display = "none";
}

// ========================================================================================
setUpManual(); // occasionally not getting keypad set from apps, this helps
