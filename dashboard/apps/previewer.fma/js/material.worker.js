/**
 * Material mesh worker.
 *
 * Off-main-thread builder for the initial uncut stepped-column mesh. The
 * caller transfers pre-allocated posArr / colorArr / idxArr buffers in,
 * along with the grid parameters; the worker fills the top vertices, all
 * indices, and per-vertex colors, then transfers the buffers back.
 *
 * Only the *initial* uncut mesh build runs here today — that's the path
 * that locks the UI on low-performance systems. Subsequent rebuilds during
 * and after cut application still run on the main thread (smaller work,
 * needs the live heightMap).
 *
 * Bottom vertices are filled by the main thread before transfer; the
 * worker does not touch them.
 */

'use strict';

self.onmessage = function (e) {
    var msg = e.data;
    if (!msg) return;

    if (msg.type === 'buildUncut') {
        var p = msg.params;
        var posArr = new Float32Array(msg.posBuf);
        var colorArr = new Float32Array(msg.colorBuf);
        var idxArr = new Uint32Array(msg.idxBuf);

        var indexCount = buildUncut(p, posArr, colorArr, idxArr);

        self.postMessage(
            {
                type: 'buildUncutDone',
                jobId: msg.jobId,
                posBuf: posArr.buffer,
                colorBuf: colorArr.buffer,
                idxBuf: idxArr.buffer,
                indexCount: indexCount,
                topVertCount: p.xPoints * p.yPoints * 4,
                botVertOffset: p.xPoints * p.yPoints * 4,
            },
            [posArr.buffer, colorArr.buffer, idxArr.buffer]
        );
        return;
    }

    if (msg.type === 'computeHeights') {
        var heights = new Float32Array(msg.heightsBuf);
        var jobId = msg.jobId;
        var cutCount = computeHeights(msg.params, msg.segments, heights, function (frac) {
            self.postMessage({ type: 'progress', jobId: jobId, frac: frac });
        });
        self.postMessage(
            {
                type: 'computeHeightsDone',
                jobId: jobId,
                heightsBuf: heights.buffer,
                cutCount: cutCount,
            },
            [heights.buffer]
        );
        return;
    }
};

function buildUncut(p, posArr, colorArr, idxArr) {
    var xPoints = p.xPoints;
    var yPoints = p.yPoints;
    var xStep = p.xStep;
    var yStep = p.yStep;
    var minX = p.boundsMinX;
    var minY = p.boundsMinY;
    var materialTop = p.materialTop;
    var baseColor = p.baseColor;
    var depthMin = p.depthMin;

    var topVertCount = xPoints * yPoints * 4;
    var botVertOffset = topVertCount;
    var hw = xStep / 2;
    var hh = yStep / 2;

    // --- Top vertices (all at materialTop for an uncut mesh) -----------------
    for (var yi = 0; yi < yPoints; yi++) {
        for (var xi = 0; xi < xPoints; xi++) {
            var base = (yi * xPoints + xi) * 4 * 3;
            var cx = minX + xi * xStep;
            var cy = minY + yi * yStep;
            posArr[base]      = cx - hw; posArr[base + 1]  = cy - hh; posArr[base + 2]  = materialTop;
            posArr[base + 3]  = cx + hw; posArr[base + 4]  = cy - hh; posArr[base + 5]  = materialTop;
            posArr[base + 6]  = cx - hw; posArr[base + 7]  = cy + hh; posArr[base + 8]  = materialTop;
            posArr[base + 9]  = cx + hw; posArr[base + 10] = cy + hh; posArr[base + 11] = materialTop;
        }
    }

    // --- Indices: top + bottom + outer walls (no internal walls — flat) ------
    var fi = 0;
    function tv(xi, yi, c) { return (yi * xPoints + xi) * 4 + c; }
    function bv(xi, yi) { return botVertOffset + yi * (xPoints + 1) + xi; }

    // Top faces
    for (yi = 0; yi < yPoints; yi++) {
        for (xi = 0; xi < xPoints; xi++) {
            idxArr[fi++] = tv(xi, yi, 0); idxArr[fi++] = tv(xi, yi, 1); idxArr[fi++] = tv(xi, yi, 2);
            idxArr[fi++] = tv(xi, yi, 1); idxArr[fi++] = tv(xi, yi, 3); idxArr[fi++] = tv(xi, yi, 2);
        }
    }
    // Bottom faces
    for (yi = 0; yi < yPoints; yi++) {
        for (xi = 0; xi < xPoints; xi++) {
            idxArr[fi++] = bv(xi, yi);     idxArr[fi++] = bv(xi, yi + 1); idxArr[fi++] = bv(xi + 1, yi);
            idxArr[fi++] = bv(xi + 1, yi); idxArr[fi++] = bv(xi, yi + 1); idxArr[fi++] = bv(xi + 1, yi + 1);
        }
    }
    // Outer walls — front (yi=0)
    for (xi = 0; xi < xPoints; xi++) {
        idxArr[fi++] = bv(xi, 0);    idxArr[fi++] = tv(xi, 0, 0); idxArr[fi++] = bv(xi + 1, 0);
        idxArr[fi++] = tv(xi, 0, 0); idxArr[fi++] = tv(xi, 0, 1); idxArr[fi++] = bv(xi + 1, 0);
    }
    // Back (yi=yP-1)
    for (xi = 0; xi < xPoints; xi++) {
        idxArr[fi++] = tv(xi, yPoints - 1, 2); idxArr[fi++] = bv(xi, yPoints);     idxArr[fi++] = tv(xi, yPoints - 1, 3);
        idxArr[fi++] = tv(xi, yPoints - 1, 3); idxArr[fi++] = bv(xi, yPoints);     idxArr[fi++] = bv(xi + 1, yPoints);
    }
    // Left (xi=0)
    for (yi = 0; yi < yPoints; yi++) {
        idxArr[fi++] = tv(0, yi, 0); idxArr[fi++] = bv(0, yi);     idxArr[fi++] = tv(0, yi, 2);
        idxArr[fi++] = tv(0, yi, 2); idxArr[fi++] = bv(0, yi);     idxArr[fi++] = bv(0, yi + 1);
    }
    // Right (xi=xP-1)
    for (yi = 0; yi < yPoints; yi++) {
        idxArr[fi++] = bv(xPoints, yi);           idxArr[fi++] = tv(xPoints - 1, yi, 1); idxArr[fi++] = bv(xPoints, yi + 1);
        idxArr[fi++] = tv(xPoints - 1, yi, 1);    idxArr[fi++] = tv(xPoints - 1, yi, 3); idxArr[fi++] = bv(xPoints, yi + 1);
    }

    // --- Colors: top of stock at full base color; bottom at depthMin --------
    var topColorBytes = topVertCount * 3;
    for (var i = 0; i < topColorBytes; i += 3) {
        colorArr[i]     = baseColor.r;
        colorArr[i + 1] = baseColor.g;
        colorArr[i + 2] = baseColor.b;
    }
    for (i = botVertOffset * 3; i < colorArr.length; i += 3) {
        colorArr[i]     = baseColor.r * depthMin;
        colorArr[i + 1] = baseColor.g * depthMin;
        colorArr[i + 2] = baseColor.b * depthMin;
    }

    return fi;
}

/**
 * Compute the per-cell minimum-Z heightmap from a list of tool segments.
 * Mirrors the math in material.js computeFromSegmentsAsync; runs straight
 * through here because we're off the main thread. Posts progress roughly
 * every PROGRESS_ROW_INTERVAL rows so the main thread can paint the bar.
 */
function computeHeights(p, segments, heights, onProgress) {
    var xP = p.xPoints, yP = p.yPoints;
    var xS = p.xStep, yS = p.yStep;
    var minX = p.boundsMinX, minY = p.boundsMinY;
    var maxX = p.boundsMaxX, maxY = p.boundsMaxY;
    var materialTop = p.materialTop;

    // Spatial grid bucket — identical to main-thread version.
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
    var gridW = Math.ceil((maxX - minX) / cellSize) + 1;
    var gridH = Math.ceil((maxY - minY) / cellSize) + 1;
    var grid = new Array(gridW * gridH);
    for (i = 0; i < grid.length; i++) grid[i] = null;

    for (i = 0; i < segments.length; i++) {
        seg = segments[i];
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
                var k = gy * gridW + gx;
                if (!grid[k]) grid[k] = [];
                grid[k].push(i);
            }
        }
    }

    var cutCount = 0;
    // Coarse-grained progress posting: yP/20 rows or every 32 rows minimum.
    var progressInterval = Math.max(32, Math.floor(yP / 20));
    var rowsSinceProgress = 0;

    for (var yi = 0; yi < yP; yi++) {
        var py = minY + yi * yS;
        var gyy = Math.floor((py - minY) / cellSize);
        if (gyy >= 0 && gyy < gridH) {
            for (var xi = 0; xi < xP; xi++) {
                var px = minX + xi * xS;
                var gxx = Math.floor((px - minX) / cellSize);
                if (gxx < 0 || gxx >= gridW) continue;
                var cell = grid[gyy * gridW + gxx];
                if (!cell) continue;

                var minZ = materialTop;
                for (var s = 0; s < cell.length; s++) {
                    seg = segments[cell[s]];
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
        if (++rowsSinceProgress >= progressInterval) {
            rowsSinceProgress = 0;
            if (onProgress) onProgress((yi + 1) / yP);
        }
    }
    if (onProgress) onProgress(1);
    return cutCount;
}
