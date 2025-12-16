/**
 * Material simulation using height map for CNC cutting visualization.
 * Displays material removal as the toolpath executes.
 */

'use strict';

var util = require('./util');
var cookie = require('./cookie');
// Note: THREE is available globally via window.THREE from app.js

module.exports = function(scene, update) {
  var self = this;

  self.mesh = null;
  self.wireMesh = null;
  self.show = parseInt(cookie.get('show-material', 0));
  self.opacity = parseFloat(cookie.get('material-opacity', 0.5));
  self.resolution = Math.min(parseInt(cookie.get('material-resolution', 200)), 500); // INCREASED cap to 500
  
  // DECLARE ALL MODULE-LEVEL VARIABLES HERE
  var bounds = null;
  var stockHeight = 0;
  var toolDia = 0.05;
  var materialTop = 0;
  var heightMap = null;
  var lastUpdateTime = 0; // Track last mesh update time
  var UPDATE_INTERVAL_MS = 500; // Update mesh every 1000ms (1 second) for smooth progress
  var lastToolPos = null;
  var isDirty = false; // Track if mesh needs update
  var pendingUpdates = 0; // Count updates since last render

  /**
   * Initialize material block with height map
   */
  self.initialize = function(pathBounds, height, diameter, topZ) {
    // ASSIGN bounds FIRST before using it
    bounds = pathBounds;
    stockHeight = height || 1;
    toolDia = diameter || 0.25;
    materialTop = topZ !== undefined ? topZ : 0;
    
    // NOW calculate grid dimensions (after bounds is assigned)
    var width = bounds.max.x - bounds.min.x;
    var depth = bounds.max.y - bounds.min.y;
    
    // Use resolution directly - no capping
    var xPoints = self.resolution;
    var yPoints = Math.round(self.resolution * (depth / width)); // Maintain aspect ratio
    
    // Create height map
    heightMap = {
      xPoints: xPoints,
      yPoints: yPoints,
      xStep: width / (xPoints - 1),
      yStep: depth / (yPoints - 1),
      heights: new Float32Array(xPoints * yPoints)
    };
    
    // Initialize all heights to material top (this creates the solid block)
    for (var i = 0; i < heightMap.heights.length; i++) {
      heightMap.heights[i] = materialTop;
    }
    
    console.log('Material initialized:', xPoints, 'x', yPoints, 'grid',
                'Grid spacing: X=' + heightMap.xStep.toFixed(4) + 'in, Y=' + heightMap.yStep.toFixed(4) + 'in',
                'Stock height:', stockHeight, 'Top Z:', materialTop, 'Tool dia:', toolDia);
    
    // Create initial mesh (solid block)
    self.updateMesh();
  };

  /**
   * Get grid indices from world coordinates
   */
  function getGridIndices(x, y) {
    if (!bounds || !heightMap) return null;
    
    var xi = Math.round((x - bounds.min.x) / heightMap.xStep);
    var yi = Math.round((y - bounds.min.y) / heightMap.yStep);
    
    if (xi < 0 || xi >= heightMap.xPoints || yi < 0 || yi >= heightMap.yPoints) {
      return null;
    }
    
    return { xi: xi, yi: yi };
  }

  /**
   * Get/set height at grid location
   */
  function getHeight(xi, yi) {
    return heightMap.heights[yi * heightMap.xPoints + xi];
  }

  function setHeight(xi, yi, z) {
    heightMap.heights[yi * heightMap.xPoints + xi] = z;
  }

  /**
   * Calculate tool bottom height at a point based on tool shape
   */
  function getToolBottomZ(toolZ, radialDist, toolType) {
    var toolRadius = toolDia / 2;
    
    if (radialDist > toolRadius) return Infinity; // Outside tool
    
    switch(toolType) {
      case 'ball':
        // Ball nose: hemisphere bottom
        return toolZ + Math.sqrt(toolRadius * toolRadius - radialDist * radialDist);
      
      case 'vbit':
        // V-bit: conical bottom (assume 90 degrees for now)
        return toolZ + radialDist;
      
      case 'flat':
      default:
        // Flat endmill: flat bottom
        return toolZ;
    }
  }

  /**
   * Remove material at a single tool position
   */
  function updateGridUnderTool(toolX, toolY, toolZ, toolType) {
    if (!heightMap) return;
    
    // Skip if tool barely moved (optimization)
    if (lastToolPos) {
      var dx = toolX - lastToolPos.x;
      var dy = toolY - lastToolPos.y;
      var moveDist = Math.sqrt(dx*dx + dy*dy);
      if (moveDist < heightMap.xStep * 0.5) return; // REDUCED threshold back to 0.5 for better quality
    }
    lastToolPos = {x: toolX, y: toolY};
    
    var toolRadius = toolDia / 2;
    
    // Find grid cells under tool footprint
    var cellRadius = Math.ceil(toolRadius / Math.min(heightMap.xStep, heightMap.yStep));
    var indices = getGridIndices(toolX, toolY);
    if (!indices) return;
    
    var xiMin = Math.max(0, indices.xi - cellRadius);
    var xiMax = Math.min(heightMap.xPoints - 1, indices.xi + cellRadius);
    var yiMin = Math.max(0, indices.yi - cellRadius);
    var yiMax = Math.min(heightMap.yPoints - 1, indices.yi + cellRadius);
    
    var changed = false;
    
    // Update each grid cell under tool
    for (var xi = xiMin; xi <= xiMax; xi++) {
      for (var yi = yiMin; yi <= yiMax; yi++) {
        var cellX = bounds.min.x + xi * heightMap.xStep;
        var cellY = bounds.min.y + yi * heightMap.yStep;
        
        var dx = cellX - toolX;
        var dy = cellY - toolY;
        var radialDist = Math.sqrt(dx*dx + dy*dy);
        
        if (radialDist <= toolRadius) {
          var toolBottomZ = getToolBottomZ(toolZ, radialDist, toolType);
          var currentZ = getHeight(xi, yi);
          
          // Material removal: take minimum (lower) Z value
          if (toolBottomZ < currentZ) {
            setHeight(xi, yi, toolBottomZ);
            changed = true;
          }
        }
      }
    }
    
    if (changed) {
      isDirty = true;
      pendingUpdates++;
    }
  }

  /**
   * Remove material along a path
   */
  self.removeMaterial = function(start, end, toolType) {
    if (!heightMap) {
      console.warn('Height map not initialized');
      return;
    }
    
    toolType = toolType || 'flat';
    
    // Calculate move distance and interpolate
    var dx = end[0] - start[0];
    var dy = end[1] - start[1];
    var dz = end[2] - start[2];
    var dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    if (dist < 0.001) return; // Too small to matter
    
    // Number of steps - ADAPTIVE based on resolution
    var steps = Math.max(2, Math.ceil(dist / (toolDia * 0.5)));
    
    // Interpolate along path and remove material
    for (var step = 0; step <= steps; step++) {
      var t = step / steps;
      var toolX = start[0] + dx * t;
      var toolY = start[1] + dy * t;
      var toolZ = start[2] + dz * t;
      
      updateGridUnderTool(toolX, toolY, toolZ, toolType);
    }
    
    // TIME-BASED mesh updates for consistent visual progress
    var now = Date.now();
    if (isDirty && (now - lastUpdateTime) >= UPDATE_INTERVAL_MS) {
      console.log('Material update: ' + pendingUpdates + ' changes since last render');
      self.updateMesh();
      lastUpdateTime = now;
      isDirty = false;
      pendingUpdates = 0;
    }
  };

  /**
   * Force immediate mesh update
   */
  self.forceUpdate = function() {
    if (isDirty) {
      console.log('Forcing final material update: ' + pendingUpdates + ' pending changes');
      self.updateMesh();
      lastUpdateTime = Date.now();
      isDirty = false;
      pendingUpdates = 0;
    } else {
      console.log('No changes to update');
    }
  };

  /**
   * Create/update THREE.js mesh from height map
   */
  self.updateMesh = function() {
    if (!heightMap) return;
    
    // Remove old meshes
    if (self.mesh) scene.remove(self.mesh);
    if (self.wireMesh) scene.remove(self.wireMesh);
    
    // THREE is available globally from app.js
    var geometry = new THREE.Geometry();
    
    // Create vertices for TOP surface from height map
    for (var yi = 0; yi < heightMap.yPoints; yi++) {  // ADD var
      for (var xi = 0; xi < heightMap.xPoints; xi++) {  // ADD var
        var x = bounds.min.x + xi * heightMap.xStep;
        var y = bounds.min.y + yi * heightMap.yStep;
        var z = getHeight(xi, yi);
        
        geometry.vertices.push(new THREE.Vector3(x, y, z));
      }
    }
    
    // Add BOTTOM surface vertices (flat bottom)
    var bottomVertexOffset = heightMap.xPoints * heightMap.yPoints;
    var bottomZ = materialTop - stockHeight;
    
    for (var yi = 0; yi < heightMap.yPoints; yi++) {  // ADD var
      for (var xi = 0; xi < heightMap.xPoints; xi++) {  // ADD var
        var x = bounds.min.x + xi * heightMap.xStep;
        var y = bounds.min.y + yi * heightMap.yStep;
        
        geometry.vertices.push(new THREE.Vector3(x, y, bottomZ));
      }
    }
    
    // Create TOP surface faces (height-mapped surface)
    for (var yi = 0; yi < heightMap.yPoints - 1; yi++) {  // ADD var
      for (var xi = 0; xi < heightMap.xPoints - 1; xi++) {  // ADD var
        var i0 = yi * heightMap.xPoints + xi;
        var i1 = i0 + 1;
        var i2 = i0 + heightMap.xPoints;
        var i3 = i2 + 1;
        
        // Two triangles per grid square, correct winding for upward-facing normals
        geometry.faces.push(new THREE.Face3(i0, i1, i2));
        geometry.faces.push(new THREE.Face3(i1, i3, i2));
      }
    }
    
    // Create BOTTOM surface faces (flat, downward-facing)
    for (var yi = 0; yi < heightMap.yPoints - 1; yi++) {  // ADD var
      for (var xi = 0; xi < heightMap.xPoints - 1; xi++) {  // ADD var
        var i0 = bottomVertexOffset + yi * heightMap.xPoints + xi;
        var i1 = i0 + 1;
        var i2 = i0 + heightMap.xPoints;
        var i3 = i2 + 1;
        
        // Reversed winding for downward-facing normals
        geometry.faces.push(new THREE.Face3(i0, i2, i1));
        geometry.faces.push(new THREE.Face3(i1, i2, i3));
      }
    }
    
    // Create SIDE faces connecting top and bottom edges
    
    // Front edge (yi = 0)
    for (var xi = 0; xi < heightMap.xPoints - 1; xi++) {  // ADD var
      var topLeft = xi;
      var topRight = xi + 1;
      var bottomLeft = bottomVertexOffset + xi;
      var bottomRight = bottomVertexOffset + xi + 1;
      
      geometry.faces.push(new THREE.Face3(bottomLeft, topLeft, bottomRight));
      geometry.faces.push(new THREE.Face3(topLeft, topRight, bottomRight));
    }
    
    // Back edge (yi = heightMap.yPoints - 1)
    var backOffset = (heightMap.yPoints - 1) * heightMap.xPoints;
    for (var xi = 0; xi < heightMap.xPoints - 1; xi++) {  // ADD var
      var topLeft = backOffset + xi;
      var topRight = backOffset + xi + 1;
      var bottomLeft = bottomVertexOffset + backOffset + xi;
      var bottomRight = bottomVertexOffset + backOffset + xi + 1;
      
      geometry.faces.push(new THREE.Face3(bottomLeft, bottomRight, topLeft));
      geometry.faces.push(new THREE.Face3(topLeft, bottomRight, topRight));
    }
    
    // Left edge (xi = 0)
    for (var yi = 0; yi < heightMap.yPoints - 1; yi++) {  // ADD var
      var topFront = yi * heightMap.xPoints;
      var topBack = (yi + 1) * heightMap.xPoints;
      var bottomFront = bottomVertexOffset + yi * heightMap.xPoints;
      var bottomBack = bottomVertexOffset + (yi + 1) * heightMap.xPoints;
      
      geometry.faces.push(new THREE.Face3(bottomFront, topFront, bottomBack));
      geometry.faces.push(new THREE.Face3(topFront, topBack, bottomBack));
    }
    
    // Right edge (xi = heightMap.xPoints - 1)
    var rightOffset = heightMap.xPoints - 1;
    for (var yi = 0; yi < heightMap.yPoints - 1; yi++) {  // ADD var
      var topFront = yi * heightMap.xPoints + rightOffset;
      var topBack = (yi + 1) * heightMap.xPoints + rightOffset;
      var bottomFront = bottomVertexOffset + yi * heightMap.xPoints + rightOffset;
      var bottomBack = bottomVertexOffset + (yi + 1) * heightMap.xPoints + rightOffset;
      
      geometry.faces.push(new THREE.Face3(bottomFront, bottomBack, topFront));
      geometry.faces.push(new THREE.Face3(topFront, bottomBack, topBack));
    }
    
    geometry.computeFaceNormals();
    geometry.computeVertexNormals();
    
    // Create material with nice wood appearance
    var material = new THREE.MeshPhongMaterial({
      color: 0xD2B48C, // Tan/wood color (slightly lighter)
      specular: 0x222222,
      shininess: 20,
      transparent: true,
      opacity: self.opacity,
      side: THREE.DoubleSide,
      flatShading: false
    });
    
    self.mesh = new THREE.Mesh(geometry, material);
    self.mesh.visible = !!self.show;
    scene.add(self.mesh);
    
    // Optional wireframe for debugging (only at low res)
    if (self.resolution <= 100) {
      var wireGeo = new THREE.WireframeGeometry(geometry);
      var wireMat = new THREE.LineBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.03
      });
      self.wireMesh = new THREE.LineSegments(wireGeo, wireMat);
      self.wireMesh.visible = !!self.show;
      scene.add(self.wireMesh);
    }
    
    update();
  };

  /**
   * Reset material to original state
   */
  self.reset = function() {
    if (!heightMap || !bounds) return;
    
    // Reset all heights to material top
    for (var i = 0; i < heightMap.heights.length; i++) {
      heightMap.heights[i] = materialTop;
    }
    
    self.updateMesh();
  };

  /**
   * Toggle visibility
   */
  self.setShow = function(show) {
    self.show = show;
    if (self.mesh) self.mesh.visible = !!show;
    if (self.wireMesh) self.wireMesh.visible = !!show;
    cookie.set('show-material', show ? 1 : 0);
    update();
  };

  /**
   * Set opacity
   */
  self.setOpacity = function(opacity) {
    self.opacity = opacity;
    if (self.mesh) self.mesh.material.opacity = opacity;
    cookie.set('material-opacity', opacity);
    update();
  };

  /**
   * Set resolution and reinitialize
   */
  self.setResolution = function(resolution) {
    console.log('Setting resolution to:', resolution);
    self.resolution = Math.min(parseInt(resolution), 500); // INCREASED cap to 400
    cookie.set('material-resolution', self.resolution);
    
    // Reinitialize if material exists
    if (bounds) {
      console.log('Reinitializing material with new resolution...');
      
      // Reset timing trackers
      lastUpdateTime = 0;
      pendingUpdates = 0;
      isDirty = false;
      
      self.initialize(bounds, stockHeight, toolDia, materialTop);
    }
  };

  // Initialize settings connections
  util.connectSetting('show-material', self.show, self.setShow);
  util.connectSetting('material-opacity', self.opacity, self.setOpacity);
  util.connectSetting('material-resolution', self.resolution, self.setResolution);
};