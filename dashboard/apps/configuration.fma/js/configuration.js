require('./jquery.dragster.js');
require('jquery');
var setApps = require('./app_manager.js');
var setUsers = require('./user_manager');
var Foundation = require('../../../static/js/libs/foundation.min.js');
var moment = require('../../../static/js/libs/moment.js');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;

// Having ABC operate differently than XYZ and G2 makes this axis overloaded with special cases
// ... and using ips rather than G2's mps makes it even more complicated; lots of fussing here
// For jerk values, we stick with "per minute" reports as these values don't have intuitive meaning
// ... and it just makes it easier to stay consistent with G2


$('body').bind('focusin focus', function(e){
  e.preventDefault();
})

var axis_modes = {
  a_mode: 0, // For ABC axis mode:   0=disable; 1=degrees; 2=linear; 3=speed/radius(not implemented yet)
  b_mode: 0,
  c_mode: 0,
};

var unit_label_index = {}
var registerUnitLabel = function(label, in_label, mm_label) {
  var labels = {
    'in' : in_label,
    'mm' : mm_label
  }
  unit_label_index[label] = labels;
}

var flattenObject = function(ob) {
  var toReturn = {};
  for (var i in ob) {
    if (!ob.hasOwnProperty(i)) continue;

    if ((typeof ob[i]) == 'object') {
      var flatObject = flattenObject(ob[i]);
      for (var x in flatObject) {
        if (!flatObject.hasOwnProperty(x)) continue;

        toReturn[i + '-' + x] = flatObject[x];
      }
    } else {
      toReturn[i] = ob[i];
    }
  }
  return toReturn;
};

function update() {
  fabmo.getVersion(function(err, version) {
    switch(version.type) {
      case 'dev':
        // We want the version prefix for cache-busting during development,
        // but don't need to display it as part of the version string
        const VERSION_STRING_START_INDEX = 6;
        $('.engine-version').text(version.number.substring(VERSION_STRING_START_INDEX));
        break;
      case 'release':
        $('.engine-version').text(version.number);
        break;
    }
  });
  fabmo.getInfo(function(err, info) {
    if(err) {
      console.error(err);
    } else {
      $('.firmware-version').text(info.firmware.version.replace("-dirty","")) 
    }
  });
  fabmo.getConfig(function(err, data) {
    if(err) {
      console.error(err);
    } else {
      let decimals = '';
      configData = data;
      ['driver', 'engine', 'machine', 'opensbp'].forEach(function(branchname) {
          branch = flattenObject(data[branchname]);
          for(key in branch) {
            v = branch[key];
            // for managing decimal places
            if ( key === 'units') {decimals = v == "mm" ? 100 : 1000};
            // Get ABC axis modes for later use
            if ( key === 'aam') {axis_modes["a_mode"] = v}
            if ( key === 'bam') {axis_modes["b_mode"] = v}
            if ( key === 'cam') {axis_modes["c_mode"] = v}  
            input = $('#' + branchname + '-' + key);
            if(input.length) {
                if (input.is(':checkbox')){
                  if (v){
                      input.prop( "checked", true );
                  } else {
                      input.prop( "checked", false );
                  }
                } else {
                  if ( key != 'jogy_speed' &&  key != 'y_maxjerk' ) {    // ...ugly way to handle, per below
                    input.val(String(v));                                // Most values updated here    
                      
                      if (key.substring(1,3) === 'fr') {                // Handle special case of feedrate values
                          input.val((Math.round(String(v) * 100) / (60 * 100)));
                      }  
                    }
                }  
            }
            // Handle special case of representing jogs in config manager display in units/sec
            if ( key.substring(0,3) === 'jog' && key != 'jogy_speed') {
                input.val((Math.round(String(v) * decimals) / decimals));
            }    
            // Handle special case that some Y axis values are linked to X axis in FabMo
            // ... for Jog speed
            if ( key === 'jogxy_speed' ) {
                $('#' + branchname + '-' + 'jogy_speed').val((Math.round(String(v) * decimals) / decimals));
            }

            if ( key === 'xy_maxjerk' ) {
                $('#' + branchname + '-' + 'y_maxjerk').val(String(v));
            }
          }
        });
      // Update all the labels based on the current unit setting
      var unit = data.machine.units;
      $.each(unit_label_index, function(key, value) {  // handles units for XYZ
          $(key).html(value[unit]);
      });
      for (var key in axis_modes) {                    // handles units for ABC
        if (axis_modes.hasOwnProperty(key)) {
          var axis = key.substring(0,1);
          var mode = axis_modes[key];
          if (mode === 2) { // if linear
            if (unit === "in") {
              $("." + axis + "-axis-unit").html("in/sec");
              $("." + axis + "-axis-jerk-unit").html("in/min<sup>3</sup>");
            } else {
              $("." + axis + "-axis-unit").html("mm/sec");
              $("." + axis + "-axis-jerk-unit").html("mm/min<sup>3</sup>");
            }
          } else {
            $("." + axis + "-axis-unit").html("degs/sec");
            $("." + axis + "-axis-jerk-unit").html("deg/min<sup>3</sup>");
          }
        }
      }
      var profiles = data['profiles'] || {}
      var profilesList = $('#profile-listbox');
      profilesList.empty();
      if(profiles) {
        for(var name in profiles) {
          profilesList.append(
              $('<option></option>').val(name).html(name)
          );
        }
      } else {
        console.error("No profiles!")
      }
      // Shim
      if(data.engine.profile === 'default') {
        data.engine.profile = 'Default';
      }
      profilesList.val(data.engine.profile);
    }
  });
}

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
	fabmo.setConfig(o, function(err, data) {
    notifyChange(err,id);
    update();
	});
}

var notifyChange = function(err,id){
  if(err){
    $('#'+id).addClass("flash-red");
  }else{
    $('#'+id).addClass("flash-green");
  }
  setTimeout(function(){$('#'+id).removeClass("flash-red flash-green")},500);
};

var configData = null;

// Handle Backups

$('#btn-backup').click(function(evt) {
    fabmo.getConfig(function(err,conf){
        if(err){
            fabmo.notify('error','cannot backup the config !');
        }else{
            fabmo._download(JSON.stringify(conf), 'fabmo_config_backup.fmc','text/json');
        }
    });
});

$('#btn-restore').click(function(evt) {
    $('#restore_conf_file').trigger('click');
});

$("#restore_conf_file").change(function() {
    var files = $(this).prop('files');
    if(files.length===1){
        var conf_file = files[0];
        if(!conf_file)return;
        if(conf_file.name.split('.').pop()!=='fmc'){
            fabmo.notify('error','the file you submitted is not valid');
            $("#restore_conf_file").attr("value", "");
            return;
        }
        var reader = new FileReader();
        reader.readAsText(conf_file);
        reader.onload = function(evt)
        {
            try{
                conf = JSON.parse(evt.target.result);
            }catch(ex){
            fabmo.notify("error","Error reading file : "+ex);
            $("#restore_conf_file").attr("value", "");
            return;
            }
            fabmo.setConfig(conf,function(err){
                if(err){
                    fabmo.notify("error",err);
                    $("#restore_conf_file").attr("value", "");
                    return;
                }
                fabmo.notify("success","the configuration file have been successfully loaded !");
                $("#restore_conf_file").attr("value", "");
            });
        }
        reader.onerror = function (evt) {
            fabmo.notify("error","Error reading file");
            $("#restore_conf_file").attr("value", "");
        }
    }
});

// Backup Macros
$('#btn-macros-backup').click(function () {
  fetch('/macros/backup', {
      method: 'GET',
  })
    .then((response) => {
        if (!response.ok) {
            throw new Error('Failed to backup macros');
        }
        return response.blob(); // Get the response as a binary Blob
    })
    .then((blob) => {
        // Create a download link for the Blob
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'fabmo_macros_backup.zip'; // Set the file name
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url); // Clean up the URL
        fabmo.notify('success', 'Macros backup completed successfully!');
    })
  .catch((err) => {
      fabmo.notify('error', 'Failed to backup macros: ' + err.message);
  });
});


// Restore Macros
$('#btn-macros-restore').click(function () {
    $('#restore_macros_dir').trigger('click');
});

$('#restore_macros_dir').change(function() {
  const files = $(this).prop('files');
  if (files.length === 1) {
    const macroFile = files[0];
    fabmo.notify('info', 'Uploading and restoring macros...');
    const formData = new FormData();
    formData.append('file', macroFile);
    
    $.ajax({
      url: '/macros/restore',
      type: 'POST',
      data: formData,
      processData: false,
      contentType: false,
      timeout: 120000, // 2-minute timeout
      success: function(response) {
        fabmo.notify('success', 'Macros restored successfully!');
      },
      error: function(xhr, status, error) {
        console.error('Upload error:', xhr.responseText);
        let errorMessage = 'Failed to restore macros';
        
        try {
          const errorObj = JSON.parse(xhr.responseText);
          if (errorObj && errorObj.message) {
            errorMessage += ': ' + errorObj.message;
          }
        } catch (e) {
          errorMessage += ': ' + error;
        }
        fabmo.notify('error', errorMessage);
      },
      complete: function() {
        // Reset the file input
        $('#restore_macros_dir').val('');
        location.reload(); // Uncomment this line to refresh the page
      }
    });
  }
});

// Other Config page functions

$('#btn-flash-firm').click(function() {
    $('#firmware-input').trigger('click');
  });

$('#btn-reload-firm').click(function() {
    fabmo.showModal({
      title: 'Reload G2 Firmware?',
      message: 'This will reload the G2 firmware from the current FabMo version. The tool will restart.',
      okText: 'Reload',
      cancelText: 'Cancel',
      ok: function() {
        fabmo.notify('info', 'Reloading G2 firmware ...');
        fabmo.reloadFirmware({}, function(err, data) {
          if (err) {
            fabmo.notify('error', 'Firmware reload failed: ' + (err.message || err));
          } else {
            fabmo.notify('info', 'Firmware reload started — tool will restart.');
          }
        });
      },
      cancel: function() {}
    });
  });

$('#btn-update').click(function(){
  fabmo.navigate('/updater');  // for the moment, let's just go to updater to check for updates
  //  $('#update-input').trigger('click');
});

$('#update-input').change(function(evt) {
    var files = [];
    for(var i=0; i<evt.target.files.length; i++) {
      files.push({file:evt.target.files[i]});
    }
    fabmo.submitUpdate(files, {}, function(err, data) {
        if(err){
            console.log(err)
        }else {
            console.log(data);
        }
      
    }, function(progress) {
      console.log(progress);
    });
  });

// Upload a package file manually
$('#firmware-input').change(function(evt) {
  var files = [];
  for(var i=0; i<evt.target.files.length; i++) {
    files.push({file:evt.target.files[i]});
  }
  fabmo.submitFirmwareUpdate(files, {}, function(err, data) {
      if(err){
          console.log(err)
      }else {
          console.log(data);
      }
    
  }, function(progress) {
    console.log(progress);
  });
});


$(document).ready(function() {
    $(document).foundation();

    // Setup Unit Labels
    registerUnitLabel('.in_mm_label', 'in', 'mm');
    registerUnitLabel('.ipm_mmpm_label', 'in/min', 'mm/min');
    registerUnitLabel('.ips_mmps_label', 'in/sec', 'mm/sec');
    registerUnitLabel('.inpm2_mmpm2_label', 'in/min<sup>2</sup>', 'mm/min<sup>2</sup>');
    registerUnitLabel('.inrev_mmrev_label', 'in/rev', 'mm/rev');
    registerUnitLabel('.inpm3_mmpm3_label', 'in/min<sup>3</sup>', 'mm/min<sup>3</sup>');

    fabmo.on('status', function(status) {
      update();
    });
    
    // Trigger a status update to get the ball rolling
    fabmo.requestStatus();

    // Populate Settings
    update();

    // tool tip logic
    $('.tool-tip').click(function(){
        var tip =$(this).parent().data('tip');
        var eTop = $(this).offset().top;
        var eLeft = $(this).offset().left;
        
        var realTop = eTop - 10;
        $('.tip-output').show();
        var eWidth = $('.tip-output').width();
        var realLeft = eLeft - eWidth - 40;
        $('.tip-text').text(tip);
        $('.tip-output').css('top', realTop + 'px');
        $('.tip-output').css('left', realLeft + 'px');
    });

    $('body').scroll(function(){
        $('.tip-output').hide();
    });

    $('body').click(function(event){   
          if($(event.target).attr('class') == "tool-tip"){
              return
          } else {
              $('.tip-output').hide();
          }
    });

    // Update settings on change
    $('.driver-input').change( function() {
        var parts = this.id.split("-");
        var new_config = {};
        new_config.driver = {};
        var v = parts[1];
        if(v === "gdi") {
            new_config.driver.gdi = this.value;
            if (this.value == 0) { fabmo.runGCode("G90"); }
            else { fabmo.runGCode("G91"); }
            fabmo.setConfig(new_config, function(err, data) {
                notifyChange(err, data.driver.gid);
                setTimeout(update, 500);
            });

        // Handle getting the driver input value from seconds to min before saving to g2.config
        } else if(v === "xfr" || v === "yfr" || v === "zfr" || v === "afr" || v === "bfr" || v === "cfr") {
            new_config.driver[v] = this.value * 60;
            setConfig(this.id,  new_config.driver[v]);
        
        // Fix up the symbol and label for ABC axis mode and deal with default selection
        } else if (v === "aam" || v === "bam" || v === "cam") {
            console.log ("Got a new Axis Mode - " + (v) + " - " + this.value); 
            setConfig(this.id, this.value);
            // get current unit_value for the 3rd channel "3su"; this Z value is used to estimate a linear A,B, or C
            var chan = 4; // default to A axis
            if (v === "bam") { chan = 5; }
            if (v === "cam") { chan = 6; }
            var est_linear = 100; // default to 100 if we can't get a better value
            var chan3_units = configData.driver["3su"];
            if (chan3_units >= 5 && chan3_units <= 5000) {est_linear = chan3_units};
            // get current units
            var unit_multipler = 1;
            var current_units = configData.machine.units;
            if (current_units == "mm") { unit_multipler = 25.4; }
            // With a change in mode, we need to reset some other parameters to defaults
            // for linear-2 set: FeedrateMaximum=4, JogVelocity=6, MaxJerk=50
            // for rotary-1 set: FeedrateMaximum=100, JogVelocity=150, MaxJerk=1000
            // for disable-0 set: FeedrateMaximum=100, JogVelocity=150, MaxJerk=1000
            // Speed/Radius-3 not implemented; but should be available in G2 for future
            var axis = v.substring(0,1);
            var new_params = {};
            new_params.driver = {};
            new_params.opensbp = {};
           // Handle getting reasonable defaults for linear vs rotary (and handle units for linear too)
           // ... these are based on typical values for XYZ axis, but reduced a bit for ABC
           // ... these are just starting points; user can modify as needed
           // ... user can override these values after changing mode and they will persist
            if (this.value == 2) { // linear
                new_params.driver[axis + 'fr'] = 4 * 60 * unit_multipler;
                new_params.opensbp['move' + axis + '_speed'] = (4 * unit_multipler)/2; // default move speed to 1/2 feedrate max
                new_params.opensbp['jog' + axis + '_speed'] = 6 * unit_multipler;
                new_params.opensbp[axis + '_maxjerk'] = 50 * unit_multipler;
                new_params.driver[chan + 'su'] = est_linear; // set a reasonable default linear value
            } else {              // rotary or disable
                new_params.driver[axis + 'fr'] = 100 * 60;
                new_params.opensbp['move' + axis + '_speed'] = 50/2; // default move speed to 1/2 feedrate max
                new_params.opensbp['jog' + axis + '_speed'] = 150;
                new_params.opensbp[axis + '_maxjerk'] = 1000;
                new_params.driver[chan + 'su'] = 33.33333; // set a reasonable default rotary value
            }
            fabmo.setConfig(new_params, function(err, data) {
                notifyChange(err, v);
                setTimeout(update, 500);
            });

         // General "driver-input" updates  
         } else {
            setConfig(this.id, this.value);
         }

    });

    $('#engine-version').click(function(evt) {
        evt.preventDefault();
        fabmo.navigate('/updater');
    });

    $('.engine-input').change( function() {
        setConfig(this.id, this.value);
    });

    $("#machine-auth_required").on('change', function() {
        if ($(this).is(':checked')) {
            $(this).attr('value', 'true');
        } else {
            $(this).attr('value', 'false');
        }
    });

    $("#machine-interlock_required").on('change', function() {
        if ($(this).is(':checked')) {
            $(this).attr('value', 'true');
        } else {
            $(this).attr('value', 'false');
        }
    });

    $('.machine-input').change( function() {
            setConfig(this.id, this.value);
    });

    $('.opensbp-input').change( function() {  // speccial case for XY jerk and jog speed
        setConfig(this.id, this.value);
        if (this.id === "opensbp-xy_maxjerk") {
            setConfig("opensbp-y_maxjerk", this.value);
        }
        if (this.id === "opensbp-jogxy_speed") {
            setConfig("opensbp-jogy_speed", this.value);
        }
    });

    $('.opensbp-values').change( function() {
        var parts = this.id.split("-");
        var new_config = {};
        new_config.driver = {};
        var v = parts[1];

        if (!configData) { return; }
        if(v !== undefined) {
            if(v === "units1"){
                new_config.driver['1tr']=(360/configData.driver["1sa"])*configData.driver["1mi"]/this.value;
            }
            else if(v === "units2"){
                new_config.driver['2tr']=(360/configData.driver["2sa"])*configData.driver["2mi"]/this.value;
            }
            else if(v === "units3"){
                new_config.driver['3tr']=(360/configData.driver["3sa"])*configData.driver["3mi"]/this.value;
            }
            else if(v === "units4"){
                new_config.driver['4tr']=(360/configData.driver["4sa"])*configData.driver["4mi"]/this.value;
            }
            else if(v === "units5"){
                new_config.driver['5tr']=(360/configData.driver["5sa"])*configData.driver["5mi"]/this.value;
            }
            else if(v === "units6"){
                new_config.driver['6tr']=(360/configData.driver["6sa"])*configData.driver["6mi"]/this.value;
            }
            fabmo.setConfig(new_config, function(err, data) {
                notifyChange(err,id);
                setTimeout(update, 500);
            });
        }
    });


    // setupUserManager();

    fabmo.on('reconnect', function() {
        update();
    });

    $('#profile-listbox').on('change', function(evt) {
        evt.preventDefault();
        fabmo.showModal({
            title : 'Change Profiles?',
            message : 'Changing your machine profile will reset all of your apps and settings. Are you sure you want to change profiles?',
            okText : 'Yes',
            cancelText : 'No',
            ok : function() {
                // NEW: Use the special manual profile change route
                var selectedProfile = $("#profile-listbox option:checked").val();
                
                $.ajax({
                    url: '/profile/manual-change',
                    method: 'POST',
                    data: JSON.stringify({ profile: selectedProfile }),
                    contentType: 'application/json',
                    success: function(response) {
                        fabmo.notify('info', 'Profile change initiated...');
                    },
                    error: function(xhr, status, error) {
                        // Server restart causes connection error - this is expected
                        if (status === 'error' && (xhr.status === 0 || xhr.status >= 500)) {
                            fabmo.notify('info', 'Profile change initiated - engine restarting...');
                        } else {
                            fabmo.notify('error', 'Profile change failed: ' + error);
                            // Reset the dropdown to current profile if failed
                            update();
                        }
                    }
                });

            },
            cancel : function() {
                // Reset dropdown to current value if user cancels
                update();
            }
        });
    });

    setApps(fabmo);
    setUsers(fabmo);

});

function ensureProfileDisplayCorrect() {
    fabmo.getConfig(function(err, data) {
        if (err) return;
        
        var currentProfileDir = data.engine.profile;
        var profiles = data['profiles'] || {};
        
        // Find display name by matching directory path
        var displayName = Object.keys(profiles).find(name => {
            return profiles[name].dir && profiles[name].dir.endsWith('/' + currentProfileDir);
        });
        
        // Handle default case
        if (!displayName && currentProfileDir === 'default') {
            displayName = 'Default';
        }
        
        if (displayName) {
            $('#profile-listbox').val(displayName);
            console.log('Profile display updated to:', displayName);
        } else {
            console.warn('Could not find profile for directory:', currentProfileDir);
        }
    });
}

// ============================================================================
// PROFILE CREATOR
// ============================================================================

var profileDefaults = null; // Stores the default profile config values

// Load default profile values into the Profiles tab form
function loadProfileDefaults() {
    fabmo.getDefaultProfile(function (err, data) {
        if (err) {
            console.error("Failed to load default profile:", err);
            return;
        }
        profileDefaults = data;

        // Populate all profile form fields from defaults
        var sections = ["machine", "g2", "opensbp"];
        sections.forEach(function (section) {
            if (!data[section]) return;
            var flat = flattenObject(data[section]);
            for (var key in flat) {
                // Skip the variables object — handled separately
                if (key.indexOf("variables-") === 0) continue;
                var input = $("#profile-" + section + "-" + key);
                if (input.length) {
                    if (input.is(":checkbox")) {
                        input.prop("checked", flat[key] ? true : false);
                    } else {
                        input.val(String(flat[key]));
                    }
                }
            }
        });

        // Populate default variables
        if (data.opensbp && data.opensbp.variables) {
            var vars = data.opensbp.variables;
            for (var name in vars) {
                if (vars.hasOwnProperty(name)) {
                    addProfileVariableRow(name, vars[name], true);
                }
            }
        }
    });
}

// Add a variable row to the variables list
function addProfileVariableRow(name, value, isDefault) {
    var row = $('<div class="profile-var-row" style="margin-bottom: 4px; overflow: hidden;"></div>');
    row.append('<div class="large-4 columns"><input type="text" class="profile-var-name" value="' + (name || '') + '"' + (isDefault ? ' data-default="true"' : '') + '/></div>');
    row.append('<div class="large-4 columns"><input type="text" class="profile-var-value" value="' + (value !== undefined ? value : '') + '"' + (isDefault ? ' data-default-value="' + value + '"' : '') + '/></div>');
    row.append('<div class="large-4 columns"><a class="button radius small btn-remove-profile-var" style="background-color:#c0392b; margin:0; padding: 6px 12px;">Remove</a></div>');
    $("#profile-variables-list").append(row);
}

// Add variable button handler
$(document).on("click", "#btn-add-profile-var", function () {
    var name = $("#profile-var-new-name").val().trim();
    var value = $("#profile-var-new-value").val().trim();
    if (!name) return;
    if (/\s/.test(name)) {
        fabmo.notify("error", "Variable names cannot contain spaces");
        return;
    }
    addProfileVariableRow(name, value, false);
    $("#profile-var-new-name").val("");
    $("#profile-var-new-value").val("");
});

// Remove variable button handler
$(document).on("click", ".btn-remove-profile-var", function () {
    $(this).closest(".profile-var-row").remove();
});

// Collect current variables from the UI — returns null if validation fails
function getProfileVariables() {
    var vars = {};
    var valid = true;
    $(".profile-var-row").each(function () {
        var name = $(this).find(".profile-var-name").val().trim();
        var value = $(this).find(".profile-var-value").val().trim();
        if (name) {
            if (/\s/.test(name)) {
                fabmo.notify("error", 'Variable name "' + name + '" cannot contain spaces');
                $(this).find(".profile-var-name").addClass("flash-red");
                setTimeout(function () { $(".flash-red").removeClass("flash-red"); }, 500);
                valid = false;
                return;
            }
            // Try to parse as number
            var numVal = parseFloat(value);
            vars[name] = !isNaN(numVal) && String(numVal) === value ? numVal : value;
        }
    });
    return valid ? vars : null;
}

// Compute the diff between current form values and defaults
function computeProfileDiff() {
    if (!profileDefaults) return {};
    var config = {};
    var validationFailed = false;
    var sections = ["machine", "g2", "opensbp"];

    sections.forEach(function (section) {
        if (!profileDefaults[section]) return;
        var flat = flattenObject(profileDefaults[section]);
        var sectionChanges = {};

        for (var key in flat) {
            // Skip variables — handled separately for opensbp
            if (key.indexOf("variables-") === 0) continue;

            var input = $("#profile-" + section + "-" + key);
            if (!input.length) continue;

            var defaultVal = flat[key];
            var currentVal;

            if (input.is(":checkbox")) {
                currentVal = input.is(":checked");
                if (currentVal !== (defaultVal ? true : false)) {
                    setNestedValue(sectionChanges, key, currentVal);
                }
            } else {
                currentVal = input.val();
                // Compare as numbers if the default is a number
                if (typeof defaultVal === "number") {
                    var numVal = parseFloat(currentVal);
                    if (!isNaN(numVal) && numVal !== defaultVal) {
                        setNestedValue(sectionChanges, key, numVal);
                    }
                } else {
                    if (currentVal !== String(defaultVal)) {
                        setNestedValue(sectionChanges, key, currentVal);
                    }
                }
            }
        }

        // For opensbp, include variables if any differ from defaults
        if (section === "opensbp") {
            var currentVars = getProfileVariables();
            if (currentVars === null) {
                validationFailed = true;
                return;
            }
            var defaultVars = (profileDefaults.opensbp && profileDefaults.opensbp.variables) || {};
            var varsChanged = false;

            // Check for new or changed variables
            for (var vname in currentVars) {
                if (!(vname in defaultVars) || currentVars[vname] !== defaultVars[vname]) {
                    varsChanged = true;
                    break;
                }
            }
            // Check for removed variables
            if (!varsChanged) {
                for (var dname in defaultVars) {
                    if (!(dname in currentVars)) {
                        varsChanged = true;
                        break;
                    }
                }
            }
            if (varsChanged) {
                sectionChanges.variables = currentVars;
            }
        }

        if (Object.keys(sectionChanges).length > 0) {
            config[section] = sectionChanges;
        }
    });

    if (validationFailed) return null;
    return config;
}

// Convert a flat key like "envelope-xmin" into a nested object path
function setNestedValue(obj, flatKey, value) {
    var parts = flatKey.split("-");
    var current = obj;
    for (var i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
}

// Hide Backup & Restore section when Profiles tab is active
$(document).on("click", "[data-tab] a[role='tab']", function () {
    var target = $(this).attr("href");
    if (target === "#tabpanel8") {
        $("#backup-restore-section").hide();
    } else {
        $("#backup-restore-section").show();
    }
});

// Collapsible fieldsets
$(document).on("click", ".profile-collapse-toggle", function () {
    $(this).next(".profile-fieldset-content").slideToggle(200);
    $(this).toggleClass("collapsed");
});

// Save profile button handler
$(document).on("click", "#btn-save-profile", function () {
    var name = $("#profile-name").val().trim();
    if (!name) {
        $("#profile-save-status").text("Profile name is required").css("color", "red");
        return;
    }

    var description = $("#profile-description").val().trim();
    var config = computeProfileDiff();

    if (config === null) {
        $("#profile-save-status").text("Fix validation errors above").css("color", "red");
        return;
    }

    $("#profile-save-status").text("Saving...").css("color", "#333");

    fabmo.createProfile(
        { name: name, description: description, config: config },
        function (err, result) {
            if (err) {
                $("#profile-save-status").text("Error: " + err).css("color", "red");
            } else {
                $("#profile-save-status").text("Profile saved!").css("color", "green");
                // Refresh the profile dropdown in the General tab
                update();
            }
        }
    );
});

// Load defaults when the page loads
$(document).ready(function () {
    loadProfileDefaults();
});