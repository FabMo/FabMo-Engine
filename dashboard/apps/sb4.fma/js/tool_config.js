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


let video_button = "0"; // note that the localStorage value is a string, so we use "0", "1", or "2"
let videoLayout = "none";
let hasVideo = true;

function updateSpeedsFromEngineConfig() {  // ALSO update HOMING status at the same time
    fabmo.getConfig(function(err, data) {
        if (err) {
            console.error(err);
            return;
        }
        $('#formatted_movexy_speed').val(data.opensbp.movexy_speed.toFixed(2));
        $('#formatted_movez_speed').val(data.opensbp.movez_speed.toFixed(2));
        
        // Show/hide and populate A, B, C axis move speeds if configured
        if (data.driver && data.driver.aam !== 0 && data.opensbp.movea_speed !== undefined) {
            $('#movea-container').show();
            $('#formatted_movea_speed').val(data.opensbp.movea_speed.toFixed(2));
        } else {
            $('#movea-container').hide();
        }
        
        if (data.driver && data.driver.bam !== 0 && data.opensbp.moveb_speed !== undefined) {
            $('#moveb-container').show();
            $('#formatted_moveb_speed').val(data.opensbp.moveb_speed.toFixed(2));
        } else {
            $('#moveb-container').hide();
        }
        
        if (data.driver && data.driver.cam !== 0 && data.opensbp.movec_speed !== undefined) {
            $('#movec-container').show();
            $('#formatted_movec_speed').val(data.opensbp.movec_speed.toFixed(2));
        } else {
            $('#movec-container').hide();
        }
        
        // Note that for g2, jog speeds are handled differently than move speeds (they are drived from G2 velocity max)
        $('#formatted_jogxy_speed').val(data.opensbp.jogxy_speed.toFixed(2));
        $('#formatted_jogz_speed').val(data.opensbp.jogz_speed.toFixed(2));

        // Show/hide and populate A, B, C axis move speeds if configured
        if (data.driver && data.driver.aam !== 0 && data.opensbp.joga_speed !== undefined) {
            $('#joga-container').show();
            $('#formatted_joga_speed').val(data.opensbp.joga_speed.toFixed(2));
        } else {
            $('#joga-container').hide();
        }
        
        if (data.driver && data.driver.bam !== 0 && data.opensbp.jogb_speed !== undefined) {
            $('#jogb-container').show();
            $('#formatted_jogb_speed').val(data.opensbp.jogb_speed.toFixed(2));
        } else {
            $('#jogb-container').hide();
        }
        
        if (data.driver && data.driver.cam !== 0 && data.opensbp.jogc_speed !== undefined) {
            $('#jogc-container').show();
            $('#formatted_jogc_speed').val(data.opensbp.jogc_speed.toFixed(2));
        } else {
            $('#jogc-container').hide();
        }


        applyHomedIndicator("xy", data?.opensbp?.tempVariables?.XYHOMED);
        applyHomedIndicator("z", data?.opensbp?.tempVariables?.ZHOMED);
    });
}

// ---- Homed indicators (Machine card Home XY / Home Z buttons) ----
// Homed state lives in opensbp tempVariables XYHOMED / ZHOMED ("true"/"false"),
// set by macros 2/3/9 and absent again after an engine start; absent is read
// and written back as "false", as Sb4 always did. Display only — nothing in
// the engine or macros reads these except macro 99.
// Button classes: sb4-unhomed (yellow), sb4-homed (dimmed), sb4-ind-off.
// The ⦸ glyph cycles: not homed -> homed -> indicator off (per browser,
// localStorage sb4-homed-ind-<axis>) -> not homed.
var HOMED_BTN = { xy: "#btn-home-xy", z: "#btn-home-z" };
var homedState = { xy: null, z: null };   // "true" / "false" as last seen

function homedIndicatorOff(axis) {
    try { return localStorage.getItem("sb4-homed-ind-" + axis) === "off"; } catch (e) { return false; }
}

function setHomedVar(axis, value, callback) {
    var v = {};
    v[axis.toUpperCase() + "HOMED"] = value;
    fabmo.setConfig({ opensbp: { tempVariables: v } }, function (err) {
        if (err) { console.error(err); }
        if (callback) { callback(err); }
    });
}

function applyHomedIndicator(axis, raw) {
    var homed = (raw === true || raw === "true") ? "true" : "false";
    if (homedState[axis] !== homed) {
        if (raw === undefined || raw === null || raw === "") {
            setHomedVar(axis, "false");                 // normalize absent -> "false"
        }
        homedState[axis] = homed;
    }
    var off = homedIndicatorOff(axis);
    $(HOMED_BTN[axis])
        .toggleClass("sb4-ind-off", off)
        .toggleClass("sb4-unhomed", !off && homed === "false")
        .toggleClass("sb4-homed", !off && homed === "true");
}

function cycleHomedIndicator(axis) {
    if (homedIndicatorOff(axis)) {                       // off -> not homed
        try { localStorage.removeItem("sb4-homed-ind-" + axis); } catch (e) { /* no storage */ }
        homedState[axis] = null;
        setHomedVar(axis, "false", updateSpeedsFromEngineConfig);
    } else if (homedState[axis] === "true") {            // homed -> off
        try { localStorage.setItem("sb4-homed-ind-" + axis, "off"); } catch (e) { /* no storage */ }
        updateSpeedsFromEngineConfig();
    } else {                                             // not homed -> homed
        homedState[axis] = null;
        setHomedVar(axis, "true", updateSpeedsFromEngineConfig);
    }
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
}

function restoreUIConfig() {
    const height = localStorage.getItem("fabmo_sb4_height");
    const width = localStorage.getItem("fabmo_sb4_width");
    video_button = localStorage.getItem("fabmo_sb4_video_button");  // 0 = disabled, 1 = off, 2 = on
    videoLayout = localStorage.getItem("fabmo_sb4_video_layout");
    hasVideo = localStorage.getItem("fabmo_sb4_has_video");

    if (width) {
        g.COnt_Width = parseInt(width, 10);
    }
    if (height) {
        g.COnt_Height = parseInt(height, 10);
    } else {
        g.COnt_Height = "200";
    }

    if (hasVideo === "false" || hasVideo === null) {
       videoLayout = "none"; // No video available
       console.log("No video available, setting layout to 'none'");
    }
    else if (videoLayout != "both" && videoLayout != "cam1" && videoLayout != "cam2") {
        videoLayout = "both";
        console.log("Invalid video layout, setting to 'none'");
    }
    else if (videoLayout === "none") { // if it's already "none", test again
        videoLayout = "both";
        console.log("Video layout is 'none', setting to 'both'");
    }
    localStorage.setItem("fabmo_sb4_video_layout", videoLayout);

    $("#sbp-container").css("height", g.COnt_Height);

    // Clear all button classes first
    $("#vid-button").removeClass("vid-button-on vid-button-off vid-button-disabled");
    // Check if cameras are available
    if (hasVideo === "false" || hasVideo === null) {
        // NO CAMERAS AVAILABLE - Button disabled
        $("#file_txt_area").css("background", "#327c7e");
        $("#video").css("visibility", "hidden");
        $("#vid-button").addClass("vid-button-disabled");
        localStorage.setItem("fabmo_sb4_video_button", 0); // Video button is disabled (grayed out)
        localStorage.setItem("fabmo_sb4_has_video", "false");
    } else {
        // CAMERAS ARE AVAILABLE - Check if video is on or off
        if (video_button == 2) {   // Note: video_button is a string, so we check for "2"
            // VIDEO ON
            $("#video").css("visibility", "visible");
            $("#file_txt_area").css("background", "transparent");
            $("#vid-button").addClass("vid-button-on");
            localStorage.setItem("fabmo_sb4_video_button", 2); // Video button is on RED
            localStorage.setItem("fabmo_sb4_has_video", "true");
            $("#sbp-container").click(); // refresh the form
        } else {
            // VIDEO OFF (but cameras available)
            $("#file_txt_area").css("background", "#327c7e");
            $("#video").css("visibility", "hidden");
            $("#vid-button").addClass("vid-button-off");
            localStorage.setItem("fabmo_sb4_video_button", 1); // Button is off but still visible WHITE
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
