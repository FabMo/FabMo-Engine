/**
 * Material simulation using height map for CNC cutting visualization.
 * Displays material removal as the toolpath executes.
 */

'use strict';

var util = require('./util');
var cookie = require('./cookie');

module.exports = function(scene, update) {
  var self = this;

  self.mesh = null;
  self.wireMesh = null;
  self.show = parseInt(cookie.get('show-material', 0));
  self.opacity = parseFloat(cookie.get('material-opacity', 0.5));
  self.resolution = Math.min(parseInt(cookie.get('material-resolution', 200)), 500);
  
  // NEW: Tool settings with defaults
  self.toolType = cookie.get('tool-type', 'flat');
  self.toolDiameter = parseFloat(cookie.get('tool-diameter', 0.25));
  self.vbitAngle = parseFloat(cookie.get('vbit-angle', 90));
  
  var bounds = null;
  var stockHeight = 0;
  var toolDia = 0.25; // Will be updated from self.toolDiameter
  var materialTop = 0;
  var heightMap = null;
  var lastUpdateTime = 0;
  var UPDATE_INTERVAL_MS = 500;
  var lastToolPos = null;
  var isDirty = false;
  var pendingUpdates = 0;
  var activeGeometries = [];
  var activeMaterials = [];
  var dirtyRegions = [];
  var geometryCreated = false;

  /**
   * Helper to properly dispose a mesh and track its resources
   */
  function disposeMesh(mesh) {
    if (!mesh) return null;
    
    // Remove from scene FIRST
    scene.remove(mesh);
    
    // Dispose geometry
    if (mesh.geometry) {
      mesh.geometry.dispose();
      
      // Remove from tracking array
      var idx = activeGeometries.indexOf(mesh.geometry);
      if (idx > -1) activeGeometries.splice(idx, 1);
      
      // Null out reference
      mesh.geometry = null;
    }
    
    // Dispose material
    if (mesh.material) {
      // Handle both single materials and arrays
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(function(mat) {
          if (mat.dispose) mat.dispose();
          var idx = activeMaterials.indexOf(mat);
          if (idx > -1) activeMaterials.splice(idx, 1);
        });
      } else {
        if (mesh.material.dispose) mesh.material.dispose();
        var idx = activeMaterials.indexOf(mesh.material);
        if (idx > -1) activeMaterials.splice(idx, 1);
      }
      mesh.material = null;
    }
    
    // Clear parent reference
    mesh.parent = null;
    
    // FORCE renderer to update (releases GPU memory)
    if (update) update();
    
    return null;
  }

  /**
   * Initialize material block with height map
   */
  self.initialize = function(pathBounds, height, diameter, topZ) {
    // CHANGED: Just dispose old meshes, don't destroy everything
    self.mesh = disposeMesh(self.mesh);
    self.wireMesh = disposeMesh(self.wireMesh);
    
    // Clear old heightmap if exists
    if (heightMap && heightMap.heights) {
      heightMap.heights = null;
    }
    
    // NOW set new bounds and parameters
    bounds = pathBounds;
    stockHeight = height || 1;
    toolDia = self.toolDiameter; // Use setting instead of parameter
    materialTop = topZ !== undefined ? topZ : 0;
    
    var width = bounds.max.x - bounds.min.x;
    var depth = bounds.max.y - bounds.min.y;
    
    var xPoints = self.resolution;
    var yPoints = Math.round(self.resolution * (depth / width));
    
    // Create NEW height map
    heightMap = {
      xPoints: xPoints,
      yPoints: yPoints,
      xStep: width / (xPoints - 1),
      yStep: depth / (yPoints - 1),
      heights: new Float32Array(xPoints * yPoints)
    };
    
    // Initialize heights
    for (var i = 0; i < heightMap.heights.length; i++) {
      heightMap.heights[i] = materialTop;
    }
    
    // Reset state flags
    geometryCreated = false;
    dirtyRegions = [];
    lastToolPos = null;
    isDirty = false;
    pendingUpdates = 0;
    lastUpdateTime = 0;
    
    console.log('Material initialized:', xPoints, 'x', yPoints, 'grid',
                'Stock height:', stockHeight, 'Top Z:', materialTop, 'Tool dia:', toolDia);
    
    // Create initial mesh
    self.createFullMesh();
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
    
    if (radialDist > toolRadius) {
      // For V-bit, check if within max cutting width
      if (toolType === 'vbit') {
        var maxWidth = 1.0; // 1 inch max width
        var angleRad = (self.vbitAngle / 2) * (Math.PI / 180);
        var depth = Math.abs(toolZ - materialTop);
        var widthAtDepth = 2 * depth * Math.tan(angleRad);
        
        if (radialDist <= widthAtDepth / 2 && widthAtDepth <= maxWidth) {
          return toolZ + radialDist / Math.tan(angleRad);
        }
      }
      return Infinity; // Outside tool
    }
    
    switch(toolType) {
      case 'ball':
        // Formula: depth below tip = toolRadius - sqrt(r² - d²)
        var depthBelowTip = toolRadius - Math.sqrt(toolRadius * toolRadius - radialDist * radialDist);
        // Height of ball surface above the tip at distance d:
        var heightAboveTip = toolRadius - Math.sqrt(toolRadius * toolRadius - radialDist * radialDist);

        return toolZ + toolRadius - Math.sqrt(toolRadius * toolRadius - radialDist * radialDist);
      
      case 'vbit':
        // V-bit: cone formula
        var angleRad = (self.vbitAngle / 2) * (Math.PI / 180);
        return toolZ + radialDist / Math.tan(angleRad);
      
      case 'flat':
      default:
        // Flat endmill: constant bottom
        return toolZ;
    }
  }

  /**
   * Mark a region as needing update
   */
  function markDirtyRegion(xi, yi) {
    // Find if region already exists
    for (var i = 0; i < dirtyRegions.length; i++) {
      var region = dirtyRegions[i];
      if (xi >= region.xMin && xi <= region.xMax && 
          yi >= region.yMin && yi <= region.yMax) {
        return; // Already covered
      }
    }
    
    // Add new region with small buffer
    var bufferSize = 2;
    dirtyRegions.push({
      xMin: Math.max(0, xi - bufferSize),
      xMax: Math.min(heightMap.xPoints - 1, xi + bufferSize),
      yMin: Math.max(0, yi - bufferSize),
      yMax: Math.min(heightMap.yPoints - 1, yi + bufferSize)
    });
  }

  /**
   * Remove material at a single tool position (IMPROVED with adaptive sampling)
   */
  function updateGridUnderTool(toolX, toolY, toolZ, toolType) {
    if (!heightMap) return;
    
    // Skip if tool barely moved (optimization)
    if (lastToolPos) {
      var dx = toolX - lastToolPos.x;
      var dy = toolY - lastToolPos.y;
      var moveDist = Math.sqrt(dx*dx + dy*dy);
      if (moveDist < heightMap.xStep * 0.25) return; // CHANGED: More frequent updates
    }
    lastToolPos = {x: toolX, y: toolY};
    
    var toolRadius = toolDia / 2;
    var cellRadius = Math.ceil(toolRadius / Math.min(heightMap.xStep, heightMap.yStep)) + 1; // ADDED: +1 for safety margin
    var indices = getGridIndices(toolX, toolY);
    if (!indices) return;
    
    var xiMin = Math.max(0, indices.xi - cellRadius);
    var xiMax = Math.min(heightMap.xPoints - 1, indices.xi + cellRadius);
    var yiMin = Math.max(0, indices.yi - cellRadius);
    var yiMax = Math.min(heightMap.yPoints - 1, indices.yi + cellRadius);
    
    var changed = false;
    
    // ADAPTIVE: Use more sub-samples for shallow cuts
    var cutDepth = Math.abs(toolZ - materialTop);
    var subSamples = (cutDepth < toolDia) ? 5 : 3; // 5x5 for shallow cuts, 3x3 for deep
    
    for (var xi = xiMin; xi <= xiMax; xi++) {
      for (var yi = yiMin; yi <= yiMax; yi++) {
        var cellX = bounds.min.x + xi * heightMap.xStep;
        var cellY = bounds.min.y + yi * heightMap.yStep;
        
        var minToolZ = Infinity;
        var maxToolZ = -Infinity; // NEW: Track deepest and shallowest tool contact
        
        // IMPROVED: Sub-sample BEYOND grid cell boundaries for better coverage
        var sampleRange = 0.6; // Sample 60% beyond cell center in each direction
        
        for (var sx = 0; sx < subSamples; sx++) {
          for (var sy = 0; sy < subSamples; sy++) {
            // Map to -sampleRange to +sampleRange instead of -0.5 to +0.5
            var offsetX = (sx / (subSamples - 1) - 0.5) * (2 * sampleRange);
            var offsetY = (sy / (subSamples - 1) - 0.5) * (2 * sampleRange);
            
            var sampleX = cellX + offsetX * heightMap.xStep;
            var sampleY = cellY + offsetY * heightMap.yStep;
            
            var dx = sampleX - toolX;
            var dy = sampleY - toolY;
            var radialDist = Math.sqrt(dx*dx + dy*dy);
            
            if (radialDist <= toolRadius) {
              var toolBottomZ = getToolBottomZ(toolZ, radialDist, toolType);
              minToolZ = Math.min(minToolZ, toolBottomZ);
              maxToolZ = Math.max(maxToolZ, toolBottomZ);
            }
          }
        }
        
        // IMPROVED: Use average of min/max for better edge representation
        var currentZ = getHeight(xi, yi);
        
        if (minToolZ < Infinity) {
          // For shallow cuts, use minimum to ensure material is removed
          // For deep cuts, average min/max for smoother edges
          var targetZ;
          if (cutDepth < toolDia * 0.5) {
            targetZ = minToolZ; // Shallow: aggressive removal
          } else {
            targetZ = (minToolZ + maxToolZ) / 2; // Deep: smooth average
          }
          
          if (targetZ < currentZ) {
            setHeight(xi, yi, targetZ);
            markDirtyRegion(xi, yi);
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
   * Remove material along a path (with arc segment detection)
   */
  self.removeMaterial = function(start, end, toolType, isArcSegment) {
    if (!heightMap) return;
    
    toolType = self.toolType; // Use setting instead of parameter
    
    var dx = end[0] - start[0];
    var dy = end[1] - start[1];
    var dz = end[2] - start[2];
    var xyDist = Math.sqrt(dx*dx + dy*dy);
    var totalDist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    if (totalDist < 0.001) return;
    
    var isPlunge = (xyDist < toolDia * 0.1) && (Math.abs(dz) > toolDia * 0.5);
    
    if (isPlunge) {
      var toolX = start[0];
      var toolY = start[1];
      var toolZ = Math.min(start[2], end[2]);
      
      updateGridUnderTool(toolX, toolY, toolZ, toolType);
      
    } else if (isArcSegment) {
      var gridSpacing = Math.min(heightMap.xStep, heightMap.yStep);
      var steps = Math.max(2, Math.ceil(totalDist / (gridSpacing * 0.5)));
      
      for (var step = 0; step <= steps; step++) {
        var t = step / steps;
        var toolX = start[0] + dx * t;
        var toolY = start[1] + dy * t;
        var toolZ = start[2] + dz * t;
        
        updateGridUnderTool(toolX, toolY, toolZ, toolType);
      }
      
    } else {
      var axisAlignedTolerance = 0.001;
      var isAxisAligned = false;
      
      if (Math.abs(dx) < axisAlignedTolerance && Math.abs(dy) > axisAlignedTolerance) {
        isAxisAligned = 'vertical';
      } else if (Math.abs(dy) < axisAlignedTolerance && Math.abs(dx) > axisAlignedTolerance) {
        isAxisAligned = 'horizontal';
      }
      
      if (isAxisAligned) {
        var steps = Math.max(5, Math.ceil(totalDist / (heightMap.xStep * 0.3)));
        
        for (var step = 0; step <= steps; step++) {
          var t = step / steps;
          var toolX = start[0] + dx * t;
          var toolY = start[1] + dy * t;
          var toolZ = start[2] + dz * t;
          
          updateGridUnderTool(toolX, toolY, toolZ, toolType);
        }
      } else {
        var steps = Math.max(2, Math.ceil(totalDist / (toolDia * 0.5)));
        
        for (var step = 0; step <= steps; step++) {
          var t = step / steps;
          var toolX = start[0] + dx * t;
          var toolY = start[1] + dy * t;
          var toolZ = start[2] + dz * t;
          
          updateGridUnderTool(toolX, toolY, toolZ, toolType);
        }
      }
    }
    
    var now = Date.now();
    if (isDirty && (now - lastUpdateTime) >= UPDATE_INTERVAL_MS) {
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
   * OPTIMIZED: Update only changed vertices instead of full rebuild
   */
  self.updateMesh = function() {
    if (!heightMap) return;
    
    // FIRST TIME ONLY: Create full geometry
    if (!geometryCreated) {
      self.createFullMesh();
      // geometryCreated is now set inside createFullMesh()
      dirtyRegions = [];
      return;
    }
    
    // INCREMENTAL UPDATE: Only modify changed vertices
    if (dirtyRegions.length === 0) {
      return;
    }
    
    console.log('Updating ' + dirtyRegions.length + ' dirty regions incrementally');
    
    var geometry = self.mesh.geometry;
    
    // SAFETY CHECK: If geometry doesn't exist, recreate
    if (!geometry) {
      console.warn('Geometry missing - recreating full mesh');
      self.createFullMesh();
      dirtyRegions = [];
      return;
    }
    
    var vertices = geometry.vertices;
    
    // Update only vertices in dirty regions
    dirtyRegions.forEach(function(region) {
      for (var yi = region.yMin; yi <= region.yMax; yi++) {
        for (var xi = region.xMin; xi <= region.xMax; xi++) {
          // Update TOP surface vertex Z coordinate
          var vertexIndex = yi * heightMap.xPoints + xi;
          if (vertexIndex < vertices.length) {
            vertices[vertexIndex].z = getHeight(xi, yi);
          }
        }
      }
    });
    
    // Mark geometry for update
    geometry.verticesNeedUpdate = true;
    geometry.computeFaceNormals();
    geometry.computeVertexNormals();
    geometry.normalsNeedUpdate = true;
    
    // Clear dirty regions
    dirtyRegions = [];
    
    update();
  };

  /**
   * NEW: Create full mesh geometry (called only once or after reset)
   */
  self.createFullMesh = function() {
    console.log('Creating full material mesh...');
    
    // Dispose old meshes
    self.mesh = disposeMesh(self.mesh);
    self.wireMesh = disposeMesh(self.wireMesh);
    
    var geometry = new THREE.Geometry();
    activeGeometries.push(geometry);
    
    // Create vertices for TOP surface from height map
    for (var yi = 0; yi < heightMap.yPoints; yi++) {
      for (var xi = 0; xi < heightMap.xPoints; xi++) {
        var x = bounds.min.x + xi * heightMap.xStep;
        var y = bounds.min.y + yi * heightMap.yStep;
        var z = getHeight(xi, yi);
        
        geometry.vertices.push(new THREE.Vector3(x, y, z));
      }
    }
    
    // Add BOTTOM surface vertices
    var bottomVertexOffset = heightMap.xPoints * heightMap.yPoints;
    var bottomZ = materialTop - stockHeight;
    
    for (var yi = 0; yi < heightMap.yPoints; yi++) {
      for (var xi = 0; xi < heightMap.xPoints; xi++) {
        var x = bounds.min.x + xi * heightMap.xStep;
        var y = bounds.min.y + yi * heightMap.yStep;
        
        geometry.vertices.push(new THREE.Vector3(x, y, bottomZ));
      }
    }
    
    // Create TOP surface faces
    for (var yi = 0; yi < heightMap.yPoints - 1; yi++) {
      for (var xi = 0; xi < heightMap.xPoints - 1; xi++) {
        var i0 = yi * heightMap.xPoints + xi;
        var i1 = i0 + 1;
        var i2 = i0 + heightMap.xPoints;
        var i3 = i2 + 1;
        
        geometry.faces.push(new THREE.Face3(i0, i1, i2));
        geometry.faces.push(new THREE.Face3(i1, i3, i2));
      }
    }
    
    // Create BOTTOM surface faces
    for (var yi = 0; yi < heightMap.yPoints - 1; yi++) {
      for (var xi = 0; xi < heightMap.xPoints - 1; xi++) {
        var i0 = bottomVertexOffset + yi * heightMap.xPoints + xi;
        var i1 = i0 + 1;
        var i2 = i0 + heightMap.xPoints;
        var i3 = i2 + 1;
        
        geometry.faces.push(new THREE.Face3(i0, i2, i1));
        geometry.faces.push(new THREE.Face3(i1, i2, i3));
      }
    }
    
    // Create SIDE faces (front, back, left, right)
    // Front edge (yi = 0)
    for (var xi = 0; xi < heightMap.xPoints - 1; xi++) {
      var topLeft = xi;
      var topRight = xi + 1;
      var bottomLeft = bottomVertexOffset + xi;
      var bottomRight = bottomVertexOffset + xi + 1;
      
      geometry.faces.push(new THREE.Face3(bottomLeft, topLeft, bottomRight));
      geometry.faces.push(new THREE.Face3(topLeft, topRight, bottomRight));
    }
    
    // Back edge
    var backOffset = (heightMap.yPoints - 1) * heightMap.xPoints;
    for (var xi = 0; xi < heightMap.xPoints - 1; xi++) {
      var topLeft = backOffset + xi;
      var topRight = backOffset + xi + 1;
      var bottomLeft = bottomVertexOffset + backOffset + xi;
      var bottomRight = bottomVertexOffset + backOffset + xi + 1;
      
      geometry.faces.push(new THREE.Face3(bottomLeft, bottomRight, topLeft));
      geometry.faces.push(new THREE.Face3(topLeft, bottomRight, topRight));
    }
    
    // Left edge
    for (var yi = 0; yi < heightMap.yPoints - 1; yi++) {
      var topFront = yi * heightMap.xPoints;
      var topBack = (yi + 1) * heightMap.xPoints;
      var bottomFront = bottomVertexOffset + yi * heightMap.xPoints;
      var bottomBack = bottomVertexOffset + (yi + 1) * heightMap.xPoints;
      
      geometry.faces.push(new THREE.Face3(bottomFront, topFront, bottomBack));
      geometry.faces.push(new THREE.Face3(topFront, topBack, bottomBack));
    }
    
    // Right edge
    var rightOffset = heightMap.xPoints - 1;
    for (var yi = 0; yi < heightMap.yPoints - 1; yi++) {
      var topFront = yi * heightMap.xPoints + rightOffset;
      var topBack = (yi + 1) * heightMap.xPoints + rightOffset;
      var bottomFront = bottomVertexOffset + yi * heightMap.xPoints + rightOffset;
      var bottomBack = bottomVertexOffset + (yi + 1) * heightMap.xPoints + rightOffset;
      
      geometry.faces.push(new THREE.Face3(bottomFront, bottomBack, topFront));
      geometry.faces.push(new THREE.Face3(topFront, bottomBack, topBack));
    }
    
    geometry.computeFaceNormals();
    geometry.computeVertexNormals();
    
    // Create material
    var material = new THREE.MeshPhongMaterial({
      color: 0xD2B48C,
      specular: 0x222222,
      shininess: 20,
      transparent: true,
      opacity: self.opacity,
      side: THREE.DoubleSide,
      flatShading: false
    });
    activeMaterials.push(material);
    
    self.mesh = new THREE.Mesh(geometry, material);
    self.mesh.visible = !!self.show;
    scene.add(self.mesh);
    
    // Optional wireframe
    if (self.resolution <= 100) {
      var wireGeo = new THREE.WireframeGeometry(geometry);
      activeGeometries.push(wireGeo);
      
      var wireMat = new THREE.LineBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.03
      });
      activeMaterials.push(wireMat);
      
      self.wireMesh = new THREE.LineSegments(wireGeo, wireMat);
      self.wireMesh.visible = !!self.show;
      scene.add(self.wireMesh);
    }
    
    // CRITICAL: Set flag here so subsequent updates use incremental path
    geometryCreated = true;
    
    update();
  };

  /**
   * RESET: Replace current material with fresh stock (for Reset Material button)
   */
  self.reset = function() {
    console.log('Resetting material simulation (creating fresh stock)...');
    
    // PRESERVE user's show preference AND bounds for re-initialization
    var wasVisible = self.show;
    var savedBounds = bounds;
    var savedStockHeight = stockHeight;
    var savedToolDia = toolDia;
    var savedMaterialTop = materialTop;
    
    // Dispose meshes
    self.mesh = disposeMesh(self.mesh);
    self.wireMesh = disposeMesh(self.wireMesh);
    
    // Clear transient state (but keep bounds)
    if (heightMap && heightMap.heights) {
      heightMap.heights = null;
    }
    heightMap = null;
    lastToolPos = null;
    isDirty = false;
    pendingUpdates = 0;
    lastUpdateTime = 0;
    dirtyRegions = [];
    geometryCreated = false;
    
    console.log('Material disposed - memory should be released');
    
    // RESTORE visibility preference
    self.show = wasVisible;
    
    // RE-INITIALIZE with saved parameters if we had bounds
    if (savedBounds) {
      console.log('Re-initializing material with fresh stock...');
      bounds = savedBounds;
      stockHeight = savedStockHeight;
      toolDia = savedToolDia;
      materialTop = savedMaterialTop;
      
      var width = bounds.max.x - bounds.min.x;
      var depth = bounds.max.y - bounds.min.y;
      
      var xPoints = self.resolution;
      var yPoints = Math.round(self.resolution * (depth / width));
      
      heightMap = {
        xPoints: xPoints,
        yPoints: yPoints,
        xStep: width / (xPoints - 1),
        yStep: depth / (yPoints - 1),
        heights: new Float32Array(xPoints * yPoints)
      };
      
      for (var i = 0; i < heightMap.heights.length; i++) {
        heightMap.heights[i] = materialTop;
      }
      
      self.createFullMesh();
      
      console.log('Material re-initialized: fresh stock ready');
    } else {
      bounds = null;
    }
    
    update();
  };

  /**
   * DESTROY: Completely dispose everything (for app exit - NO re-initialization)
   */
  self.destroy = function() {
    console.log('Destroying material simulation (complete cleanup for app exit)...');
    
    // Dispose meshes
    self.mesh = disposeMesh(self.mesh);
    self.wireMesh = disposeMesh(self.wireMesh);
    
    // Dispose any orphaned resources
    activeGeometries.forEach(function(geo) {
      if (geo && geo.dispose) geo.dispose();
    });
    activeMaterials.forEach(function(mat) {
      if (mat && mat.dispose) mat.dispose();
    });
    
    // Clear ALL tracking
    activeGeometries.length = 0;
    activeMaterials.length = 0;
    dirtyRegions = [];
    geometryCreated = false;
    
    // Null out heightmap
    if (heightMap && heightMap.heights) {
      heightMap.heights = null;
    }
    heightMap = null;
    
    // Clear ALL state (including bounds this time)
    bounds = null;
    stockHeight = 0;
    toolDia = 0.05;
    materialTop = 0;
    lastToolPos = null;
    isDirty = false;
    pendingUpdates = 0;
    lastUpdateTime = 0;
    
    console.log('Material destroyed - all resources freed');
    update();
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
    self.resolution = Math.min(parseInt(resolution), 500);
    cookie.set('material-resolution', self.resolution);
    
    // Reinitialize will call reset() internally
    if (bounds) {
      console.log('Reinitializing material with new resolution...');
      
      // Reset timing trackers
      lastUpdateTime = 0;
      pendingUpdates = 0;
      isDirty = false;
      
      self.initialize(bounds, stockHeight, toolDia, materialTop);
    }
  };

  self.setToolType = function(type) {
    self.toolType = type;
    cookie.set('tool-type', type);
    
    if (bounds) {
      self.reset();
    }
  };

  self.setToolDiameter = function(diameter) {
    self.toolDiameter = parseFloat(diameter);
    cookie.set('tool-diameter', diameter);
    
    if (bounds) {
      toolDia = self.toolDiameter;
      self.reset();
    }
  };

  self.setVbitAngle = function(angle) {
    self.vbitAngle = parseFloat(angle);
    cookie.set('vbit-angle', angle);
    
    if (bounds && self.toolType === 'vbit') {
      self.reset();
    }
  };

  // Initialize settings connections
  util.connectSetting('show-material', self.show, self.setShow);
  util.connectSetting('material-opacity', self.opacity, self.setOpacity);
  util.connectSetting('material-resolution', self.resolution, self.setResolution);
  util.connectSetting('tool-type', self.toolType, self.setToolType);
  util.connectSetting('tool-diameter', self.toolDiameter, self.setToolDiameter);
  util.connectSetting('vbit-angle', self.vbitAngle, self.setVbitAngle);
};