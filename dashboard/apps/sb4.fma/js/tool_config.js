/**
 * Updates various UI elements on the page from the engine's opensbp configuration.
 * Takes any element with an id of the form branchname-configitem_name that corresponds to a configuration item:
 * eg: opensbp-movexy_speed, opensbp-jogxy_speed
 * and populates it from the corresponding value in the opensbp configuration, read from the engine.
 **/
function updateUIFromEngineConfig() {
    // getting config values for OpenSBP and G2; note that move speeds is OpenSBP, but jogs are in G2
    fabmo.getConfig(function(err, data) {
      if(err) {
        console.error(err);
      } else {
        for(key in data.opensbp) {
          v = data.opensbp[key];
          input = $('#opensbp-' + key);
          if(input.length) {
            input.val(String(v));
          }
        }  
        for(key in data.driver) {
          v = data.driver[key];
          input = $('#g2-values' + key);
          if(input.length) {
            input.val(String(v));
          }  
        }
      }
    });
}

var previousXYHomedStatus = null;
var previousZHomedStatus = null;

function updateSpeedsFromEngineConfig() {  // ALSO update HOMING status at the same time
    fabmo.getConfig(function(err, data) {
        if (err) {
            console.error(err);
            return;
        }
        $('#formatted_movexy_speed').val(data.opensbp.movexy_speed.toFixed(2));
        $('#formatted_movez_speed').val(data.opensbp.movez_speed.toFixed(2));
        // Note that for g2, jog speeds are handled differently than move speeds (they are drived from G2 velocity max)
        $('#formatted_jogxy_speed').val(data.opensbp.jogxy_speed.toFixed(2));
        $('#formatted_jogz_speed').val(data.opensbp.jogz_speed.toFixed(2));
        $('#formatted_joga_speed').val(data.opensbp.joga_speed.toFixed(2));

        var xyHomedStatus = data?.opensbp?.tempVariables?.XYHOMED || null;
        if (!xyHomedStatus || xyHomedStatus == "false") {
            $("#first_macro_button").addClass("info");
            $("#first_macro_button").removeClass("disabled");
            if (previousXYHomedStatus !== "false") {
                fabmo.setConfig({"opensbp": {"tempVariables": {"XYHOMED": "false"}}}, function(err, data) {
                    if (err) {
                        console.error(err);
                    }
                });
                previousXYHomedStatus = "false";
            }
        } else {
            $("#first_macro_button").addClass("disabled");
            $("#first_macro_button").removeClass("info");
            if (previousXYHomedStatus !== "true") {
                fabmo.setConfig({"opensbp": {"tempVariables": {"XYHOMED": "true"}}}, function(err, data) {
                    if (err) {
                        console.error(err);
                    }
                });
                previousXYHomedStatus = "true";
            }
        }

        var zHomedStatus = data?.opensbp?.tempVariables?.ZHOMED || null;
        if (!zHomedStatus || zHomedStatus == "false") {
            $("#second_macro_button").addClass("info");
            $("#second_macro_button").removeClass("disabled");
            if (previousZHomedStatus !== "false") {
                fabmo.setConfig({"opensbp": {"tempVariables": {"ZHOMED": "false"}}}, function(err, data) {
                    if (err) {
                        console.error(err);
                    }
                });
                previousZHomedStatus = "false";
            }
        } else {
            $("#second_macro_button").addClass("disabled");
            $("#second_macro_button").removeClass("info");
            if (previousZHomedStatus !== "true") {
                fabmo.setConfig({"opensbp": {"tempVariables": {"ZHOMED": "true"}}}, function(err, data) {
                    if (err) {
                        console.error(err);
                    }
                });
                previousZHomedStatus = "true";
            }
        }
    });
}

// AXis = ["", "X", "Y", "Z", "A", "B", "C", "U", "V", "W" ]
function getAxisLimits() {
  let temp
  fabmo.getConfig(function(err, data) {
    if (err) {
        console.error(err);
    } else {
        let i = 1
        do {
        temp = AXis[i].toLowerCase();
        LIm_up[i] = data.machine.envelope[(temp + "max")];
        LIm_dn[i] = data.machine.envelope[(temp + "min")];
        console.log("testAxis",temp,LIm_up[i],LIm_dn[i]);
        } while(i++ < 6);
    }
  });  
}

function getExcludedAxes(callback) {         
    fabmo.getConfig(function(err, data) {
//      let excluded_axes_str="";
      let num_axes_str = "";
      let axes_in_use = 6;
        if(err) {
        console.error(err);
      } else {
        if (data.driver.xam == 0) {
          excluded_axes_str = excluded_axes_str + "X";
          num_axes_str = num_axes_str + "1";
          axes_in_use--;
        }
        if (data.driver.yam == 0) {
          excluded_axes_str = excluded_axes_str + "Y";
          num_axes_str = num_axes_str + "2";
          axes_in_use--;
        }
        if (data.driver.zam == 0) {
          excluded_axes_str = excluded_axes_str + "Z";
          num_axes_str = num_axes_str + "3";
          axes_in_use--;
        }
        if (data.driver.aam == 0) {
          excluded_axes_str = excluded_axes_str + "A";
          num_axes_str = num_axes_str + "4";
          axes_in_use--;
        }
        if (data.driver.bam == 0) {
          excluded_axes_str = excluded_axes_str + "B";
          num_axes_str = num_axes_str + "5";
          axes_in_use--;
        }
        if (data.driver.cam == 0) {
          excluded_axes_str = excluded_axes_str + "C";
          num_axes_str = num_axes_str + "6";
          axes_in_use--;
        }
        excluded_axes_str = excluded_axes_str + num_axes_str;
        console.log(data);
        console.log(axes_in_use);
        console.log("axes - " + excluded_axes_str);
        callback(excluded_axes_str);
      }
    });
}

function saveUIConfig() {
    localStorage.setItem("fabmo_sb4_height", g.COnt_Height);
    localStorage.setItem("fabmo_sb4_width", g.COnt_Width);
    localStorage.setItem("fabmo_sb4_vi", g.VI_display);
    localStorage.setItem("fabmo_sb4_video_layout", g.VI_layout || "none");
    console.log("UI Config saved: height=" + g.COnt_Height + ", width=" + g.COnt_Width + ", vi=" + g.VI_display + ", video_layout=" + g.VI_layout);
}

function restoreUIConfig() {
    const height = localStorage.getItem("fabmo_sb4_height");
    const width = localStorage.getItem("fabmo_sb4_width");
    const vi = localStorage.getItem("fabmo_sb4_vi");
    const videoLayout = localStorage.getItem("fabmo_sb4_video_layout");
    const hasVideo = localStorage.getItem("fabmo_sb4_has_video"); // Check if cameras are available
    
    if (width) {
        g.COnt_Width = parseInt(width, 10);
    }
    if (height) {
        g.COnt_Height = parseInt(height, 10);
    } else {
        g.COnt_Height = "200";
    }
    if (vi) {
        g.VI_display = parseInt(vi, 10);
    }
    if (videoLayout) {
        g.VI_layout = videoLayout;
    } else {
        g.VI_layout = "none";
    }
    $("#sbp-container").css("height", g.COnt_Height);

    // Clear all button classes first
    $("#vid-button").removeClass("vid-button-on vid-button-off vid-button-disabled");

    // Check if cameras are available
    if (hasVideo === "false" || hasVideo === null) {
        // NO CAMERAS AVAILABLE - Button disabled
        $("#file_txt_area").css("background", "#327c7e");
        $("#video").css("visibility", "hidden");
        $("#vid-button").addClass("vid-button-disabled");
        g.VI_display = 0;
        localStorage.setItem("fabmo_sb4_has_video", "false");
    } else {
        // CAMERAS ARE AVAILABLE - Check if video is on or off
        if (g.VI_display !== 0) {
            // VIDEO ON
            $("#video").css("visibility", "visible");
            $("#file_txt_area").css("background", "transparent");
            $("#vid-button").addClass("vid-button-on");
            g.VI_layout = videoLayout || "both";
            localStorage.setItem("fabmo_videos", 2);
            localStorage.setItem("fabmo_sb4_has_video", "true");
            $("#sbp-container").click(); // refresh the form
        } else {
            // VIDEO OFF (but cameras available)
            $("#file_txt_area").css("background", "#327c7e");
            $("#video").css("visibility", "hidden");
            $("#vid-button").addClass("vid-button-off");
            g.VI_display = 0;
            localStorage.setItem("fabmo_sb4_has_video", "true"); // Still true - cameras exist
        }
    }
}


/**
 * id is of the form opensbp-configitem_name such as opensbp-movexy_speed, etc.
 * This will only work for configuration items on the first branch of the tree - 
 * deeper items need more consideration. (???)
 **/
function setConfig(id, value) {
	var parts = id.split("-");
	var o = {};
	var co = o;
	var i=0;

	do {
	  co[parts[i]] = {};
	  if(i < parts.length-1) {
	    co = co[parts[i]];            
	  }
	} while(i++ < parts.length-1 );

	co[parts[parts.length-1]] = value;
	  console.log(o);
    fabmo.setConfig(o, function(err, data) {
	  updateUIFromEngineConfig();
	});
}



/**
 * Manage App Config and Variables                      // Note that this info in stored in the app, approot/approot/generatedName/config.json
 * Much of this might be better handled with local storage in the browser, but I wanted to explore app specific variables storage would work. This storage
 * transends the client side app, but is not shared with other apps.
 **/ 

// function updateAppState() {
//     fabmo.getAppConfig(function (err, config) {
//         if (err) {
//             console.error(err);
//         } else {
//             //console.log("App Config", config);
//             //console.log("first read ", config["COnt_Height"]);
//             if (config["cont-height"]) {
//                 g.COnt_Height = config["cont-height"];
//             } else {
//                 g.COnt_Height = "200";
//             }
//             // if (config["cont-width"]) {
//             //     g.COnt_Width = config["cont-width"];
//             // } else {
//             //     g.COnt_Width = "400px";
//             // }   
//             $("#sbp-container").css("height", g.COnt_Height);
//             // $("#sbp-container").css("width", g.COnt_Width);
//             if (config["vi-display"] === null || config["vi-display"] === 0) {
//                 g.VI_display = 0;
//             } else {
//                 g.VI_display = config["vi-display"];
//             }   
//         }
//         // Video state, read from local app storage ... if we have no feed
//         if (localStorage.getItem("videos") === null || localStorage.getItem("videos") === "0") {
//             $("#file_txt_area").css("background", "#327c7e");
//             $("#vid-button").removeClass("vid-button-on");
//             $("#vid-button").removeClass("vid-button-off");
//             $("#vid-button").addClass("vid-button-disabled");
//             localStorage.setItem("fabmo_sb4_has_video", "false");
//             g.VI_display = 0;
//         } else {
//             // ... if we have a feed, look at state of the video toggle button
//             if (g.VI_display !== 0) {
//                 $("#video").css("visibility", "visible");
//                 $("#file_txt_area").css("background", "transparent");
//                 $("#vid-button").addClass("vid-button-on");
//                 $("#vid-button").removeClass("vid-button-off");
//                 $("#vid-button").removeClass("vid-button-disabled");
//                 g.VI_display = 3;                                    // Assume both feeds at moment
//                 localStorage.setItem("videos", 2);                   // ... redundant to system; needs to be generated
//                 localStorage.setItem("fabmo_sb4_has_video", "true"); // ... inform system for transparent keypad
//                 $("#sbp-container").click();                         // ... refresh the form; a hack, but it works
//             } else {
//                 $("#file_txt_area").css("background", "#327c7e");
//                 $("#video").css("visibility", "hidden");
//                 $("#vid-button").removeClass("vid-button-on");
//                 $("#vid-button").addClass("vid-button-off");
//                 $("#vid-button").removeClass("vid-button-disabled");
//                 g.VI_display = 0;
//                 localStorage.setItem("fabmo_sb4_has_video", "false");
//                 $("#sbp-container").click();
//             }
//         }
//     });
// }
