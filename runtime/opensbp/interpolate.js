// TODO - Gordon provide documentation here?

var fs = require("fs");
var log = require("../../log").logger("sbp");
var config = require("../../config");

//  Interpolate_Line - is used to interpolate a line into smaller segments.
//
//  Usage: lineInterpolate(<EndPt>)
//
exports.lineInterpolate = function (runtime, EndPt) {
    log.debug("lineInterpolate: EndPt = " + JSON.stringify(EndPt));
    var startX = runtime.cmd_posx;
    var startY = runtime.cmd_posy;
    var startZ = runtime.cmd_posz;
    var endX = startX;
    if ("X" in EndPt && EndPt.X !== undefined) {
        endX = EndPt.X;
    }
    var endY = startY;
    if ("Y" in EndPt && EndPt.Y !== undefined) {
        endY = EndPt.Y;
    }
    var endZ = startZ;
    if ("Z" in EndPt && EndPt.Z !== undefined) {
        endZ = EndPt.Z;
        log.debug("Z = " + endZ);
    }
    var speed = EndPt.F;
    var segLen = config.opensbp.get("cRes");
    log.debug("segLen = " + segLen);
    //distance = sqrt[width^2 + length^2 + height^2]
    log.debug(
        "startX = " + startX + " startY = " + startY + " startZ = " + startZ
    );
    log.debug("endX = " + endX + " endY = " + endY + " endZ = " + endZ);
    var lineLen = Math.sqrt(
        Math.pow(endX - startX, 2) +
            Math.pow(endY - startY, 2) +
            Math.pow(endZ - startZ, 2)
    );
    log.debug("lineLen = " + lineLen);
    if (lineLen === 0) {
        throw "lineInterpolate: line length zero";
    }
    var steps = Math.floor(lineLen / segLen);
    var stepX = (endX - startX) / steps;
    var stepY = (endY - startY) / steps;
    var stepZ = (endZ - startZ) / steps;
    var gcode = "";
    var level = runtime.transforms.level.apply;
    var PtFilename = runtime.transforms.level.ptDataFile;
    var PtData = "";
    if (level === true) {
        PtData = fs.readFileSync(PtFilename);
        PtData = JSON.parse(PtData);
    }
    for (var i = 1; i < steps + 1; i++) {
        var nextPt = {};
        gcode = "G1";

        if (stepX !== 0) {
            nextPt.X = startX + stepX * i;
        } else {
            nextPt.X = runtime.cmd_posx;
        }

        if (stepY !== 0) {
            nextPt.Y = startY + stepY * i;
        } else {
            nextPt.Y = runtime.cmd_posy;
        }

        if (stepZ !== 0) {
            nextPt.Z = startZ + stepZ * i;
        } else {
            if (level === true) {
                nextPt.Z = runtime.cmd_posz;
            }
        }

        if (level === true) {
            nextPt.Z = leveler(nextPt, PtData);
        }

        for (var key in nextPt) {
            var v = nextPt[key];
            log.debug(" lineInterpolate v = " + v);
            if (v !== undefined) {
                if (isNaN(v)) {
                    var err = new Error("Invalid " + key + " argument: " + v);
                    log.error(err);
                    throw err;
                }
                gcode += key + v.toFixed(5);
                if (key === "X") {
                    runtime.cmd_posx = v;
                } else if (key === "Y") {
                    runtime.cmd_posy = v;
                } else if (key === "Z") {
                    runtime.cmd_posz = v;
                } else if (key === "A") {
                    runtime.cmd_posa = v;
                } else if (key === "B") {
                    runtime.cmd_posb = v;
                } else if (key === "C") {
                    runtime.cmd_posc = v;
                }
            }
        }

        gcode += "F" + speed;
        runtime.emit_gcode(gcode);
    }

    return;
};

function leveler(PtNew, data) {
    log.debug("leveler data = " + JSON.stringify(data));
    var zA = 0;
    var zB = 0;
    var zP = 0;
    var count = Object.keys(data).length;
    if (count === 4) {
        log.debug("leveler_4-point: num keys = " + count);
        zA =
            data.P1.z +
            (data.P2.z - data.P1.z) *
                ((PtNew.X - data.P1.x) / (data.P2.x - data.P1.x));
        log.debug("leveler: zA = " + zA);
        zB =
            data.P4.z +
            (data.P3.z - data.P4.z) *
                ((PtNew.X - data.P4.x) / (data.P3.x - data.P4.x));
        log.debug("leveler: zB = " + zB);
        zP = zA - (zB - zA) * ((PtNew.Y - data.P1.y) / (data.P4.y - data.P1.y));
        log.debug("leveler: zP = " + zP);
        zP += PtNew.Z;
        log.debug("zP = " + zP + "   PtZ = " + PtNew.Z);
        return zP;
    } else {
        log.debug("leveler_multi-point: num keys = " + count);
        //TODO: unmarked TODO
        // **************Move to higher level so that the objcet only has to be
        // created once for the file run.
        // Read point data

        // Organize points

        // Create triangles
        // *****************************************************
        var triangles = {};
        var pX = PtNew.X;
        var pY = PtNew.Y;
        //Search for the triangle that the point intersects
        for (var key in triangles) {
            if (
                (triangles[key].Y1 > pY ||
                    triangles[key].Y2 > pY ||
                    triangles[key].Y3 > pY) &&
                (triangles[key].Y1 < pY ||
                    triangles[key].Y2 < pY ||
                    triangles[key].Y3 < pY)
            ) {
                if (
                    (triangles[key].X1 > pX ||
                        triangles[key].X2 > pX ||
                        triangles[key].Y3 > pX) &&
                    (triangles[key].X1 < pX ||
                        triangles[key].X2 < pX ||
                        triangles[key].Y3 < pX)
                ) {
                    //Calculate the Z Height
                    // Find X line that intersects triangle

                    // Find Z at Y intersection of X line
                    zP += PtNew.Z;
                    log.debug("zP = " + zP + "   PtZ = " + PtNew.Z);
                    return zP;
                }
            }
        }
    }
    return PtNew.Z;
}

//  Interpolate_Circle - is used to interpolate a circle that has uneven proportions as an ellipse.
//
//  Usage: circleInterpolate(pt);
//
exports.circleInterpolate = function (runtime, code, CGParams) {
    log.debug("circleInterpolate: CGParams = " + JSON.stringify(CGParams));
    var startX = runtime.cmd_posx;
    var startY = runtime.cmd_posy;
    var startZ = runtime.cmd_posz;
    log.debug("startX = " + startX + " startY = " + startY);
    var endX = startX;
    if ("X" in CGParams && CGParams.X !== undefined) {
        endX = CGParams.X;
    }
    var endY = startY;
    if ("Y" in CGParams && CGParams.Y !== undefined) {
        endY = CGParams.Y;
    }
    var plunge = startZ;
    if ("Z" in CGParams && CGParams.Z !== undefined) {
        plunge = CGParams.Z;
    }
    var centerX = CGParams.I;
    var centerY = CGParams.J;
    var centerPtX = startX + centerX;
    var centerPtY = startY + centerY;
    var speed = CGParams.F;
    var nextX = 0.0;
    var nextY = 0.0;
    var nextZ = 0.0;

    var SpiralPlunge = 0;
    if (plunge !== 0) {
        SpiralPlunge = 1;
    }

    // Find the beginning and ending angles in radians. We'll use only radians from here on.
    var Bang = Math.abs(Math.atan2(centerY, centerX));
    var Eang = Math.abs(Math.atan2(endY - centerPtY, endX - centerPtX));

    var inclAng;

    if (code === "G2") {
        if (Eang > Bang) {
            inclAng = 6.28318530717959 - (Bang - Eang);
        }
        if (Bang > Eang) {
            inclAng = Eang - Bang;
        }
    } else {
        if (Bang < Eang) {
            inclAng = Eang + Bang;
        }
        if (Bang > Eang) {
            inclAng = 6.28318530717959 - (Bang - Eang);
        }
    }
    if (Math.abs(inclAng) < 0.005) {
        //      log.debug("Returning from interpolation - arc too small to cut!");
        return;
    }

    var circleTol = 0.001;
    var radius = Math.sqrt(Math.pow(centerX, 2) + Math.pow(centerY, 2));
    var chordLen = config.opensbp.get("cRes");
    // Sagitta is the height of an arc from the chord
    var sagitta =
        radius - Math.sqrt(Math.pow(radius, 2) - Math.pow(chordLen / 2, 2));

    if (sagitta !== circleTol) {
        sagitta *= sagitta / circleTol;
        chordLen = Math.sqrt(2 * sagitta * radius - Math.pow(sagitta, 2));
        log.debug("chordLen = " + chordLen);
        if (chordLen < 0.001) {
            chordLen = 0.001;
        }
    }

    var theta = Math.asin((0.5 * chordLen) / radius) * 2;
    var remain = Math.abs(inclAng) % Math.abs(theta);
    var steps = Math.floor(Math.abs(inclAng) / Math.abs(theta));

    if (remain !== 0) {
        theta = inclAng / steps;
    }

    var zStep = plunge / steps;
    var nextAng = Bang;
    var gcode = "";

    for (var i = 1; i < steps; i++) {
        gcode = "G1";
        nextAng = Bang + i * theta;
        runtime.cmd_posx = nextX = centerPtX + radius * Math.cos(nextAng); //* propX;
        runtime.cmd_posy = nextY = centerPtY + radius * Math.sin(nextAng); //* propY;
        gcode += "X" + nextX.toFixed(5) + "Y" + nextY.toFixed(5);
        if (SpiralPlunge === 1) {
            // eslint-disable-next-line no-undef
            runtime.cmd_posz = params.Z = zStep * i; // params is undefined
            gcode += "Z" + nextZ.toFixed(5);
        }
        gcode += "F" + speed;
        runtime.emit_gcode(gcode);
    }

    gcode = "G1";
    runtime.cmd_posx = nextX = endX;
    runtime.cmd_posy = nextY = endY;
    gcode += "X" + nextX.toFixed(5) + "Y" + nextY.toFixed(5);
    if (SpiralPlunge === 1) {
        runtime.cmd_posz = nextZ = plunge;
        gcode += "Z" + nextZ.toFixed(5);
    }
    log.debug("circleInterpolation: end gcode = " + gcode);
    gcode += "F" + speed;
    runtime.emit_gcode(gcode);

    return;
};
