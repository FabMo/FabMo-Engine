/**
 * @author Joseph Coffland <joseph@cauldrondevelopment.com>
 *
 * Adapted from code written by Alex Canales.
 */

'use strict';


var util          = require('./util');
var cookie        = require('./cookie');
var Path          = require('./path');
var Dimensions    = require('./dimensions');
var Axes          = require('./axes');
var Grid          = require('./grid');
var Table         = require('./table');
var Tool          = require('./tool');
var Gui           = require('./gui');
var PointCloud    = require('./pointcloud');
var Material      = require('./material');  // ADD THIS

module.exports = function(container) {
  var self = this;

  const tableBounds = {   // Manages pushing and pulling around; Desktop for example
    max: {
        x: 24,
        y: 18,
        z: 1
    },
    min: {
        x: 0,
        y: 0,
        z: 0
    },
    loc: {
        x: 0,
        y: 0,
        z: 0
    },
    offloc: {
        x: 0,
        y: 0,
        z: 0
    }
  }


  // Renders the screen
  function render() {self.renderer.render(self.scene, self.camera)}


  self.refresh = function() {
    render();
    self.controls.update();
  }


  self.setTable = function(envelope, xoff, yoff, zoff) {    // getting data for table, grid, and offset from machine 0
      tableBounds.max.x = envelope.xmax;
      tableBounds.min.x = envelope.xmin;
      tableBounds.max.y = envelope.ymax;
      tableBounds.min.y = envelope.ymin;
      tableBounds.loc.x = (tableBounds.max.x - tableBounds.min.x) / 2;
      tableBounds.loc.y = (tableBounds.max.y - tableBounds.min.y) / 2;
      tableBounds.offloc.x = tableBounds.loc.x - xoff;      // keeping it simple by offsetting table not scene
      tableBounds.offloc.y = tableBounds.loc.y - yoff;
      tableBounds.offloc.z = zoff;
  }


  // Soft-limit envelope and active work offsets, supplied by app.js.
  // Used to flag files whose cutting extents would exceed the machine envelope.
  var softLimits = null;

  self.setSoftLimits = function (envelope, g55x, g55y, units) {
      softLimits = {
          envelope: envelope,
          g55: { x: g55x || 0, y: g55y || 0 },
          units: units || ''
      };
  }


  // bounds are in work coords; envelope is in machine coords.
  // machineCoord = workCoord + g55Offset
  function checkSoftLimits(bounds) {
      if (!self.gui) return;
      if (!softLimits || !softLimits.envelope || !bounds) {
          self.gui.hideSoftLimitWarning && self.gui.hideSoftLimitWarning();
          return;
      }
      var env = softLimits.envelope;
      var g55 = softLimits.g55;
      var violations = [];
      ['x', 'y'].forEach(function (a) {
          var bMin = bounds.min[a];
          var bMax = bounds.max[a];
          if (typeof bMin !== 'number' || typeof bMax !== 'number') return;
          var machineMin = bMin + g55[a];
          var machineMax = bMax + g55[a];
          var envMin = env[a + 'min'];
          var envMax = env[a + 'max'];
          if (typeof envMax === 'number' && machineMax > envMax) {
              violations.push({ axis: a, direction: 'max', overage: machineMax - envMax });
          }
          if (typeof envMin === 'number' && machineMin < envMin) {
              violations.push({ axis: a, direction: 'min', overage: envMin - machineMin });
          }
      });
      if (violations.length) {
          self.gui.showSoftLimitWarning(violations, softLimits.units);
      } else {
          self.gui.hideSoftLimitWarning && self.gui.hideSoftLimitWarning();
      }
  }


  // Called when the canvas or container has resized; scaling to available window.
  self.resize = function(width, height) {
    self.renderer.setSize(width, height);
    
    var aspect = width / height;
    
    // Update perspective camera
    self.perspectiveCamera.aspect = aspect;
    self.perspectiveCamera.updateProjectionMatrix();
    
    // Update orthographic camera
    var frustumSize = 100;  // Match the value used in resize()
    self.orthographicCamera.left = frustumSize * aspect / -2;
    self.orthographicCamera.right = frustumSize * aspect / 2;
    self.orthographicCamera.top = frustumSize / 2;
    self.orthographicCamera.bottom = frustumSize / -2;
    self.orthographicCamera.updateProjectionMatrix();
    
    // Update active camera
    self.camera.aspect = aspect;
    self.camera.updateProjectionMatrix();
    
    self.gui.resize(width, height);
    self.refresh();
  }


  function snapPlane(plane) {
    var bounds = self.path.bounds;
    var center = util.getCenter(bounds);
    var camera = util.getCenter(bounds);
    var dims = util.getDims(bounds);
    var zoom = 0.75 * util.maxDim(bounds) / Math.tan(Math.PI / 8);

    if (plane == 'yz') camera[0] += zoom + dims[0] / 2;
    else if (plane == 'xz') camera[1] -= zoom + dims[1] / 2;
    else if (plane == 'xy') camera[2] += zoom + dims[2] / 2;
    else {
      camera[1] -= (zoom + dims[1] / 2) / 1.4;
      camera[2] += (zoom + dims[2] / 2) / 1.4;
    }

    var pos = self.controls.object.position;
    self.controls.reset();
    pos.set(camera[0], camera[1], camera[2]);
    self.controls.target.set(center[0], center[1], center[2]);
    self.refresh();
  }


  self.showX   = function () {snapPlane('yz')}
  self.showY   = function () {snapPlane('xz')}
  self.showZ   = function () {snapPlane('xy')}
  
  self.toggleView = function () {
    self.toggleOrtho();
  }

  self.toggleOrtho = function() {
    self.isOrtho = !self.isOrtho;
    
    console.log('Toggling ortho mode to:', self.isOrtho); // Debug log
    
    // Update CSS class on preview container - using jQuery for reliability
    if (self.isOrtho) {
      container.addClass('ortho-mode');
      //console.log('Added ortho-mode class'); // Debug log
    } else {
      container.removeClass('ortho-mode');
      //console.log('Removed ortho-mode class'); // Debug log
    }
    
    // Log to verify class was applied
    //console.log('Container has ortho-mode class:', container.hasClass('ortho-mode'));
    
    if (self.isOrtho) {
      // Switch to orthographic
      var currentPos = self.perspectiveCamera.position.clone();
      var currentTarget = self.controls.target.clone();
      
      self.orthographicCamera.position.copy(currentPos);
      self.orthographicCamera.lookAt(currentTarget);
      self.orthographicCamera.zoom = 2.0;
      self.orthographicCamera.near = self.orthoNearClip;
      self.orthographicCamera.updateProjectionMatrix();
      
      self.camera = self.orthographicCamera;
    } else {
      // Switch back to perspective
      var currentPos = self.orthographicCamera.position.clone();
      var currentTarget = self.controls.target.clone();
      
      self.perspectiveCamera.position.copy(currentPos);
      self.perspectiveCamera.lookAt(currentTarget);
      
      self.camera = self.perspectiveCamera;
    }
    
    // Update controls to use new camera
    self.controls.object = self.camera;
    self.controls.update();
    
    self.camera.updateProjectionMatrix();
    
    // Save the current view state
    self.saveViewState();
    
    self.refresh();
  }

  // Lighting direction (degrees). Cookie-persisted; updated from settings dialog.
  // Default azimuth is upper-left, elevation is low-raking so micro-relief
  // (toolpath cuts) casts visible shadows when the scene is viewed top-down.
  self.lightAzimuth = parseFloat(cookie.get('light-azimuth', 135));
  self.lightElevation = parseFloat(cookie.get('light-elevation', 25));

  function updateLights(bounds) {
    if (!bounds) bounds = self._lastLightBounds;
    if (!bounds) return;
    self._lastLightBounds = bounds;

    var center = util.getCenter(bounds);
    var dims = util.getDims(bounds);
    var distance = Math.max(dims[0], dims[1], dims[2]) + 10;

    var azim = self.lightAzimuth * Math.PI / 180;
    var elev = self.lightElevation * Math.PI / 180;
    var cosE = Math.cos(elev);
    var dx = distance * cosE * Math.cos(azim);
    var dy = distance * cosE * Math.sin(azim);
    var dz = distance * Math.sin(elev);

    self.light2.position.set(center[0] + dx, center[1] + dy, center[2] + dz);
    if (self.light2.target) {
      self.light2.target.position.set(center[0], center[1], center[2]);
      self.light2.target.updateMatrixWorld();
    }
  }


  function pathLoaded() {
    if (self.path.errors.length)
      self.gui.showErrors(self.path.errors);

    var bounds = self.path.bounds;

    // On first load, save the full-file bounds so operation filtering
    // doesn't shrink the material/camera to a subset's extents.
    var isFirstLoad = !self.originalBounds;
    if (isFirstLoad) {
      self.originalBounds = {
        min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
        max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z }
      };
    }

    // Check the full-file extents against the machine soft-limit envelope.
    checkSoftLimits(self.originalBounds);

    // Always use original bounds for material, camera, and scene setup
    var sceneBounds = self.originalBounds;
    var size = util.maxDim(sceneBounds);

    updateLights(sceneBounds);
    self.dims.update(sceneBounds, self.isMetric());
    self.axes.update(size);
    self.tool.update(size, self.path.position);

    // Lift toolpath fractionally so on-surface segments don't z-fight the stock top.
    if (self.path.obj) self.path.obj.position.z = self.isMetric() ? 0.13 : 0.005;

    // Initialize material simulation — values come from the effective accessors
    // (Setup overrides win over file metadata; file metadata wins over defaults).
    var stockThickness = getEffectiveStockThickness();
    var materialTop = getEffectiveZOrigin() === 'table' ? stockThickness : 0;

    // Expand bounds to include material block
    var materialBounds = {
      min: {
        x: sceneBounds.min.x - 0.5,  // Add margin
        y: sceneBounds.min.y - 0.5,
        z: materialTop - stockThickness  // Bottom of stock
      },
      max: {
        x: sceneBounds.max.x + 0.5,
        y: sceneBounds.max.y + 0.5,
        z: materialTop  // Top at Z=0
      }
    };

    // Align table surface with the bottom of the material
    var materialBottom = materialTop - stockThickness;
    self.table.setZZoff(materialBottom);

    // Tool info is now per-operation; initial material diameter uses the first
    // operation's tool when available, falling back to the Setup default tool.
    var toolDia = self.defaultTool.toolDiameter || 0.25;
    if (self.operations && self.operations.length > 0 && self.operations[0].toolInfo) {
      toolDia = self.operations[0].toolInfo.toolDiameter || toolDia;
    }

    console.log('Initializing material:');
    console.log('  Top Z:', materialTop);
    console.log('  Bottom Z:', materialTop - stockThickness);
    console.log('  Thickness:', stockThickness);
    console.log('  Tool diameter:', toolDia);
    console.log('Path bounds Z: min=', bounds.min.z, 'max=', bounds.max.z);

    // Material initialization is handled by computeMaterialProgressive() below

    // Only set up camera on first load
    if (isFirstLoad) {
      // Try to restore saved view state first
      var restored = self.restoreViewState();

      // If no saved state, position camera in ISO orientation
      if (!restored) {
        var center = util.getCenter(sceneBounds);
        var dims = util.getDims(sceneBounds);
        var zoom = 0.75 * size / Math.tan(Math.PI / 8);

        var camera = [center[0], center[1], center[2]];
        camera[1] -= (zoom + dims[1] / 2) / 1.4;
        camera[2] += (zoom + dims[2] / 2) / 1.4;

        self.controls.reset();
        self.camera.position.set(camera[0], camera[1], camera[2]);
        self.controls.target.set(center[0], center[1], center[2]);

        // Apply zoom and near plane if in ortho mode
        if (self.isOrtho) {
          self.orthographicCamera.zoom = 2.0;
          self.orthographicCamera.near = self.orthoNearClip;
          self.orthographicCamera.updateProjectionMatrix();
        }

        self.controls.update();
      }
    }

    // Tag each move with tool info so the material simulation can switch
    // bit size/type per operation; with no parsed ops, every move inherits
    // the Setup default tool.
    if (self.path.moves.length) {
      tagMovesWithToolInfo();
    }

    // Save material params for progressive re-rendering
    self._materialParams = {
      bounds: materialBounds,
      thickness: stockThickness,
      toolDia: toolDia,
      materialTop: materialTop
    };

    // Compute material with progress bar
    computeMaterial(function() {
      buildNLineMap();
      self.gui.hideLoading();
      self.gui.setTimelineDuration(self.path.duration);
      self.refresh();
    });
  }

  function computeMaterial(onDone) {
    if (!self.material || !self.path || !self._materialParams) {
      if (onDone) onDone();
      return;
    }
    var p = self._materialParams;
    self.material.initialize(p.bounds, p.thickness, p.toolDia, p.materialTop);
    // Sync the current light direction into the freshly-built mesh's hillshade.
    applyLightDirectionToMaterial();
    self.gui.showLoading('Computing material\u2026');
    self.path.applyAllMaterial(
      function(progress) {
        var pct = Math.round(progress * 100);
        self.gui.showLoading('Computing material\u2026 <progress max="100" value="' + pct + '"></progress>');
      },
      function() {
        if (onDone) onDone();
      }
    );
  }

  // Assign toolInfo from operations to each move based on sourceLine ranges.
  // Moves with no matching op (or all moves when there are no parsed ops)
  // fall back to the Setup default tool so the material simulation reflects
  // user-set bit type/diameter even when the file has no operation metadata.
  function tagMovesWithToolInfo() {
    var moves = self.path && self.path.moves;
    if (!moves || !moves.length) return;
    var fallback = {
      toolType: self.defaultTool.toolType,
      toolDiameter: self.defaultTool.toolDiameter,
      vbitAngle: self.defaultTool.vbitAngle
    };
    var ops = self.operations || [];
    if (ops.length === 0 || !self.path.hasSourceLines) {
      for (var i = 0; i < moves.length; i++) moves[i].toolInfo = fallback;
      return;
    }
    // Build sorted list of operation ranges (0-based source lines)
    var ranges = [];
    for (var i = 0; i < ops.length; i++) {
      ranges.push({
        start: ops[i].startLine - 1,
        end: ops[i].endLine - 1,
        toolInfo: ops[i].toolInfo
      });
    }
    for (var i = 0; i < moves.length; i++) {
      var sl = moves[i].sourceLine;
      var matched = false;
      for (var r = 0; r < ranges.length; r++) {
        if (sl >= ranges[r].start && sl <= ranges[r].end) {
          moves[i].toolInfo = ranges[r].toolInfo;
          matched = true;
          break;
        }
      }
      if (!matched) moves[i].toolInfo = fallback;
    }
  }


  function pathProgress(progress) {
    self.gui.showLoadingProgress(progress);
    self.refresh();
  }


  // Build N-number → first move index lookup table after gcode is loaded.
  //
  // Two different N-numbering schemes in use depending on file type:
  //   SBP files:   emit_gcode() embeds N = (SBP_pc + 20), so loaded gcode has
  //                N-numbers that map to SBP source commands (N20=cmd0, N21=cmd1 ...)
  //   GCode files: loaded gcode has NO N-numbers; LineNumberer adds N21 for file
  //                line 0, N22 for line 1, etc. during actual execution
  //
  // In both cases status.line = last N-number accepted by G2 planner, so a
  // single backward search through this table works for both file types.
  function buildNLineMap() {
    self.nLineMap = {};
    var gcode = self.path.gcode;
    var moves = self.path.moves;
    var hasNNumbers = false;

    // Map each 1-based gcode array index to the first move index from that line
    var lineToMoveIdx = {};
    for (var m = 0; m < moves.length; m++) {
      var gl = moves[m].getLine(); // move.getLine() == gcode_array_index + 1
      if (!(gl in lineToMoveIdx)) lineToMoveIdx[gl] = m;
    }

    // SBP files: N-numbers already present in loaded gcode (N = SBP pc + 20)
    for (var k = 0; k < gcode.length; k++) {
      var match = gcode[k].match(/^N(\d+)/);
      if (match) {
        hasNNumbers = true;
        var n = parseInt(match[1]);
        var gcLine = k + 1;
        if (!(n in self.nLineMap) && (gcLine in lineToMoveIdx)) {
          self.nLineMap[n] = lineToMoveIdx[gcLine];
        }
      }
    }

    // GCode files: no N-numbers in loaded gcode; LineNumberer will assign
    // N21 to gcode[0], N22 to gcode[1], etc. during actual streaming to G2
    if (!hasNNumbers) {
      for (var k = 0; k < gcode.length; k++) {
        var n = k + 21;
        var gcLine = k + 1;
        if (gcLine in lineToMoveIdx) {
          self.nLineMap[n] = lineToMoveIdx[gcLine];
        }
      }
    }
    self.isSBP = hasNNumbers;  
  }



  // VCarve/ShopBot file metadata (Z origin mode, material thickness)
  self.fileMetadata = null;

  // Session-only Setup overrides (null = follow file metadata / defaults).
  // Populated when the user edits the Setup section in the operations panel.
  self.setupOverrides = {
    materialThickness: null,
    zOrigin: null
  };

  // Default tool used by ops with no parsed toolInfo. User-editable in the
  // Setup section. Per-op edits detach an op from this default; further
  // changes here only update ops still tracking the default.
  self.defaultTool = {
    toolType: 'flat',
    toolDiameter: 0.25,
    vbitAngle: 90
  };

  function getEffectiveStockThickness() {
    if (self.setupOverrides.materialThickness != null)
      return self.setupOverrides.materialThickness;
    if (self.fileMetadata && self.fileMetadata.materialThickness)
      return self.fileMetadata.materialThickness;
    return 0.75;
  }

  function getEffectiveZOrigin() {
    if (self.setupOverrides.zOrigin != null) return self.setupOverrides.zOrigin;
    if (self.fileMetadata && self.fileMetadata.zOrigin) {
      return self.fileMetadata.zOrigin.indexOf('table') !== -1 ? 'table' : 'material';
    }
    return 'material';
  }

  self.setFileMetadata = function(metadata) {
    self.fileMetadata = metadata;
    console.log('File metadata set:', JSON.stringify(metadata));
    // Seed default tool from file-level toolInfo (used when there are 0 ops
    // or to give Setup section a sensible starting value).
    if (metadata && metadata.toolInfo) {
      if (metadata.toolInfo.toolType) self.defaultTool.toolType = metadata.toolInfo.toolType;
      if (metadata.toolInfo.toolDiameter) self.defaultTool.toolDiameter = metadata.toolInfo.toolDiameter;
      if (metadata.toolInfo.vbitAngle) self.defaultTool.vbitAngle = metadata.toolInfo.vbitAngle;
    }
  };

  // Operations list parsed from 'New Path blocks
  self.operations = null;

  // Helper: rebuild move tags and reload material after a tool override
  function applyToolChange() {
    if (self.path && self.path.moves && self.path.moves.length) {
      tagMovesWithToolInfo();
      computeMaterial(function() {
        self.gui.hideLoading();
        self.refresh();
      });
    }
  }

  // Helper: rebuild material after a Setup change (thickness / Z origin /
  // default tool when there are no ops). Updates material params from the
  // current effective values; doesn't disturb camera or path geometry.
  function applySetupChange() {
    if (!self._materialParams || !self.path || !self.path.bounds) return;
    var sceneBounds = self.originalBounds || self.path.bounds;
    var stockThickness = getEffectiveStockThickness();
    var materialTop = getEffectiveZOrigin() === 'table' ? stockThickness : 0;
    var materialBottom = materialTop - stockThickness;
    self._materialParams.thickness = stockThickness;
    self._materialParams.materialTop = materialTop;
    self._materialParams.bounds = {
      min: { x: sceneBounds.min.x - 0.5, y: sceneBounds.min.y - 0.5, z: materialBottom },
      max: { x: sceneBounds.max.x + 0.5, y: sceneBounds.max.y + 0.5, z: materialTop }
    };
    if (!self.operations || self.operations.length === 0) {
      self._materialParams.toolDia = self.defaultTool.toolDiameter || 0.25;
    }
    self.table.setZZoff(materialBottom);
    if (self.path.moves && self.path.moves.length) {
      tagMovesWithToolInfo();
      computeMaterial(function() {
        self.gui.hideLoading();
        self.refresh();
      });
    }
  }

  // One-time wiring of the always-visible Setup section. Pre-fills inputs
  // from current effective values and persists user edits to setupOverrides
  // / defaultTool, re-rendering the material on each change.
  var setupSectionInitialized = false;
  function initSetupSection() {
    if (setupSectionInitialized) return;
    setupSectionInitialized = true;

    var $setup = $('#ops-setup');
    var $thickness = $setup.find('.setup-material-thickness');
    var $zOrigin = $setup.find('.setup-z-origin');
    var $toolType = $setup.find('.setup-tool-type');
    var $toolDia = $setup.find('.setup-tool-dia');
    var $toolAngle = $setup.find('.setup-tool-angle');
    var $vbitWrap = $setup.find('.setup-vbit-wrap');

    $thickness.val(getEffectiveStockThickness());
    $zOrigin.val(getEffectiveZOrigin());
    $toolType.val(self.defaultTool.toolType);
    $toolDia.val(self.defaultTool.toolDiameter);
    $toolAngle.val(self.defaultTool.vbitAngle);
    $vbitWrap.toggle(self.defaultTool.toolType === 'vbit');

    $setup.find('.ops-setup-header').on('click', function() {
      var $panel = $('#operations-panel');
      var collapsed = $panel.toggleClass('setup-collapsed').hasClass('setup-collapsed');
      $setup.find('.ops-setup-toggle').text(collapsed ? '+' : '−');
    });

    $thickness.on('change', function() {
      var v = parseFloat($(this).val());
      if (!isNaN(v) && v > 0) {
        self.setupOverrides.materialThickness = v;
        applySetupChange();
      }
    });

    $zOrigin.on('change', function() {
      self.setupOverrides.zOrigin = $(this).val();
      applySetupChange();
    });

    $toolType.on('change', function() {
      self.defaultTool.toolType = $(this).val();
      $vbitWrap.toggle(self.defaultTool.toolType === 'vbit');
      propagateDefaultToolToOps();
      applySetupChange();
    });

    $toolDia.on('change', function() {
      var v = parseFloat($(this).val());
      if (!isNaN(v) && v > 0) {
        self.defaultTool.toolDiameter = v;
        propagateDefaultToolToOps();
        applySetupChange();
      }
    });

    $toolAngle.on('change', function() {
      var v = parseFloat($(this).val());
      if (!isNaN(v) && v > 0) {
        self.defaultTool.vbitAngle = v;
        propagateDefaultToolToOps();
        applySetupChange();
      }
    });
  }

  // Update toolInfo on ops still tracking the Setup default, refreshing
  // their per-op rows. Ops the user has explicitly edited keep their values.
  function propagateDefaultToolToOps() {
    if (!self.operations) return;
    for (var i = 0; i < self.operations.length; i++) {
      var op = self.operations[i];
      if (!op._fromDefault) continue;
      op.toolInfo = {
        toolType: self.defaultTool.toolType,
        toolDiameter: self.defaultTool.toolDiameter,
        vbitAngle: self.defaultTool.vbitAngle
      };
      var $row = $('#ops-list .op-entry').eq(i);
      $row.find('.op-tool-type').val(op.toolInfo.toolType);
      $row.find('.op-tool-dia').val(op.toolInfo.toolDiameter);
      $row.find('.op-tool-angle').val(op.toolInfo.vbitAngle);
      $row.find('.op-angle-wrap').toggle(op.toolInfo.toolType === 'vbit');
    }
  }

  self.setOperations = function(ops) {
    ops = ops || [];
    self.operations = ops;
    initSetupSection();

    var list = $('#ops-list');
    list.empty();

    var $panel = $('#operations-panel');
    var $empty = $('#ops-empty');
    var $header = $panel.find('.ops-header');
    var $toggleAll = $panel.find('.ops-toggle-all');
    var $runSelected = $panel.find('.run-selected-ops');
    var $submitSelected = $panel.find('.submit-selected-ops');

    // Always show panel + Run Full Job; gate ops-only UI on whether ops exist.
    $panel.show();
    $empty.toggle(ops.length === 0);
    $header.toggle(ops.length > 0);
    $toggleAll.toggle(ops.length > 0);
    $runSelected.toggle(ops.length > 0);
    $submitSelected.toggle(ops.length > 0);

    if (ops.length === 0) {
      console.log('Operations panel: no operations parsed — showing Setup-only fallback');
      return;
    }

    for (var i = 0; i < ops.length; i++) {
      (function(idx) {
        var op = ops[idx];
        // Inherit default tool when the file didn't supply one.
        if (!op.toolInfo) {
          op.toolInfo = {
            toolType: self.defaultTool.toolType,
            toolDiameter: self.defaultTool.toolDiameter,
            vbitAngle: self.defaultTool.vbitAngle
          };
          op._fromDefault = true;
        }
        var ti = op.toolInfo;
        var entry = $('<div class="op-entry">');
        var topRow = $('<div class="op-top-row">');
        var checkbox = $('<input type="checkbox" checked>').attr('data-op-index', idx);
        var nameSpan = $('<span class="op-name">').text(op.name || ('Operation ' + (idx + 1)));
        topRow.append(checkbox).append(nameSpan);
        entry.append(topRow);

        // Per-operation tool controls
        var toolRow = $('<div class="op-tool-row">');

        var typeSelect = $('<select class="op-tool-type">')
          .append('<option value="flat">Flat</option>')
          .append('<option value="ball">Ball</option>')
          .append('<option value="vbit">V-Bit</option>')
          .val(ti.toolType || 'flat');

        var diaInput = $('<input class="op-tool-dia" type="number" min="0.01" max="3" step="any">')
          .val(ti.toolDiameter || 0.25);

        var diaLabel = $('<span class="op-tool-dia-label">').text('"');

        var angleInput = $('<input class="op-tool-angle" type="number" min="10" max="180" step="1">')
          .val(ti.vbitAngle || 90);
        var angleLabel = $('<span class="op-tool-angle-label">').text('°');
        var angleWrap = $('<span class="op-angle-wrap">').append(angleInput).append(angleLabel);
        if ((ti.toolType || 'flat') !== 'vbit') angleWrap.hide();

        typeSelect.on('change', function() {
          var type = $(this).val();
          op.toolInfo.toolType = type;
          op._fromDefault = false;
          angleWrap.toggle(type === 'vbit');
          applyToolChange();
        });

        diaInput.on('change', function() {
          var dia = parseFloat($(this).val());
          if (dia > 0) {
            op.toolInfo.toolDiameter = dia;
            op._fromDefault = false;
            applyToolChange();
          }
        });

        angleInput.on('change', function() {
          var angle = parseFloat($(this).val());
          if (angle > 0) {
            op.toolInfo.vbitAngle = angle;
            op._fromDefault = false;
            applyToolChange();
          }
        });

        toolRow.append(typeSelect).append(diaInput).append(diaLabel).append(angleWrap);
        entry.append(toolRow);

        // Click on name to highlight this operation green, grey out the rest.
        // Click again to clear highlighting.
        nameSpan.on('click', function(e) {
          e.preventDefault();
          var wasActive = entry.hasClass('active');
          list.find('.op-entry').removeClass('active');

          if (wasActive) {
            if (self.path && self.path.highlightSourceLineRange) {
              self.path.highlightSourceLineRange(null, null);
            }
          } else {
            entry.addClass('active');
            if (self.path && self.path.highlightSourceLineRange) {
              self.path.highlightSourceLineRange(op.startLine - 1, op.endLine - 1);
              if (self.path.moveTime !== undefined) {
                self.gui.updateTimeline(self.path.moveTime);
              }
            }
          }
        });

        // Toggle toolpath visibility — reload path with only selected operations' GCode
        checkbox.on('change', function() {
          self.reloadForSelectedOperations(self.getSelectedOperationIndices());
        });

        list.append(entry);
      })(i);
    }

    // Toggle all / none
    $toggleAll.off('click').on('click', function() {
      var checkboxes = list.find('input[type="checkbox"]');
      var allChecked = checkboxes.length === checkboxes.filter(':checked').length;
      checkboxes.prop('checked', !allChecked);
      // Single reload instead of triggering each checkbox individually
      self.reloadForSelectedOperations(self.getSelectedOperationIndices());
    });

    console.log('Operations panel: ' + ops.length + ' operations');
  };

  self.getSelectedOperationIndices = function() {
    var indices = [];
    $('#ops-list input[type="checkbox"]:checked').each(function() {
      indices.push(parseInt($(this).attr('data-op-index')));
    });
    return indices.sort(function(a, b) { return a - b; });
  };

  // Get the file path that will be displayed; "bounds" comes from this work
  self.setGCode = function(gcode) {
    self.originalGCode = gcode;  // Store for operation filtering
    self.reloadGCode(gcode);
  }

  // Reload the path from GCode text (used for initial load and operation filtering)
  self.reloadGCode = function(gcode) {
    // Clean up existing material before loading new path
    if (self.material && self.material.reset) {
      console.log('Cleaning up previous material before new load');
      self.material.reset();
    }
    // Clear existing path geometry
    if (self.path.clearPath) {
      self.path.clearPath();
    }

    self.path.load(gcode, pathLoaded);
  }

  // Filter GCode to only lines whose N-word source line falls within
  // the selected operation ranges, then reload the path.
  // Ranges are 0-based source lines (matching move.sourceLine = pc).
  self.reloadForSelectedOperations = function(selectedOps) {
    if (!self.originalGCode || !self.operations) return;

    // If all operations selected, just reload the original
    if (!selectedOps || selectedOps.length === self.operations.length) {
      self.reloadGCode(self.originalGCode);
      return;
    }

    if (selectedOps.length === 0) {
      // Nothing selected — clear the path
      if (self.path.clearPath) self.path.clearPath();
      return;
    }

    // Build list of 0-based source line ranges for selected operations
    var ranges = [];
    for (var i = 0; i < selectedOps.length; i++) {
      var op = self.operations[selectedOps[i]];
      ranges.push({ start: op.startLine - 1, end: op.endLine - 1 });
    }

    // Filter GCode lines: keep lines with no N-word (setup/units) or
    // with N-word mapping to a selected operation's source line range
    var gcodeLines = self.originalGCode.split('\n');
    var filtered = [];
    for (var i = 0; i < gcodeLines.length; i++) {
      var line = gcodeLines[i];
      // Extract N-word value
      var nMatch = line.match(/^N(\d+)\s/);
      if (!nMatch) {
        // Lines without N-word (shouldn't happen in SBP-compiled GCode, but keep them)
        filtered.push(line);
        continue;
      }
      var sourceLine = parseInt(nMatch[1]) - 20;  // N = pc + 20
      // Check if this source line is in any selected operation range
      var inRange = false;
      for (var r = 0; r < ranges.length; r++) {
        if (sourceLine >= ranges[r].start && sourceLine <= ranges[r].end) {
          inRange = true;
          break;
        }
      }
      if (inRange) {
        filtered.push(line);
      }
    }

    console.log('Filtered GCode: ' + filtered.length + ' of ' + gcodeLines.length + ' lines for ' + selectedOps.length + ' operations');
    self.reloadGCode(filtered.join('\n'));
  };


  self.isMetric = function () {
    switch (self.units) {
    case 'mm': return true;
    case 'in': return false;
    default: return self.path.metric;
    }
  }


  self.setMetric = function (metric) {
    if (self.path && self.path.bounds) {
      self.dims.update(self.path.bounds, metric);
      self.grid.update(tableBounds, metric);
      self.table.update(tableBounds, metric);
    }
  }

  // Setting from within file here
  self.setPathMetric = function (metric) {
    self.setMetric(metric);
  }


  // Initially set Units and Location to current machine values 
  self.setUnits = function (units, status) {             
    self.units = units;
    self.setMetric(self.isMetric());
    self.path.metric = (self.isMetric());
    if (status) {self.path.position = [status.posx, status.posy, status.posz]};
  }


  self.updateStatus = function(line, position) {
    // TODO this is a problem as the line number being reported is a relatively arbitrary
    // ... gcode N number, not the actual line number in the file
    // ... and the previewer lines are just an array of lines that are previewer executable
    // ... which does not include a number of sbp type lines
    // SO ... as a very crude first approximation, we just look for the gcode start and go from there
    // DO THAT BY Extracting the line number from the first element of the gcode array
  
  
    if (!self.path || !self.path.loaded || !self.path.gcode || !self.path.gcode.length) return;
    if (!self.nLineMap || !line) return;

    // Subtract the planner buffer compensation (in N-numbers).
    // For GCode files: 1 N-number = 1 gcode line, so comp=20 means "show 20 lines behind planner"
    // For SBP files:   1 N-number = 1 SBP command, so comp=5 means "5 commands behind planner"
    var comp = parseInt(cookie.get('planner-lookahead', 5));
    var targetN = line - comp;

    // Backward search: find the largest N <= targetN that has a mapped move.
    // Handles gaps from preamble lines (no motion), non-motion commands, etc.
    var moveIdx;
    var limit = 200;
    for (var n = targetN; n >= 0 && limit-- > 0; n--) {
      if (n in self.nLineMap) {
        moveIdx = self.nLineMap[n];
        break;
      }
    }

    if (moveIdx === undefined) moveIdx = 0;
    if (moveIdx >= self.path.moves.length) moveIdx = self.path.moves.length - 1;

    // setMoveLinePosition handles the fine positioning within the move using
    // the reported hardware coordinates — pins the preview icon to actual position
    var moveLine = self.path.moves[moveIdx].getLine();
    self.path.setMoveLinePosition(moveLine, position);

    // Show both GCode and (when this is an SBP-derived run) SBP source line.
    if (self.path.setCurrentLine) {
      var liveMove = self.path.moves[moveIdx];
      self.path.setCurrentLine(
        liveMove.getLine(),
        self.isSBP ? liveMove.sourceLine : undefined
      );
    }
  }
  
  // Called when G2 finishes streaming (state leaves 'running' while job exists).
  // Animates the remaining moves in the planner buffer before any modal appears.
  self.finishLive = function() {
    self.path.play();
  }

  self.jobStarted = function () {container.addClass('live')}

  self.jobEnded = function () {
    // If finishLive() animation is still running, let it finish naturally.
    // If not (e.g. direct-to-idle with no pause), jump to end instantly.
    if (typeof self.path.animationFrame === 'undefined') {
      self.path.setMoveToEnd();
    }
    container.removeClass('live');
  }

  function updatePosition (position) {
    self.tool.setPosition(position);
    if (self.gui) self.gui.updateTimeline(self.path.moveTime);
    self.refresh();
  }

  // Renderer
  self.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  self.renderer.domElement.style.zIndex = 1;
  container.append(self.renderer.domElement);

  self.renderer.setClearColor(0xebebeb);
  self.renderer.setPixelRatio(window.devicePixelRatio);

  self.scene = new THREE.Scene();

  // Camera
  self.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);  // 3rd param is near plane
  self.camera.up.set(0, 0, 1);

  // Store reference to perspective camera
  self.perspectiveCamera = self.camera;

  // Create orthographic camera
  var frustumSize = 100;
  self.orthoNearClip = -100;  // Make it a property of self so it's accessible everywhere
  self.orthographicCamera = new THREE.OrthographicCamera(
    -frustumSize / 2,
    frustumSize / 2,
    frustumSize / 2,
    -frustumSize / 2,
    self.orthoNearClip,    // Near plane (can be negative)
    10000             // Far plane
  );
  self.orthographicCamera.up.set(0, 0, 1);
  self.orthographicCamera.position.set(100, 100, 100);
  
  // Initialize view mode from saved preference (default to perspective)
  var savedView = cookie.get('view-mode', 'perspective');  // Changed from 'fabmo-previewer-view'
  self.isOrtho = (savedView === 'ortho');
  
  // Set initial camera based on saved preference
  if (self.isOrtho) {
    self.camera = self.orthographicCamera;
    self.orthographicCamera.zoom = 2.0;
    self.orthographicCamera.near = self.orthoNearClip;
    self.orthographicCamera.updateProjectionMatrix();
    container.addClass('ortho-mode');
  } else {
    self.camera = self.perspectiveCamera;
    container.removeClass('ortho-mode');
  }

  // Controls
  self.controls =
    new THREE.OrbitControls(self.camera, self.renderer.domElement);
  self.controls.damping = 0.2;
  self.controls.enableKeys = false;
  self.controls.addEventListener('change', render);
  
  // Save view state when controls change (with debounce)
  var saveTimer = null;
  self.controls.addEventListener('end', function() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function() {
      self.saveViewState();
    }, 500); // Save 500ms after user stops moving
  });

  // Method to save current view state
  self.saveViewState = function() {
    var viewState = {
      mode: self.isOrtho ? 'ortho' : 'perspective',
      position: {
        x: self.camera.position.x,
        y: self.camera.position.y,
        z: self.camera.position.z
      },
      target: {
        x: self.controls.target.x,
        y: self.controls.target.y,
        z: self.controls.target.z
      },
      zoom: self.camera.zoom
    };
    cookie.set('view-state', JSON.stringify(viewState));  // Changed from 'fabmo-previewer-view-state'
    cookie.set('view-mode', viewState.mode);              // Changed from 'fabmo-previewer-view'
  };

  // Method to restore saved view state
  self.restoreViewState = function() {
    try {
      var viewStateStr = cookie.get('view-state');  // Changed from 'fabmo-previewer-view-state'
      if (!viewStateStr) return false;
      
      var viewState = JSON.parse(viewStateStr);
      
      // Make sure we're using the right camera before restoring
      if (viewState.mode !== (self.isOrtho ? 'ortho' : 'perspective')) {
        return false;
      }
      
      if (viewState.position) {
        self.camera.position.set(
          viewState.position.x,
          viewState.position.y,
          viewState.position.z
        );
      }
      
      if (viewState.target) {
        self.controls.target.set(
          viewState.target.x,
          viewState.target.y,
          viewState.target.z
        );
      }
      
      if (viewState.zoom && self.isOrtho) {
        self.orthographicCamera.zoom = viewState.zoom;
        self.orthographicCamera.updateProjectionMatrix();
      }
      
      self.controls.update();
      return true;
    } catch (e) {
      console.warn('Could not restore view state:', e);
      return false;
    }
  };

  // Lights
  self.light2 = new THREE.DirectionalLight(0xffffff, 0.4);
  self.scene.add(self.light2);
  // The DirectionalLight target must be in the scene for its world matrix
  // to update — required so lightAzimuth/lightElevation correctly control
  // the direction relative to the scene center (not just origin).
  self.scene.add(self.light2.target);
  // Dedicated top-down key light. Drives the wall-vs-top contrast on the
  // material mesh: tops face it, walls don't.
  var topLight = new THREE.DirectionalLight(0xffffff, 0.9);
  topLight.position.set(0, 0, 1);
  self.scene.add(topLight);
  self.scene.add(new THREE.AmbientLight(0x404040));

  function applyLightDirectionToMaterial() {
    if (self.material && self.material.setLightDirection) {
      self.material.setLightDirection(self.lightAzimuth, self.lightElevation);
    }
  }

  util.connectSetting('light-azimuth', self.lightAzimuth, function (v) {
    self.lightAzimuth = parseFloat(v);
    cookie.set('light-azimuth', self.lightAzimuth);
    updateLights();
    applyLightDirectionToMaterial();
    self.refresh();
  });
  util.connectSetting('light-elevation', self.lightElevation, function (v) {
    self.lightElevation = parseFloat(v);
    cookie.set('light-elevation', self.lightElevation);
    updateLights();
    applyLightDirectionToMaterial();
    self.refresh();
  });

  // Widgets
  self.dims = new Dimensions(self.scene, self.refresh);
  self.grid = new Grid(self.scene, self.refresh);
  self.table = new Table(self.scene, self.refresh);
  self.axes = new Axes(self.scene, self.refresh);
  self.tool = new Tool(self.scene, self.refresh);
  self.pointcloud = new PointCloud(self.scene, self.refresh);
  self.material = new Material(self.scene, self.refresh);

  // Path - Create WITH material callbacks
  self.path = new Path(self.scene, {
    metric: self.setPathMetric,
    progress: pathProgress,
    position: updatePosition,
    update: self.refresh,
    materialUpdate: function(start, end, isArcSegment) {
      if (!self.material) return;

      self.material.removeMaterial(start, end, 'flat', isArcSegment);
    },
    materialToolChange: function(toolInfo) {
      if (!self.material || !toolInfo) return;
      if (toolInfo.toolDiameter) self.material.setSimToolDiameter(toolInfo.toolDiameter);
      if (toolInfo.toolType) self.material.setSimToolType(toolInfo.toolType);
      if (toolInfo.vbitAngle) self.material.setSimVbitAngle(toolInfo.vbitAngle);
    },
    materialComputeFromSegments: function(segments, onProgress, onDone) {
      if (self.material) {
        if (onProgress || onDone) {
          self.material.computeFromSegmentsAsync(segments, onProgress, onDone);
        } else {
          self.material.computeFromSegments(segments);
        }
      }
    },
    materialForceUpdate: function(useSparse) {
      if (self.material) {
        self.material.forceUpdate(useSparse);
      }
    },
    materialResetHeights: function() {
      if (self.material) {
        self.material.resetHeights();
      }
    }
  });

  // Initialize camera position BEFORE path loads
  // This prevents the "jump" effect
  var initialViewState = cookie.get('view-state');  // Changed from 'fabmo-previewer-view-state'
  if (initialViewState) {
    try {
      var parsed = JSON.parse(initialViewState);
      if (parsed.position) {
        self.camera.position.set(parsed.position.x, parsed.position.y, parsed.position.z);
      }
      if (parsed.target) {
        self.controls.target.set(parsed.target.x, parsed.target.y, parsed.target.z);
      }
      if (parsed.zoom && self.isOrtho) {
        self.orthographicCamera.zoom = parsed.zoom;
        self.orthographicCamera.updateProjectionMatrix();
      }
      self.controls.update();
    } catch (e) {
      console.warn('Could not apply initial view state:', e);
    }
  }

  self.refresh();

  // Add the GUI
  var callbacks = {
    showX: function() {snapPlane('yz')},
    showY: function() {snapPlane('xz')},
    showZ: function() {snapPlane('xy')},
    showISO: function() {snapPlane()},
    toggleView: self.toggleView,  // ADD THIS LINE
    play: function() {self.path.play()},
    pause: function() {self.path.pause()},
    reset: function() {self.path.reset()},
    scrub: function(time) {
      self.path.pause();
      self.path.setMoveTime(time);
    },
    getZoomRange: function() {
      if (!self.path || !self.path.moves.length) return null;
      var moves = self.path.moves;
      var idx = self.path.lastMove;
      if (idx < 0 || idx >= moves.length) return null;
      var currentLine = moves[idx].sourceLine;
      var lineRange = 100;
      var minLine = currentLine - lineRange;
      var maxLine = currentLine + lineRange;

      var startTime = null;
      var endTime = null;
      for (var i = 0; i < moves.length; i++) {
        var line = moves[i].sourceLine;
        if (line >= minLine && line <= maxLine) {
          var t0 = moves[i].getStartTime();
          var t1 = moves[i].getEndTime();
          if (startTime === null || t0 < startTime) startTime = t0;
          if (endTime === null || t1 > endTime) endTime = t1;
        }
      }
      if (startTime === null) return null;
      return { startTime: startTime, endTime: endTime };
    },
    showGrid: self.grid.setShow,
    showDims: self.dims.setShow,
    showAxes: self.axes.setShow,
    showTool: self.tool.setShow,
    showPointCloud: self.pointcloud.setShow,
    showMaterial: self.material.setShow,
    showToolpath: self.path.setShow,
    setMaterialOpacity: self.material.setOpacity,
    setMaterialResolution: self.material.setResolution,
    resetMaterial: self.material.reset,
    setInPoint: function() {
      if (!self.path || !self.path.loaded) return;
      var time = self.path.moveTime;
      var moveIdx = self.path.lastMove;
      var move = self.path.moves[moveIdx];
      if (!move) return;
      // 1-based: SBP source line = pc+1; GCode line is already 1-based.
      var srcLine = self.path.hasSourceLines ? (move.sourceLine + 1) : move.getLine();
      self.gui.setInPoint(time, srcLine, moveIdx);
    },
    setOutPoint: function() {
      if (!self.path || !self.path.loaded) return;
      var time = self.path.moveTime;
      var moveIdx = self.path.lastMove;
      var move = self.path.moves[moveIdx];
      if (!move) return;
      var srcLine = self.path.hasSourceLines ? (move.sourceLine + 1) : move.getLine();
      self.gui.setOutPoint(time, srcLine, moveIdx);
    },
    stepForward: function() {
      if (!self.path || !self.path.loaded || !self.path.moves.length) return;
      var moves = self.path.moves;
      var idx = self.path.lastMove;
      var currentLine = moves[idx].sourceLine;

      // Find next move with a different sourceLine
      for (var i = idx + 1; i < moves.length; i++) {
        if (moves[i].sourceLine !== currentLine) {
          self.path.pause();
          self.path.setMoveTime(moves[i].startTime);
          if (self.gui) self.gui.updateTimeline(moves[i].startTime);
          self.refresh();
          return;
        }
      }
    },

    stepBackward: function() {
      if (!self.path || !self.path.loaded || !self.path.moves.length) return;
      var moves = self.path.moves;
      var idx = self.path.lastMove;
      var currentLine = moves[idx].sourceLine;

      // Skip back to start of current line group
      var i = idx;
      while (i > 0 && moves[i - 1].sourceLine === currentLine) i--;

      // Now go to the previous line group
      if (i > 0) {
        var prevLine = moves[i - 1].sourceLine;
        // Find start of that previous line group
        while (i > 1 && moves[i - 2].sourceLine === prevLine) i--;
        i--;
        self.path.pause();
        self.path.setMoveTime(moves[i].startTime);
        if (self.gui) self.gui.updateTimeline(moves[i].startTime);
        self.refresh();
      }
    },

    skipToCutStart: function() {
      if (!self.path || !self.path.loaded || !self.path.moves.length) return;
      var moves = self.path.moves;
      var idx = self.path.lastMove;
      var Z_THRESHOLD = 0.01;

      // Search backward for a plunge move (Z decreasing significantly, into material)
      for (var i = idx - 1; i >= 0; i--) {
        var zDelta = moves[i].end[2] - moves[i].start[2];
        if (zDelta < -Z_THRESHOLD) {
          self.path.pause();
          self.path.setMoveTime(moves[i].startTime);
          if (self.gui) self.gui.updateTimeline(moves[i].startTime);
          self.refresh();
          return;
        }
      }
    },

    skipToCutEnd: function() {
      if (!self.path || !self.path.loaded || !self.path.moves.length) return;
      var moves = self.path.moves;
      var idx = self.path.lastMove;
      var Z_THRESHOLD = 0.01;

      // Search forward for a retract move (Z increasing significantly, out of material)
      for (var i = idx + 1; i < moves.length; i++) {
        var zDelta = moves[i].end[2] - moves[i].start[2];
        if (zDelta > Z_THRESHOLD) {
          self.path.pause();
          self.path.setMoveTime(moves[i].startTime);
          if (self.gui) self.gui.updateTimeline(moves[i].startTime);
          self.refresh();
          return;
        }
      }
    },

    inOutChanged: function(inPt, outPt) {
      // Toggle submit-trimmed button visibility
      if (inPt || outPt) {
        container.addClass('has-selection');
      } else {
        container.removeClass('has-selection');
      }
      // Dim toolpath segments outside the in/out range
      if (!self.path || !self.path.moves.length) return;
      var moves = self.path.moves;
      for (var i = 0; i < moves.length; i++) {
        var inside = true;
        if (inPt && i < inPt.moveIndex) inside = false;
        if (outPt && i > outPt.moveIndex) inside = false;
        if (inPt || outPt) {
          // Dim outside segments, normal inside
          var m = moves[i];
          if (!inside) {
            m.setColor([0.3, 0.3, 0.3]);  // dim gray
          } else {
            // Restore original color based on done/rapid state
            m.setDone(false);  // reset to default color
          }
        } else {
          // No in/out set — restore all
          moves[i].setDone(false);
        }
      }
      self.refresh();
    }
  };

  self.gui = new Gui(callbacks);

  // Public accessor for in/out points (used by app.js for job submission)
  self.getInOutPoints = function() {
    return self.gui.getInOut();
  };

  // --- Toolpath hover/click interaction ---
  var raycaster = new THREE.Raycaster();
  // Line.threshold is recomputed per pick in findMoveUnderMouse to stay
  // at ~6 px regardless of zoom; the default value is unused.
  var mouse = new THREE.Vector2();
  var hoveredMove = null;
  var hoverThrottle = null;
  var mouseDownPos = null;
  var canvas = self.renderer.domElement;

  function getMouseNDC(event) {
    var rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function findMoveUnderMouse(event) {
    if (!self.path || !self.path.obj || !self.path.obj.visible) return null;
    if (!self.path.loaded) return null;
    getMouseNDC(event);
    raycaster.setFromCamera(mouse, self.camera);
    // Scale the line-pick tolerance to a constant screen radius (~6 px),
    // otherwise zoomed-out views miss most segments and zoomed-in views
    // grab many at once. For perspective use camera→target distance;
    // for ortho use the visible frustum height.
    var pixelRadius = 6;
    var canvasH = canvas.clientHeight || 1;
    var worldPerPixel;
    if (self.camera.isOrthographicCamera) {
      var visH = (self.camera.top - self.camera.bottom) / (self.camera.zoom || 1);
      worldPerPixel = visH / canvasH;
    } else {
      var dist = self.camera.position.distanceTo(self.controls.target);
      worldPerPixel = 2 * dist * Math.tan((self.camera.fov * Math.PI / 180) / 2) / canvasH;
    }
    // This bundled three.js still consults the legacy `linePrecision` field
    // for Line.raycast (default 1 world unit), so set it alongside the
    // modern params.Line.threshold to cover both code paths.
    var threshold = pixelRadius * worldPerPixel;
    raycaster.params.Line.threshold = threshold;
    raycaster.linePrecision = threshold;
    var intersects = raycaster.intersectObject(self.path.obj, true);
    if (intersects.length === 0) return null;
    // Only pick cuts. Rapids draw above the material and visually block
    // the cut segments below, so including them in hover/click would
    // surface the wrong move whenever a jog passes over a cut.
    for (var i = 0; i < intersects.length; i++) {
      var m = self.path.getMoveAtIntersection(intersects[i].object, intersects[i].index);
      if (m && !m.rapid) return m;
    }
    return null;
  }

  canvas.addEventListener('mousemove', function(event) {
    // Don't show hover during playback (it flickers with the playback line display)
    if (container.hasClass('running')) return;

    // Throttle to ~15fps to avoid bogging down the Pi
    if (hoverThrottle) return;
    hoverThrottle = setTimeout(function() { hoverThrottle = null; }, 66);

    var move = findMoveUnderMouse(event);
    if (move) {
      if (hoveredMove !== move) {
        if (hoveredMove) hoveredMove.setColor(hoveredMove.rapid ? [1,0,0] : [0,1,0]);
        hoveredMove = move;
        move.setColor([1, 1, 1]);  // glow
        var label = 'GC ' + move.getLine().toLocaleString();
        if (self.path.hasSourceLines) {
          label += '  /  SBP ' + (move.sourceLine + 1).toLocaleString();
        }
        self.path.codeLine.text(label);
        canvas.style.cursor = 'pointer';
        self.refresh();
      }
    } else if (hoveredMove) {
      hoveredMove.setColor(hoveredMove.rapid ? [1,0,0] : [0,1,0]);
      hoveredMove = null;
      self.refresh();
      self.path.codeLine.text('');
      canvas.style.cursor = '';
    }
  });

  // Track mousedown to distinguish clicks from drags
  canvas.addEventListener('mousedown', function(event) {
    mouseDownPos = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener('click', function(event) {
    // Ignore if user dragged (was rotating/panning, not clicking)
    if (mouseDownPos) {
      var dx = event.clientX - mouseDownPos.x;
      var dy = event.clientY - mouseDownPos.y;
      if (dx * dx + dy * dy > 25) return;  // 5px threshold
    }

    var move = findMoveUnderMouse(event);
    if (!move) return;

    // Jump timeline to this move's start time
    var time = move.getStartTime();
    self.path.pause();
    self.path.setMoveTime(time);
    if (self.gui) {
      self.gui.updateTimeline(time);
    }
    self.refresh();
  });

  // Units
  util.connectSetting('units', self.units, self.setUnits);

  // Planner lookahead compensation
  util.connectSetting('planner-lookahead', parseInt(cookie.get('planner-lookahead', 5)), function(v) {
      cookie.set('planner-lookahead', v);
  });

  // Add method to load point cloud from config
  self.loadPointCloud = function(config) {
    if (config && config.opensbp && config.opensbp.transforms &&
        config.opensbp.transforms.level && config.opensbp.transforms.level.apply) {
      var filePath = config.opensbp.transforms.level.ptDataFile;
      self.pointcloud.loadFromFile(filePath);
    }
  };
  
  /**
   * Cleanup entire viewer when app exits
   */
  self.cleanup = function() {
    
    // 1. Cleanup material first
    if (self.material && self.material.destroy) {
      self.material.destroy();
    }
    
    // 2. Cleanup path (most complex - has many geometries)
    if (self.path && self.path.obj) {
      self.scene.remove(self.path.obj); // FIXED: was 'scene', now 'self.scene'
      
      // Dispose all path geometries and materials
      self.path.obj.traverse(function(child) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => {
              if (mat.map) mat.map.dispose();
              mat.dispose();
            });
          } else {
            if (child.material.map) child.material.map.dispose();
            child.material.dispose();
          }
        }
      });
      
      // Clear path buffers
      if (self.path.buffers) {
        self.path.buffers.forEach(function(buffer) {
          if (buffer[0] && buffer[0].dispose) buffer[0].dispose();
          if (buffer[1] && buffer[1].dispose) buffer[1].dispose();
        });
        self.path.buffers = [];
      }
    }
    
    // 3. Cleanup other scene objects
    var objectsToRemove = [
      self.dims && self.dims.group,
      self.grid && self.grid.grid,
      self.table && self.table.table,
      self.axes && self.axes.mesh,
      self.tool && self.tool.mesh,
      self.pointcloud && self.pointcloud.mesh,
      self.path && self.path.currentLine
    ];
    
    objectsToRemove.forEach(function(obj) {
      if (obj) {
        self.scene.remove(obj); // FIXED: was 'scene'
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(mat => mat.dispose());
          } else {
            obj.material.dispose();
          }
        }
      }
    });
    
    // 4. Clear the entire scene recursively
    while(self.scene.children.length > 0) { // FIXED: was 'scene'
      var obj = self.scene.children[0]; // FIXED: was 'scene'
      self.scene.remove(obj); // FIXED: was 'scene'
      
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(mat => {
            if (mat.map) mat.map.dispose();
            mat.dispose();
          });
        } else {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      }
      
      // Recursively dispose children
      if (obj.children) {
        obj.traverse(function(child) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      }
    }
    
    // 5. CRITICAL: Force WebGL context loss and dispose renderer
    if (self.renderer) {
      // Get the WebGL context
      var gl = self.renderer.getContext();
      
      // Dispose all render targets
      self.renderer.renderLists.dispose();
      
      // Clear any cached programs
      if (self.renderer.info && self.renderer.info.programs) {
        self.renderer.info.programs.length = 0;
      }
      
      // Dispose renderer
      self.renderer.dispose();
      
      // FORCE context loss (critical for memory release)
      if (gl) {
        var loseContext = gl.getExtension('WEBGL_lose_context');
        if (loseContext) {
          loseContext.loseContext();
        }
      }
      
      // Remove canvas from DOM
      if (self.renderer.domElement && self.renderer.domElement.parentNode) {
        self.renderer.domElement.parentNode.removeChild(self.renderer.domElement);
      }
      
      self.renderer = null;
    }
    
    // 6. Cleanup controls
    if (self.controls) {
      self.controls.dispose();
      self.controls = null;
    }
    
    // 7. Null out all references
    self.camera = null;
    self.scene = null;
    self.path = null;
    self.material = null;
    self.dims = null;
    self.grid = null;
    self.table = null;
    self.axes = null;
    self.tool = null;
    self.pointcloud = null;
    self.gui = null;
    
    console.log('=== VIEWER CLEANUP COMPLETE ===');
    
    // 8. FORCE garbage collection hint (non-standard but helps in some browsers)
    if (window.gc) {
      console.log('Suggesting garbage collection...');
      window.gc();
    }
  };

  // Material update callback - processes path moves and updates material
  function materialUpdate(start, end, isArc) {
    if (!self.material) return;
    
    // CHANGED: Handle arcs differently from lines
    if (isArc) {
      var currentMove = self.path.moves[self.path.lastMove];
      
      console.log('Arc detected! Move type:', currentMove ? currentMove.type : 'undefined');
      console.log('Arc center:', currentMove ? currentMove.arcCenter : 'undefined');
      console.log('Arc radius:', currentMove ? currentMove.arcRadius : 'undefined');
      
      if (currentMove && currentMove.type === 'arc') {
        var arcLength = currentMove.getLength();
        var samplesPerInch = 20;
        var numSamples = Math.max(10, Math.ceil(arcLength * samplesPerInch));
        
        console.log('Sampling arc with', numSamples, 'samples');
        
        var prevPos = start;
        
        for (var i = 1; i <= numSamples; i++) {
          var t = i / numSamples;
          var segTime = currentMove.startTime + t * currentMove.getDuration();
          var currentPos = currentMove.getPositionAt(segTime);
          
          if (!currentPos) {
            console.error('getPositionAt returned undefined at t=', t);
            continue;
          }
          
          self.material.removeMaterial(prevPos, currentPos, 'flat');
          prevPos = currentPos;
        }
      } else {
        console.warn('Arc flagged but no arc metadata found, using fallback');
        self.material.removeMaterial(start, end, 'flat');
      }
    } else {
      // Linear move: process normally
      self.material.removeMaterial(start, end, 'flat');
    }
  }

};
