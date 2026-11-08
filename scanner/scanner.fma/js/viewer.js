/* ScanViewer — three.js preview of a sweep scan (points or height surface).
 *
 * Data (from scand, all mm, machine axes, Z levelled to the table):
 *   points.bin   float32 x,y,z triples
 *   surface.bin  float32 height grid, rows = Y, cols = X, NaN = no data;
 *                geometry in scan.json "surface" {cell_mm, origin_mm, width, height}
 *
 * Z is up (camera.up = +Z). Uses the global THREE (r112) + THREE.OrbitControls.
 */
/* global THREE */
/* exported ScanViewer */

var ScanViewer = (function () {
    "use strict";

    // Turbo colormap (Google, polynomial approximation), t in [0,1]
    function turbo(t, out, o) {
        t = Math.max(0, Math.min(1, t));
        var t2 = t * t, t3 = t2 * t, t4 = t3 * t, t5 = t4 * t;
        out[o] = Math.max(0, Math.min(1, 0.13572138 + 4.61539260 * t - 42.66032258 * t2 +
            132.13108234 * t3 - 152.94239396 * t4 + 59.28637943 * t5));
        out[o + 1] = Math.max(0, Math.min(1, 0.09140261 + 2.19418839 * t + 4.84296658 * t2 -
            14.18503333 * t3 + 4.27729857 * t4 + 2.82956604 * t5));
        out[o + 2] = Math.max(0, Math.min(1, 0.10667330 + 12.64194608 * t - 60.58204836 * t2 +
            110.36276771 * t3 - 89.90310912 * t4 + 27.34824973 * t5));
    }

    function ScanViewer(container, opts) {
        this.el = container;
        this.opts = opts || {};
        this.mode = "surface";            // "surface" | "points"
        this.pointSize = 1.5;
        this.zRange = [0, 1];
        this.data = null;                 // {points, surface, meta}
        this.picks = [];
        this._init();
    }

    ScanViewer.prototype._init = function () {
        var w = this.el.clientWidth || 600, h = this.el.clientHeight || 400;
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.setSize(w, h);
        this.renderer.setClearColor(0x1e2126);
        this.el.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(40, w / h, 1, 20000);
        this.camera.up.set(0, 0, 1);
        this.camera.position.set(0, -300, 250);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.15;
        this.controls.screenSpacePanning = true;

        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 0.55));
        var key = new THREE.DirectionalLight(0xffffff, 0.75);
        key.position.set(-0.5, -1, 1.6);
        this.scene.add(key);
        var fill = new THREE.DirectionalLight(0xffffff, 0.25);
        fill.position.set(1, 0.6, 0.8);
        this.scene.add(fill);

        this.group = new THREE.Group();          // scan content
        this.scene.add(this.group);
        this.helpers = new THREE.Group();        // grid, markers
        this.scene.add(this.helpers);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        var self = this, down = null;
        this.renderer.domElement.addEventListener("pointerdown", function (e) {
            down = [e.clientX, e.clientY];
        });
        this.renderer.domElement.addEventListener("pointerup", function (e) {
            if (down && Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) < 5) {
                self._pick(e);
            }
            down = null;
        });

        window.addEventListener("resize", function () { self.resize(); });
        (function loop() {
            requestAnimationFrame(loop);
            self.controls.update();
            self.renderer.render(self.scene, self.camera);
        })();
    };

    ScanViewer.prototype.resize = function () {
        var w = this.el.clientWidth, h = this.el.clientHeight;
        if (!w || !h) { return; }
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    };

    ScanViewer.prototype._clear = function (grp) {
        while (grp.children.length) {
            var o = grp.children.pop();
            if (o.geometry) { o.geometry.dispose(); }
            if (o.material) { o.material.dispose(); }
        }
    };

    /* data: {points: Float32Array, surface: Float32Array|null, meta: scan.json} */
    ScanViewer.prototype.load = function (data) {
        this.data = data;
        this.picks = [];
        var p = data.points, n = p.length / 3, zs = new Float32Array(n);
        for (var i = 0; i < n; i++) { zs[i] = p[3 * i + 2]; }
        zs.sort();
        // colour range: table (0) up to the 99.5th percentile height
        this.zRange = [Math.min(0, zs[Math.floor(n * 0.005)]),
            Math.max(1, zs[Math.floor(n * 0.995)])];
        this._build();
        this.view("iso");
        if (this.opts.onPick) { this.opts.onPick([]); }
    };

    ScanViewer.prototype._colors = function (pos, nverts, out) {
        var lo = this.zRange[0], span = this.zRange[1] - lo;
        for (var i = 0; i < nverts; i++) {
            turbo(0.05 + 0.9 * (pos[3 * i + 2] - lo) / span, out, 3 * i);
        }
    };

    ScanViewer.prototype._build = function () {
        this._clear(this.group);
        this._clear(this.helpers);
        if (!this.data) { return; }
        if (this.mode === "surface" && this.data.surface) {
            this.group.add(this._surfaceMesh());
        } else {
            this.group.add(this._pointCloud());
        }
        this._grid();
        this._markers();
    };

    ScanViewer.prototype._pointCloud = function () {
        var p = this.data.points, n = p.length / 3;
        var g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(p, 3));
        var col = new Float32Array(p.length);
        this._colors(p, n, col);
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        g.computeBoundingSphere();
        var m = new THREE.PointsMaterial({ size: this.pointSize, sizeAttenuation: false,
            vertexColors: THREE.VertexColors });
        return new THREE.Points(g, m);
    };

    ScanViewer.prototype._surfaceMesh = function () {
        var s = this.data.meta.surface, grid = this.data.surface;
        var W = s.width, H = s.height, cell = s.cell_mm;
        var ox = s.origin_mm[0] + cell / 2, oy = s.origin_mm[1] + cell / 2;
        var pos = new Float32Array(W * H * 3);
        for (var r = 0; r < H; r++) {
            for (var c = 0; c < W; c++) {
                var k = r * W + c, z = grid[k];
                pos[3 * k] = ox + c * cell;
                pos[3 * k + 1] = oy + r * cell;
                pos[3 * k + 2] = isNaN(z) ? 0 : z;
            }
        }
        var idx = [];
        for (r = 0; r < H - 1; r++) {
            for (c = 0; c < W - 1; c++) {
                var a = r * W + c, b = a + 1, d = a + W, e = d + 1;
                var va = !isNaN(grid[a]), vb = !isNaN(grid[b]),
                    vd = !isNaN(grid[d]), ve = !isNaN(grid[e]);
                if (va && vb && ve) { idx.push(a, b, e); }
                if (va && ve && vd) { idx.push(a, e, d); }
                else if (!ve && va && vb && vd) { idx.push(a, b, d); }
                else if (!va && vb && ve && vd) { idx.push(b, e, d); }
            }
        }
        var g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        var col = new Float32Array(pos.length);
        this._colors(pos, W * H, col);
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        g.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1)
            : new THREE.Uint16BufferAttribute(idx, 1));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        var m = new THREE.MeshStandardMaterial({ vertexColors: THREE.VertexColors,
            roughness: 0.75, metalness: 0.0, side: THREE.DoubleSide });
        return new THREE.Mesh(g, m);
    };

    ScanViewer.prototype._bounds = function () {
        var b = this.data.meta.bounds_mm;
        return { min: new THREE.Vector3(b.min[0], b.min[1], b.min[2]),
            max: new THREE.Vector3(b.max[0], b.max[1], b.max[2]) };
    };

    ScanViewer.prototype._grid = function () {
        var b = this._bounds();
        var size = Math.ceil(Math.max(b.max.x - b.min.x, b.max.y - b.min.y) / 50) * 50 + 50;
        var gh = new THREE.GridHelper(size, size / 10, 0x50565f, 0x33373d);
        gh.rotation.x = Math.PI / 2;                    // XZ -> XY plane
        gh.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, -0.2);
        this.helpers.add(gh);
        var axes = new THREE.AxesHelper(25);
        axes.position.set(b.min.x, b.min.y, 0);
        this.helpers.add(axes);
    };

    ScanViewer.prototype._markers = function () {
        var self = this;
        this.picks.forEach(function (p, i) {
            var s = new THREE.Mesh(new THREE.SphereBufferGeometry(1.2, 12, 8),
                new THREE.MeshBasicMaterial({ color: i ? 0xff4fd8 : 0xffffff,
                    depthTest: false }));
            s.renderOrder = 10;
            s.position.copy(p);
            self.helpers.add(s);
        });
        if (this.picks.length === 2) {
            var g = new THREE.BufferGeometry().setFromPoints(this.picks);
            var l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff4fd8,
                depthTest: false }));
            l.renderOrder = 10;
            this.helpers.add(l);
        }
    };

    ScanViewer.prototype._pick = function (e) {
        if (!this.data) { return; }
        var rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        var dist = this.camera.position.distanceTo(this.controls.target);
        this.raycaster.params.Points.threshold = Math.max(0.3, dist * 0.004);
        var hits = this.raycaster.intersectObjects(this.group.children);
        if (!hits.length) { return; }
        var p = hits[0].point.clone();
        if (hits[0].object.isPoints && hits[0].index !== undefined) {
            var a = this.data.points, k = hits[0].index;
            p.set(a[3 * k], a[3 * k + 1], a[3 * k + 2]);
        }
        if (this.picks.length >= 2) { this.picks = []; }
        this.picks.push(p);
        this._clear(this.helpers);
        this._grid();
        this._markers();
        if (this.opts.onPick) { this.opts.onPick(this.picks); }
    };

    ScanViewer.prototype.clearPicks = function () {
        this.picks = [];
        if (this.data) { this._clear(this.helpers); this._grid(); }
        if (this.opts.onPick) { this.opts.onPick([]); }
    };

    ScanViewer.prototype.setMode = function (mode) {
        this.mode = mode;
        this._build();
    };

    ScanViewer.prototype.setPointSize = function (s) {
        this.pointSize = s;
        this.group.children.forEach(function (o) {
            if (o.isPoints) { o.material.size = s; }
        });
    };

    ScanViewer.prototype.view = function (which) {
        if (!this.data) { return; }
        var b = this._bounds();
        var c = b.min.clone().add(b.max).multiplyScalar(0.5);
        c.z = (this.zRange[0] + this.zRange[1]) / 2;
        var r = b.max.clone().sub(b.min).length() * 0.5;
        var d = r / Math.tan(THREE.MathUtils ? THREE.MathUtils.degToRad(20) : 0.349) * 1.05;
        var dirs = {
            iso: new THREE.Vector3(-0.55, -1, 0.85),
            top: new THREE.Vector3(0, -0.001, 1),
            front: new THREE.Vector3(0, -1, 0.02),
            side: new THREE.Vector3(1, 0, 0.02),
        };
        var v = (dirs[which] || dirs.iso).normalize().multiplyScalar(d);
        this.controls.target.copy(c);
        this.camera.position.copy(c).add(v);
        this.camera.near = Math.max(0.5, d / 100);
        this.camera.far = d * 20;
        this.camera.updateProjectionMatrix();
        this.controls.update();
    };

    ScanViewer.prototype.legend = function () {
        // CSS gradient + range for the colour legend
        var stops = [], c = [0, 0, 0];
        for (var i = 0; i <= 10; i++) {
            turbo(0.05 + 0.9 * i / 10, c, 0);
            stops.push("rgb(" + c.map(function (v) { return Math.round(v * 255); }).join(",") +
                ") " + (i * 10) + "%");
        }
        return { gradient: "linear-gradient(to right, " + stops.join(", ") + ")",
            min: this.zRange[0], max: this.zRange[1] };
    };

    return ScanViewer;
})();
