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

  // Stepped column mesh buffers (pre-allocated for performance)
  var posArr = null;       // Float32Array of vertex positions
  var idxArr = null;       // Uint32Array of face indices
  var posAttr = null;      // THREE.BufferAttribute for positions
  var idxAttr = null;      // THREE.BufferAttribute for indices
  var topVertCount = 0;    // Number of top surface vertices (4 per column)
  var botVertOffset = 0;   // Index offset to bottom vertices in posArr
  var meshMaterial = null;  // Reusable THREE.MeshPhongMaterial

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

    // Pre-allocate stepped column mesh buffers
    topVertCount = xPoints * yPoints * 4;  // 4 top vertices per column
    botVertOffset = topVertCount;
    var botVertCount = (xPoints + 1) * (yPoints + 1);  // shared bottom grid
    var totalVerts = topVertCount + botVertCount;

    var maxFaces = xPoints * yPoints * 2                              // top faces
                 + xPoints * yPoints * 2                              // bottom faces
                 + (xPoints > 1 ? (xPoints - 1) * yPoints * 2 : 0)   // x-direction walls
                 + (yPoints > 1 ? xPoints * (yPoints - 1) * 2 : 0)   // y-direction walls
                 + 2 * (xPoints + yPoints) * 2;                       // outer walls

    posArr = new Float32Array(totalVerts * 3);
    idxArr = new Uint32Array(maxFaces * 3);

    // Fill bottom vertices (static — never change)
    var bottomZ = materialTop - stockHeight;
    var xS = heightMap.xStep;
    var yS = heightMap.yStep;
    for (var byi = 0; byi <= yPoints; byi++) {
      for (var bxi = 0; bxi <= xPoints; bxi++) {
        var bIdx = (topVertCount + byi * (xPoints + 1) + bxi) * 3;
        posArr[bIdx]     = bounds.min.x + (bxi - 0.5) * xS;
        posArr[bIdx + 1] = bounds.min.y + (byi - 0.5) * yS;
        posArr[bIdx + 2] = bottomZ;
      }
    }

    console.log('Material initialized:', xPoints, 'x', yPoints, 'stepped column grid',
                'Stock:', stockHeight, 'TopZ:', materialTop, 'Tool:', toolDia,
                'Verts:', totalVerts, 'MaxFaces:', maxFaces);

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

    for (var xi = xiMin; xi <= xiMax; xi++) {
      for (var yi = yiMin; yi <= yiMax; yi++) {
        var cellX = bounds.min.x + xi * heightMap.xStep;
        var cellY = bounds.min.y + yi * heightMap.yStep;

        // Distance from cell center to tool center
        var cdx = cellX - toolX;
        var cdy = cellY - toolY;
        var centerDist = Math.sqrt(cdx*cdx + cdy*cdy);

        // Get the tool bottom Z at this cell's radial distance
        var targetZ = getToolBottomZ(toolZ, centerDist, toolType);

        if (targetZ < Infinity) {
          var currentZ = getHeight(xi, yi);
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
   * Fill top vertex positions in posArr from heightMap data.
   * Each column (grid point) gets 4 vertices forming a flat-topped rectangle.
   */
  function fillAllTopVertices() {
    var xP = heightMap.xPoints;
    var yP = heightMap.yPoints;
    var xS = heightMap.xStep;
    var yS = heightMap.yStep;
    var hw = xS / 2;
    var hh = yS / 2;

    for (var yi = 0; yi < yP; yi++) {
      for (var xi = 0; xi < xP; xi++) {
        var base = (yi * xP + xi) * 4 * 3;
        var cx = bounds.min.x + xi * xS;
        var cy = bounds.min.y + yi * yS;
        var h = getHeight(xi, yi);

        // vertex 0: near-left
        posArr[base]     = cx - hw; posArr[base + 1]  = cy - hh; posArr[base + 2]  = h;
        // vertex 1: near-right
        posArr[base + 3] = cx + hw; posArr[base + 4]  = cy - hh; posArr[base + 5]  = h;
        // vertex 2: far-left
        posArr[base + 6] = cx - hw; posArr[base + 7]  = cy + hh; posArr[base + 8]  = h;
        // vertex 3: far-right
        posArr[base + 9] = cx + hw; posArr[base + 10] = cy + hh; posArr[base + 11] = h;
      }
    }
  }

  /**
   * Build the index buffer for the stepped column mesh.
   * Top/bottom faces always exist; internal wall faces only where adjacent heights differ.
   * Returns the number of index values written.
   */
  function buildIndices() {
    var xP = heightMap.xPoints;
    var yP = heightMap.yPoints;
    var bOff = botVertOffset;
    var fi = 0;
    var idx = idxArr;

    // Top vertex index: column (xi,yi), corner c (0=near-left,1=near-right,2=far-left,3=far-right)
    function tv(xi, yi, c) { return (yi * xP + xi) * 4 + c; }
    // Bottom vertex index: corner (xi,yi) in the (xP+1)×(yP+1) grid
    function bv(xi, yi) { return bOff + yi * (xP + 1) + xi; }

    // --- TOP FACES (flat quad per column) ---
    for (var yi = 0; yi < yP; yi++) {
      for (var xi = 0; xi < xP; xi++) {
        idx[fi++] = tv(xi, yi, 0); idx[fi++] = tv(xi, yi, 1); idx[fi++] = tv(xi, yi, 2);
        idx[fi++] = tv(xi, yi, 1); idx[fi++] = tv(xi, yi, 3); idx[fi++] = tv(xi, yi, 2);
      }
    }

    // --- BOTTOM FACES ---
    for (var yi = 0; yi < yP; yi++) {
      for (var xi = 0; xi < xP; xi++) {
        idx[fi++] = bv(xi, yi); idx[fi++] = bv(xi, yi + 1); idx[fi++] = bv(xi + 1, yi);
        idx[fi++] = bv(xi + 1, yi); idx[fi++] = bv(xi, yi + 1); idx[fi++] = bv(xi + 1, yi + 1);
      }
    }

    // --- INTERNAL X-DIRECTION WALLS (between column (xi,yi) and (xi+1,yi)) ---
    for (var yi = 0; yi < yP; yi++) {
      for (var xi = 0; xi < xP - 1; xi++) {
        if (getHeight(xi, yi) !== getHeight(xi + 1, yi)) {
          // Wall quad using A's right edge and B's left edge
          idx[fi++] = tv(xi, yi, 1); idx[fi++] = tv(xi + 1, yi, 0); idx[fi++] = tv(xi, yi, 3);
          idx[fi++] = tv(xi + 1, yi, 0); idx[fi++] = tv(xi + 1, yi, 2); idx[fi++] = tv(xi, yi, 3);
        }
      }
    }

    // --- INTERNAL Y-DIRECTION WALLS (between column (xi,yi) and (xi,yi+1)) ---
    for (var yi = 0; yi < yP - 1; yi++) {
      for (var xi = 0; xi < xP; xi++) {
        if (getHeight(xi, yi) !== getHeight(xi, yi + 1)) {
          // Wall quad using A's far edge and B's near edge
          idx[fi++] = tv(xi, yi, 2); idx[fi++] = tv(xi, yi, 3); idx[fi++] = tv(xi, yi + 1, 0);
          idx[fi++] = tv(xi, yi, 3); idx[fi++] = tv(xi, yi + 1, 1); idx[fi++] = tv(xi, yi + 1, 0);
        }
      }
    }

    // --- OUTER WALLS (column top edges down to material bottom) ---
    // Front edge (yi = 0)
    for (var xi = 0; xi < xP; xi++) {
      idx[fi++] = bv(xi, 0); idx[fi++] = tv(xi, 0, 0); idx[fi++] = bv(xi + 1, 0);
      idx[fi++] = tv(xi, 0, 0); idx[fi++] = tv(xi, 0, 1); idx[fi++] = bv(xi + 1, 0);
    }
    // Back edge (yi = yP-1)
    for (var xi = 0; xi < xP; xi++) {
      idx[fi++] = tv(xi, yP - 1, 2); idx[fi++] = bv(xi, yP); idx[fi++] = tv(xi, yP - 1, 3);
      idx[fi++] = tv(xi, yP - 1, 3); idx[fi++] = bv(xi, yP); idx[fi++] = bv(xi + 1, yP);
    }
    // Left edge (xi = 0)
    for (var yi = 0; yi < yP; yi++) {
      idx[fi++] = tv(0, yi, 0); idx[fi++] = bv(0, yi); idx[fi++] = tv(0, yi, 2);
      idx[fi++] = tv(0, yi, 2); idx[fi++] = bv(0, yi); idx[fi++] = bv(0, yi + 1);
    }
    // Right edge (xi = xP-1)
    for (var yi = 0; yi < yP; yi++) {
      idx[fi++] = bv(xP, yi); idx[fi++] = tv(xP - 1, yi, 1); idx[fi++] = bv(xP, yi + 1);
      idx[fi++] = tv(xP - 1, yi, 1); idx[fi++] = tv(xP - 1, yi, 3); idx[fi++] = bv(xP, yi + 1);
    }

    return fi;
  }

  /**
   * Update mesh incrementally: update dirty vertex positions, rebuild indices.
   */
  self.updateMesh = function() {
    if (!heightMap || !posArr) return;

    if (!geometryCreated) {
      self.createFullMesh();
      dirtyRegions = [];
      return;
    }

    if (dirtyRegions.length === 0) return;

    var xP = heightMap.xPoints;

    // Update only dirty column top vertices (4 vertices per column, only Z changes)
    dirtyRegions.forEach(function(region) {
      for (var yi = region.yMin; yi <= region.yMax; yi++) {
        for (var xi = region.xMin; xi <= region.xMax; xi++) {
          var base = (yi * xP + xi) * 4 * 3;
          var h = getHeight(xi, yi);
          posArr[base + 2]  = h;  // vertex 0 Z
          posArr[base + 5]  = h;  // vertex 1 Z
          posArr[base + 8]  = h;  // vertex 2 Z
          posArr[base + 11] = h;  // vertex 3 Z
        }
      }
    });

    // Rebuild index buffer (wall topology may have changed)
    var indexCount = buildIndices();

    // Update GPU buffers
    posAttr.needsUpdate = true;
    idxAttr.needsUpdate = true;
    self.mesh.geometry.setDrawRange(0, indexCount);
    self.mesh.geometry.computeVertexNormals();

    dirtyRegions = [];
    update();
  };

  /**
   * Create the stepped column mesh (BufferGeometry with pre-allocated buffers).
   * Each grid point becomes a flat-topped column; vertical wall faces appear
   * only where adjacent column heights differ.
   */
  self.createFullMesh = function() {
    console.log('Creating stepped column material mesh...');

    // Dispose old meshes
    self.mesh = disposeMesh(self.mesh);
    self.wireMesh = disposeMesh(self.wireMesh);

    if (!heightMap || !posArr) return;

    // Fill all top vertex positions from current heightMap
    fillAllTopVertices();

    // Build index buffer
    var indexCount = buildIndices();

    // Create BufferGeometry with pre-allocated typed arrays
    var geometry = new THREE.BufferGeometry();
    posAttr = new THREE.BufferAttribute(posArr, 3);
    idxAttr = new THREE.BufferAttribute(idxArr, 1);
    geometry.setAttribute('position', posAttr);
    geometry.setIndex(idxAttr);
    geometry.setDrawRange(0, indexCount);
    geometry.computeVertexNormals();
    activeGeometries.push(geometry);

    // Create material (flat shading for clean stepped look)
    if (!meshMaterial) {
      meshMaterial = new THREE.MeshPhongMaterial({
        color: 0xD2B48C,
        specular: 0x222222,
        shininess: 20,
        transparent: true,
        opacity: self.opacity,
        side: THREE.DoubleSide,
        flatShading: true
      });
      activeMaterials.push(meshMaterial);
    }

    self.mesh = new THREE.Mesh(geometry, meshMaterial);
    self.mesh.visible = !!self.show;
    scene.add(self.mesh);

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

    // Clear transient state
    if (heightMap && heightMap.heights) {
      heightMap.heights = null;
    }
    heightMap = null;
    posArr = null;
    idxArr = null;
    posAttr = null;
    idxAttr = null;
    lastToolPos = null;
    isDirty = false;
    pendingUpdates = 0;
    lastUpdateTime = 0;
    dirtyRegions = [];
    geometryCreated = false;

    // RESTORE visibility preference
    self.show = wasVisible;

    // RE-INITIALIZE with saved parameters (allocates new buffers)
    if (savedBounds) {
      self.initialize(savedBounds, savedStockHeight, savedToolDia, savedMaterialTop);
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

    // Null out heightmap and buffers
    if (heightMap && heightMap.heights) {
      heightMap.heights = null;
    }
    heightMap = null;
    posArr = null;
    idxArr = null;
    posAttr = null;
    idxAttr = null;
    meshMaterial = null;

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
   * Reset height map to fresh stock without disposing geometry.
   * Used for timeline rewind — much lighter than full reset().
   */
  self.resetHeights = function() {
    if (!heightMap) return;
    for (var i = 0; i < heightMap.heights.length; i++) {
      heightMap.heights[i] = materialTop;
    }
    fillAllTopVertices();
    lastToolPos = null;
    isDirty = false;
    pendingUpdates = 0;
    dirtyRegions = [];
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
    if (meshMaterial) meshMaterial.opacity = opacity;
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