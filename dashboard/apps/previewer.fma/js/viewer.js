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
  
  self.showISO = function () {
    // Toggle between ortho and perspective
    self.toggleOrtho();
    
    // Only snap to ISO view if we're now in ortho mode
    if (self.isOrtho) {
      snapPlane('iso');
    }
  }

  self.toggleOrtho = function() {
    self.isOrtho = !self.isOrtho;
    
    if (self.isOrtho) {
      // Switch to orthographic
      var currentPos = self.perspectiveCamera.position.clone();
      var currentTarget = self.controls.target.clone();
      
      self.orthographicCamera.position.copy(currentPos);
      self.orthographicCamera.lookAt(currentTarget);
      self.orthographicCamera.zoom = 2.0;
      self.orthographicCamera.near = orthoNearClip;
      self.orthographicCamera.updateProjectionMatrix();
      
      // Debug: Log the near plane distance
      //console.log('Ortho near clipping plane:', orthoNearClip);
      //console.log('Camera distance from target:', currentPos.distanceTo(currentTarget));
      
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
    // Stock top should be at Z=0 (or slightly above if needed)
    var stockThickness = 0.75; // Default stock thickness
    var materialTop = 0; // Top surface at Z=zero plane
    
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
        self.orthographicCamera.near = orthoNearClip;
        self.orthographicCamera.updateProjectionMatrix();
      }
      
      self.controls.update();
    }
    
    self.gui.hideLoading();
    self.refresh();
  }


  function pathProgress(progress) {
    self.gui.showLoadingProgress(progress);
    self.refresh();
  }


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
    const gcodeLine = self.path.gcode[0];
    const match = gcodeLine.match(/^N(\d+)/);
    let baseLineNumber = match ? parseInt(match[1], 10) : 0;

    //console.log('line: ', line);
    //console.log('gcodeLine: ', gcodeLine);
    //console.log('baseLineNumber: ', baseLineNumber);

    // Subtract the extracted line number from the input line number
    line = line - baseLineNumber;

    // Update the move line position
    self.path.setMoveLinePosition(line, position);
  }
  // self.updateStatus = function(line, position) {
  //   line = line - 20; // Subtract the minimum line number for gcode starting point
  //   self.path.setMoveLinePosition(line, position);
  // }


  self.jobStarted = function () {container.addClass('live')}


  self.jobEnded = function () {
    self.path.setMoveToEnd();
    container.removeClass('live')
  }


  function updatePosition (position) {
    self.tool.setPosition(position);
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
  var orthoNearClip = -100;  // Try a NEGATIVE value to include objects behind camera
  self.orthographicCamera = new THREE.OrthographicCamera(
    -frustumSize / 2,
    frustumSize / 2,
    frustumSize / 2,
    -frustumSize / 2,
    orthoNearClip,    // Near plane (can be negative)
    10000             // Far plane
  );
  self.orthographicCamera.up.set(0, 0, 1);
  self.orthographicCamera.position.set(100, 100, 100);
  
  // Initialize view mode from saved preference (default to perspective)
  var savedView = cookie.get('view', 'perspective');  // Was 'fabmo-previewer-view'
  self.isOrtho = (savedView === 'ortho');
  
  // Set initial camera based on saved preference
  if (self.isOrtho) {
    self.camera = self.orthographicCamera;
    self.orthographicCamera.zoom = 2.0;
    self.orthographicCamera.near = orthoNearClip;  // Ensure near plane is set
    self.orthographicCamera.updateProjectionMatrix();  // IMPORTANT: Update the matrix
  } else {
    self.camera = self.perspectiveCamera;
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
    cookie.set('view-state', JSON.stringify(viewState));  // Was 'fabmo-previewer-view-state'
    cookie.set('view', viewState.mode);  // Was 'fabmo-previewer-view'
  };

  // Method to restore saved view state
  self.restoreViewState = function() {
    try {
      var viewStateStr = cookie.get('view-state');  // Was 'fabmo-previewer-view-state'
      if (!viewStateStr) return false;
      
      var viewState = JSON.parse(viewStateStr);
      
      // Make sure we're using the right camera before restoring
      if (viewState.mode !== (self.isOrtho ? 'ortho' : 'perspective')) {
        console.warn('View state camera mode mismatch - skipping restore');
        return false;
      }
      
      // Restore camera position and target
      self.camera.position.set(
        viewState.position.x,
        viewState.position.y,
        viewState.position.z
      );
      self.controls.target.set(
        viewState.target.x,
        viewState.target.y,
        viewState.target.z
      );
      
      // Restore zoom - CRITICAL for orthographic
      if (viewState.zoom && self.isOrtho) {
        self.orthographicCamera.zoom = viewState.zoom;
      }
      
      // Ensure near plane is set if in ortho mode
      if (self.isOrtho) {
        self.orthographicCamera.near = orthoNearClip;
      }
      
      // Update projection matrix BEFORE updating controls
      self.camera.updateProjectionMatrix();
      
      // Force controls to use the restored state
      self.controls.update();
      
      // Force a render to show the correct view immediately
      self.refresh();
      
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
    materialUpdate: function(start, end, isCut) {
      if (self.material && isCut) {
        self.material.removeMaterial(start, end);
      }
    },
    materialForceUpdate: function() {
      if (self.material) {
        self.material.forceUpdate();
      }
    }
    // REMOVED materialAutoCleanup - not needed anymore
  });

  // Initialize camera position BEFORE path loads
  // This prevents the "jump" effect
  var initialViewState = cookie.get('view-state');  // Was 'fabmo-previewer-view-state'
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
    showX: self.showX,
    showY: self.showY,
    showZ: self.showZ,
    showISO: self.showISO,
    play: self.path.play,
    pause: self.path.pause,
    stop: self.path.stop,
    reset: self.path.reset,
    showPointCloud: self.pointcloud.setShow,
    showPointCloudWireframe: self.pointcloud.setShowWireframe,
    setPointCloudOpacity: self.pointcloud.setOpacity,
    showMaterial: self.material.setShow,
    setMaterialOpacity: self.material.setOpacity,
    setMaterialResolution: self.material.setResolution,
    resetMaterial: self.material.reset
  };

  self.gui = new Gui(callbacks);

  // Units
  util.connectSetting('units', self.units, self.setUnits);

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
    console.log('=== VIEWER CLEANUP STARTED ===');
    
    // 1. Cleanup material first
    if (self.material && self.material.destroy) {
      self.material.destroy();
    }
    
    // 2. Cleanup path (most complex - has many geometries)
    if (self.path && self.path.obj) {
      scene.remove(self.path.obj);
      
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
        scene.remove(obj);
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
    while(scene.children.length > 0) { 
      var obj = scene.children[0];
      scene.remove(obj);
      
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
          console.log('WebGL context forcibly lost');
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

};
