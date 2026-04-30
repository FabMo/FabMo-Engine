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
    // In AR / overhead mode the camera is positioned manually (custom pose
    // from calibration or an explicit top-down ortho) and OrbitControls is
    // disabled. Calling controls.update() here would snap the camera back
    // onto its spherical math against a stale target/up, flipping the
    // render off the AR pose — visible whenever something inside a module
    // (e.g. material.disposeMesh) calls back into refresh during a rebuild.
    if (!self.ar || (!self.ar.enabled && !self.ar.overhead)) {
      self.controls.update();
    }
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

  self.setSoftLimits = function (envelope, g55x, g55y, g55z, units) {
      softLimits = {
          envelope: envelope,
          g55: { x: g55x || 0, y: g55y || 0, z: g55z || 0 },
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

      // Z ceiling is fixed at machine_z = 0 (homed top) regardless of envelope.zmax.
      // No Z min check — low Z in a CAM file is cut depth and depends on bit length.
      var bMaxZ = bounds.max.z;
      if (typeof bMaxZ === 'number') {
          var machineMaxZ = bMaxZ + g55.z;
          if (machineMaxZ > 0) {
              violations.push({ axis: 'z', direction: 'max', overage: machineMaxZ });
          }
      }
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
    if (self.ar && (self.ar.enabled || self.ar.overhead)) {
      if (self._syncAROverlayDims) self._syncAROverlayDims();
      if (typeof _renderCalHandles === 'function' && self.ar.calibrating) _renderCalHandles();
      // While entering or animating AR/overhead, skip camera setup so
      // the in-flight transition can interpolate from / to the right
      // poses without being snapped to ortho or AR each resize tick.
      if (!self.ar._entering && !self.ar._animating) {
        if (typeof _setTopDownCamera === 'function') _setTopDownCamera();
        if (self.ar.overhead) {
          if (typeof _applyOverheadWarp === 'function') _applyOverheadWarp();
        } else {
          if (typeof _applyHomography === 'function') _applyHomography();
        }
      }
    }
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
  
  // ---------- AR overlay ----------------------------------------------------
  //
  // Stage 1 (CSS matrix3d homography on a top-down render):
  //  - Lock the camera to top-down ortho framing the envelope.
  //  - Render with a transparent background; show the live MJPEG behind.
  //  - Compute a 2D homography from where the envelope corners actually project
  //    on the canvas → where the user clicked the same corners on the video,
  //    and apply it to the canvas as `transform: matrix3d(...)`.
  //  - Calibration is saved as fractions of the preview container (resize-safe
  //    since the video and canvas both fill the container at all times).
  //
  // Z-elevated motion is approximated as if it were on the table plane in this
  // stage; Stage 2 will replace the CSS warp with a proper 3D camera pose.

  self.ar = {
      enabled: false,          // perspective AR (3D camera pose)
      overhead: false,         // un-warped top-down view (matrix3d on the video)
      calibrating: false,
      cameraPort: null,
      corners: null,           // persisted {tl, tr, br, bl} as {x,y} fractions [0..1]
      _draftCorners: null,     // working copy during drag-to-calibrate
      _backupCorners: null,    // pre-calibration snapshot for Cancel
      _dragging: null,
      _savedView: null,
      // 2D zoom/pan applied as CSS transform on top of the AR composite
      // (canvas + video + calibration overlay). Doesn't change the 3D
      // camera or homography — just scales the rendered output.
      viewZoom: 1,
      viewPanX: 0,
      viewPanY: 0,
  };

  // 4-point homography from src quad → dst quad (both as [[x,y], ...] in TL,TR,BR,BL order).
  // Decomposes via the unit-square: H = H_dst * H_src^-1 where each H_* maps
  // the unit square (0,0)→(1,0)→(1,1)→(0,1) to its quad. Closed-form, no SVD.
  function _h_squareToQuad(p) {
      var dx1 = p[1][0] - p[2][0],  dx2 = p[3][0] - p[2][0],  sx = p[0][0] - p[1][0] + p[2][0] - p[3][0];
      var dy1 = p[1][1] - p[2][1],  dy2 = p[3][1] - p[2][1],  sy = p[0][1] - p[1][1] + p[2][1] - p[3][1];
      var det = dx1 * dy2 - dx2 * dy1;
      var g = (sx * dy2 - dx2 * sy) / det;
      var h = (dx1 * sy - sx * dy1) / det;
      return [
          [p[1][0] - p[0][0] + g * p[1][0], p[3][0] - p[0][0] + h * p[3][0], p[0][0]],
          [p[1][1] - p[0][1] + g * p[1][1], p[3][1] - p[0][1] + h * p[3][1], p[0][1]],
          [g, h, 1],
      ];
  }
  function _h_inverse3(m) {
      var a = m[0][0], b = m[0][1], c = m[0][2];
      var d = m[1][0], e = m[1][1], f = m[1][2];
      var g = m[2][0], h = m[2][1], i = m[2][2];
      var det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
      return [
          [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
          [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
          [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
      ];
  }
  function _h_mul3(a, b) {
      var r = [[0,0,0],[0,0,0],[0,0,0]];
      for (var i = 0; i < 3; i++)
          for (var j = 0; j < 3; j++)
              r[i][j] = a[i][0]*b[0][j] + a[i][1]*b[1][j] + a[i][2]*b[2][j];
      return r;
  }
  function _h_quadToQuad(src, dst) {
      return _h_mul3(_h_squareToQuad(dst), _h_inverse3(_h_squareToQuad(src)));
  }
  // 3x3 H → 4x4 column-major for CSS matrix3d.
  function _h_toMatrix3d(H) {
      return 'matrix3d(' + [
          H[0][0], H[1][0], 0, H[2][0],
          H[0][1], H[1][1], 0, H[2][1],
          0,       0,       1, 0,
          H[0][2], H[1][2], 0, H[2][2],
      ].map(function (n) { return n.toFixed(8); }).join(',') + ')';
  }

  // Return the canvas pixel positions of the 4 grid corners by projecting
  // them through the current camera. With aspect-preserving framing the
  // corners are inside the canvas (letterboxed), not at the edges — but
  // that's fine: matrix3d uses these as the homography source and the
  // transparent letterbox regions warp to invisible extrapolations.
  function _envelopeCornersInCanvasPx() {
      var w = self.renderer.domElement.clientWidth;
      var h = self.renderer.domElement.clientHeight;
      var halfX = (tableBounds.max.x - tableBounds.min.x) / 2;
      var halfY = (tableBounds.max.y - tableBounds.min.y) / 2;
      var cx = tableBounds.loc.x;
      var cy = tableBounds.loc.y;
      var corners = [
          [cx - halfX, cy + halfY, 0],  // TL
          [cx + halfX, cy + halfY, 0],  // TR
          [cx + halfX, cy - halfY, 0],  // BR
          [cx - halfX, cy - halfY, 0],  // BL
      ];
      return corners.map(function (c) {
          var v = new THREE.Vector3(c[0], c[1], c[2]);
          v.project(self.camera);
          return [(v.x + 1) * 0.5 * w, (1 - v.y) * 0.5 * h];
      });
  }

  function _previewSize() {
      var c = self.renderer.domElement;
      return { w: c.clientWidth, h: c.clientHeight };
  }

  // The video/calibration overlays use `position: absolute` inside #preview,
  // but #preview has no explicit height — `height: 100%` resolves unpredictably.
  // Pin them to the renderer canvas's bounding box instead.
  function _syncAROverlayDims() {
      if (!self.ar.enabled && !self.ar.overhead) return;
      var c = self.renderer.domElement;
      var pRect = container[0].getBoundingClientRect();
      var rect = c.getBoundingClientRect();
      var css = {
          left:   (rect.left - pRect.left) + 'px',
          top:    (rect.top  - pRect.top)  + 'px',
          width:  rect.width  + 'px',
          height: rect.height + 'px',
      };
      container.find('.ar-video, .ar-video-bg, .ar-calibration').css(css);
  }
  self._syncAROverlayDims = _syncAROverlayDims;

  function _detectCamera(callback) {
      if (!window.FabMoVideo) return callback(null);
      window.FabMoVideo.detectCamera(1).then(function (ok) {
          if (ok) return callback(1);
          window.FabMoVideo.detectCamera(2).then(function (ok2) {
              callback(ok2 ? 2 : null);
          });
      });
  }

  function _videoUrl(port) {
      return 'http://' + window.location.hostname + ':' + (port === 2 ? 3142 : 3141) + '/?t=' + Date.now();
  }

  function _setTopDownCamera() {
      // Aspect-preserving top-down framing. Whichever axis fits the canvas
      // tightly determines scale; the other axis gets extra frustum (and the
      // canvas has transparent letterbox bands on that axis). The homography
      // warp uses the projected grid corners (inside the canvas, not at its
      // edges), so letterbox regions warp to invisible extrapolations and the
      // rendered grid stays at the correct aspect during calibration.
      var ex = tableBounds.max.x - tableBounds.min.x;
      var ey = tableBounds.max.y - tableBounds.min.y;
      // Grid is positioned at tableBounds.loc (see grid.js).
      var cx = tableBounds.loc.x;
      var cy = tableBounds.loc.y;
      var w = self.renderer.domElement.clientWidth || 1;
      var h = self.renderer.domElement.clientHeight || 1;
      // Pad the framing 10% in overhead mode so a bit of the area beyond
      // the table edges shows in the warped live video — useful context
      // for clamps/fixtures right at the table edge. Both the camera
      // framing AND the overhead warp use this so toolpath and live
      // video stay aligned. Calibration keeps the tighter framing.
      var pad = self.ar && self.ar.overhead ? 1.10 : 1.0;
      var spanX = ex * pad;
      var spanY = ey * pad;
      if (spanX / spanY > w / h) spanY = spanX * h / w;
      else                       spanX = spanY * w / h;
      // Shift the envelope leftward in overhead so the operations-panel
      // (top-right setup controls) doesn't sit on top of it. We bias the
      // camera frustum rightward in world coords by half the panel
      // width, which moves rendered world content (envelope + warped
      // video) left on the canvas by the same amount. Toolpath and video
      // share the camera so they shift together.
      var shiftWorld = 0;
      if (self.ar && self.ar.overhead) {
          var $panel = container.find('.operations-panel');
          if ($panel.length && $panel.is(':visible')) {
              var shiftPx = $panel.outerWidth() / 2;
              shiftWorld = shiftPx * (spanX / w);
          }
      }
      var cam = self.orthographicCamera;
      cam.left   = -spanX / 2 + shiftWorld;
      cam.right  =  spanX / 2 + shiftWorld;
      cam.top    =  spanY / 2;
      cam.bottom = -spanY / 2;
      cam.zoom = 1;
      cam.position.set(cx, cy, 100);
      cam.up.set(0, 1, 0);          // screen-up = +Y world
      cam.lookAt(new THREE.Vector3(cx, cy, 0));
      cam.near = -1000;
      cam.far  = 10000;
      cam.updateProjectionMatrix();
      self.camera = cam;
      self.controls.object = cam;
      self.controls.target.set(cx, cy, 0);
      self.controls.update();
  }

  // Stage 2: solve for a true 3D camera pose from the 4 world↔image corner
  // correspondences. The previous Stage 1 implementation warped a top-down
  // render with CSS matrix3d — correct for points on the z=0 plane but ignored
  // depth. Now we recover (R, t, f) so toolpath points above the table project
  // with the right perspective and the bit visibly lifts off the surface.
  //
  // Math (Zhang-style decomposition for coplanar points):
  //   • Compute 3x3 homography H from world (X, Y) → image (u, v).
  //   • Shift principal point to image center (subtract cx, cy in image rows).
  //   • For K = diag(f, f, 1) the columns r1 = K⁻¹h1 and r2 = K⁻¹h2 must be
  //     orthonormal. The orthogonality constraint r1·r2 = 0 gives one equation
  //     in one unknown (f), solvable in closed form.
  //   • Scale to enforce |r1| = 1 (rotation column unit length).
  //   • r3 = r1 × r2; Gram-Schmidt-orthogonalize r2 against r1 for numerical
  //     stability. Flip sign if t_z < 0 (table must be in front of camera).
  //   • Convert OpenCV pose to three.js: same +X axis, but +Y and +Z flip
  //     (three.js camera has +Y up and looks down -Z; OpenCV is +Y down,
  //     looking +Z).
  function _solveCameraPose() {
      var c = self.ar.calibrating ? self.ar._draftCorners : self.ar.corners;
      if (!c) return null;
      var w = self.renderer.domElement.clientWidth;
      var h = self.renderer.domElement.clientHeight;
      if (!w || !h) return null;
      var halfX = (tableBounds.max.x - tableBounds.min.x) / 2;
      var halfY = (tableBounds.max.y - tableBounds.min.y) / 2;
      var cwx = tableBounds.loc.x;
      var cwy = tableBounds.loc.y;
      // World corners (z=0), TL/TR/BR/BL with "top" = +Y world.
      var worldPts = [
          [cwx - halfX, cwy + halfY],
          [cwx + halfX, cwy + halfY],
          [cwx + halfX, cwy - halfY],
          [cwx - halfX, cwy - halfY],
      ];
      // Image corners in canvas pixels (y down).
      var imgPts = [
          [c.tl.x * w, c.tl.y * h],
          [c.tr.x * w, c.tr.y * h],
          [c.br.x * w, c.br.y * h],
          [c.bl.x * w, c.bl.y * h],
      ];

      var H = _h_quadToQuad(worldPts, imgPts);
      // Shift principal point: H' = T·H with T translating image origin to center.
      var pcx = w / 2, pcy = h / 2;
      var Hp = [
          [H[0][0] - pcx * H[2][0], H[0][1] - pcx * H[2][1], H[0][2] - pcx * H[2][2]],
          [H[1][0] - pcy * H[2][0], H[1][1] - pcy * H[2][1], H[1][2] - pcy * H[2][2]],
          [H[2][0],                 H[2][1],                 H[2][2]],
      ];
      var h1 = [Hp[0][0], Hp[1][0], Hp[2][0]];
      var h2 = [Hp[0][1], Hp[1][1], Hp[2][1]];
      var h3 = [Hp[0][2], Hp[1][2], Hp[2][2]];

      // f² from orthogonality: (h1x*h2x + h1y*h2y)/f² + h1z*h2z = 0.
      var num = -(h1[0]*h2[0] + h1[1]*h2[1]);
      var den = h1[2]*h2[2];
      var f;
      if (Math.abs(den) < 1e-9 || num / den <= 0) {
          // Near-degenerate (top-down ortho-like). Pick a sensible default.
          f = 2 * w;
      } else {
          f = Math.sqrt(num / den);
      }

      var m1 = [h1[0]/f, h1[1]/f, h1[2]];
      var m2 = [h2[0]/f, h2[1]/f, h2[2]];
      var m3 = [h3[0]/f, h3[1]/f, h3[2]];
      var len1 = Math.sqrt(m1[0]*m1[0] + m1[1]*m1[1] + m1[2]*m1[2]);
      if (len1 < 1e-9) return null;
      var lambda = 1 / len1;
      var r1 = [m1[0]*lambda, m1[1]*lambda, m1[2]*lambda];
      var r2 = [m2[0]*lambda, m2[1]*lambda, m2[2]*lambda];
      var t  = [m3[0]*lambda, m3[1]*lambda, m3[2]*lambda];

      var dot = r1[0]*r2[0] + r1[1]*r2[1] + r1[2]*r2[2];
      r2 = [r2[0] - dot*r1[0], r2[1] - dot*r1[1], r2[2] - dot*r1[2]];
      var r2len = Math.sqrt(r2[0]*r2[0] + r2[1]*r2[1] + r2[2]*r2[2]);
      if (r2len < 1e-9) return null;
      r2 = [r2[0]/r2len, r2[1]/r2len, r2[2]/r2len];

      var r3 = [
          r1[1]*r2[2] - r1[2]*r2[1],
          r1[2]*r2[0] - r1[0]*r2[2],
          r1[0]*r2[1] - r1[1]*r2[0],
      ];

      if (t[2] < 0) {
          r1 = [-r1[0], -r1[1], -r1[2]];
          r2 = [-r2[0], -r2[1], -r2[2]];
          r3 = [-r3[0], -r3[1], -r3[2]];
          t  = [-t[0],  -t[1],  -t[2]];
      }

      // Camera position C = -R⁻¹t = -Rᵀt. R col i = r_(i+1).
      var C = [
          -(r1[0]*t[0] + r1[1]*t[1] + r1[2]*t[2]),
          -(r2[0]*t[0] + r2[1]*t[1] + r2[2]*t[2]),
          -(r3[0]*t[0] + r3[1]*t[1] + r3[2]*t[2]),
      ];
      // three.js camera local axes in world. OpenCV→three.js flips Y and Z.
      var ex = [ r1[0],  r2[0],  r3[0]];
      var ey = [-r1[1], -r2[1], -r3[1]];
      var ez = [-r1[2], -r2[2], -r3[2]];

      return { ex: ex, ey: ey, ez: ez, C: C, f: f, w: w, h: h };
  }

  function _applyARCamera() {
      var pose = _solveCameraPose();
      if (!pose) {
          _setTopDownCamera();
          self.refresh();
          return;
      }
      var cam = self.perspectiveCamera;
      var rotMat = new THREE.Matrix4();
      rotMat.set(
          pose.ex[0], pose.ey[0], pose.ez[0], 0,
          pose.ex[1], pose.ey[1], pose.ez[1], 0,
          pose.ex[2], pose.ey[2], pose.ez[2], 0,
          0,          0,          0,          1
      );
      // Use lookAt + explicit up vector instead of quaternion. Equivalent
      // mathematically but avoids any subtle quaternion-extraction bugs in
      // bundled three.js r112. The homography solver treats world points
      // at z=0 as the calibration plane, which in the previewer is the
      // material top / cut surface — exactly what the user marked corners
      // against, so no z-shift is needed.
      cam.position.set(pose.C[0], pose.C[1], pose.C[2]);
      cam.up.set(pose.ey[0], pose.ey[1], pose.ey[2]);
      var fwd = [-pose.ez[0], -pose.ez[1], -pose.ez[2]];
      cam.lookAt(new THREE.Vector3(
          pose.C[0] + fwd[0],
          pose.C[1] + fwd[1],
          pose.C[2] + fwd[2]
      ));
      cam.fov = 2 * Math.atan(pose.h / (2 * pose.f)) * 180 / Math.PI;
      cam.aspect = pose.w / pose.h;
      cam.near = 0.01;
      cam.far = 100000;
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      self.camera = cam;
      self.controls.object = cam;
      // Re-apply the 2D view transform (zoom/pan) to the canvas; AR
      // perspective doesn't have a matrix3d on the video so this is
      // sufficient to keep zoom/pan applied to the composite output.
      _applyARViewTransform();
      self.renderer.render(self.scene, self.camera);
  }

  // Backwards-compat alias used by existing call sites in this module.
  function _applyHomography() { _applyARCamera(); }
  function _clearHomography() {
      self.renderer.domElement.style.transform = '';
      self.renderer.domElement.style.transformOrigin = '';
  }

  function _saveCalibration() {
      if (!window.fabmo || !self.ar.corners) return;
      window.fabmo.setConfig({
          machine: { cameraCalibration: {
              corners: self.ar.corners,
              port: self.ar.cameraPort || 0,
              savedAt: Date.now(),
              calibrated: true,
          }}
      }, function (err) {
          if (err) console.warn('AR calibration save failed:', err);
      });
  }

  function _loadCalibration(config) {
      var cal = config && config.machine && config.machine.cameraCalibration;
      if (cal && cal.calibrated && cal.corners && cal.corners.tl && cal.corners.tr && cal.corners.br && cal.corners.bl) {
          self.ar.corners = cal.corners;
          if (cal.port) self.ar.cameraPort = cal.port;
          if (typeof _refreshOverheadToggleVisibility === 'function') _refreshOverheadToggleVisibility();
      }
  }
  self.loadARCalibration = _loadCalibration;

  function _renderCalHandles() {
      if (!self.ar._draftCorners) return;
      var size = _previewSize();
      ['tl', 'tr', 'br', 'bl'].forEach(function (k) {
          var p = self.ar._draftCorners[k];
          container.find('.ar-cal-handle[data-corner="' + k + '"]').css({
              left: (p.x * size.w) + 'px',
              top:  (p.y * size.h) + 'px',
          });
      });
      var c = self.ar._draftCorners;
      var pts = [c.tl, c.tr, c.br, c.bl].map(function (p) { return p.x + ',' + p.y; }).join(' ');
      container.find('.ar-cal-quad').attr('points', pts);
  }

  function _startCalibration() {
      // Reset 2D zoom/pan so the user marks corners against the raw,
      // unscaled video frame. _applyARViewTransform also wipes transforms
      // when calibrating=true, so the canvas/video render at 1:1.
      _resetARView();
      self.ar._backupCorners = self.ar.corners ? JSON.parse(JSON.stringify(self.ar.corners)) : null;
      if (self.ar.corners) {
          self.ar._draftCorners = JSON.parse(JSON.stringify(self.ar.corners));
      } else {
          // Default the handles to the projected grid corners, then lift the
          // bottom two by 100px so they're not jammed against the bottom of
          // the window (where they're hard to grab). The initial warp is a
          // mild trapezoid; the user fixes it by dragging.
          var size = _previewSize();
          var src = _envelopeCornersInCanvasPx();
          var bottomPad = Math.min(100, size.h * 0.2);
          self.ar._draftCorners = {
              tl: { x: src[0][0] / size.w, y: src[0][1] / size.h },
              tr: { x: src[1][0] / size.w, y: src[1][1] / size.h },
              br: { x: src[2][0] / size.w, y: (src[2][1] - bottomPad) / size.h },
              bl: { x: src[3][0] / size.w, y: (src[3][1] - bottomPad) / size.h },
          };
      }
      self.ar.calibrating = true;
      container.find('.ar-calibration').show();
      _renderCalHandles();
      // In overhead mode the user marks corners on the *raw* video — strip
      // the matrix3d warp off the <img> so the calibration handles align
      // with where the table actually appears in the camera feed. The
      // 3D scene stays in top-down ortho with no canvas transform; live
      // homography preview is suppressed (would re-warp the raw video).
      if (self.ar.overhead) {
          container.find('.ar-video').css('transform', '');
      } else {
          _applyHomography();
      }
  }

  function _onHandleDown(e) {
      if (!self.ar.calibrating) return;
      e.preventDefault();
      var key = $(e.currentTarget).data('corner');
      self.ar._dragging = key;
      var move = function (ev) {
          if (!self.ar._dragging) return;
          var src = (ev.touches && ev.touches[0]) ? ev.touches[0] : ev;
          var rect = container[0].getBoundingClientRect();
          var x = (src.clientX - rect.left) / rect.width;
          var y = (src.clientY - rect.top)  / rect.height;
          x = Math.max(0, Math.min(1, x));
          y = Math.max(0, Math.min(1, y));
          self.ar._draftCorners[self.ar._dragging] = { x: x, y: y };
          _renderCalHandles();
          // In overhead recalibration the video must stay un-warped so the
          // user can mark actual table corners on the raw feed.
          if (!self.ar.overhead) _applyHomography();
      };
      var up = function () {
          self.ar._dragging = null;
          $(document).off('mousemove.arcal touchmove.arcal mouseup.arcal touchend.arcal');
      };
      $(document).on('mousemove.arcal touchmove.arcal', move);
      $(document).on('mouseup.arcal touchend.arcal', up);
  }

  function _saveCalibrationDraft() {
      if (!self.ar._draftCorners) return;
      self.ar.corners = self.ar._draftCorners;
      self.ar._draftCorners = null;
      self.ar._backupCorners = null;
      self.ar.calibrating = false;
      container.find('.ar-calibration').hide();
      _saveCalibration();
      _refreshOverheadToggleVisibility();
      // Re-apply the active mode's warp with the new corners.
      if (self.ar.overhead) _applyOverheadWarp();
      else                  _applyHomography();
  }

  function _cancelCalibration() {
      self.ar.calibrating = false;
      self.ar._draftCorners = null;
      container.find('.ar-calibration').hide();
      if (self.ar._backupCorners) {
          self.ar.corners = self.ar._backupCorners;
          self.ar._backupCorners = null;
          if (self.ar.overhead) _applyOverheadWarp();
          else                  _applyHomography();
      } else {
          // No prior calibration to restore — leave AR but unwarped, or exit.
          self.exitAR();
      }
  }

  self.enterAR = function () {
      if (self.ar.enabled) return;
      if (!self.ar.cameraPort) return;

      var fromOverhead = !!self.ar.overhead;

      // Mode swap from overhead — simple fade-out, snap, fade-in. Keep the
      // saved view; tear down only overhead-specific bits (material hidden,
      // overhead-mode class, bg blur, video matrix3d).
      if (fromOverhead) {
          self.ar.overhead = false;
          container.removeClass('overhead-mode');
          container.find('input[name="show-overhead"]').prop('checked', false);
          if (self.material) {
              if (self.material.mesh && typeof self.ar._materialMeshWasVisible !== 'undefined') {
                  self.material.mesh.visible = self.ar._materialMeshWasVisible;
                  delete self.ar._materialMeshWasVisible;
              }
              if (self.material.wireMesh && typeof self.ar._materialWireWasVisible !== 'undefined') {
                  self.material.wireMesh.visible = self.ar._materialWireWasVisible;
                  delete self.ar._materialWireWasVisible;
              }
          }
      }

      container.find('#ar-recalibrate').show();
      self.ar.enabled = true;

      if (!fromOverhead) {
          _resetARView();
          // Capture saved view, unless an exit animation is still in flight
          // (in which case _savedView lingers — reuse it instead of
          // overwriting with the mid-animation pose). self.refresh is
          // AR-aware (skips controls.update while ar.enabled), so no
          // refresh override is needed.
          if (!self.ar._savedView) {
              self.ar._savedView = {
                  isOrtho: self.isOrtho,
                  camera: self.camera,
                  target: { x: self.controls.target.x, y: self.controls.target.y, z: self.controls.target.z },
                  pos:    { x: self.camera.position.x, y: self.camera.position.y, z: self.camera.position.z },
                  zoom: self.camera.zoom,
              };
              _applyARStyling();
          }
          var $video0 = container.find('.ar-video');
          $video0.attr('src', _videoUrl(self.ar.cameraPort)).css('opacity', 0).show();
          self.controls.enabled = false;
      }
      container.addClass('ar-mode');

      // Shrink the canvas to leave room for the bottom-bar; suppress the
      // resize branch's camera setup so _animateToAR can capture the user's
      // current view as the start pose.
      self.ar._entering = true;
      $(window).trigger('resize');
      self.ar._entering = false;

      if (fromOverhead) {
          // Simple fade between modes: dim out the warped overhead view,
          // snap to AR pose, fade back in.
          _fadeAR({ videoTo: 0, bgTo: 0, clearTo: 1, durationMs: 200,
              onComplete: function () {
                  container.find('.ar-video').css('transform', '');
                  container.find('.ar-video-bg').hide().css('opacity', '');
                  if (self.ar.corners) _applyARCamera();
                  else                 _setTopDownCamera();
                  self.renderer.setClearAlpha(0);
                  _fadeAR({ videoTo: 1, bgTo: 0, clearTo: 0, durationMs: 200,
                      onComplete: function () {
                          if (!self.ar.corners) _startCalibration();
                      }
                  });
              }
          });
          return;
      }

      // Regular → AR: the cool camera-tilt animation.
      if (self.ar.corners) {
          _animateToAR(1200);
      } else {
          // No saved calibration — go straight to top-down ortho for the
          // calibration UI; no animation makes sense without a target pose.
          self.renderer.setClearAlpha(0);
          container.find('.ar-video').css('opacity', 1);
          _setTopDownCamera();
          self.refresh();
          _startCalibration();
      }
  };

  // Snap the scene's AR styling — table mesh hidden, grid moved to table z and
  // brightened. Idempotent: only stashes original values once.
  function _applyARStyling() {
      if (self.table && self.table.table && typeof self.ar._tableWasVisible === 'undefined') {
          self.ar._tableWasVisible = self.table.table.visible;
          self.table.table.visible = false;
      }
      if (self.grid && self.grid.grid && typeof self.ar._gridZ === 'undefined') {
          self.ar._gridZ = self.grid.grid.position.z;
          // Sit the grid at the calibration plane (scene z=0), where the user
          // marked the table edges. Tiny lift to avoid z-fighting with anything
          // else exactly at z=0.
          self.grid.grid.position.z = 0.01;
          if (self.grid.grid.material) {
              self.ar._gridOpacity = self.grid.grid.material.opacity;
              self.ar._gridColor = self.grid.grid.material.color.getHex();
              self.grid.grid.material.opacity = 0.65;
              self.grid.grid.material.color = new THREE.Color(0xffffff);
              self.grid.grid.material.needsUpdate = true;
          }
      }
  }

  // Simple opacity / clear-alpha crossfade. Used for all transitions
  // except regular → AR (which has the cooler camera-tilt animation in
  // _animateToAR). The 3D scene keeps rendering each frame so the user
  // sees the underlying preview behind the fading video.
  function _fadeAR(opts) {
      var durationMs = opts.durationMs || 250;
      var $video = container.find('.ar-video');
      var $videoBg = container.find('.ar-video-bg');
      var fromVideo = parseFloat($video.css('opacity'));
      var fromBg    = parseFloat($videoBg.css('opacity'));
      if (isNaN(fromVideo)) fromVideo = 0;
      if (isNaN(fromBg))    fromBg = 0;
      var fromClear = self.renderer.getClearAlpha();

      var startTime = Date.now();
      var animId = (self.ar._animId = (self.ar._animId || 0) + 1);
      self.ar._animating = true;

      function tick() {
          if (self.ar._animId !== animId) return;
          var t = Math.min(1, (Date.now() - startTime) / durationMs);
          var ease = t * t * (3 - 2 * t);
          $video.css(  'opacity', fromVideo + (opts.videoTo - fromVideo) * ease);
          $videoBg.css('opacity', fromBg    + (opts.bgTo    - fromBg)    * ease);
          self.renderer.setClearColor(0xebebeb, fromClear + (opts.clearTo - fromClear) * ease);
          self.renderer.render(self.scene, self.camera);
          if (t < 1) requestAnimationFrame(tick);
          else {
              self.ar._animating = false;
              if (opts.onComplete) opts.onComplete();
          }
      }
      requestAnimationFrame(tick);
  }

  // Cool transition for the regular → AR entry path: pull/tilt the camera
  // onto the calibrated AR pose while fading the live video in and the
  // canvas clear color out. Slerp + lerp on a perspective camera.
  function _animateToAR(durationMs) {
      durationMs = durationMs || 1200;
      var pose = _solveCameraPose();
      if (!pose) {
          // Calibration is degenerate — skip animation, fall back.
          self.renderer.setClearAlpha(0);
          container.find('.ar-video').css('opacity', 1);
          _applyARCamera();
          return;
      }

      // If the scene is currently in ortho, copy its position+target onto the
      // perspective camera so the animation has a sensible perspective start.
      if (self.camera !== self.perspectiveCamera) {
          self.perspectiveCamera.position.copy(self.camera.position);
          self.perspectiveCamera.up.set(0, 0, 1);
          self.perspectiveCamera.lookAt(self.controls.target);
          self.perspectiveCamera.fov = 45;
          var w0 = self.renderer.domElement.clientWidth || 1;
          var h0 = self.renderer.domElement.clientHeight || 1;
          self.perspectiveCamera.aspect = w0 / h0;
          self.perspectiveCamera.updateProjectionMatrix();
          self.camera = self.perspectiveCamera;
          self.controls.object = self.camera;
      }

      var startPos  = self.camera.position.clone();
      var startQuat = self.camera.quaternion.clone();
      var startFov  = self.camera.fov;

      var endPos = new THREE.Vector3(pose.C[0], pose.C[1], pose.C[2]);
      var endFov = 2 * Math.atan(pose.h / (2 * pose.f)) * 180 / Math.PI;
      var canvasAspect = (self.renderer.domElement.clientWidth || pose.w) /
                         (self.renderer.domElement.clientHeight || pose.h);

      var endCam = new THREE.PerspectiveCamera();
      endCam.position.copy(endPos);
      endCam.up.set(pose.ey[0], pose.ey[1], pose.ey[2]);
      var fwd = [-pose.ez[0], -pose.ez[1], -pose.ez[2]];
      endCam.lookAt(endPos.x + fwd[0], endPos.y + fwd[1], endPos.z + fwd[2]);
      var endQuat = endCam.quaternion.clone();

      var $video = container.find('.ar-video');
      // Start with the scene fully opaque (so the 3D preview is solid) and
      // fade out the canvas's own clear background as we fade the video in.
      self.renderer.setClearColor(0xebebeb, 1);

      var startTime = Date.now();
      var animId = (self.ar._animId = (self.ar._animId || 0) + 1);

      function tick() {
          if (!self.ar.enabled || self.ar._animId !== animId) return;
          var t = Math.min(1, (Date.now() - startTime) / durationMs);
          var ease = t * t * (3 - 2 * t);  // smoothstep

          self.camera.position.lerpVectors(startPos, endPos, ease);
          THREE.Quaternion.slerp(startQuat, endQuat, self.camera.quaternion, ease);
          self.camera.fov = startFov + (endFov - startFov) * ease;
          self.camera.aspect = canvasAspect;
          self.camera.updateProjectionMatrix();

          $video.css('opacity', ease);
          self.renderer.setClearColor(0xebebeb, 1 - ease);

          self.renderer.render(self.scene, self.camera);

          if (t < 1) {
              requestAnimationFrame(tick);
          } else {
              // Final snap to ensure exact pose + transparent canvas.
              self.renderer.setClearAlpha(0);
              _applyARCamera();
          }
      }
      requestAnimationFrame(tick);
  }

  self.exitAR = function () {
      if (!self.ar.enabled) return;
      self.ar.enabled = false;
      self.ar.calibrating = false;
      container.find('.ar-calibration').hide();
      container.find('#ar-recalibrate').hide();
      _fadeAR({ videoTo: 0, bgTo: 0, clearTo: 1, durationMs: 250,
          onComplete: _exitARTeardown });
  };

  // Tear down all AR/overhead-specific state and restore the prior 3D view.
  // Used by both exitAR and exitOverhead at the tail end of their animations.
  function _exitARTeardown() {
      container.removeClass('ar-mode overhead-mode');
      _clearHomography();
      container.find('.ar-video').hide().attr('src', '').css({ transform: '', opacity: '' });
      container.find('.ar-video-bg').hide().attr('src', '').css('opacity', '');
      self.renderer.setClearColor(0xebebeb, 1);
      self.controls.enabled = true;
      if (self.ar._debugSphere) self.scene.remove(self.ar._debugSphere);
      if (self.table && self.table.table && typeof self.ar._tableWasVisible !== 'undefined') {
          self.table.table.visible = self.ar._tableWasVisible;
          delete self.ar._tableWasVisible;
      }
      if (self.grid && self.grid.grid && typeof self.ar._gridZ !== 'undefined') {
          self.grid.grid.position.z = self.ar._gridZ;
          if (self.grid.grid.material && typeof self.ar._gridOpacity !== 'undefined') {
              self.grid.grid.material.opacity = self.ar._gridOpacity;
              self.grid.grid.material.color = new THREE.Color(self.ar._gridColor || 0x000000);
              self.grid.grid.material.needsUpdate = true;
          }
          delete self.ar._gridZ;
          delete self.ar._gridOpacity;
          delete self.ar._gridColor;
      }
      if (self.material) {
          if (self.material.mesh && typeof self.ar._materialMeshWasVisible !== 'undefined') {
              self.material.mesh.visible = self.ar._materialMeshWasVisible;
              delete self.ar._materialMeshWasVisible;
          }
          if (self.material.wireMesh && typeof self.ar._materialWireWasVisible !== 'undefined') {
              self.material.wireMesh.visible = self.ar._materialWireWasVisible;
              delete self.ar._materialWireWasVisible;
          }
      }
      if (self.ar._savedView) {
          self.camera = self.ar._savedView.camera;
          self.controls.object = self.camera;
          self.camera.position.set(self.ar._savedView.pos.x, self.ar._savedView.pos.y, self.ar._savedView.pos.z);
          self.controls.target.set(self.ar._savedView.target.x, self.ar._savedView.target.y, self.ar._savedView.target.z);
          self.camera.zoom = self.ar._savedView.zoom;
          self.camera.updateProjectionMatrix();
          self.controls.update();
          self.ar._savedView = null;
      }
      $(window).trigger('resize');
      self.refresh();
  }

  self.recalibrateAR = function () {
      if (self.ar.enabled || self.ar.overhead) _startCalibration();
  };

  self.isARAvailable = function () {
      return !!self.ar.cameraPort;
  };

  // ---------- Overhead (un-warped top-down) ---------------------------------
  //
  // Re-uses the AR table-corner calibration to compute the inverse homography
  // (camera-pixels → table-coords) and applies it to the live MJPEG <img>
  // via CSS matrix3d. The 3D scene renders in top-down ortho with the same
  // envelope framing, so the warped video corners land exactly on the canvas
  // envelope corners. Material and table mesh are hidden so the toolpath
  // appears over the actual table surface — useful for spotting clamps or
  // fixtures the path would collide with.
  // Apply the current 2D view (zoom + pan) plus the overhead warp (when
  // applicable) to the canvas, video, and calibration overlay. Single
  // source of truth for transforms on those elements while AR is active.
  function _applyARViewTransform() {
      var $video = container.find('.ar-video');
      var $cal   = container.find('.ar-calibration');
      var canvas = self.renderer.domElement;

      // During calibration the user marks corners against the raw video,
      // so wipe all transforms (including any overhead warp + zoom/pan)
      // and let CSS-driven defaults apply.
      if (self.ar.calibrating) {
          if (canvas) canvas.style.transform = '';
          $video.css({ 'transform-origin': '', transform: '' });
          $cal.css({ 'transform-origin': '', transform: '' });
          return;
      }

      var z  = self.ar.viewZoom  || 1;
      var px = self.ar.viewPanX  || 0;
      var py = self.ar.viewPanY  || 0;
      var view = (z === 1 && px === 0 && py === 0)
          ? '' : 'translate(' + px + 'px,' + py + 'px) scale(' + z + ')';

      if (canvas) {
          canvas.style.transformOrigin = '0 0';
          canvas.style.transform = view;
      }
      $cal.css({ 'transform-origin': '0 0', transform: view });

      // Compose with the overhead matrix3d homography when applicable.
      // Order: matrix3d (warps the raw camera frame onto the envelope),
      // then scale (zoom), then translate (pan) — read right-to-left.
      var warp = '';
      if (self.ar.overhead && self.ar.corners) {
          var size = _previewSize();
          if (size.w && size.h) {
              var c = self.ar.corners;
              var src = [
                  [c.tl.x * size.w, c.tl.y * size.h],
                  [c.tr.x * size.w, c.tr.y * size.h],
                  [c.br.x * size.w, c.br.y * size.h],
                  [c.bl.x * size.w, c.bl.y * size.h],
              ];
              var dst = _envelopeCornersInCanvasPx();
              warp = _h_toMatrix3d(_h_quadToQuad(src, dst));
          }
      }
      $video.css({
          'transform-origin': '0 0',
          'transform': (view && warp) ? (view + ' ' + warp) : (view || warp || '')
      });
  }

  // Reset view to identity. Called on entry/exit and at calibration start.
  function _resetARView() {
      self.ar.viewZoom = 1;
      self.ar.viewPanX = 0;
      self.ar.viewPanY = 0;
  }

  // Backwards-compat alias — many existing call sites just want the warp.
  function _applyOverheadWarp() { _applyARViewTransform(); }

  self.enterOverhead = function () {
      if (self.ar.overhead) return;
      if (!self.ar.cameraPort || !self.ar.corners) return;

      var fromAR = !!self.ar.enabled;
      if (fromAR) {
          self.ar.enabled = false;
          container.find('input[name="show-ar"]').prop('checked', false);
      } else if (!self.ar._savedView) {
          _resetARView();
          // Fresh entry — capture saved view. self.refresh is AR-aware
          // (skips controls.update while ar.overhead), so no refresh
          // override is needed.
          self.ar._savedView = {
              camera: self.camera,
              target: { x: self.controls.target.x, y: self.controls.target.y, z: self.controls.target.z },
              pos:    { x: self.camera.position.x, y: self.camera.position.y, z: self.camera.position.z },
              zoom: self.camera.zoom,
          };
          _applyARStyling();
          self.controls.enabled = false;
      }

      self.ar.overhead = true;
      container.addClass('ar-mode overhead-mode');
      container.find('#ar-recalibrate').show();

      // Hide material so the live table shows through (overhead-only).
      if (self.material) {
          if (self.material.mesh && typeof self.ar._materialMeshWasVisible === 'undefined') {
              self.ar._materialMeshWasVisible = self.material.mesh.visible;
              self.material.mesh.visible = false;
          }
          if (self.material.wireMesh && typeof self.ar._materialWireWasVisible === 'undefined') {
              self.ar._materialWireWasVisible = self.material.wireMesh.visible;
              self.material.wireMesh.visible = false;
          }
      }

      var videoSrc = _videoUrl(self.ar.cameraPort);
      var $video = container.find('.ar-video');
      var $videoBg = container.find('.ar-video-bg');
      if (!fromAR) {
          $video.attr('src', videoSrc).css('opacity', 0).show();
      }
      $videoBg.attr('src', videoSrc + '&bg=1').css('opacity', 0).show();

      self.ar._entering = true;
      $(window).trigger('resize');
      self.ar._entering = false;
      self.renderer.domElement.style.transform = '';

      // Snap-then-fade. From AR, dim out the unwarped video first so the
      // matrix3d swap-on isn't visible; from regular the video is already
      // hidden so we go straight to the fade-in.
      var snapAndFadeIn = function () {
          _setTopDownCamera();
          _applyOverheadWarp();
          self.renderer.setClearColor(0xebebeb, 1);
          _fadeAR({ videoTo: 1, bgTo: 0.45, clearTo: 0, durationMs: 250,
              onComplete: function () {
                  // Let CSS-driven bg opacity take over after fade-in completes.
                  container.find('.ar-video-bg').css('opacity', '');
                  self.renderer.setClearAlpha(0);
                  self.refresh();
              }
          });
      };
      if (fromAR) {
          _fadeAR({ videoTo: 0, bgTo: 0, clearTo: 1, durationMs: 200,
              onComplete: snapAndFadeIn });
      } else {
          snapAndFadeIn();
      }
  };

  self.exitOverhead = function () {
      if (!self.ar.overhead) return;
      self.ar.overhead = false;
      container.find('#ar-recalibrate').hide();
      _fadeAR({ videoTo: 0, bgTo: 0, clearTo: 1, durationMs: 250,
          onComplete: _exitARTeardown });
  };

  // The Top toggle only makes sense once a calibration exists. Surface or
  // hide it as calibration state changes (load, save, camera-detect).
  function _refreshOverheadToggleVisibility() {
      var $w = container.find('#overhead-toggle-wrap');
      if (self.ar.cameraPort && self.ar.corners) $w.show();
      else                                       $w.hide();
  }
  // ---------- end Overhead --------------------------------------------------

  // Detect a camera and surface the toggles if found. Top toggle additionally
  // requires that calibration corners exist (loaded from machine config).
  _detectCamera(function (port) {
      self.ar.cameraPort = port;
      if (port) {
          container.find('#ar-toggle-wrap').show();
          _refreshOverheadToggleVisibility();
      }
  });

  // Wire UI: AR toggle, Top toggle, recalibrate, calibration click capture, cancel.
  container.on('change', 'input[name="show-ar"]', function () {
      if (this.checked) self.enterAR();
      else              self.exitAR();
  });
  container.on('change', 'input[name="show-overhead"]', function () {
      if (this.checked) self.enterOverhead();
      else              self.exitOverhead();
  });
  container.on('click', '#ar-recalibrate', function () {
      self.recalibrateAR();
  });
  container.on('mousedown touchstart', '.ar-cal-handle', _onHandleDown);
  container.on('click', '.ar-cal-save', function (e) {
      e.stopPropagation();
      _saveCalibrationDraft();
  });
  container.on('click', '.ar-cal-cancel', function (e) {
      e.stopPropagation();
      _cancelCalibration();
  });

  // 2D zoom/pan on the AR composite (canvas + warped video). Wheel zooms
  // around the cursor; left-drag pans. Active only in AR or overhead, and
  // skipped during calibration so handles stay 1:1 with the raw video.
  self.renderer.domElement.addEventListener('wheel', function (e) {
      if (!self.ar.enabled && !self.ar.overhead) return;
      if (self.ar.calibrating) return;
      e.preventDefault();
      var rect = self.renderer.domElement.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var step = e.deltaY < 0 ? 1.10 : 1 / 1.10;
      var z0 = self.ar.viewZoom || 1;
      var z1 = Math.max(0.5, Math.min(8, z0 * step));
      if (z1 === z0) return;
      var f = z1 / z0;
      // Keep the cursor's underlying world point fixed while zooming.
      self.ar.viewPanX = mx - (mx - (self.ar.viewPanX || 0)) * f;
      self.ar.viewPanY = my - (my - (self.ar.viewPanY || 0)) * f;
      self.ar.viewZoom = z1;
      _applyARViewTransform();
  }, { passive: false });

  self.renderer.domElement.addEventListener('mousedown', function (e) {
      if (!self.ar.enabled && !self.ar.overhead) return;
      if (self.ar.calibrating) return;
      if (e.button !== 0) return;
      e.preventDefault();
      var startX = e.clientX, startY = e.clientY;
      var sx = self.ar.viewPanX || 0;
      var sy = self.ar.viewPanY || 0;
      function move(ev) {
          self.ar.viewPanX = sx + (ev.clientX - startX);
          self.ar.viewPanY = sy + (ev.clientY - startY);
          _applyARViewTransform();
      }
      function up() {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
  });

  // ---------- end AR overlay ------------------------------------------------

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
