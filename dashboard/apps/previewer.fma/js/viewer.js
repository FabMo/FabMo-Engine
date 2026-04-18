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

  function updateLights(bounds) {
    var dims = util.getDims(bounds);

    var lx = dims[0] / 2;    //2
    var ly = dims[1] / 2;
    var lz = dims[2] / 2;

    self.light2.position.set(lx, ly, lz + 10);
  }


  function pathLoaded() {
    if (self.path.errors.length)
      self.gui.showErrors(self.path.errors);

    var bounds = self.path.bounds;
    var size = util.maxDim(bounds);

    updateLights(bounds);
    self.dims.update(bounds, self.isMetric());
    self.axes.update(size);
    self.tool.update(size, self.path.position);
    
    // Initialize material simulation
    var stockThickness = 0.75; // Default stock thickness
    var materialTop = 0; // Default: material surface origin (Z=0 is top)

    // Use VCarve/ShopBot file metadata if available
    if (self.fileMetadata) {
      if (self.fileMetadata.materialThickness) {
        stockThickness = self.fileMetadata.materialThickness;
      }
      if (self.fileMetadata.zOrigin && self.fileMetadata.zOrigin.indexOf('table') !== -1) {
        // Table Surface origin: Z=0 is at the table, material top at Z=stockThickness
        materialTop = stockThickness;
      }
    }
    
    // Expand bounds to include material block
    var materialBounds = {
      min: {
        x: bounds.min.x - 0.5,  // Add margin
        y: bounds.min.y - 0.5,
        z: materialTop - stockThickness  // Bottom of stock
      },
      max: {
        x: bounds.max.x + 0.5,
        y: bounds.max.y + 0.5,
        z: materialTop  // Top at Z=0
      }
    };
    
    // Align table surface with the bottom of the material
    var materialBottom = materialTop - stockThickness;
    self.table.setZZoff(materialBottom);

    // Tool diameter - could be from config or settings (default 0.25")
    var toolDia = 0.125; // TODO: Get from machine config
    
    console.log('Initializing material:');
    console.log('  Top Z:', materialTop);
    console.log('  Bottom Z:', materialTop - stockThickness);
    console.log('  Thickness:', stockThickness);
    console.log('  Tool diameter:', toolDia);
    console.log('Path bounds Z: min=', bounds.min.z, 'max=', bounds.max.z);
    
    // Initialize material with proper positioning
    self.material.initialize(materialBounds, stockThickness, toolDia, materialTop);
    
    // Try to restore saved view state first
    var restored = self.restoreViewState();
    
    // If no saved state, position camera in ISO orientation
    if (!restored) {
      var center = util.getCenter(bounds);
      var dims = util.getDims(bounds);
      var zoom = 0.75 * util.maxDim(bounds) / Math.tan(Math.PI / 8);
      
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

    buildNLineMap();
    self.gui.hideLoading();
    self.gui.setTimelineDuration(self.path.duration);
    self.refresh();
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

  self.setFileMetadata = function(metadata) {
    self.fileMetadata = metadata;
    console.log('File metadata set:', JSON.stringify(metadata));
  };

  // Get the file path that will be displayed; "bounds" comes from this work
  self.setGCode = function(gcode) {
    // Clean up existing material before loading new path
    if (self.material && self.material.reset) {
      console.log('Cleaning up previous material before new load');
      self.material.reset();
    }
    
    self.path.load(gcode, pathLoaded);
  }


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

    // Update the Line: display with the original file line number.
    // SBP:   N = SBP_pc + 20, so 1-based source line = targetN - 19
    // GCode: N21 = line 1,    so 1-based source line = targetN - 20
    if (self.path.setCurrentLine && targetN > 0) {
      var displayLine = self.isSBP ? (targetN - 19) : (targetN - 20);
      if (displayLine < 1) displayLine = 1;
      self.path.setCurrentLine(displayLine);
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
  self.light2 = new THREE.DirectionalLight(0xffffff, 1);
  self.scene.add(self.light2);
  self.scene.add(new THREE.AmbientLight(0x808080));

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
    materialForceUpdate: function() {
      if (self.material) {
        self.material.forceUpdate();
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
      var srcLine = self.path.hasSourceLines ? move.sourceLine : move.getLine();
      self.gui.setInPoint(time, srcLine, moveIdx);
    },
    setOutPoint: function() {
      if (!self.path || !self.path.loaded) return;
      var time = self.path.moveTime;
      var moveIdx = self.path.lastMove;
      var move = self.path.moves[moveIdx];
      if (!move) return;
      var srcLine = self.path.hasSourceLines ? move.sourceLine : move.getLine();
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
  raycaster.params.Line.threshold = 0.1;  // world-space pick tolerance
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
    var intersects = raycaster.intersectObject(self.path.obj, true);
    if (intersects.length === 0) return null;
    return self.path.getMoveAtIntersection(intersects[0].object, intersects[0].index);
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
        hoveredMove = move;
        var label = self.path.hasSourceLines
          ? 'SBP Line ' + move.sourceLine.toLocaleString()
          : 'Line ' + move.getLine().toLocaleString();
        self.path.codeLine.text(label);
        canvas.style.cursor = 'pointer';
      }
    } else if (hoveredMove) {
      hoveredMove = null;
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
