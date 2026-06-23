require('./jquery.dragster.js');
require('jquery');
var setApps = require('./app_manager.js');
var setUsers = require('./user_manager');
require('./layout_orientation.js');
var Foundation = require('../../../static/js/libs/foundation.min.js');
var moment = require('../../../static/js/libs/moment.js');
var Fabmo = require('../../../static/js/libs/fabmo.js');
require('../../../static/js/libs/i18n.js');   // installs window.t / window.i18nReady / window.i18nApply
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

      // Outputs tab: sync seconds-input visibility against the just-populated
      // mode dropdowns. Done here (not on a timer) so initial render and any
      // external config change refresh visibility correctly.
      if (typeof syncSecondsVisibility === 'function') {
        for (var nOut = 1; nOut <= 12; nOut++) {
          if (OUTPUT_HARDCODED[nOut]) continue;
          syncSecondsVisibility(nOut, 'on');
          syncSecondsVisibility(nOut, 'off');
        }
      }
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
            fabmo.notify('error',window.t('config.notify.backup_failed'));
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
            fabmo.notify('error',window.t('config.notify.invalid_file'));
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
            fabmo.notify("error",window.t('config.notify.error_reading_file_detail')+ex);
            $("#restore_conf_file").attr("value", "");
            return;
            }
            fabmo.setConfig(conf,function(err){
                if(err){
                    fabmo.notify("error",err);
                    $("#restore_conf_file").attr("value", "");
                    return;
                }
                fabmo.notify("success",window.t('config.notify.config_loaded'));
                $("#restore_conf_file").attr("value", "");
            });
        }
        reader.onerror = function (evt) {
            fabmo.notify("error",window.t('config.notify.error_reading_file'));
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
            throw new Error(window.t('config.notify.macros_backup_failed'));
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
        fabmo.notify('success', window.t('config.notify.macros_backup_ok'));
    })
  .catch((err) => {
      fabmo.notify('error', window.t('config.notify.macros_backup_failed_detail') + err.message);
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
    fabmo.notify('info', window.t('config.notify.macros_uploading'));
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
        fabmo.notify('success', window.t('config.notify.macros_restored'));
      },
      error: function(xhr, status, error) {
        console.error('Upload error:', xhr.responseText);
        let errorMessage = window.t('config.notify.macros_restore_failed');

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

// Export Job History (.zip) — streams the server-built archive directly
// to a download. Payload can be large (cut files included) so we don't
// fetch().blob() the whole thing through memory if we can avoid it; a
// simple anchor click hands the response to the browser's downloader.
$('#btn-history-export').click(function () {
  fabmo.notify('info', window.t('config.notify.preparing_history_archive'));
  const link = document.createElement('a');
  link.href = '/history/export';
  link.download = 'fabmo_history_export.zip';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// Import Job History — upload a .zip produced by export. The server
// unpacks it back into /opt/fabmo/db/ and /opt/fabmo/files/; restart
// is required afterwards for the in-memory DB to pick up new state.
$('#btn-history-import').click(function () {
  if (!confirm(window.t('config.modal.import_history_confirm'))) return;
  $('#history-import-file').trigger('click');
});

$('#history-import-file').change(function() {
  const files = $(this).prop('files');
  if (files.length !== 1) return;
  const f = files[0];
  fabmo.notify('info', window.t('config.notify.uploading_history_archive'));
  const formData = new FormData();
  formData.append('file', f);
  $.ajax({
    url: '/history/import',
    type: 'POST',
    data: formData,
    processData: false,
    contentType: false,
    timeout: 600000, // 10-minute timeout for large archives
    success: function(response) {
      fabmo.notify('success', (response && response.message) || window.t('config.notify.history_imported'));
    },
    error: function(xhr, status, error) {
      let msg = window.t('config.notify.history_import_failed');
      try {
        const obj = JSON.parse(xhr.responseText);
        if (obj && obj.message) msg += ': ' + obj.message;
      } catch (e) { msg += ': ' + error; }
      fabmo.notify('error', msg);
    },
    complete: function() {
      $('#history-import-file').val('');
    }
  });
});

// Other Config page functions

$('#btn-flash-firm').click(function() {
    $('#firmware-input').trigger('click');
  });

$('#btn-reload-firm').click(function() {
    fabmo.showModal({
      title: window.t('config.modal.reload_firmware_title'),
      message: window.t('config.modal.reload_firmware_message'),
      okText: window.t('config.modal.reload'),
      cancelText: window.t('config.modal.cancel'),
      ok: function() {
        fabmo.notify('info', window.t('config.notify.reloading_firmware'));
        fabmo.reloadFirmware({}, function(err, data) {
          if (err) {
            fabmo.notify('error', window.t('config.notify.firmware_reload_failed') + (err.message || err));
          } else {
            fabmo.notify('info', window.t('config.notify.firmware_reload_started'));
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


// Outputs whose behavior is hardcoded — labels are fixed and modes are not
// user-configurable. The runtime ignores their saved policy entirely (see
// runtime/output_policy.js HARDCODED).
var OUTPUT_HARDCODED = { 1: "Spindle 1", 2: "Spindle 2", 4: "Arm Motion" };

var ON_MODES = [
    { value: "file_start", label: window.t("config.outputs_tab.mode_file_start") },
    { value: "command", label: window.t("config.outputs_tab.mode_command") },
    { value: "timed_after_file_end", label: window.t("config.outputs_tab.mode_timed_after_file_end") }
];
var OFF_MODES = [
    { value: "file_end", label: window.t("config.outputs_tab.mode_file_end") },
    { value: "command", label: window.t("config.outputs_tab.mode_command") },
    { value: "timed_after_file_end", label: window.t("config.outputs_tab.mode_timed_after_file_end") }
];

function buildOutputFieldset(n) {
    var isLocked = !!OUTPUT_HARDCODED[n];

    // Legend: "Output N" + label. For locked outputs the label is fixed text
    // with a "(locked)" tag; for configurable ones it's an inline input the
    // user can rename.
    var legendInner;
    if (isLocked) {
        legendInner =
            window.t("config.outputs_tab.output_word") + ' ' + n +
            ' <span style="font-weight:normal;">' + OUTPUT_HARDCODED[n] + '</span>' +
            ' <span style="color:#999; font-size:0.85em; font-weight:normal;">' + window.t("config.outputs_tab.locked") + '</span>' +
            '<input type="hidden" id="machine-outputs-' + n + '-label" value="' + OUTPUT_HARDCODED[n] + '">';
    } else {
        legendInner =
            window.t("config.outputs_tab.output_word") + ' ' + n +
            ' <input type="text" id="machine-outputs-' + n + '-label" class="machine-output"' +
            ' style="display:inline-block; width:auto; margin:0 0 0 6px; height:1.8em; font-weight:normal;">';
    }

    function buildModeBlock(side, label, modes) {
        var opts = modes.map(function (m) {
            return '<option value="' + m.value + '">' + m.label + '</option>';
        }).join('');
        var lockedAttr = isLocked ? ' disabled' : '';
        var selectCls = isLocked ? '' : ' class="machine-output output-mode" data-side="' + side + '" data-output="' + n + '"';
        var secondsCls = isLocked ? '' : ' class="machine-output output-seconds"';
        return [
            '<div class="large-4 columns">',
              '<div class="row collapse">',
                '<label>' + label,
                  '<select id="machine-outputs-' + n + '-' + side + '_mode"' + selectCls + lockedAttr + '>' + opts + '</select>',
                '</label>',
                '<input type="number" id="machine-outputs-' + n + '-' + side + '_seconds" min="0" step="0.1"' + secondsCls + lockedAttr +
                  ' placeholder="' + window.t("config.outputs_tab.seconds_placeholder") + '" style="display:none; margin-top:4px;">',
              '</div>',
            '</div>'
        ].join('');
    }

    var toggleBlock = [
        '<div class="large-4 columns">',
          '<div class="row collapse">',
            '<label>' + window.t("config.outputs_tab.test"),
              '<button type="button" class="button output-toggle" data-output="' + n + '"',
                ' id="output-toggle-' + n + '"',
                // Match the adjacent <select> dimensions so the row aligns:
                ' style="width:100%; height:2.3125rem; padding:0; margin:0;">' + window.t("config.outputs_tab.state_off") + '</button>',
            '</label>',
          '</div>',
        '</div>'
    ].join('');

    return [
        '<div class="row">',
          '<fieldset>',
            '<legend>' + legendInner + '</legend>',
            buildModeBlock('on', window.t("config.outputs_tab.on_condition"), ON_MODES),
            buildModeBlock('off', window.t("config.outputs_tab.off_condition"), OFF_MODES),
            toggleBlock,
          '</fieldset>',
        '</div>'
    ].join('');
}

// Toggle the seconds input visibility for a given (output, side) pair based
// on the mode dropdown value. Called on init (to set initial visibility from
// loaded config) and on every dropdown change.
function syncSecondsVisibility(n, side) {
    var mode = $('#machine-outputs-' + n + '-' + side + '_mode').val();
    var $secs = $('#machine-outputs-' + n + '-' + side + '_seconds');
    $secs.css('display', mode === 'timed_after_file_end' ? '' : 'none');
}

function setupOutputsTab() {
    var $list = $('#outputs-list');
    if (!$list.length) return;
    var html = '';
    for (var n = 1; n <= 12; n++) html += buildOutputFieldset(n);
    $list.html(html);

    // Generic save: any change in a row writes back to machine.outputs.<n>.<key>.
    // setConfig already splits the id by "-" and rebuilds the nested object,
    // so machine-outputs-3-on_mode → { machine: { outputs: { 3: { on_mode: ... } } } }.
    $list.on('change', '.machine-output', function () {
        setConfig(this.id, this.value);
    });

    // Show/hide seconds inputs whenever a mode changes.
    $list.on('change', '.output-mode', function () {
        var n = $(this).data('output');
        var side = $(this).data('side');
        syncSecondsVisibility(n, side);
    });

    // Toggle button: send SO,N,<opposite-of-current-state>. The SO command is
    // always permitted regardless of policy; the firmware will reflect the
    // new state in the next status report and updateOutputStates repaints.
    $list.on('click', '.output-toggle', function () {
        var n = $(this).data('output');
        var $btn = $(this);
        var nextState = $btn.hasClass('output-on') ? 0 : 1;
        fabmo.runSBP('SO,' + n + ',' + nextState + '\n');
    });

    // Initial visibility is set inside update()'s getConfig callback
    // (see syncSecondsVisibility loop near the end of update()) once the
    // dropdown values have been populated from the loaded config.
}

// Live state — drives each output's toggle button label and color from
// status.out1..out12 (piped through the engine status report; see machine.js
// status init). Button text shows the *current* state; clicking it toggles
// to the opposite (handled in setupOutputsTab).
function updateOutputStates(status) {
    if (!status) return;
    for (var n = 1; n <= 12; n++) {
        var v = status['out' + n];
        var $btn = $('#output-toggle-' + n);
        if (!$btn.length) continue;
        if (v === 1 || v === true) {
            $btn.text(window.t('config.outputs_tab.state_on')).addClass('output-on')
                .css({ background: '#4caf50', color: '#fff' });
        } else {
            $btn.text(window.t('config.outputs_tab.state_off')).removeClass('output-on')
                .css({ background: '#888', color: '#fff' });
        }
    }
}

$(document).ready(function() {
    $(document).foundation();

    // Setup Unit Labels
    registerUnitLabel('.in_mm_label', 'in', 'mm');
    registerUnitLabel('.ipm_mmpm_label', 'in/min', 'mm/min');
    registerUnitLabel('.ips_mmps_label', 'in/sec', 'mm/sec');
    registerUnitLabel('.inpm2_mmpm2_label', 'in/min<sup>2</sup>', 'mm/min<sup>2</sup>');
    registerUnitLabel('.inrev_mmrev_label', 'in/rev', 'mm/rev');
    registerUnitLabel('.inpm3_mmpm3_label', 'in/min<sup>3</sup>', 'mm/min<sup>3</sup>');

    setupOutputsTab();

    fabmo.on('status', function(status) {
      update();
      updateOutputStates(status);
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

    $("#machine-softlimits_on").on('change', function() {
        $(this).attr('value', $(this).is(':checked') ? 'true' : 'false');
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
            title : window.t('config.modal.change_profiles_title'),
            message : window.t('config.modal.change_profiles_message'),
            okText : window.t('config.modal.yes'),
            cancelText : window.t('config.modal.no'),
            ok : function() {
                // NEW: Use the special manual profile change route
                var selectedProfile = $("#profile-listbox option:checked").val();
                
                $.ajax({
                    url: '/profile/manual-change',
                    method: 'POST',
                    data: JSON.stringify({ profile: selectedProfile }),
                    contentType: 'application/json',
                    success: function(response) {
                        fabmo.notify('info', window.t('config.notify.profile_change_initiated'));
                    },
                    error: function(xhr, status, error) {
                        // Server restart causes connection error - this is expected
                        if (status === 'error' && (xhr.status === 0 || xhr.status >= 500)) {
                            fabmo.notify('info', window.t('config.notify.profile_change_restarting'));
                        } else {
                            fabmo.notify('error', window.t('config.notify.profile_change_failed') + error);
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

// "My Custom Profile": create a snapshot from the current /opt/fabmo/config +
// macros, then mark it as the Preferred fallback the recovery chain will reach
// for. This is the user-friendly entry into the snapshot system — it does not
// modify any shipped profiles.
//
// Refreshes both the snapshot dropdown and the Preferred Profile label.
// Filters to kind="user" so auto recovery snapshots (which rotate on their
// own and aren't user-meaningful) don't clutter the picker.
function refreshDefaultSnapshotName() {
    fetch('/snapshots')
        .then(function (r) { return r.json(); })
        .then(function (resp) {
            var all = (resp && resp.status === 'success' && resp.data) ? (resp.data.snapshots || []) : [];
            var userSnaps = all.filter(function (s) { return (s.kind || 'user') === 'user'; });
            var preferred = null;
            for (var i = 0; i < userSnaps.length; i++) {
                if (userSnaps[i].is_user_default) { preferred = userSnaps[i]; break; }
            }

            var $sel = $('#custom-snapshot-select');
            var prev = $sel.val();
            $sel.empty();
            if (userSnaps.length === 0) {
                $sel.append($('<option></option>').val('').text(window.t('config.custom_profile.no_custom_profiles')));
            } else {
                for (var j = 0; j < userSnaps.length; j++) {
                    var s = userSnaps[j];
                    var label = s.name + (s.is_user_default ? '  ' + window.t('config.custom_profile.preferred_tag') : '');
                    $sel.append($('<option></option>').val(s.name).text(label));
                }
            }
            // Preserve the user's prior selection if it still exists; otherwise
            // fall back to the Preferred snapshot so the action buttons act on
            // the most useful default.
            if (prev && userSnaps.some(function (s) { return s.name === prev; })) {
                $sel.val(prev);
            } else if (preferred) {
                $sel.val(preferred.name);
            }

            $('#current-default-name').text(preferred ? preferred.name : window.t('config.custom_profile.none'));
        })
        .catch(function () { /* leave display alone on transient errors */ });
}

// The app is sandboxed and cannot use window.prompt(), so we drive an
// inline modal in index.html (#save-default-dialog).
$('#btn-save-default').click(function () {
    $('#save-default-name').val('');
    $('#save-default-description').val('');
    $('#save-default-dialog').show();
    setTimeout(function () { $('#save-default-name').focus(); }, 0);
});

$('#save-default-cancel').click(function () {
    $('#save-default-dialog').hide();
});

$('#save-default-confirm').click(function () {
    // Spaces are a common natural input; auto-convert to underscores
    // rather than rejecting. Collapse runs of whitespace to a single _.
    var name = ($('#save-default-name').val() || '').trim().replace(/\s+/g, '_');
    var description = $('#save-default-description').val() || '';
    if (!name) {
        fabmo.notify('error', window.t('config.notify.name_required'));
        return;
    }
    if (!/^[a-zA-Z0-9_-]{1,25}$/.test(name)) {
        fabmo.notify('error', window.t('config.notify.name_invalid'));
        return;
    }
    $('#save-default-dialog').hide();

    fetch('/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, description: description })
    })
    .then(function (r) { return r.json(); })
    .then(function (resp) {
        if (!resp || resp.status !== 'success') {
            var msg = resp && resp.message ? resp.message : window.t('config.notify.unknown_error');
            throw new Error(msg);
        }
        return fetch('/snapshots/' + encodeURIComponent(name) + '/set-default', {
            method: 'POST'
        }).then(function (r) { return r.json(); });
    })
    .then(function (resp) {
        if (!resp || resp.status !== 'success') {
            var msg = resp && resp.message ? resp.message : window.t('config.notify.mark_default_failed');
            throw new Error(window.t('config.notify.snapshot_not_default') + msg);
        }
        fabmo.notify('success', window.t('config.notify.saved_default') + name);
        refreshDefaultSnapshotName();
    })
    .catch(function (err) {
        fabmo.notify('error', err.message || window.t('config.notify.save_default_failed'));
    });
});

// Restore from whatever snapshot is currently picked in the dropdown.
// fabmo.showModal is used here (instead of window.confirm) because the app
// runs in a sandboxed iframe that blocks confirm/prompt.
$('#btn-reset-default').click(function () {
    var name = $('#custom-snapshot-select').val();
    if (!name) {
        fabmo.notify('warning', window.t('config.notify.no_custom_profile_selected'));
        return;
    }
    fabmo.showModal({
        title: window.t('config.modal.reset_default_title'),
        message: window.t('config.modal.reset_default_message_prefix') + name + window.t('config.modal.reset_default_message_suffix'),
        okText: window.t('config.modal.restore'),
        cancelText: window.t('config.modal.cancel'),
        ok: function () {
            fabmo.notify('info', window.t('config.notify.restoring_default_prefix') + name + window.t('config.notify.restoring_default_suffix'));
            fetch('/snapshots/' + encodeURIComponent(name) + '/restore', {
                method: 'POST'
            })
                .then(function (r) { return r.json(); })
                .then(function (resp) {
                    if (!resp || resp.status !== 'success') {
                        var msg = resp && resp.message ? resp.message : window.t('config.notify.unknown_error');
                        fabmo.notify('error', window.t('config.notify.reset_failed') + msg);
                    }
                    // On success the engine restarts; the page reloads on its own.
                })
                .catch(function (err) {
                    fabmo.notify('error', window.t('config.notify.reset_failed') + err.message);
                });
        },
        cancel: function () {}
    });
});

// Mark the dropdown's selected snapshot as the Preferred fallback. Refresh
// the UI so the "(Preferred)" tag and label move to the new winner.
$('#btn-set-preferred').click(function () {
    var name = $('#custom-snapshot-select').val();
    if (!name) {
        fabmo.notify('warning', window.t('config.notify.no_custom_profile_selected'));
        return;
    }
    fetch('/snapshots/' + encodeURIComponent(name) + '/set-default', {
        method: 'POST'
    })
        .then(function (r) { return r.json(); })
        .then(function (resp) {
            if (!resp || resp.status !== 'success') {
                var msg = resp && resp.message ? resp.message : window.t('config.notify.unknown_error');
                throw new Error(msg);
            }
            fabmo.notify('success', window.t('config.notify.preferred_profile_set') + name);
            refreshDefaultSnapshotName();
        })
        .catch(function (err) {
            fabmo.notify('error', window.t('config.notify.set_preferred_failed') + err.message);
        });
});

// Delete the dropdown's selected snapshot. Confirmation modal because the
// action is destructive and unrecoverable. Live machine settings are not
// touched — only the saved profile is removed.
$('#btn-delete-snapshot').click(function () {
    var name = $('#custom-snapshot-select').val();
    if (!name) {
        fabmo.notify('warning', window.t('config.notify.no_custom_profile_selected'));
        return;
    }
    fabmo.showModal({
        title: window.t('config.modal.delete_profile_title'),
        message: window.t('config.modal.delete_profile_message_prefix') + name + window.t('config.modal.delete_profile_message_suffix'),
        okText: window.t('config.modal.delete'),
        cancelText: window.t('config.modal.cancel'),
        ok: function () {
            fetch('/snapshots/' + encodeURIComponent(name), {
                method: 'DELETE'
            })
                .then(function (r) { return r.json(); })
                .then(function (resp) {
                    if (!resp || resp.status !== 'success') {
                        var msg = resp && resp.message ? resp.message : window.t('config.notify.unknown_error');
                        throw new Error(msg);
                    }
                    fabmo.notify('success', window.t('config.notify.deleted_prefix') + name);
                    refreshDefaultSnapshotName();
                })
                .catch(function (err) {
                    fabmo.notify('error', window.t('config.notify.delete_failed') + err.message);
                });
        },
        cancel: function () {}
    });
});

// Download the dropdown-selected snapshot as a `.fmsnap.zip`. The browser
// drives the download via a temporary anchor — server sets
// Content-Disposition so the filename is `<name>.fmsnap.zip`.
$('#btn-download-snapshot').click(function () {
    var name = $('#custom-snapshot-select').val();
    if (!name) {
        fabmo.notify('warning', window.t('config.notify.no_custom_profile_selected'));
        return;
    }
    var url = '/snapshots/' + encodeURIComponent(name) + '/download';
    var a = document.createElement('a');
    a.href = url;
    a.download = name + '.fmsnap.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

// Upload a previously-downloaded snapshot zip. Trigger flow mirrors the
// macros restore: button -> hidden file input -> change -> multipart POST.
$('#btn-upload-snapshot').click(function () {
    $('#upload-snapshot-file').trigger('click');
});

$('#upload-snapshot-file').change(function () {
    var files = $(this).prop('files');
    if (!files || files.length !== 1) return;
    var file = files[0];
    fabmo.notify('info', window.t('config.notify.uploading_custom_profile'));
    var formData = new FormData();
    formData.append('file', file);

    $.ajax({
        url: '/snapshots/upload',
        type: 'POST',
        data: formData,
        processData: false,
        contentType: false,
        timeout: 120000
    }).done(function (resp) {
        if (resp && resp.status === 'success') {
            var importedName = (resp.data && resp.data.name) || file.name;
            fabmo.notify('success', window.t('config.notify.imported_custom_profile') + importedName);
            refreshDefaultSnapshotName();
        } else {
            fabmo.notify('error', window.t('config.notify.upload_failed') + ((resp && resp.message) || window.t('config.notify.unknown')));
        }
    }).fail(function (xhr) {
        var msg = window.t('config.notify.unknown_error');
        try { msg = (JSON.parse(xhr.responseText) || {}).message || msg; } catch (e) {}
        fabmo.notify('error', window.t('config.notify.upload_failed') + msg);
    }).always(function () {
        $('#upload-snapshot-file').val('');
    });
});

// Populate the dropdown and Preferred label on load.
refreshDefaultSnapshotName();

// ---------- Spindle Setup ----------

function renderSpindleDiscover(data) {
    var adapterEl = $('#spindle-setup-adapter');
    var profileEl = $('#spindle-setup-profile');
    if (data.adapter) {
        adapterEl.val(data.adapter.name + '  [' + data.adapter.vid + ':' + data.adapter.pid + ']  ' + (data.adapter.ttyPath || '(not bound)'));
    } else {
        adapterEl.val(window.t('config.spindle.not_detected'));
    }
    profileEl.val(data.installedTemplate || window.t('config.spindle.none'));
}

function refreshSpindleDiscover() {
    $.ajax({
        url: '/acc/spindle/discover',
        method: 'GET',
        dataType: 'json'
    }).done(function (resp) {
        if (resp.status === 'success') {
            renderSpindleDiscover(resp.data);
        } else {
            fabmo.notify('error', window.t('config.notify.spindle_detection_failed') + (resp.message || window.t('config.notify.unknown')));
        }
    }).fail(function (xhr) {
        fabmo.notify('error', window.t('config.notify.spindle_detection_request_failed') + xhr.status);
    });
}

function runSpindleConfigure() {
    $('#spindle-setup-configure').prop('disabled', true);
    $.ajax({
        url: '/acc/spindle/configure',
        method: 'POST',
        dataType: 'json'
    }).done(function (resp) {
        var d = resp.data || {};
        if (d.ok) {
            fabmo.notify('success', window.t('config.spindle.configured') + d.template);
        } else {
            fabmo.notify('error', window.t('config.spindle.configure_failed_detail') + spindleFailureReason(d.steps));
        }
        refreshSpindleDiscover();
    }).fail(function () {
        fabmo.notify('error', window.t('config.spindle.configure_request_failed'));
    }).always(function () {
        $('#spindle-setup-configure').prop('disabled', false);
    });
}

function spindleFailureReason(steps) {
    var failed = (steps || []).filter(function (s) { return !s.ok; }).pop();
    if (!failed) return window.t('config.notify.unknown_error');
    switch (failed.name) {
        case 'detect_adapter':   return window.t('config.spindle.reason_no_adapter');
        case 'bind_driver':      return window.t('config.spindle.reason_no_bind');
        case 'probe_vfd':        return window.t('config.spindle.reason_no_profile');
        case 'install_template': return window.t('config.spindle.reason_install_failed_prefix') + (failed.detail || window.t('config.notify.unknown')) + window.t('config.spindle.reason_paren_suffix');
        case 'connect_vfd':      return window.t('config.spindle.reason_connect_failed_prefix') + (failed.detail || window.t('config.notify.unknown')) + window.t('config.spindle.reason_paren_suffix');
        default:                 return failed.name + (failed.detail ? ' (' + failed.detail + ')' : '');
    }
}

$('#spindle-setup-configure').on('click', runSpindleConfigure);

// Populate on load
refreshSpindleDiscover();

// ----- Variables tab -------------------------------------------------------
// Lists persistent OpenSBP variables ($-prefixed) with type-aware editors and
// auto-save on blur. Layout mirrors the rest of the configuration app:
// prefix-group fieldsets; scalar leaves use the Foundation
// "large-4 columns > row collapse > label + input" pattern; object variables
// nest a child fieldset whose leaves are flattened into the same columns.
(function () {
    var $list, $statusEl, $search;
    var currentVariables = null;
    var loaded = false;

    function init() {
        $list = $('#variables-list');
        $statusEl = $('#variables-status');
        $search = $('#variables-search');
        if (!$list.length) return;
        $('#variables-refresh-btn').on('click', function () { load(true); });
        $search.on('input', renderFiltered);
        $('a[controls="tabpanel10"]').on('click', function () {
            if (!loaded) load(false);
        });
    }

    function load(announce) {
        $statusEl.text(window.t('config.variables.loading')).css('color', '#555');
        fabmo.getConfig(function (err, data) {
            if (err) {
                $statusEl.text(window.t('config.variables.error_prefix') + err).css('color', '#c33');
                return;
            }
            currentVariables = (data && data.opensbp && data.opensbp.variables) || {};
            loaded = true;
            $statusEl.text(Object.keys(currentVariables).length + window.t('config.variables.count_suffix')).css('color', '#555');
            renderFiltered();
            if (announce) $statusEl.text(window.t('config.variables.reloaded_prefix') + Object.keys(currentVariables).length + window.t('config.variables.reloaded_suffix'));
        });
    }

    function renderFiltered() {
        if (!currentVariables) return;
        var filter = ($search.val() || '').toLowerCase().trim();
        var names = Object.keys(currentVariables).sort();
        if (filter) {
            names = names.filter(function (n) {
                return n.toLowerCase().indexOf(filter) >= 0;
            });
        }
        var html = '';
        names.forEach(function (n) {
            html += renderVariable(n, currentVariables[n]);
        });
        $list.html(html || '<p style="color:#888;">' + window.t('config.variables.no_match') + '</p>');
        attachInputHandlers();
    }

    // Each root variable becomes a labeled frame; the value inside is
    // rendered structurally — objects as nested frames, scalars as
    // label+input pairs. Mirrors prettified JSON visually.
    function renderVariable(name, value) {
        return '<div class="var-frame var-root">'
             +   '<div class="var-frame-label">$' + escapeHtml(name) + '</div>'
             +   renderBody(name, value, [])
             + '</div>';
    }

    // Body of a frame: groups scalar children on one wrapping row, and
    // expands object children into their own nested frames.
    function renderBody(varName, value, path) {
        if (value === null || typeof value !== 'object') {
            // Root scalar (a variable that's just a number/string/bool).
            return '<div class="var-kv-row">' + renderKV(varName, '', value, path) + '</div>';
        }
        var keys = Object.keys(value);
        var labels = detectKeyLabels(varName, keys);
        var scalarKeys = [];
        var objectKeys = [];
        keys.forEach(function (k) {
            if (value[k] !== null && typeof value[k] === 'object') objectKeys.push(k);
            else scalarKeys.push(k);
        });
        var html = '';
        if (scalarKeys.length) {
            html += '<div class="var-kv-row">';
            scalarKeys.forEach(function (k) {
                html += renderKV(varName, labels[k] || k, value[k], path.concat(k));
            });
            html += '</div>';
        }
        objectKeys.forEach(function (k) {
            var label = labels[k] || k;
            var unitClass = label === 'in' ? ' var-frame-in' : (label === 'mm' ? ' var-frame-mm' : '');
            html += '<div class="var-frame' + unitClass + '">'
                  +   '<div class="var-frame-label">' + escapeHtml(label) + '</div>'
                  +   renderBody(varName, value[k], path.concat(k))
                  + '</div>';
        });
        return html;
    }

    function renderKV(varName, label, value, path) {
        var dataAttr = 'data-var="' + escapeAttr(varName) + '"'
                     + ' data-path=\'' + escapeAttr(JSON.stringify(path)) + '\'';
        var t = jsType(value);
        var input;
        if (t === 'boolean') {
            input = '<input type="checkbox" class="var-input" ' + dataAttr + (value ? ' checked' : '') + '>';
        } else if (t === 'number') {
            input = '<input type="number" step="any" class="var-input" ' + dataAttr
                  + ' value="' + escapeAttr(String(value)) + '">';
        } else {
            input = '<input type="text" class="var-input" ' + dataAttr
                  + ' value="' + escapeAttr(value == null ? '' : String(value)) + '">';
        }
        var labelHtml = label ? '<span class="var-key">' + escapeHtml(label) + ':</span>' : '';
        return '<span class="var-kv">' + labelHtml + input + '</span>';
    }

    // Friendlier labels for known patterns. {0,1} on a *UU variable → in/mm.
    function detectKeyLabels(varName, keys) {
        var labels = {};
        var keySet = keys.slice().sort().join(',');
        if (keySet === '0,1' && /UU$/i.test(varName)) {
            labels['0'] = 'in'; labels['1'] = 'mm'; return labels;
        }
        keys.forEach(function (k) { labels[k] = k; });
        return labels;
    }

    function attachInputHandlers() {
        $list.find('.var-input').each(function () {
            var $in = $(this);
            var original = $in.is(':checkbox') ? !!$in.prop('checked') : $in.val();
            $in.data('original', original);
            $in.on('input change', function () {
                var $wrap = $in.closest('.var-kv');
                var current = $in.is(':checkbox') ? !!$in.prop('checked') : $in.val();
                if (String(current) !== String($in.data('original'))) {
                    $wrap.addClass('dirty').removeClass('saved error');
                } else {
                    $wrap.removeClass('dirty saved error');
                }
            });
            $in.on('blur change', function (e) {
                // Checkbox change saves immediately; text/number saves on blur.
                if (e.type === 'change' && !$in.is(':checkbox')) return;
                if (e.type === 'blur' && $in.is(':checkbox')) return;
                var current = $in.is(':checkbox') ? !!$in.prop('checked') : $in.val();
                if (String(current) === String($in.data('original'))) return;
                save($in);
            });
            $in.on('keydown', function (e) {
                if (e.key === 'Enter' || e.keyCode === 13) {
                    if (!$in.is(':checkbox')) $in.blur();
                } else if (e.key === 'Escape' || e.keyCode === 27) {
                    if ($in.is(':checkbox')) $in.prop('checked', !!$in.data('original'));
                    else $in.val($in.data('original'));
                    $in.closest('.var-kv').removeClass('dirty saved error');
                }
            });
        });
    }

    function save($in) {
        var name = $in.data('var');
        // jQuery auto-parses data-* attributes that look like JSON, so .data()
        // gives us the array directly — but fall back if not.
        var path = $in.data('path');
        if (typeof path === 'string') {
            try { path = JSON.parse(path); } catch (e) { path = []; }
        }
        if (!Array.isArray(path)) path = [];

        var raw = $in.is(':checkbox') ? !!$in.prop('checked') : $in.val();
        var originalVar = currentVariables[name];
        var leafOriginal = path.length === 0 ? originalVar : navigatePath(originalVar, path);
        var newVal = coerce(raw, leafOriginal, $in);
        var updatedVar = path.length === 0 ? newVal : deepSetPath(originalVar, path, newVal);

        var updatedVars = Object.assign({}, currentVariables);
        updatedVars[name] = updatedVar;
        var payload = { opensbp: { variables: updatedVars } };

        var $wrap = $in.closest('.var-kv');
        fabmo.setConfig(payload, function (err) {
            if (err) {
                $wrap.addClass('error').removeClass('dirty saved');
                $statusEl.text(window.t('config.variables.save_failed_prefix') + err).css('color', '#c33');
                return;
            }
            currentVariables = updatedVars;
            $in.data('original', $in.is(':checkbox') ? !!$in.prop('checked') : $in.val());
            $wrap.addClass('saved').removeClass('dirty error');
            var pathStr = path.length ? '[' + path.join('][') + ']' : '';
            $statusEl.text(window.t('config.variables.saved_prefix') + name + pathStr).css('color', '#0a0');
            setTimeout(function () { $wrap.removeClass('saved'); }, 1200);
        });
    }

    function navigatePath(obj, path) {
        for (var i = 0; i < path.length; i++) {
            if (obj == null) return undefined;
            obj = obj[path[i]];
        }
        return obj;
    }

    // Return a shallow-copied tree with the leaf at `path` set to `value`,
    // so the resulting object is safe to send back to setConfig without
    // mutating our currentVariables cache.
    function deepSetPath(obj, path, value) {
        var clone = Array.isArray(obj) ? obj.slice() : Object.assign({}, obj || {});
        if (path.length === 1) {
            clone[path[0]] = value;
            return clone;
        }
        clone[path[0]] = deepSetPath(obj && obj[path[0]], path.slice(1), value);
        return clone;
    }

    // Type-coerce the user's text back to the same JS type as the original
    // value. Falls back to string when there's no reference type.
    function coerce(raw, ref, $in) {
        if ($in && $in.hasClass('var-input-json')) {
            try { return JSON.parse(raw); } catch (e) { return raw; }
        }
        if (typeof ref === 'number') {
            var n = Number(raw);
            return isNaN(n) ? raw : n;
        }
        if (typeof ref === 'boolean') {
            if (typeof raw === 'boolean') return raw;
            return raw === 'true' || raw === '1' || raw === 'yes';
        }
        return raw;
    }

    function jsType(v) {
        if (v === null || v === undefined) return 'null';
        if (Array.isArray(v)) return 'array';
        if (typeof v === 'object') return 'object';
        return typeof v;
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(s) { return escapeHtml(s); }

    $(document).ready(init);
})();