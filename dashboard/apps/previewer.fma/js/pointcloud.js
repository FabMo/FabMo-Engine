/**
 * Point Cloud visualization for leveler height mapping.
 * Displays the triangulated surface from the point cloud data.
 */

'use strict';

var util = require('./util');
var cookie = require('./cookie');
var triangulate = require('delaunay-triangulate'); // Add this

module.exports = function(scene, update) {
  var self = this;

  self.mesh = null;
  self.wireframe = null;
  self.show = parseInt(cookie.get('show-pointcloud', 0));
  self.showWireframe = parseInt(cookie.get('show-pointcloud-wireframe', 1));
  self.opacity = parseFloat(cookie.get('pointcloud-opacity', 0.3));

  // Parse XYZ format point cloud data
  function parsePointCloudData(data) {
    var lines = data.trim().split('\n');
    var points = [];
    
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.length === 0 || line[0] === '#') continue;
      
      var coords = line.split(/\s+/);
      if (coords.length >= 3) {
        points.push([
          parseFloat(coords[0]),
          parseFloat(coords[1]),
          parseFloat(coords[2])
        ]);
      }
    }
    return points;
  }

  // Create color gradient based on height
  function getHeightColor(z, minZ, maxZ) {
    var normalized = (z - minZ) / (maxZ - minZ);
    var hue = (1 - normalized) * 240; // Blue (240) to Red (0)
    var color = new THREE.Color();
    color.setHSL(hue / 360, 0.8, 0.5);
    return color;
  }

  // Load and display point cloud from file path
  self.loadFromFile = function(filePath, callback) {
    if (!filePath) {
      console.log('No point cloud file specified');
      if (callback) callback();
      return;
    }

    // Extract just the filename from the full path
    var filename = filePath.split('/').pop();
    
    // Use the pointcloud route to fetch the file
    $.ajax({
      url: '/pointcloud/' + filename,
      type: 'GET',
      dataType: 'text',
      success: function(data) {
        console.log('Point cloud file loaded, parsing...');
        self.loadFromData(data);
        if (callback) callback();
      },
      error: function(err) {
        console.error('Failed to load point cloud file:', err);
        if (callback) callback(err);
      }
    });
  };

  // Create mesh from point cloud data
  self.loadFromData = function(data) {
    // Remove existing meshes
    if (self.mesh) scene.remove(self.mesh);
    if (self.wireframe) scene.remove(self.wireframe);

    var points = parsePointCloudData(data);
    if (points.length < 3) {
      console.error('Not enough points in point cloud');
      return;
    }

    // Find Z range for color mapping
    var minZ = Infinity, maxZ = -Infinity;
    for (var i = 0; i < points.length; i++) {
      minZ = Math.min(minZ, points[i][2]);
      maxZ = Math.max(maxZ, points[i][2]);
    }

    // Convert to 2D for triangulation
    var points2D = points.map(function(p) { return [p[0], p[1]]; });
    
    // Triangulate
    var triangles = triangulate(points2D);

    // Create THREE.js geometry
    var geometry = new THREE.Geometry();
    
    // Add vertices
    for (i = 0; i < points.length; i++) {
      var vertex = new THREE.Vector3(points[i][0], points[i][1], points[i][2]);
      geometry.vertices.push(vertex);
      geometry.colors.push(getHeightColor(points[i][2], minZ, maxZ));
    }

    // Add faces
    for (i = 0; i < triangles.length; i++) {
      var face = new THREE.Face3(
        triangles[i][0],
        triangles[i][1],
        triangles[i][2]
      );
      
      // Set vertex colors for face
      face.vertexColors = [
        geometry.colors[triangles[i][0]],
        geometry.colors[triangles[i][1]],
        geometry.colors[triangles[i][2]]
      ];
      
      geometry.faces.push(face);
    }

    geometry.computeFaceNormals();
    geometry.computeVertexNormals();

    // Create material
    var material = new THREE.MeshPhongMaterial({
      vertexColors: THREE.VertexColors,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: self.opacity,
      shininess: 30,
      flatShading: false
    });

    // Create mesh
    self.mesh = new THREE.Mesh(geometry, material);
    self.mesh.visible = !!self.show;
    scene.add(self.mesh);

    // Create wireframe
    var wireframeGeo = new THREE.WireframeGeometry(geometry);
    var wireframeMat = new THREE.LineBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.5
    });
    self.wireframe = new THREE.LineSegments(wireframeGeo, wireframeMat);
    self.wireframe.visible = !!self.show && !!self.showWireframe;
    scene.add(self.wireframe);

    update();
  };

  // Toggle visibility
  self.setShow = function(show) {
    self.show = show;
    if (self.mesh) self.mesh.visible = !!show;
    if (self.wireframe) self.wireframe.visible = !!show && !!self.showWireframe;
    cookie.set('show-pointcloud', show ? 1 : 0);
    update();
  };

  // Toggle wireframe
  self.setShowWireframe = function(show) {
    self.showWireframe = show;
    if (self.wireframe) self.wireframe.visible = !!show && !!self.show;
    cookie.set('show-pointcloud-wireframe', show ? 1 : 0);
    update();
  };

  // Set opacity
  self.setOpacity = function(opacity) {
    self.opacity = opacity;
    if (self.mesh) self.mesh.material.opacity = opacity;
    cookie.set('pointcloud-opacity', opacity);
    update();
  };

  // Initialize settings connections
  util.connectSetting('show-pointcloud', self.show, self.setShow);
  util.connectSetting('show-pointcloud-wireframe', self.showWireframe, self.setShowWireframe);
  util.connectSetting('pointcloud-opacity', self.opacity, self.setOpacity);
};