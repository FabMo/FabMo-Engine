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
  self.resolution = Math.min(parseInt(cookie.get('material-resolution', 1000)), 3000);
  
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
    var t0 = performance.now();
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

    var tInit = performance.now() - t0;
    console.log('Material initialized:', xPoints, 'x', yPoints, 'in', tInit.toFixed(0) + 'ms',
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
   * Compute the entire heightmap from an array of move segments at once.
   * Uses spatial indexing: index all segments, then for each grid point
   * find nearby segments and compute min Z analytically from distance.
   * Much faster for V-bits since the bevel is a simple distance calculation.
   *
   * segments: array of {start:[x,y,z], end:[x,y,z], toolType, toolDia, vbitAngle}
   */
  self.computeFromSegments = function(segments) {
    if (!heightMap || !segments.length) return;
    var t0 = performance.now();

    var xP = heightMap.xPoints;
    var yP = heightMap.yPoints;
    var xS = heightMap.xStep;
    var yS = heightMap.yStep;
    var minX = bounds.min.x;
    var minY = bounds.min.y;

    // 1. Build spatial grid index of segments
    // Cell size based on max tool influence radius
    var maxInfluence = 0;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var r = seg.toolDia / 2;
      if (seg.toolType === 'vbit') {
        // V-bit influence extends based on depth
        var maxDepth = Math.max(
          Math.abs(seg.start[2] - materialTop),
          Math.abs(seg.end[2] - materialTop)
        );
        var angleRad = (seg.vbitAngle / 2) * Math.PI / 180;
        r = Math.max(r, maxDepth * Math.tan(angleRad));
      }
      if (r > maxInfluence) maxInfluence = r;
    }
    // Add margin for grid cell half-width
    maxInfluence += Math.max(xS, yS);

    var cellSize = Math.max(maxInfluence * 2, Math.max(xS, yS) * 4);
    var gridW = Math.ceil((bounds.max.x - minX) / cellSize) + 1;
    var gridH = Math.ceil((bounds.max.y - minY) / cellSize) + 1;

    // Hash grid: array of arrays
    var grid = new Array(gridW * gridH);
    for (var i = 0; i < grid.length; i++) grid[i] = null;

    function gridKey(gx, gy) { return gy * gridW + gx; }

    // Insert each segment into all grid cells it touches
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var sx = seg.start, ex = seg.end;
      var x0 = Math.min(sx[0], ex[0]) - maxInfluence;
      var x1 = Math.max(sx[0], ex[0]) + maxInfluence;
      var y0 = Math.min(sx[1], ex[1]) - maxInfluence;
      var y1 = Math.max(sx[1], ex[1]) + maxInfluence;

      var gx0 = Math.max(0, Math.floor((x0 - minX) / cellSize));
      var gx1 = Math.min(gridW - 1, Math.floor((x1 - minX) / cellSize));
      var gy0 = Math.max(0, Math.floor((y0 - minY) / cellSize));
      var gy1 = Math.min(gridH - 1, Math.floor((y1 - minY) / cellSize));

      for (var gy = gy0; gy <= gy1; gy++) {
        for (var gx = gx0; gx <= gx1; gx++) {
          var k = gridKey(gx, gy);
          if (!grid[k]) grid[k] = [];
          grid[k].push(i);
        }
      }
    }

    var t1 = performance.now();

    // 2. For each heightmap grid point, find nearby segments and compute min Z
    var heights = heightMap.heights;
    var cutCount = 0;

    for (var yi = 0; yi < yP; yi++) {
      var py = minY + yi * yS;
      var gy = Math.floor((py - minY) / cellSize);
      if (gy < 0 || gy >= gridH) continue;

      for (var xi = 0; xi < xP; xi++) {
        var px = minX + xi * xS;
        var gx = Math.floor((px - minX) / cellSize);
        if (gx < 0 || gx >= gridW) continue;

        var cell = grid[gridKey(gx, gy)];
        if (!cell) continue;

        var minZ = materialTop;

        for (var s = 0; s < cell.length; s++) {
          var seg = segments[cell[s]];
          var sx = seg.start, ex = seg.end;

          // Perpendicular distance from point to segment
          var dx = ex[0] - sx[0];
          var dy = ex[1] - sx[1];
          var lenSq = dx * dx + dy * dy;
          var t;
          if (lenSq < 0.000001) {
            t = 0;
          } else {
            t = ((px - sx[0]) * dx + (py - sx[1]) * dy) / lenSq;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
          }

          // Closest point on segment and interpolated Z
          var cx = sx[0] + t * dx;
          var cy = sx[1] + t * dy;
          var cz = sx[2] + t * (ex[2] - sx[2]);

          var dist = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));

          // Compute tool bottom Z at this distance
          var segDia = seg.toolDia;
          var segRadius = segDia / 2;
          var z;

          if (seg.toolType === 'vbit') {
            var angleRad = (seg.vbitAngle / 2) * Math.PI / 180;
            var tanHalf = Math.tan(angleRad);
            // V-bit: depth at center = cz, shallower as distance increases
            z = cz + dist / tanHalf;
            // Clamp to material surface
            if (z >= materialTop) continue;
          } else if (seg.toolType === 'ball') {
            if (dist > segRadius) continue;
            z = cz + segRadius - Math.sqrt(segRadius * segRadius - dist * dist);
          } else {
            // Flat end mill
            if (dist > segRadius) continue;
            z = cz;
          }

          if (z < minZ) minZ = z;
        }

        if (minZ < materialTop) {
          heights[yi * xP + xi] = minZ;
          cutCount++;
        }
      }
    }

    isDirty = cutCount > 0;
    pendingUpdates = cutCount;

    var t2 = performance.now();
    console.log('computeFromSegments: ' + segments.length + ' segments, ' +
                cutCount + ' cells cut, index=' + (t1 - t0).toFixed(0) +
                'ms, compute=' + (t2 - t1).toFixed(0) + 'ms, total=' + (t2 - t0).toFixed(0) + 'ms');
  };

  /**
   * Async version of computeFromSegments that yields between row batches
   * so the browser can paint progress updates.
   *   onProgress(fraction) — called with 0..1
   *   onDone() — called when complete
   */
  self.computeFromSegmentsAsync = function(segments, onProgress, onDone) {
    if (!heightMap || !segments.length) { if (onDone) onDone(); return; }
    var t0 = performance.now();

    var xP = heightMap.xPoints;
    var yP = heightMap.yPoints;
    var xS = heightMap.xStep;
    var yS = heightMap.yStep;
    var minX = bounds.min.x;
    var minY = bounds.min.y;
    var heights = heightMap.heights;

    // Build spatial grid (same as sync version)
    var maxInfluence = 0;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var r = seg.toolDia / 2;
      if (seg.toolType === 'vbit') {
        var maxDepth = Math.max(
          Math.abs(seg.start[2] - materialTop),
          Math.abs(seg.end[2] - materialTop)
        );
        var angleRad = (seg.vbitAngle / 2) * Math.PI / 180;
        r = Math.max(r, maxDepth * Math.tan(angleRad));
      }
      if (r > maxInfluence) maxInfluence = r;
    }
    maxInfluence += Math.max(xS, yS);
    var cellSize = Math.max(maxInfluence * 2, Math.max(xS, yS) * 4);
    var gridW = Math.ceil((bounds.max.x - minX) / cellSize) + 1;
    var gridH = Math.ceil((bounds.max.y - minY) / cellSize) + 1;
    var grid = new Array(gridW * gridH);
    for (var i = 0; i < grid.length; i++) grid[i] = null;
    function gridKey(gx, gy) { return gy * gridW + gx; }

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var sx = seg.start, ex = seg.end;
      var x0 = Math.min(sx[0], ex[0]) - maxInfluence;
      var x1 = Math.max(sx[0], ex[0]) + maxInfluence;
      var y0 = Math.min(sx[1], ex[1]) - maxInfluence;
      var y1 = Math.max(sx[1], ex[1]) + maxInfluence;
      var gx0 = Math.max(0, Math.floor((x0 - minX) / cellSize));
      var gx1 = Math.min(gridW - 1, Math.floor((x1 - minX) / cellSize));
      var gy0 = Math.max(0, Math.floor((y0 - minY) / cellSize));
      var gy1 = Math.min(gridH - 1, Math.floor((y1 - minY) / cellSize));
      for (var gy = gy0; gy <= gy1; gy++) {
        for (var gx = gx0; gx <= gx1; gx++) {
          var k = gridKey(gx, gy);
          if (!grid[k]) grid[k] = [];
          grid[k].push(i);
        }
      }
    }

    // Process rows in batches
    var rowPos = 0;
    var rowsPerBatch = Math.max(1, Math.floor(yP / 20)); // ~20 progress steps
    var cutCount = 0;

    function processBatch() {
      var rowEnd = Math.min(rowPos + rowsPerBatch, yP);
      for (var yi = rowPos; yi < rowEnd; yi++) {
        var py = minY + yi * yS;
        var gyy = Math.floor((py - minY) / cellSize);
        if (gyy < 0 || gyy >= gridH) continue;

        for (var xi = 0; xi < xP; xi++) {
          var px = minX + xi * xS;
          var gx = Math.floor((px - minX) / cellSize);
          if (gx < 0 || gx >= gridW) continue;
          var cell = grid[gridKey(gx, gyy)];
          if (!cell) continue;

          var minZ = materialTop;
          for (var s = 0; s < cell.length; s++) {
            var seg = segments[cell[s]];
            var ssx = seg.start, eex = seg.end;
            var dx = eex[0] - ssx[0];
            var dy = eex[1] - ssx[1];
            var lenSq = dx * dx + dy * dy;
            var t;
            if (lenSq < 0.000001) { t = 0; }
            else {
              t = ((px - ssx[0]) * dx + (py - ssx[1]) * dy) / lenSq;
              if (t < 0) t = 0; else if (t > 1) t = 1;
            }
            var cx = ssx[0] + t * dx;
            var cy = ssx[1] + t * dy;
            var cz = ssx[2] + t * (eex[2] - ssx[2]);
            var dist = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
            var segRadius = seg.toolDia / 2;
            var z;
            if (seg.toolType === 'vbit') {
              var tanHalf = Math.tan((seg.vbitAngle / 2) * Math.PI / 180);
              z = cz + dist / tanHalf;
              if (z >= materialTop) continue;
            } else if (seg.toolType === 'ball') {
              if (dist > segRadius) continue;
              z = cz + segRadius - Math.sqrt(segRadius * segRadius - dist * dist);
            } else {
              if (dist > segRadius) continue;
              z = cz;
            }
            if (z < minZ) minZ = z;
          }
          if (minZ < materialTop) {
            heights[yi * xP + xi] = minZ;
            cutCount++;
          }
        }
      }

      rowPos = rowEnd;
      if (onProgress) onProgress(rowPos / yP);

      if (rowPos < yP) {
        setTimeout(processBatch, 0);
      } else {
        isDirty = cutCount > 0;
        pendingUpdates = cutCount;
        var t2 = performance.now();
        console.log('computeFromSegmentsAsync: ' + segments.length + ' segments, ' +
                    cutCount + ' cells cut, total=' + (t2 - t0).toFixed(0) + 'ms');
        if (onDone) onDone();
      }
    }

    processBatch();
  };

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
        var gridSpacing = Math.min(heightMap.xStep, heightMap.yStep);
        var steps = Math.max(2, Math.ceil(totalDist / (gridSpacing * 0.5)));

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
  self.forceUpdate = function(useSparse) {
    if (isDirty) {
      console.log('Forcing final material update: ' + pendingUpdates + ' pending changes');
      self.createFullMesh();
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

    dirtyRegions = [];
    update();
  };

  /**
   * Create the stepped column mesh (BufferGeometry with pre-allocated buffers).
   * Each grid point becomes a flat-topped column; vertical wall faces appear
   * only where adjacent column heights differ.
   */
  self.createFullMesh = function() {
    var t0 = performance.now();

    // Dispose old meshes
    self.mesh = disposeMesh(self.mesh);
    self.wireMesh = disposeMesh(self.wireMesh);

    if (!heightMap || !posArr) return;

    // Fill all top vertex positions from current heightMap
    fillAllTopVertices();
    var t1 = performance.now();

    // Build index buffer
    var indexCount = buildIndices();
    var t2 = performance.now();

    // Create BufferGeometry with pre-allocated typed arrays
    var geometry = new THREE.BufferGeometry();
    posAttr = new THREE.BufferAttribute(posArr, 3);
    idxAttr = new THREE.BufferAttribute(idxArr, 1);
    geometry.setAttribute('position', posAttr);
    geometry.setIndex(idxAttr);
    geometry.setDrawRange(0, indexCount);
    // Skip computeVertexNormals — flatShading computes face normals in the shader
    geometry.computeBoundingSphere();
    activeGeometries.push(geometry);

    // Create material (opaque solid stock with flat shading)
    if (!meshMaterial) {
      meshMaterial = new THREE.MeshPhongMaterial({
        color: 0xD2B48C,
        specular: 0x222222,
        shininess: 20,
        side: THREE.DoubleSide,
        flatShading: true
      });
      activeMaterials.push(meshMaterial);
    }

    self.mesh = new THREE.Mesh(geometry, meshMaterial);
    self.mesh.visible = !!self.show;
    scene.add(self.mesh);

    geometryCreated = true;
    var t3 = performance.now();
    console.log('createFullMesh: fillVerts=' + (t1-t0).toFixed(0) + 'ms, buildIndices=' + (t2-t1).toFixed(0) + 'ms, geometry+normals=' + (t3-t2).toFixed(0) + 'ms, total=' + (t3-t0).toFixed(0) + 'ms');
    update();
  };

  /**
   * Create a sparse mesh: only build geometry for cells that were actually cut,
   * plus a single flat quad as the uncut surface. Dramatically fewer vertices
   * when cuts cover a small fraction of the workpiece.
   */
  self.createSparseMesh = function() {
    var t0 = performance.now();

    self.mesh = disposeMesh(self.mesh);
    self.wireMesh = disposeMesh(self.wireMesh);
    if (!heightMap) return;

    var xP = heightMap.xPoints;
    var yP = heightMap.yPoints;
    var xS = heightMap.xStep;
    var yS = heightMap.yStep;

    // 1. Find active cells (cut or within margin of cut)
    var active = new Uint8Array(xP * yP); // 0=inactive, 1=active
    var activeCells = [];
    var margin = 3; // cells of uncut surface to show around each cut
    for (var yi = 0; yi < yP; yi++) {
      for (var xi = 0; xi < xP; xi++) {
        if (getHeight(xi, yi) < materialTop) {
          for (var dy = -margin; dy <= margin; dy++) {
            for (var dx = -margin; dx <= margin; dx++) {
              var nx = xi + dx, ny = yi + dy;
              if (nx >= 0 && nx < xP && ny >= 0 && ny < yP) {
                active[ny * xP + nx] = 1;
              }
            }
          }
        }
      }
    }

    // Collect active cell list
    for (var i = 0; i < active.length; i++) {
      if (active[i]) activeCells.push(i);
    }

    var t1 = performance.now();
    var nActive = activeCells.length;

    // 2. Build compact vertex + index arrays for active cells only
    // Each active cell gets 4 top vertices + 4 bottom vertices.
    var vertsPerCell = 8;
    var totalVerts = nActive * vertsPerCell;
    var sparsePos = new Float32Array(totalVerts * 3);
    // Max faces: 2 top + 2 bottom + 4 walls per cell
    var maxIdx = nActive * 10 * 3;
    var sparseIdx = new Uint32Array(maxIdx);

    // Map from grid index to vertex base
    var cellVertBase = new Int32Array(xP * yP);
    cellVertBase.fill(-1);

    var hw = xS / 2, hh = yS / 2;
    var bottomZ = materialTop - stockHeight;
    var vi = 0; // vertex write position (in floats / 3)

    for (var c = 0; c < nActive; c++) {
      var gi = activeCells[c];
      var xi = gi % xP, yi = (gi - xi) / xP;
      cellVertBase[gi] = c * vertsPerCell;

      var cx = bounds.min.x + xi * xS;
      var cy = bounds.min.y + yi * yS;
      var h = getHeight(xi, yi);
      var b = (c * vertsPerCell) * 3;

      // Top 4 vertices (0-3): NL, NR, FL, FR
      sparsePos[b]    = cx-hw; sparsePos[b+1]  = cy-hh; sparsePos[b+2]  = h;
      sparsePos[b+3]  = cx+hw; sparsePos[b+4]  = cy-hh; sparsePos[b+5]  = h;
      sparsePos[b+6]  = cx-hw; sparsePos[b+7]  = cy+hh; sparsePos[b+8]  = h;
      sparsePos[b+9]  = cx+hw; sparsePos[b+10] = cy+hh; sparsePos[b+11] = h;
      // Bottom 4 vertices (4-7): NL, NR, FL, FR
      sparsePos[b+12] = cx-hw; sparsePos[b+13] = cy-hh; sparsePos[b+14] = bottomZ;
      sparsePos[b+15] = cx+hw; sparsePos[b+16] = cy-hh; sparsePos[b+17] = bottomZ;
      sparsePos[b+18] = cx-hw; sparsePos[b+19] = cy+hh; sparsePos[b+20] = bottomZ;
      sparsePos[b+21] = cx+hw; sparsePos[b+22] = cy+hh; sparsePos[b+23] = bottomZ;
    }

    var t2 = performance.now();

    // 3. Build indices
    var fi = 0;
    var idx = sparseIdx;

    for (var c = 0; c < nActive; c++) {
      var gi = activeCells[c];
      var xi = gi % xP, yi = (gi - xi) / xP;
      var v = c * vertsPerCell;
      var h = getHeight(xi, yi);

      // Top face
      idx[fi++] = v; idx[fi++] = v+1; idx[fi++] = v+2;
      idx[fi++] = v+1; idx[fi++] = v+3; idx[fi++] = v+2;

      // Bottom face
      idx[fi++] = v+4; idx[fi++] = v+6; idx[fi++] = v+5;
      idx[fi++] = v+5; idx[fi++] = v+6; idx[fi++] = v+7;

      // Walls — only where neighbor is inactive or has different height
      // Front wall (yi-1 direction)
      var nIdx = yi > 0 ? (yi-1)*xP+xi : -1;
      if (nIdx < 0 || !active[nIdx] || getHeight(xi, yi-1) !== h) {
        idx[fi++] = v+4; idx[fi++] = v+5; idx[fi++] = v;
        idx[fi++] = v+5; idx[fi++] = v+1; idx[fi++] = v;
      }
      // Back wall (yi+1 direction)
      nIdx = yi < yP-1 ? (yi+1)*xP+xi : -1;
      if (nIdx < 0 || !active[nIdx] || getHeight(xi, yi+1) !== h) {
        idx[fi++] = v+2; idx[fi++] = v+3; idx[fi++] = v+6;
        idx[fi++] = v+3; idx[fi++] = v+7; idx[fi++] = v+6;
      }
      // Left wall (xi-1 direction)
      nIdx = xi > 0 ? yi*xP+(xi-1) : -1;
      if (nIdx < 0 || !active[nIdx] || getHeight(xi-1, yi) !== h) {
        idx[fi++] = v+4; idx[fi++] = v; idx[fi++] = v+6;
        idx[fi++] = v; idx[fi++] = v+2; idx[fi++] = v+6;
      }
      // Right wall (xi+1 direction)
      nIdx = xi < xP-1 ? yi*xP+(xi+1) : -1;
      if (nIdx < 0 || !active[nIdx] || getHeight(xi+1, yi) !== h) {
        idx[fi++] = v+1; idx[fi++] = v+5; idx[fi++] = v+3;
        idx[fi++] = v+5; idx[fi++] = v+7; idx[fi++] = v+3;
      }
    }

    var t3 = performance.now();

    // 4. Create THREE.js geometry
    var geometry = new THREE.BufferGeometry();
    var pa = new THREE.BufferAttribute(sparsePos, 3);
    var ia = new THREE.BufferAttribute(sparseIdx, 1);
    geometry.setAttribute('position', pa);
    geometry.setIndex(ia);
    geometry.setDrawRange(0, fi);
    geometry.computeBoundingSphere();
    activeGeometries.push(geometry);

    var sparseMat = new THREE.MeshPhongMaterial({
      color: 0xD2B48C,
      specular: 0x222222,
      shininess: 20,
      side: THREE.DoubleSide,
      flatShading: true
    });
    activeMaterials.push(sparseMat);

    self.mesh = new THREE.Mesh(geometry, sparseMat);
    self.mesh.visible = !!self.show;
    scene.add(self.mesh);

    // Translucent stock block showing the full workpiece volume
    self.wireMesh = disposeMesh(self.wireMesh);
    var stockW = bounds.max.x - bounds.min.x;
    var stockD = bounds.max.y - bounds.min.y;
    var stockGeo = new THREE.BoxBufferGeometry(stockW, stockD, stockHeight);
    var stockMat = new THREE.MeshPhongMaterial({
      color: 0xD2B48C,
      specular: 0x111111,
      shininess: 10,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    });
    activeMaterials.push(stockMat);
    activeGeometries.push(stockGeo);
    self.wireMesh = new THREE.Mesh(stockGeo, stockMat);
    self.wireMesh.position.set(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      materialTop - stockHeight / 2
    );
    self.wireMesh.visible = !!self.show;
    scene.add(self.wireMesh);

    geometryCreated = true;

    var t4 = performance.now();
    console.log('createSparseMesh: ' + nActive + ' of ' + (xP*yP) + ' cells active (' +
                (100*nActive/(xP*yP)).toFixed(1) + '%), scan=' + (t1-t0).toFixed(0) +
                'ms, verts=' + (t2-t1).toFixed(0) + 'ms, indices=' + (t3-t2).toFixed(0) +
                'ms, geometry=' + (t4-t3).toFixed(0) + 'ms, total=' + (t4-t0).toFixed(0) + 'ms');
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
    self.resolution = Math.min(parseInt(resolution), 3000);
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

  // Lightweight tool updates for per-operation changes during simulation.
  // These update internal state without triggering a full material reset.
  self.setSimToolDiameter = function(diameter) {
    toolDia = parseFloat(diameter);
  };
  self.setSimToolType = function(type) {
    self.toolType = type;
  };
  self.setSimVbitAngle = function(angle) {
    self.vbitAngle = parseFloat(angle);
  };

  // Initialize settings connections
  util.connectSetting('show-material', self.show, self.setShow);
  util.connectSetting('material-opacity', self.opacity, self.setOpacity);
  util.connectSetting('material-resolution', self.resolution, self.setResolution);
  // Tool settings are now per-operation in the operations panel;
  // setSimToolDiameter/setSimToolType/setSimVbitAngle handle live updates.
};