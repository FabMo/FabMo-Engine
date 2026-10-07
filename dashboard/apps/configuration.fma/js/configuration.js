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
        refreshInputOptionLabels(data.machine);
        for (var nOut = 1; nOut <= 12; nOut++) {
          // Notify visibility syncs for every output — the notify controls
          // are live even on the hardcoded outputs (spindles, arm motion).
          syncNotifyVisibility(nOut, 'on');
          syncNotifyVisibility(nOut, 'off');
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

// Backups: the granular .fmc / macros-zip / history-export buttons were
// replaced by the two-button Settings & Backups snapshot flow (see the
// "Settings & Backups" section further down). Their server routes remain
// for compatibility with old saved files.

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

// #btn-update is wired in the "Update notification" module at the bottom of
// this file: it re-runs the browser-side manifest check. The old behavior
// (navigate to the updater page) lives on #btn-open-updater under Advanced.

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
// runtime/output_policy.js HARDCODED). The notify dropdowns are still live
// for these outputs: notification is enforced at the SO command, not by the
// output policy, and the spindle is the primary notify use case.
var OUTPUT_HARDCODED = { 1: "Spindle 1", 2: "Spindle 2", 4: "Arm Motion" };

// Labels are stored as i18n keys and resolved in buildModeBlock, which runs
// after i18nReady — resolving them here would bake in raw keys because this
// module parses before the dictionary has loaded.
var ON_MODES = [
    { value: "file_start", labelKey: "config.outputs_tab.mode_file_start" },
    { value: "command", labelKey: "config.outputs_tab.mode_command" },
    { value: "timed_after_file_end", labelKey: "config.outputs_tab.mode_timed_after_file_end" },
    { value: "position", labelKey: "config.outputs_tab.mode_position" },
    { value: "input", labelKey: "config.outputs_tab.mode_input" }
];
var OFF_MODES = [
    { value: "file_end", labelKey: "config.outputs_tab.mode_file_end" },
    { value: "command", labelKey: "config.outputs_tab.mode_command" },
    { value: "timed_after_file_end", labelKey: "config.outputs_tab.mode_timed_after_file_end" },
    { value: "position", labelKey: "config.outputs_tab.mode_position" },
    { value: "input", labelKey: "config.outputs_tab.mode_input" }
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
            return '<option value="' + m.value + '">' + window.t(m.labelKey) + '</option>';
        }).join('');
        var lockedAttr = isLocked ? ' disabled' : '';
        var selectCls = isLocked ? '' : ' class="machine-output output-mode" data-side="' + side + '" data-output="' + n + '"';
        var secondsCls = isLocked ? '' : ' class="machine-output output-seconds"';
        // Notify controls are never locked — notification is enforced at the
        // SO command in the runtime, independent of the on/off mode policy.
        var notifyOpts = [
            '<option value="never">' + window.t("config.outputs_tab.notify_never") + '</option>',
            '<option value="once">' + window.t("config.outputs_tab.notify_once") + '</option>',
            '<option value="always">' + window.t("config.outputs_tab.notify_always") + '</option>'
        ].join('');
        // Position-trigger condition: [above/below] [axis] [value], shown only
        // while the mode dropdown is set to Position. Value is in working
        // coordinates (what the DRO reads), current units.
        var positionRow = [
            '<div id="machine-outputs-' + n + '-' + side + '_position_row"',
              ' title="' + window.t("config.outputs_tab.position_title_" + side) + '"',
              ' style="display:none; margin-top:4px;">',
              '<select id="machine-outputs-' + n + '-' + side + '_position-side" class="machine-output"',
                ' style="display:inline-block; width:31%; margin:0 2% 0 0;">',
                '<option value="below">' + window.t("config.outputs_tab.position_below") + '</option>',
                '<option value="above">' + window.t("config.outputs_tab.position_above") + '</option>',
              '</select>',
              '<select id="machine-outputs-' + n + '-' + side + '_position-axis" class="machine-output"',
                ' style="display:inline-block; width:31%; margin:0 2% 0 0;">',
                ['x','y','z','a','b','c'].map(function (ax) {
                    return '<option value="' + ax + '">' + ax.toUpperCase() + '</option>';
                }).join(''),
              '</select>',
              '<input type="number" step="any" id="machine-outputs-' + n + '-' + side + '_position-value" class="machine-output"',
                ' placeholder="' + window.t("config.outputs_tab.position_placeholder") + '" style="display:inline-block; width:34%; margin:0;">',
            '</div>'
        ].join('');

        // Input-trigger condition: [input] [goes ON/goes OFF], shown only
        // while the mode dropdown is set to Input. Binding both sides of an
        // output to the same input with complementary states = follow
        // ("momentary"); one side alone = latch ("permanent").
        var inputRow = [
            '<div id="machine-outputs-' + n + '-' + side + '_input_row"',
              ' title="' + window.t("config.outputs_tab.input_title_" + side) + '"',
              ' style="display:none; margin-top:4px;">',
              '<select id="machine-outputs-' + n + '-' + side + '_input-input" class="machine-output output-trigger-input"',
                ' style="display:inline-block; width:55%; margin:0 2% 0 0;">',
                (function () {
                    var o = '';
                    for (var inp = 1; inp <= 12; inp++) {
                        o += '<option value="' + inp + '">' + window.t("config.inputs.input_word") + ' ' + inp + '</option>';
                    }
                    return o;
                })(),
              '</select>',
              '<select id="machine-outputs-' + n + '-' + side + '_input-state" class="machine-output"',
                ' style="display:inline-block; width:43%; margin:0;">',
                '<option value="on">' + window.t("config.outputs_tab.input_goes_on") + '</option>',
                '<option value="off">' + window.t("config.outputs_tab.input_goes_off") + '</option>',
              '</select>',
            '</div>'
        ].join('');

        return [
            '<div class="large-4 columns">',
              '<div class="row collapse">',
                '<label>' + label,
                  '<select id="machine-outputs-' + n + '-' + side + '_mode"' + selectCls + lockedAttr + '>' + opts + '</select>',
                '</label>',
                '<input type="number" id="machine-outputs-' + n + '-' + side + '_seconds" min="0" step="0.1"' + secondsCls + lockedAttr +
                  ' placeholder="' + window.t("config.outputs_tab.seconds_placeholder") + '" style="display:none; margin-top:4px;">',
                positionRow,
                inputRow,
                '<label style="font-weight:normal; margin-top:4px;">' + window.t("config.outputs_tab.notify_for_" + side),
                  '<select id="machine-outputs-' + n + '-notify_' + side + '"',
                    ' class="machine-output output-notify" data-output="' + n + '" data-side="' + side + '">',
                    notifyOpts,
                  '</select>',
                '</label>',
                '<input type="text" id="machine-outputs-' + n + '-notify_' + side + '_message" class="machine-output"',
                  ' placeholder="' + window.t("config.outputs_tab.notify_message_placeholder") + '"' +
                  ' title="' + window.t("config.outputs_tab.notify_message_title_" + side) + '"',
                  ' style="display:none; margin-top:4px; height:1.8em;">',
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
    $('#machine-outputs-' + n + '-' + side + '_position_row')
        .css('display', mode === 'position' ? '' : 'none');
    $('#machine-outputs-' + n + '-' + side + '_input_row')
        .css('display', mode === 'input' ? '' : 'none');
}

// Annotate the input-trigger dropdowns with each input's assigned special
// function (stop, limit, auth button, ...) so nobody wires a dust collector
// to their stop button by accident. Inputs stay selectable either way —
// annotation only. Called from update() once config data is loaded.
function refreshInputOptionLabels(machineData) {
    if (!machineData) return;
    var tags = {};
    for (var i = 1; i <= 12; i++) {
        var action = machineData['di' + i + 'ac'];
        if (action && action !== 'none') tags[i] = action;
    }
    if (machineData.auth_input >= 1) tags[machineData.auth_input] = 'auth button';
    if (machineData.quit_input >= 1) tags[machineData.quit_input] = 'quit button';
    if (machineData.ap_input >= 1) tags[machineData.ap_input] = 'AP button';
    $('.output-trigger-input option').each(function () {
        var inp = Number(this.value);
        this.text = window.t("config.inputs.input_word") + ' ' + inp + (tags[inp] ? ' (' + tags[inp] + ')' : '');
    });
}

// Show the notification-message input only while its "Notify for ON/OFF"
// dropdown is set to something other than "never". Called on init (from
// update()'s getConfig callback) and on every dropdown change.
function syncNotifyVisibility(n, side) {
    var mode = $('#machine-outputs-' + n + '-notify_' + side).val();
    $('#machine-outputs-' + n + '-notify_' + side + '_message').css('display', mode && mode !== 'never' ? '' : 'none');
}

function setupOutputsTab() {
    var $list = $('#outputs-list');
    if (!$list.length) return;
    // Build the fieldsets only once the i18n dictionary has loaded:
    // buildOutputFieldset bakes window.t() text into the markup, and before
    // the dict arrives t() returns the raw keys — and injected markup is
    // not covered by the data-i18n re-walker. The delegated handlers below
    // bind to #outputs-list itself, so they're safe to attach before the
    // children exist; update() re-applies config values after injection.
    (window.i18nReady || Promise.resolve()).then(function () {
        var html = '';
        for (var n = 1; n <= 12; n++) html += buildOutputFieldset(n);
        $list.html(html);
        update();
    });

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

    // Show/hide notification message inputs whenever a notify checkbox changes.
    $list.on('change', '.output-notify', function () {
        var n = $(this).data('output');
        var side = $(this).data('side');
        syncNotifyVisibility(n, side);
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

    // Feature flags (machine.features.*) — same checkbox-to-value pattern.
    // The server installs the feature's macros when a flag turns on.
    $("#machine-features-atc, #machine-features-laser, #machine-features-knife").on('change', function() {
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
    setupLanguageSelector(fabmo);

});

// Populate the language dropdown from /i18n/languages (which knows
// what dicts ship on the machine + which is currently active) and
// wire a change handler that writes the engine config and reloads
// the dashboard so the new dictionary takes effect.
function setupLanguageSelector(fabmo) {
    $.getJSON('/i18n/languages', function (info) {
        var $sel = $('#engine-language');
        if (!$sel.length || !info) return;
        $sel.empty();
        (info.available || []).forEach(function (lang) {
            var opt = $('<option>').attr('value', lang.code).text(lang.language);
            if (lang.code === info.current) opt.prop('selected', true);
            $sel.append(opt);
        });
    }).fail(function () {
        // i18n route missing — leave the select empty; user can't switch.
    });

    // Credits / how-to-contribute modal, opened from the info button
    // beside the selector. Backdrop click closes; the dialog body
    // swallows clicks so text selection doesn't dismiss it.
    $('#btn-lang-info').on('click', function () {
        $('#lang-info-dialog').css('display', 'block');
    });
    $('#lang-info-close').on('click', function () {
        $('#lang-info-dialog').hide();
    });
    $('#lang-info-dialog').on('click', function (e) {
        if (e.target === this) $(this).hide();
    });

    $('#engine-language').on('change', function () {
        var lang = this.value;
        fabmo.setConfig({ engine: { language: lang } }, function (err) {
            if (err) {
                fabmo.notify('error', window.t('config.notify.language_change_failed') + err);
                return;
            }
            fabmo.notify('info', window.t('config.notify.language_changed'));
            // Reload the parent (the dashboard iframe host) so its
            // chrome picks up the new dict. Fall back to this app's
            // location if there's no parent (standalone testing).
            setTimeout(function () {
                try { window.parent.location.reload(); }
                catch (e) { window.location.reload(); }
            }, 600);
        });
    });
}

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

// ---------- Settings & Backups ----------
// Two-button save/restore over the snapshot system. A snapshot captures
// Configuration settings, Macros, installed App archives, and the job
// history metadata; a *downloaded* backup can additionally bundle the cut
// files themselves ("include job database"). The inline dialogs are used
// because the sandboxed iframe blocks window.prompt()/confirm().

var snapshotIndex = {}; // name -> snapshot info (incl. has_* content flags)
var restoreUploadFile = null; // File chosen via "Upload a backup file..."

function formatMB(bytes) {
    var mb = (bytes || 0) / (1024 * 1024);
    if (mb < 0.1) return '<0.1 MB';
    if (mb < 100) return mb.toFixed(1) + ' MB';
    return Math.round(mb) + ' MB';
}

// Refresh the snapshot list: populates the restore dialog's source picker
// and the "Default settings" label. Filters to kind="user" so auto
// recovery snapshots (which rotate on their own) don't clutter the picker.
function refreshSnapshots(done) {
    fetch('/snapshots')
        .then(function (r) { return r.json(); })
        .then(function (resp) {
            var all = (resp && resp.status === 'success' && resp.data) ? (resp.data.snapshots || []) : [];
            var userSnaps = all.filter(function (s) { return (s.kind || 'user') === 'user'; });
            var preferred = null;
            snapshotIndex = {};
            userSnaps.forEach(function (s) {
                snapshotIndex[s.name] = s;
                if (s.is_user_default) preferred = s;
            });

            var $sel = $('#restore-source');
            var prev = $sel.val();
            $sel.empty();
            if (userSnaps.length === 0) {
                $sel.append($('<option></option>').val('').text(window.t('config.settings_backup.no_snapshots')));
            } else {
                userSnaps.forEach(function (s) {
                    var label = s.name + (s.is_user_default ? '  ' + window.t('config.settings_backup.default_tag') : '');
                    $sel.append($('<option></option>').val(s.name).text(label));
                });
            }
            // Keep the user's selection if it survived; otherwise default
            // to the preferred snapshot, per the restore flow design.
            if (prev && snapshotIndex[prev]) {
                $sel.val(prev);
            } else if (preferred) {
                $sel.val(preferred.name);
            }

            $('#current-default-name').text(preferred ? preferred.name : window.t('config.settings_backup.none'));
            if (done) done(userSnaps, preferred);
        })
        .catch(function () {
            if (done) done([], null);
        });
}

// --- Save Current Settings ---

$('#btn-save-settings').click(function () {
    $('#save-settings-name').val('');
    $('#save-settings-description').val('');
    $('#save-settings-default').prop('checked', true);
    $('#save-settings-download').prop('checked', false);
    $('#save-settings-jobdb').prop('checked', false).prop('disabled', true);
    $('#save-settings-jobdb-size').text('');
    $('#save-settings-dialog').show();
    setTimeout(function () { $('#save-settings-name').focus(); }, 0);
    // Size estimate for the "include job database" option, so the user
    // knows what they're getting into before bundling cut files.
    fetch('/jobdb/size')
        .then(function (r) { return r.json(); })
        .then(function (resp) {
            if (resp && resp.status === 'success' && resp.data) {
                $('#save-settings-jobdb-size').text('(~' + formatMB(resp.data.total_bytes) + ')');
            }
        })
        .catch(function () {});
});

$('#save-settings-download').change(function () {
    var on = $(this).is(':checked');
    $('#save-settings-jobdb').prop('disabled', !on);
    if (!on) $('#save-settings-jobdb').prop('checked', false);
});

$('#save-settings-cancel').click(function () {
    $('#save-settings-dialog').hide();
});

$('#save-settings-confirm').click(function () {
    // Spaces are a common natural input; auto-convert to underscores
    // rather than rejecting. Collapse runs of whitespace to a single _.
    var name = ($('#save-settings-name').val() || '').trim().replace(/\s+/g, '_');
    var description = $('#save-settings-description').val() || '';
    if (!name) {
        fabmo.notify('error', window.t('config.notify.name_required'));
        return;
    }
    if (!/^[a-zA-Z0-9_-]{1,25}$/.test(name)) {
        fabmo.notify('error', window.t('config.notify.name_invalid'));
        return;
    }
    var makeDefault = $('#save-settings-default').is(':checked');
    var download = $('#save-settings-download').is(':checked');
    var includeJobdb = $('#save-settings-jobdb').is(':checked');
    $('#save-settings-dialog').hide();

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
            if (!makeDefault) return null;
            return fetch('/snapshots/' + encodeURIComponent(name) + '/set-default', { method: 'POST' })
                .then(function (r) { return r.json(); })
                .then(function (dResp) {
                    if (!dResp || dResp.status !== 'success') {
                        var msg = dResp && dResp.message ? dResp.message : window.t('config.notify.mark_default_failed');
                        fabmo.notify('warning', window.t('config.notify.snapshot_not_default') + msg);
                    }
                });
        })
        .then(function () {
            if (download) {
                var url = '/snapshots/' + encodeURIComponent(name) + '/download' + (includeJobdb ? '?jobdb=1' : '');
                var a = document.createElement('a');
                a.href = url;
                a.download = name + '.fmsnap.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
            fabmo.notify('success', window.t('config.notify.settings_saved') + name);
            refreshSnapshots();
        })
        .catch(function (err) {
            fabmo.notify('error', err.message || window.t('config.notify.save_default_failed'));
        });
});

// --- Restore Settings ---

// Enable/disable the part checkboxes for what the selected source actually
// contains. Older snapshots (or uploads, whose contents we can't see until
// they're imported) leave everything enabled. Availability flags come from
// the /snapshots list; a missing flag (old server) counts as available.
function updateRestoreParts() {
    var s = restoreUploadFile ? null : snapshotIndex[$('#restore-source').val()];
    var partAvailable = function (id, available) {
        $(id).prop('disabled', !available).prop('checked', available);
    };
    partAvailable('#restore-part-config', !s || s.has_config !== false);
    partAvailable('#restore-part-macros', !s || s.has_macros !== false);
    partAvailable('#restore-part-apps', !s || s.has_apps !== false);
    partAvailable('#restore-part-jobdb', !s || s.has_db !== false || s.has_files === true);
}

$('#btn-restore-settings').click(function () {
    restoreUploadFile = null;
    $('#restore-upload-name').text('');
    $('#restore-upload-file').val('');
    $('#restore-set-default').prop('checked', true);
    refreshSnapshots(function () {
        updateRestoreParts();
        $('#restore-settings-dialog').show();
    });
});

$('#restore-settings-cancel').click(function () {
    $('#restore-settings-dialog').hide();
});

$('#restore-source').change(function () {
    // Picking a snapshot supersedes a previously chosen upload.
    restoreUploadFile = null;
    $('#restore-upload-name').text('');
    $('#restore-upload-file').val('');
    updateRestoreParts();
});

$('#restore-upload-btn').click(function () {
    $('#restore-upload-file').trigger('click');
});

$('#restore-upload-file').change(function () {
    var files = $(this).prop('files');
    if (!files || files.length !== 1) return;
    restoreUploadFile = files[0];
    $('#restore-upload-name').text(restoreUploadFile.name);
    updateRestoreParts();
});

// Download / delete management for the selected snapshot, tucked into the
// restore dialog so the two main buttons stay uncluttered.
$('#restore-download-snapshot').click(function () {
    var name = $('#restore-source').val();
    if (!name) {
        fabmo.notify('warning', window.t('config.notify.no_custom_profile_selected'));
        return;
    }
    var a = document.createElement('a');
    a.href = '/snapshots/' + encodeURIComponent(name) + '/download';
    a.download = name + '.fmsnap.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

$('#restore-delete-snapshot').click(function () {
    var name = $('#restore-source').val();
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
            fetch('/snapshots/' + encodeURIComponent(name), { method: 'DELETE' })
                .then(function (r) { return r.json(); })
                .then(function (resp) {
                    if (!resp || resp.status !== 'success') {
                        var msg = resp && resp.message ? resp.message : window.t('config.notify.unknown_error');
                        throw new Error(msg);
                    }
                    fabmo.notify('success', window.t('config.notify.deleted_prefix') + name);
                    refreshSnapshots(function () { updateRestoreParts(); });
                })
                .catch(function (err) {
                    fabmo.notify('error', window.t('config.notify.delete_failed') + err.message);
                });
        },
        cancel: function () {}
    });
});

// After a restore the engine exits and systemd brings it back. Poll until
// it answers again, then reload the whole dashboard so every view picks up
// the restored state.
function awaitEngineRestart() {
    var attempts = 0;
    // Let the engine actually go down before polling for it coming back,
    // otherwise the first poll can hit the dying process.
    setTimeout(function poll() {
        attempts++;
        $.ajax({ url: '/status', method: 'GET', timeout: 3000 })
            .done(function () {
                try { window.top.location.reload(); } catch (e) { window.location.reload(); }
            })
            .fail(function () {
                if (attempts < 60) setTimeout(poll, 3000);
            });
    }, 5000);
}

$('#restore-settings-confirm').click(function () {
    var parts = {
        config: $('#restore-part-config').is(':checked'),
        macros: $('#restore-part-macros').is(':checked'),
        apps: $('#restore-part-apps').is(':checked'),
        jobdb: $('#restore-part-jobdb').is(':checked'),
    };
    if (!parts.config && !parts.macros && !parts.apps && !parts.jobdb) {
        fabmo.notify('warning', window.t('config.notify.restore_nothing_selected'));
        return;
    }
    var setDefault = $('#restore-set-default').is(':checked');

    var doRestore = function (name) {
        fabmo.notify('info', window.t('config.notify.restoring_default_prefix') + name + window.t('config.notify.restoring_default_suffix'));
        fetch('/snapshots/' + encodeURIComponent(name) + '/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parts: parts, set_default: setDefault })
        })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                if (!resp || resp.status !== 'success') {
                    var msg = resp && resp.message ? resp.message : window.t('config.notify.unknown_error');
                    fabmo.notify('error', window.t('config.notify.reset_failed') + msg);
                    return;
                }
                // Apps restore reinstalls from the archives already on the
                // tool; anything missing can't be recovered (yet) and is
                // reported by name.
                var missing = resp.data && resp.data.missing_apps;
                if (missing && missing.length) {
                    fabmo.notify('warning', window.t('config.notify.apps_missing') +
                        missing.map(function (a) { return a.name || a.id; }).join(', '));
                }
                fabmo.notify('success', window.t('config.notify.engine_restarting'));
                awaitEngineRestart();
            })
            .catch(function (err) {
                fabmo.notify('error', window.t('config.notify.reset_failed') + err.message);
            });
    };

    if (restoreUploadFile) {
        $('#restore-settings-dialog').hide();
        fabmo.notify('info', window.t('config.notify.uploading_custom_profile'));
        var formData = new FormData();
        formData.append('file', restoreUploadFile);
        $.ajax({
            url: '/snapshots/upload',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            timeout: 600000
        }).done(function (resp) {
            if (resp && resp.status === 'success' && resp.data && resp.data.name) {
                doRestore(resp.data.name);
            } else {
                fabmo.notify('error', window.t('config.notify.upload_failed') + ((resp && resp.message) || window.t('config.notify.unknown')));
            }
        }).fail(function (xhr) {
            var msg = window.t('config.notify.unknown_error');
            try { msg = (JSON.parse(xhr.responseText) || {}).message || msg; } catch (e) {}
            fabmo.notify('error', window.t('config.notify.upload_failed') + msg);
        }).always(function () {
            restoreUploadFile = null;
            $('#restore-upload-file').val('');
        });
    } else {
        var name = $('#restore-source').val();
        if (!name) {
            fabmo.notify('warning', window.t('config.notify.no_custom_profile_selected'));
            return;
        }
        $('#restore-settings-dialog').hide();
        doRestore(name);
    }
});

// Populate the Default settings label on load — gated so the "(none)" /
// "(default)" strings resolve after the i18n dicts land; an early t() here
// would bake raw keys into #current-default-name and the restore select.
(window.i18nReady || Promise.resolve()).then(refreshSnapshots);

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

// Populate on load — gated: the "Not detected" / "(none)" field values are
// written with .val() (no data-i18n-value), so a pre-dict t() sticks until
// the user runs Configure.
(window.i18nReady || Promise.resolve()).then(refreshSpindleDiscover);

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
// ----- Update notification --------------------------------------------------
// Checks for FabMo updates using the BROWSER's internet connection, so a tool
// with no network route of its own still learns that an update exists. The
// package manifest on gofabmo.org is CORS-open (GitHub Pages), so the page
// can read it directly. Install goes through the engine's same-origin updater
// proxy (/updater/*, routes/updater.js):
//   - tool online:  the updater downloads the package itself, then applies.
//   - tool offline: the browser downloads the .fmp (normal browser download,
//     no CORS needed) and the user drops it on the page; we relay it to the
//     updater's manual-update endpoint.
(function() {
    var MANIFEST_URL = 'https://www.gofabmo.org/manifest/packages.json';
    var latestPkg = null;
    var currentVersion = null;
    var armed = false;
    var armTimer = null;
    var lastMachineState = null;
    // The single #btn-update button: 'check' = run the manifest check,
    // 'install' = install latestPkg (set once a newer version is found).
    var mode = 'check';

    fabmo.on('status', function(status) {
        if (status && status.state) { lastMachineState = status.state; }
    });

    function parseVer(v) {
        var p = String(v || '').replace(/^v/i, '').split('.').map(function(n) {
            return parseInt(n, 10) || 0;
        });
        while (p.length < 3) { p.push(0); }
        return p;
    }

    function verCmp(a, b) {
        var va = parseVer(a), vb = parseVer(b);
        for (var i = 0; i < 3; i++) {
            if (va[i] !== vb[i]) { return va[i] - vb[i]; }
        }
        return 0;
    }

    function progress(msg, isError) {
        $('#update-progress')
            .show()
            .css('color', isError ? '#a94442' : '#31708f')
            .text(msg);
    }

    function showNotice(pkg) {
        latestPkg = pkg;
        mode = 'install';
        $('#update-uptodate').hide();
        // A small "(update available)" flag next to the version number
        // (data-i18n already filled its text), and the one button morphs:
        // "Check for Updates" → "Install vX.X.X now".
        $('#update-available-flag').show();
        $('#btn-update').addClass('success')
            .text(window.t('config.software.install_now', { version: pkg.version }));
    }

    // manual=true when the user clicked "Check for Updates": give feedback
    // for the quiet outcomes (dev build, no internet) that the automatic
    // on-load check deliberately swallows.
    function checkForUpdates(manual) {
        if (manual) {
            $('#update-uptodate').hide();
            $('#btn-update').addClass('disabled');
            progress(window.t('config.software.update_checking'));
        }
        function done(msgKey, isError) {
            $('#btn-update').removeClass('disabled');
            if (msgKey) {
                if (manual) { progress(window.t(msgKey), isError); }
            } else {
                $('#update-progress').hide();
            }
        }
        fabmo.getVersion(function(err, version) {
            if (err || !version || version.type !== 'release' || !version.number) {
                return done('config.software.update_check_unavailable', true); // dev builds: no version to compare against
            }
            currentVersion = version.number;
            // Ask the engine's updater proxy which platform we are; fall back
            // to raspberry-pi (the only shipping platform) if it's unreachable.
            $.getJSON('/updater/config').always(function(resp) {
                var ucfg = (resp && resp.data && (resp.data.config || resp.data)) || {};
                var platform = ucfg.platform || 'raspberry-pi';
                var controller = window.AbortController ? new AbortController() : null;
                var timer = controller ? setTimeout(function() { controller.abort(); }, 8000) : null;
                fetch(MANIFEST_URL, controller ? { signal: controller.signal, cache: 'no-store' } : { cache: 'no-store' })
                    .then(function(r) { return r.json(); })
                    .then(function(manifest) {
                        if (timer) { clearTimeout(timer); }
                        var pkgs = (manifest.packages || []).filter(function(p) {
                            return p.product === 'FabMo-Engine' &&
                                   p.os === 'linux' &&
                                   p.platform === platform;
                        }).sort(function(a, b) { return verCmp(a.version, b.version); });
                        if (!pkgs.length) { return done('config.software.update_check_failed', true); }
                        var newer = pkgs.filter(function(p) {
                            return verCmp(p.version, currentVersion) > 0;
                        });
                        done(null);
                        if (newer.length) {
                            showNotice(newer[newer.length - 1]);
                        } else {
                            $('#update-uptodate').show();
                        }
                    })
                    .catch(function() {
                        // Browser has no internet either (or the fetch timed
                        // out). The automatic check stays quiet; a manual
                        // check reports the failure.
                        done('config.software.update_check_failed', true);
                    });
            });
        });
    }

    function disarm() {
        armed = false;
        if (armTimer) { clearTimeout(armTimer); armTimer = null; }
        if (latestPkg) {
            $('#btn-update')
                .removeClass('alert').addClass('success')
                .text(window.t('config.software.install_now', { version: latestPkg.version }));
        }
    }

    function beginInstall() {
        if (lastMachineState && lastMachineState !== 'idle') {
            progress(window.t('config.software.update_requires_idle'), true);
            return;
        }
        $('#btn-update').addClass('disabled');
        $.getJSON('/network/online').always(function(resp) {
            var online = !!(resp && resp.data && resp.data.online);
            if (online) {
                serverSideInstall();
            } else {
                $('#update-offline-flow').show();
            }
        });
    }

    function serverSideInstall() {
        progress(window.t('config.software.update_downloading_tool'));
        $.ajax({
            url: '/updater/update/download',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ version: latestPkg.version }),
            dataType: 'json',
            timeout: 10 * 60 * 1000
        }).done(function(resp) {
            if (resp && resp.status === 'success') {
                progress(window.t('config.software.update_installing_restart'));
                $.post('/updater/update/apply').fail(function() {
                    // The engine often restarts before this response lands —
                    // that is the success case, not an error.
                });
            } else {
                progress(window.t('config.software.update_failed', {
                    message: (resp && resp.message) || 'unknown'
                }), true);
                $('#btn-update').removeClass('disabled');
            }
        }).fail(function(xhr, stat) {
            progress(window.t('config.software.update_failed', { message: stat }), true);
            $('#btn-update').removeClass('disabled');
        });
    }

    function relayFile(file) {
        if (!file) { return; }
        if (!/\.(fmp|fmu)$/i.test(file.name)) {
            progress(window.t('config.software.update_failed', { message: file.name }), true);
            return;
        }
        var fd = new FormData();
        fd.append('file', file, file.name);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/updater/update/manual');
        xhr.upload.onprogress = function(evt) {
            if (evt.lengthComputable) {
                progress(window.t('config.software.update_uploading', {
                    pct: Math.round((evt.loaded / evt.total) * 100)
                }));
            }
        };
        xhr.onload = function() {
            var resp = {};
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* fall through */ }
            if (resp.status === 'success') {
                progress(window.t('config.software.update_installing_restart'));
            } else {
                progress(window.t('config.software.update_failed', {
                    message: resp.message || ('HTTP ' + xhr.status)
                }), true);
            }
        };
        xhr.onerror = function() {
            progress(window.t('config.software.update_failed', { message: 'upload error' }), true);
        };
        progress(window.t('config.software.update_uploading', { pct: 0 }));
        xhr.send(fd);
    }

    function init() {
        // The one update button: checks in 'check' mode, installs (with a
        // two-step confirm — the sandboxed iframe blocks window.confirm) in
        // 'install' mode.
        $('#btn-update').click(function(evt) {
            evt.preventDefault();
            if ($(this).hasClass('disabled')) { return; }
            if (mode === 'check') {
                checkForUpdates(true);
                return;
            }
            if (!latestPkg) { return; }
            if (!armed) {
                // First click arms, second click within 6 s proceeds.
                armed = true;
                $(this).removeClass('success').addClass('alert')
                    .text(window.t('config.software.confirm_install', {
                        version: latestPkg.version
                    }));
                armTimer = setTimeout(disarm, 6000);
                return;
            }
            disarm();
            beginInstall();
        });

        $('#btn-open-updater').click(function(evt) {
            evt.preventDefault();
            fabmo.navigate('/updater');
        });

        // The browser downloads the package over ITS connection. Opened via
        // the parent window because the sandboxed app iframe can't download.
        $('#btn-download-fmp').click(function(evt) {
            evt.preventDefault();
            if (latestPkg) { fabmo.navigate(latestPkg.url, { target: '_blank' }); }
        });

        var $zone = $('#fmp-dropzone');
        $zone.click(function() { $('#fmp-file-input').trigger('click'); });
        $('#fmp-file-input').change(function() { relayFile(this.files[0]); });
        $zone.on('dragover dragenter', function(evt) {
            evt.preventDefault();
            $zone.css('border-color', '#4a7a4a');
        });
        $zone.on('dragleave drop', function(evt) {
            evt.preventDefault();
            $zone.css('border-color', '#9a9a9a');
        });
        $zone.on('drop', function(evt) {
            var dt = evt.originalEvent.dataTransfer;
            if (dt && dt.files && dt.files.length) { relayFile(dt.files[0]); }
        });

        checkForUpdates();
    }

    // Dynamic strings here are built with direct t() calls, and the check can
    // win the race against the dictionary fetch — gate the whole module.
    $(document).ready(function() {
        (window.i18nReady || Promise.resolve()).then(init);
    });
})();
