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
var FabMoAPI = require("./libs/fabmoapi.js");
var FabMoUI = require("./libs/fabmoui.js");
var Keyboard = require("./libs/keyboard.js");
var Keypad = require("./libs/keypad.js");

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
        // Turn off fixed-distance if it is on (someone may want remembering to be an option?)
        $(".drive-button").removeClass("drive-button-fixed");
        $(".slidecontainer").show();
        $(".fixed-input-container").hide();
        $(".fixed-switch input").prop("checked", false);
        //        $("#action-5 img").attr("src", "../img/icon_spindle_off.png"); // probably not useful
        $("#action-5").css("background-color", "#ce6402");

        // Function to set location displays and then set video style
        function setLocationAndVideoStyle() {
            setLocationDisplays();
            adjustModalHeight();
            setVideoStyle();
            resolve(); // Resolve the promise after setting location displays and video style
        }

        engine.getConfig(function (err, config) {
            if (err) {
                console.log(err);
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
            }
            // Call the function to set location displays and video style
            setLocationAndVideoStyle();
        });

        // Initialize drag functionality
        setTimeout(() => {
            initializeKeypadModal();
        }, 100); // Small delay to ensure modal is rendered

        resolve();
    });
};

var startManualExit = function () {
    return new Promise((resolve, reject) => {
        // Turn off fixed-distance if it is on (someone may want remembering to be an option?)
        $(".drive-button").removeClass("drive-button-fixed");
        $(".slidecontainer").show();
        $(".fixed-input-container").hide();
        $(".fixed-switch input").prop("checked", false);
        // Clean up spindle which will automatically turn off
        $("#action-5 img").attr("src", "../img/icon_spindle_off.png");
        $("#action-5").css("background-color", "#ce6402");

        // Function to set location displays and then set video style
        function setLocationAndVideoStyle() {
            setLocationDisplays();
            setVideoStyle();
            resolve(); // Resolve the promise after setting location displays and video style
        }
        setLocationAndVideoStyle();
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
});

function checkForGlobalBackupRestore() {
    // console.log("DEBUG: Global dashboard backup restore check");

    setTimeout(function() {
        // console.log("DEBUG: Making global API call to check backup status");
        
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
    }, 3000); 
}

function showGlobalBackupRestoreModal(backupInfo) {
    // console.log("DEBUG: Showing global backup restore modal");
    
    var backupDate = new Date(backupInfo.created_at).toLocaleString();
    var message = 
        'FabMo has found a configuration backup made before this update.<br>' +
        'Backup created: ' + backupDate + '<br>' +
        'Would you like to restore your previous configuration?';

    dashboard.showModal({
        title: 'Configuration Backup Available',
        message: message,
        okText: 'Use My Previous Config',
        cancelText: 'Keep the New Config',
        ok: function() {
            // console.log("DEBUG: User chose to restore global backup");
            
            // Show progress message
            dashboard.notification('info', 'Restoring backup... System will restart shortly.');
            
            // Use direct API call
            $.ajax({
                url: '/config/restore-backup',
                method: 'POST',
                success: function(response) {
                    // console.log("DEBUG: Restore backup response:", response);
                    if (response.status === 'success') {
                        dashboard.notification('success', 'Backup restored - restarting...');
                        
                        // Set up authentication check for after restart
                        sessionStorage.setItem('fabmo_expect_restart', 'backup_restore');
                        sessionStorage.removeItem('fabmo_authenticated');
                        
                        // Monitor for restart completion
                        monitorRestartAndAuth();
                        
                    } else {
                        dashboard.notification('error', 'Failed to restore backup: ' + response.message);
                    }
                },
                error: function(xhr, status, error) {
                    // console.log("DEBUG: Error restoring backup:", error);
                    dashboard.notification('error', 'Failed to restore backup: ' + error);
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
                    dashboard.notification('info', 'Keeping current configuration');
                },
                error: function(xhr, status, error) {
                    // console.log("DEBUG: Error during cleanup:", error);
                    dashboard.notification('info', 'Keeping current configuration');
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
            
            // Force redirect to authentication
            setTimeout(function() {
                if (window.location.hash !== "#/authentication") {
                    // console.log("DEBUG: Redirecting to authentication");
                    window.location.href = "#/authentication";
                }
            }, 100);
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
    setTimeout(function() {
        checkAuthenticationStatus(true);
    }, 2000);
    
    // Set up periodic checks for the first 30 seconds after startup
    let checkCount = 0;
    const maxChecks = 6; // 6 checks over 30 seconds
    
    const periodicCheck = setInterval(function() {
        checkCount++;
        
        if (sessionStorage.getItem('fabmo_authenticated') === 'true') {
            // console.log("DEBUG: Authentication confirmed, stopping periodic checks");
            clearInterval(periodicCheck);
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
        keypadHeight = 450;
        marginTop = '0%';
    } else if (visibleAxes === 5) {
        keypadHeight = 450;
        marginTop = '3%';
    } else { // 6 or more axes
        keypadHeight = 450;
        marginTop = '3%';
    }

    $(".manual-drive-modal").css("height", keypadHeight);
    $(".manual-drive-container").css("margin-top", marginTop);

    console.log(`Adjusted modal height to ${marginTop} for ${visibleAxes} axes`);
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

            keyboard = setupKeyboard();
            keypad = setupKeypad();

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

            setLocationDisplays();

            // ------------------------------------------------------------ STATUS HANDLER
            dashboard.engine.on("status", function (status) {
                fixedTimeEnd = Date.now();
                console.log(status);
                if (status.state == "dead") {
                    dashboard.showModal({
                        title: "An Error Occurred!",
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
                            // if an axis is selected in go-to or set, then flag is true
                            if (in_goto_flag) {
                                in_goto_flag = false;
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

                if (status.state !== "manual" && last_state_seen === "manual") {
                    $(".modalDim").hide();
                    $(".manual-drive-modal").hide();
                    keyboard.setEnabled(false);
                }

                if (
                    (status.state != "armed" && last_state_seen === "armed") ||
                    (status.state != "paused" && last_state_seen === "paused") ||
                    (status.state != "interlock" && last_state_seen === "interlock") ||
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
                if (status["info"] && status["info"]["id"] != lastInfoSeen) {
                    lastInfoSeen = status["info"]["id"];
                    if (status.info["message"]) {
                        if (status.state === "manual") {
                            $("#title_goto").css("visibility", "hidden");
                            $(".manual-drive-message").show();
                            $(".manual-drive-message").html(status.info.message);
                            $(".manual-drive-message").addClass("blinking-text");
                            $("#action-1").css("visibility", "hidden");
                            $("#action-2").css("visibility", "hidden");
                            $("#action-3").css("visibility", "hidden");
                            $("#action-4").css("visibility", "hidden");
                            $("#action-5").css("visibility", "hidden");
                            // Use "display: none" to hide and remove space
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
                                if (modalOptions.ok === null && modalOptions.cancel === null) {
                                    modalOptions.okText = "Resume";
                                    modalOptions.ok = resumeFunction;
                                    modalOptions.cancelText = "Quit";
                                    modalOptions.cancel = cancelFunction;
                                }
                                // if (modalOptions.ok === null) {
                                //     modalOptions.okText = "Resume";
                                //     modalOptions.ok = resumeFunction;
                                // }
                                // if (modalOptions.cancel === null) {
                                //     modalOptions.cancelText = "Quit";
                                //     modalOptions.cancel = cancelFunction;
                                // }
                            } else {
                                // No custom parameters; use default buttons
                                modalOptions.okText = "Resume";
                                modalOptions.cancelText = "Quit";
                                modalOptions.ok = resumeFunction;
                                modalOptions.cancel = cancelFunction;
                            }

                            // Show the modal
                            dashboard.showModal(modalOptions);
                            modalIsShown = true;
                            dashboard.handlers.hideFooter();
                        }

                        $("#keypad-modal").focus();
                    } else if (status.info["error"]) {
                        if (dashboard.engine.status.job) {
                            var detailHTML =
                                "<p>" +
                                "<b>Job Name:  </b>" +
                                dashboard.engine.status.job.name +
                                "<br />" +
                                "<b>Job Description:  </b>" +
                                dashboard.engine.status.job.description +
                                "</p>";
                        } else {
                            detailHTML =
                                '<p>Check the log <a href="/log" target="_blank"><span style="color: blue"> for more information</span>.</a></p>';
                        }
                        dashboard.showModal({
                            title: "An Error Occurred!",
                            message: status.info.error,
                            detail: detailHTML,
                            cancelText: "Close",
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
                    authorizeDialog = true;
                    keypad.setEnabled(false);
                    keyboard.setEnabled(false);
                    dashboard.showModal({
                        title: "Authorization Required!",
                        message: "To authorize your tool, press and hold the start button for one second.",
                        cancelText: "Quit",
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
                        title: "Limit Hit!",
                        message:
                            "Limit Switch has been Hit! Quit will temporarily over-ride Limit sensor to allow backing off with Keypad.",
                        cancelText: "Quit",
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
                        title: "Safety Interlock Activated!",
                        message:
                            "You cannot perform the specified action with the safety interlock open.  Please close the safety interlock before Resuming.",
                        cancelText: "Quit",
                        cancel: function () {
                            interlockDialog = false;
                            dashboard.engine.quit(function (err, result) {
                                if (err) {
                                    console.log("ERRROR: " + err);
                                }
                            });
                        },
                        okText: "Resume",
                        ok: function () {
                            dashboard.engine.resume();
                        },
                    });
                } else if (status.state === "lock" && status.resumeFlag === false) {
                    interlockDialog = true;
                    keypad.setEnabled(false);
                    keyboard.setEnabled(false);
                    dashboard.showModal({
                        title: "Stop Input Activated!",
                        message: "Please release any Stop Input before continuing.",
                        cancelText: "Quit",
                        cancel: function () {
                            interlockDialog = false;
                            dashboard.engine.quit(function (err, result) {
                                if (err) {
                                    console.log("ERRROR: " + err);
                                }
                            });
                        },
                        okText: "Resume",
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

function setupKeyboard() {
    var keyboard = new Keyboard();
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
    var keypad = new Keypad("#keypad");
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

$(".action-button").on("click", function () {
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

$(".manual-drive-exit").on("click", function () {
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
            title: "Waiting for FabMo...",
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

// Click outside the modal keypad to close it  //th: don't know if I like this now that it is done?
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
        // do this only if in manual mode
        if (last_state_seen === "manual") {
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

$(".go-to").on("mousedown", function () {
    var move = {};
    $(".modal-axi:visible").each(function () {
        move[$(this).attr("id")] = parseFloat($(this).val());
    });
    dashboard.engine.goto(move);
});

$(".manual-stop").on("mousedown", function () {
    dashboard.engine.manualStop();
});

$(".set-coordinates").on("mousedown", function () {
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
    $(this).val(parseFloat($(this).val().toString()));
    $(this).select();
    keyboard.setEnabled(false);
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
        $(".posx").val($(".posx").val());
        $(".posy").val($(".posy").val());
        $(".posz").val($(".posz").val());
        $(".posa").val($(".posa").val());
        $(".posb").val($(".posb").val());
        $(".posc").val($(".posc").val());
        in_goto_flag = false;
        $("#keypad").show();
        $(".go-to-container").hide();
        if ($(event.target).hasClass("fixed-step-value")) {
            keyboard.setEnabled(false);
        } else {
            keyboard.setEnabled(true);
        }
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

$(".zero-button").on("click", function () {
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

// UI for SPEED AND OVERRIDE (%) -------------------------------------------------
var changeFeedRate = function (new_feedrate) {
    if (new_feedrate > 0 && new_feedrate < 1000) {
        dashboard.handlers.runSBP("MS, " + new_feedrate, function (err, result) {
            if (err) {
                console.error("An error occurred:", err);
            } else {
                console.log("The result is:", result);
            }
        });
    }
};
$("#feed-rate").on("change", function (evt) {
    var new_feedrate = parseFloat($("#feed-rate").val());
    changeFeedRate(new_feedrate);
});
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
        // Check against: feedrate override range
        if (new_override > 4 && new_override < 301) {
            overrideFeedRate(new_override);
        }
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

// UI for Spindle Speed (RPM & AMP) -----------------------------------------------
const debouncedChangeSpindleSpeed = debounce(function (new_RPM) {
    changeSpindleSpeed(new_RPM);
}, 1500);
var changeSpindleSpeed = function (new_RPM) {
    try {
        console.log("----> new speed: " + new_RPM);
        engine.setAcc("spindle_speed", new_RPM);
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
$(".spindle-speed input").on("input", function (evt) {
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
$("#sp-speed").on("input", function (evt) {
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
        title: "Log Out?",
        message: "Are you sure you want to sign out of this machine?",
        okText: "Yes",
        cancelText: "No",
        ok: function () {
            window.location.href = "#/authentication";
        },
        cancel: function () {},
    });
});

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

function showTitle() {
    document.getElementById("title_goto").style.display = "block";
}

function hideTitle() {
    document.getElementById("title_goto").style.display = "none";
}

// ========================================================================================
setUpManual(); // occasionally not getting keypad set from apps, this helps
