// Note that this file uses paperjs/scripting; so getting in and out must be global 
// paperjs not current with ES6

//var fabmo = new FabMoDashboard();
var LIne_up, LIne_dn, LIne_full;               // motion direction transit lines, primary feature of app
var RUn_dist = 0;                              // for incrementing distance along transit lines before next update
var MOveTo_x = 0, MOveTo_y = 0, MOveTo_Z = 0;  // move targets to pass to 'livecode' runtime
var FOcalAxis = 1;                             // current axis for transit motion; 1=x, 2=y, 3=z
var HAndledDouble = false;                     // flags on state of transits and clicks
var HAndledOther = false;
var LAstState = "";

var MOtionFilt = [];                           // Running-Avg Filters,
var MOtionFilt_avg;                            // ... for stabilizing scrolling; seeded
var DIrFilt = [];
var DIrFilt_avg;
var nextPt = new Point();
var newTime = new Date();
var LAstTime = new Date();
var PT_ct = 0, EV_ct = 0;                      // counters for user interaction used in filtering ... /?local


var desiredWidth = $('#rmanCanvas').width(); // For instance: $(window).width();
var desiredHeight =$('#rmanCanvas').height(); // For instance $('#canvasContainer').height();

rmanCanvas.width = desiredWidth;
rmanCanvas.height = desiredHeight 

view.viewSize = new Size(desiredWidth, desiredHeight);
view.draw();



//=================================================================================================================

function Tool(width, height, zlo, zhi, zsplit, xyZoom, xyUnit, zZoom, zUnit) {
    //@th; this should all be better integrated w/objects below and after getting data from G2
    this.width = width;
    this.height = height;
    this.zlo = zlo;
    this.zhi = zhi;
    this.zsplit = zsplit;                                     // default for midpoint on Z elevator
    this.xyZoom = xyZoom;
    this.zZoom = zZoom;
    this.prop = this.height / this.width;
    this.z_preSplit = 9;
    this.type = 'unknown';
    //... ugh; particularly messy ...
    this.xyUnit = xyUnit;
    this.zUnit = zUnit;
    this.z_postSplit = this.zhi - this.zsplit;
    this.z_total = this.z_preSplit + this.z_postSplit;
}

Tool.prototype.updateDisplays = function () {
    this.zRange = this.zhi - this.zlo;
    this.zRange_above = this.zhi - this.zsplit;
    this.zRange_below = this.zsplit - this.zlo;
    this.xyUnit = xybox.bounds.height / this.height;  // Update ratio for Units-to-screen for xy-box
    this.zUnit = zbox.bounds.height / this.zRange;  // ... zbox
    this.zUnit_upper = (0.5 * zbox.bounds.height) / this.zRange_above;
    this.zUnit_lower = (0.5 * zbox.bounds.height) / this.zRange_below;
    this.xyRunit = (1 / this.xyUnit);
    this.zRunit_upper = (1 / this.zUnit_upper);
    this.zRunit_lower = (1 / this.zUnit_lower);
    this.zzeroOffset = (-1 * this.zlo * this.zUnit);
    this.z_postSplit = this.zhi - this.zsplit;
    this.z_total = this.z_preSplit + this.z_postSplit;
}
    //@th; next a total kludge here just to satisfy out or order stuff ...
//    var mTool = new Tool();
var mTool = new Tool(36, 24, -1, 2, 0, 0.80, 45, 0.90, 45); // DEFINE A HANDIBOT =====*
//    var mTool = new Tool(24, 18, -1, 2, 0, 0.95, 45, 0.90, 45); // DEFINE A DT =====*

// - Setup XYBOX Work Area ..........................................................
  //@th; should redo all this display stuff as a better organized object
var xybox = new Path.Rectangle([0, 0, mTool.width, mTool.height]); // later set scale of boxes to be slightly smaller than view
var bwidth, bheight;
xybox.applyMatrix = false;
xybox.position.x = view.center.x - (xybox.bounds.width * 0.1)
xybox.position.y = view.center.y;
xybox.strokeColor = '#999999';// '#808080';
xybox.strokeScaling = false;
xybox.strokeWidth = 1;
xybox.state = false;

//Grid Lines
var gridScale;
var gridGroup = new Group();
var gridGroupFine = new Group();
for (var i = 0; i <= mTool.width; i++) {                       // verticals
    var xvert = i * mTool.xyUnit;
    var topPoint = new Point(xvert, 0);
    var bottomPoint = new Point(xvert, mTool.height * mTool.xyUnit);
    var gridLine = new Path.Line(topPoint, bottomPoint);
    gridLine.strokeColor = '#999999';//'#808080';
    gridLine.strokeWidth = 1;
    gridGroup.addChild(gridLine);
    if (i < mTool.width) {                                       // ... fine verticals
        for (var j = 1; j < 10; j++) {
            var xvert_fine = xvert + (j * 0.1 * mTool.xyUnit);
            var topPoint_fine = new Point(xvert_fine, 0);
            var bottomPoint_fine = new Point(xvert_fine, mTool.height * mTool.xyUnit);
            var gridLineFine = new Path.Line(topPoint_fine, bottomPoint_fine);
            gridLineFine.strokeColor = 'white';
            gridLineFine.strokeWidth = 1;
            gridGroupFine.addChild(gridLineFine);
        }
    }
}
for (var i = 0; i <= mTool.height; i++) {                      // horizontals
    var xhorz = i * mTool.xyUnit;
    var leftPoint = new Point(0, xhorz);
    var rightPoint = new Point(mTool.width * mTool.xyUnit, xhorz);
    var gridLine = new Path.Line(leftPoint, rightPoint);
    gridLine.strokeColor = '#999999';//'#808080';
    gridLine.strokeWidth = 1;
    gridGroup.addChild(gridLine);
    if (i < mTool.height) {
        for (var j = 1; j < 10; j++) {                             // ... fine horizontals
            var xhorz_fine = xhorz + (j * 0.1 * mTool.xyUnit);
            var leftPoint_fine = new Point(0, xhorz_fine);
            var rightPoint_fine = new Point(mTool.width * mTool.xyUnit, xhorz_fine);
            var gridLineFine = new Path.Line(leftPoint_fine, rightPoint_fine);
            gridLineFine.strokeColor = 'white';
            gridLineFine.strokeWidth = 1;
            gridGroupFine.addChild(gridLineFine);
        }
    }
}
gridGroupFine.visible = false;
gridScale = 1;  // 1 - baseunits, 1 - 10ths
gridGroupFine.insertAbove(xybox);
gridGroup.insertAbove(gridGroupFine);

// - Setup ZBOX Work Area ..........................................................
var zbox = new Path.Rectangle([0, 0, (view.viewSize.width * (1 - mTool.zZoom)), (view.viewSize.height * mTool.zZoom)]); // sets scale
mTool.zUnit = (view.viewSize.height * mTool.zZoom) / mTool.zRange;
zbox.applyMatrix = false;
zbox.strokeColor = 'grey';
zbox.strokeScaling = false;
zbox.strokeWidth = 1;
zbox.insertAbove(gridGroup);
zbox.state = false;
var z_gridGroup = new Group();                   // Create intervals with lines around a split
var ln_color;
for (var i = 0; i <= mTool.z_total - 1; i++) {  // Just read in the lines for now ... too fussy
    if (i < mTool.z_preSplit) {
        ln_color = 'red';
    } else if (i === mTool.z_preSplit) {
        ln_color = 'darkgreen';
    } else {
        ln_color = '#999999';
    }
    var z_dispHeight = zbox.bounds.bottom - (i * 50);
    var leftPoint = new Point(zbox.bounds.left, z_dispHeight);
    var rightPoint = new Point(zbox.bounds.right, z_dispHeight);
    var z_gridLine = new Path.Line(leftPoint, rightPoint);
    z_gridLine.strokeColor = ln_color;
    z_gridLine.strokeWidth = 1;
    z_gridGroup.addChild(z_gridLine);
}
z_gridGroup.insertAbove(zbox);
mTool.updateDisplays();

// - Setup LOCATION Display
var textLOCATION = new PointText({
    content: '',
    fillColor: '#ff9933', // '#ffb366',
    fontSize: 50,
    font: 'Courier New',
    justification: 'right',
    visible: false   // keep hidden til full load
});

// - Setup Option Displays (with tooltips)
function OptText(x_pos, y_pos, text, tip) {                            // Construct Option Objects
    this.text = new PointText({
        content: text,
        point: new Point(20, y_pos),
        fillColor: 'grey',
        state: false
    });
    this.tip = tip;
    this.tipPosition = new Point(x_pos, y_pos);
    this.tipPosition = this.tipPosition + new Point(30, -16);
    this.tooltipRect = new Rectangle(this.tipPosition, new Size((tip.length * 7), 28));
    this.cornerSize = new Size(10, 10);
    this.toolTip = new Path.Rectangle(this.tooltipRect, this.cornerSize);
    this.toolTip.fillColor = 'beige';
    this.toolTip.visible = false;
    this.textTip = new PointText(this.tipPosition + (0, 17));
    this.textTip.content = tip;
    this.textTip.fillColor = 'brown';
    this.textTip.visible = false;
}
OptText.prototype.turn_on = function () {
    this.toolTip.visible = true;
    this.textTip.visible = true;
}
OptText.prototype.turn_off = function () {
    this.toolTip.visible = false;
    this.textTip.visible = false;
}  //@th; can't figure out how to get the onMouseEnter into prototype; could be simpler, issues w/paperjs?

// ... set up individual items here
// note: x value here is only for tooltip location, y sets both locations,
var zoomOpt = new OptText(65, 50, 'ZOOM: ', 'Click for Reset to Full View; Ctl-Scroll to Zoom');        // Start Individual Options Here
zoomOpt.text.fillColor = 'green';
var snapOpt = new OptText(35, 70, 'SNAP', 'SNAP to intersections');
var cycleOpt = new OptText(95, 90, 'Cycle:  X-Y  [X-Y-Z]', 'Cycle between 2 or 3 axes on click/tap/space');
cycleOpt.text.state = true;
var smallOpt = new OptText(85, 110, 'Smallest Moves: ', 'Set smallest move at normal Zoom');
var smallxyOpt = new OptText(35, 130, '    for XY=  [.025]  .010', '');
var smallxyOpt = new OptText(35, 150, '    for   Z=  .010  [.005]  .001', '');

zoomOpt.text.onMouseEnter = function (event) {                           // ... and their tool-tips
    zoomOpt.turn_on();
}
zoomOpt.text.onMouseLeave = function (event) {
    zoomOpt.turn_off();
}
snapOpt.text.onMouseEnter = function (event) {
    snapOpt.turn_on();
}
snapOpt.text.onMouseLeave = function (event) {
    snapOpt.turn_off();
}
cycleOpt.text.onMouseEnter = function (event) {
    cycleOpt.turn_on();
}
cycleOpt.text.onMouseLeave = function (event) {
    cycleOpt.turn_off();
}
smallOpt.text.onMouseEnter = function (event) {
    smallOpt.turn_on();
}
smallOpt.text.onMouseLeave = function (event) {
    smallOpt.turn_off();
}

//  // - Command Buttons
//     function CmdButton (y_pos, width, txt, sm_txt) {                                // Construct Command Button Objects
//       this.shape = new Rectangle(new Point(20,(view.viewSize.height - y_pos)), new Size (width, 40));
//       this.cornerSize = new Size(20, 20);
//       this.rectangle = new Path.Rectangle(this.shape, this.cornerSize);
//       this.rectangle.strokeColor = 'green';
//       this.rectangle.applyMatrix = false;
//       this.rectangle.strokeScaling = false;
//       this.rectangle.strokeWidth = 2;
//       this.rectangle.fill = 'lightgreen';
//       this.rectangle.opacity = 0.6;
//       this.rectangle.insertAbove(gridGroup);
//       this.text = new PointText ({
//         point: new Point(30, (view.viewSize.height - (y_pos - 30))),
//         fontSize: 25,
//         content: txt,
//         fillColor: 'yellowgreen'
//       })
//       this.smalltext = new PointText({
//         point: new Point(40, (view.viewSize.height - (y_pos - 10))),
//         fontSize: 12,
//         content: sm_txt,
//         fillColor: 'yellowgreen'
//       })
//     }
// // ... set up individual buttons here
// var jobButton = new CmdButton(300, 150, "  next JOB", "goto");                 // Individual Buttons
// var zeroButton = new CmdButton(200, 150, "XYZ-ZERO", "set location");
// var homeButton = new CmdButton(150, 150, "    HOME", "move to");
// var centerButton = new CmdButton(100, 150, "  CENTER", "move to");

// - Setup Tool-Markers' Appearance
var zMark = new Path.Star([100, 100], 3, 20, 10); // z is a triangle
zMark.strokeColor = "black";
zMark.fillColor = "white;"
zMark.rotate(-30);

//@th; working on gopher shape here ???
//var pathData = 'M 30, 30 m -25, 0 a 25,25 0 1,0 50,0 a 25,25 0 1,0 -50,0 M 30, 30 m -15, 0 a 15,15 0 1,0 25,0 a 15,15 0 1,0 -25,0';
//var xyMark = new Path(pathData);
var xyMark = new Path.Circle(100, 100, 15);
//xyMark.add(new Point(114, 97), new Point(124,97), new Point(127,103), new Point(114, 103));
xyMark.strokeColor = "black";
xyMark.fillColor = "white";

// ########################################################## INTERACTIVE Functions here / MOTIONS (&ZOOMs)
var mult, quickStop;
//------------------------------------------------------------------------ mousewheel / MOTION & ZOOM
$('#rmanCanvas').on('mousewheel DOMMouseScroll MozMousePixelScroll', function (event) {
    var delta = Math.max(-1, Math.min(1, (event.originalEvent.wheelDelta || -event.originalEvent.detail)));  // cross-browser wheel delta
    if (event.originalEvent.shiftKey === true) {                    // ** ZOOM ** ======================
        var zoomIncr = 0.1;                                         // ... smooth scaling
        if (mTool.xyZoom > 1.2) zoomIncr = 0.2;
        if (mTool.xyZoom < 0.8) zoomIncr = 0.05;
        if (delta > 0) {
            if (mTool.xyZoom > 10) return false;
            mTool.xyZoom += zoomIncr;
        }
        else {
            if (mTool.xyZoom < 0.1) return false;
            mTool.xyZoom -= zoomIncr;
        }
        onResize();
        set_XYboxTransit();                                         // ... reset to right location
 
    } else {                                                        // ** MOTION ** ====================
    ////## TODO: After any kind of a stop we should throughly delete all stuff ...    

        newTime = Date.now();
        var interval = newTime - LAstTime;                          // Running-average filters
        clearTimeout(quickStop);

        //if (globals.G2_stat == 5 && !(globals.G2_killed)) {
        if (globals.G2_stat === 5) {
            console.log('already moving --> re-start TimeOut!');
            quickStop = setTimeout(killMotion, 500);  //250 produces interesting lock ...
        }

        DIrFilt_avg = DIrFilt_avg - DIrFilt[EV_ct];                 // ... filtering direction (and tics)
        DIrFilt_avg = DIrFilt_avg + delta;
        DIrFilt[EV_ct] = delta;
        MOtionFilt_avg = MOtionFilt_avg - MOtionFilt[EV_ct];        // ... filtering speed between tics
        MOtionFilt_avg = MOtionFilt_avg + interval;
        MOtionFilt[EV_ct] = interval;
        EV_ct++;
        if (EV_ct > 4) EV_ct = 0;
        if (Math.sign(DIrFilt_avg) !== Math.sign(delta)) {          // CK directionFilter; SKIP unexpected
            return false;
        }

        if (MOtionFilt_avg < 50) {                                  // SPEED MULTIPLIER TABLE
            mult = .25;
        } else if (MOtionFilt_avg < 100) {
            mult = .1;
        } else if (MOtionFilt_avg < 200) {
            mult = 0.05;
        } else if (MOtionFilt_avg < 300) {
            mult = 0.02;
        } else {
            mult = 0.010;
        }

        LAstTime = newTime;

        if (xybox.state) {
console.log('1-mult>',mult);
            setMotionXY(mult, DIrFilt_avg);                         // * SET MOTION XY or Z *
        } else if (zbox.state) {
            setMotionZ(mult, delta);
        }
        return false;
    }
});


//------------------------------------------------------------------------- touch / MOTION & ZOOM
//     function touchStart(ev){
//       console.debug('gotTouch> ')
//         // var touches = ev.touches;
// //        ev.preventDefault();
//     }

//     var touchHmr = new Hammer(rmanCanvas);
//     touchHmr.get('pan').set({ direction: Hammer.DIRECTION_HORIZONTAL });
//     touchHmr.get('pan').set({ direction: Hammer.DIRECTION_ALL });
//     touchHmr.get('swipe').set({ direction: Hammer.DIRECTION_ALL });

//      // listening via Hammer...
//      var PAnDist = 0;
//      var PAnEvent = false;
//     touchHmr.on("panleft panright", function(ev) {
//         PAnEvent = true;
//         ev.preventDefault();
//         rmanCanvas.textContent = ev.type +" gesture detected.";
//       console.log(ev.type);
//       var pan_dir = 1;
//       if (Math.abs(PAnDist > ev.distance)) {PAnDist = 0}
// console.log('dist>' + ev.distance + '  rundist> ' + PAnDist);
//       switch(ev.type){
//         case 'panright':
//             //OBS if (CUr_transit !== 'x') {
//             //   VErt = false;
//             //   set_XYboxTransit();
//             // }
//             pan_dir = 1;
//             panNow(pan_dir * (ev.distance - PAnDist)/10);
//             PAnDist = ev.distance;
//             break;
//         case 'panleft':
//             //OBS if (CUr_transit !== 'x') {
//             //   VErt = false;
//             //   set_XYboxTransit();
//             // }
//             pan_dir = -1;
//             panNow(pan_dir * (ev.distance - PAnDist)/10);
//             PAnDist = ev.distance;
//             break;
//         // case 'panup':
//         //     //OBS if (CUr_transit !== 'y') {
//         //     //   VErt = true;
//         //     //   set_XYboxTransit();
//         //     // }
//         //     pan_dir = 1;
//         //     panNow(pan_dir * (ev.distance - PAnDist)/10);
//         //     PAnDist = ev.distance;
//         //     break;
//         // case 'pandown':
//         //     //OBS if (CUr_transit !== 'y') {
//         //     //   VErt = true;
//         //     //   set_XYboxTransit();
//         //     // }
//         //     pan_dir = -1;
//         //     panNow(pan_dir * (ev.distance - PAnDist)/10);
//         //     PAnDist = ev.distance;
//         //     break;
//         // case 'tap':
//         //     PAnDist = 0;
//         //     break;
//         // case 'press':
//         //     PAnDist = 0;
//         //     break;
//         default:
//             PAnDist = 0;
//             break;
//       }
//     });
//     function panNow (dist) {
//       setMotionXY(0.01, dist);
//     }
//--------------------------- MOTION PRIMITIVES (trying to make everything work similarly)
//..................................... Misc

function setMotionXY(mult, dir) {
    mult = mult / mTool.xyZoom;                                         // First, adjust move-multiplier to ZOOM scale
console.log('2-mult> ',mult);
    var addedSeg =  mult * mTool.xyUnit * dir;                          // Determine new Segment = unit * delta * mult = (how soon * how far)
    RUn_dist += addedSeg;   
    if (RUn_dist > LIne_full.length) {                                  // Check against limits
        RUn_dist = LIne_full.length;
    } else if (RUn_dist < 0) {
        RUn_dist = 0;
    }
    var nextPt = LIne_full.getLocationAt(RUn_dist).point;               // Get new POSITION on TRANSIT
    MOveTo_x = (nextPt.x - xybox.bounds.left) * mTool.xyRunit;          // ...new real x from grid units
    MOveTo_y = (xybox.bounds.bottom - nextPt.y) * mTool.xyRunit;        // ...new real y from grid units
    doMotion(MOveTo_x, MOveTo_y, undefined, 240);                       // SEND new desired XY
}

function setMotionZ(mult, delta) {
    RUn_dist += mult * mTool.zUnit * delta * 0.5;                       // Accum running distance transit w/#FUDGE
    if (RUn_dist > LIne_full.length) {                                  // ... but don't go beyond length
        RUn_dist = LIne_full.length;
    } else if (RUn_dist < 0) {
        RUn_dist = 0;
    }
    var nextPt = LIne_full.getLocationAt(RUn_dist).point;               // Set POSITION on TRANSIT
    MOveTo_z = getZmove(nextPt.y);
    doMotion(undefined, undefined, MOveTo_z, 120);                           // SEND a Z
}

function getZmove(screenY) {
    var next_zMove
    if (screenY < zbox.position.y) {
        next_zMove = ((zbox.position.y - screenY) * mTool.zRunit_upper) + mTool.zsplit;
    } else {
        next_zMove = ((screenY - zbox.position.y) * mTool.zRunit_lower * -1) - mTool.zsplit;
    }
    return next_zMove;
}
  
//=========================================================== APP PAD MANAGEMENT
//---------------------------drawing
function onResize() {
    if (globals.MO_pad_open) {
        // - Update WorkArea Boxes and Tool Markers ... complicated by inverted tool location and independent resize
        if ((view.viewSize.height / view.viewSize.width) < mTool.prop) {     // Working area bound by X or Y ?
            bheight = view.viewSize.height * mTool.xyZoom;                    // =Tall ... bounded by height
            bwidth = (view.viewSize.height / mTool.prop) * mTool.xyZoom;
        } else {
            bheight = view.viewSize.width * mTool.xyZoom;                     // =Squat ... bounded by width
            bwidth = (view.viewSize.width / mTool.prop) * mTool.xyZoom;
        }
//        var lastScale = xybox.scaling.x;                  // Get current scale (transform)
        var bsize = new Size(bwidth, bheight);              // Then RESIZE of xyBox and zBox
        var zsize = new Size(view.viewSize.width * (1 - mTool.zZoom), view.viewSize.height * mTool.zZoom);
        xybox.bounds = bsize;
        zbox.bounds = zsize;
        mTool.updateDisplays();

        if (mTool.xyZoom > 1.5) {                          // Zooming IN - Center on Tool
            xybox.position.x = view.center.x - ((globals.TOol_x * mTool.xyUnit) - (bwidth / 2));
            xybox.position.y = view.center.y + ((globals.TOol_y * mTool.xyUnit) - (bheight / 2));
            zbox.position.y = view.center.y;
            zbox.position.x = view.viewSize.width - (0.8 * zbox.bounds.width);
            gridGroupFine.visible = true;
            gridScale = 10;
        } else {                                            // Zooming OUT - Center Grid
            xybox.position.x = view.center.x - (xybox.bounds.width * 0.1)
            xybox.position.y = view.center.y;
            zbox.position.y = view.center.y;
            zbox.position.x = view.viewSize.width - (0.8 * zbox.bounds.width);
            gridGroupFine.visible = false;
            gridScale = 1;
        }

        var dX = xybox.bounds.left + (globals.TOol_x * mTool.xyUnit) - xyMark.position.x;
        var dY = xybox.bounds.bottom - (globals.TOol_y * mTool.xyUnit) - xyMark.position.y;
        xyMark.position += new Point([dX, dY]);
        gridGroup.fitBounds(xybox.bounds);                  // XY update grids
        gridGroupFine.fitBounds(xybox.bounds);

        //@th; scope j and issue with limit for this loop?
        //@th; not particularly well coordinated with definition above -- but works at moment
        j = 0;
        var uptHeight;
        for (var i = 0; i <= (mTool.z_postSplit - 1); i = Math.round((i + adder) * 10) / 10) {
            if (i < 1) {
                adder = 0.1;
                uptHeight = zbox.bounds.bottom - ((i + adder) * zbox.bounds.height * 0.5);
            } else {
                adder = 1;
                uptHeight = zbox.position.y - ((i + adder + mTool.zlo) * (zbox.bounds.height * 0.5 / mTool.z_postSplit));
            }
            z_gridGroup.children[j].firstSegment.point = new Point(zbox.bounds.left, uptHeight);
            z_gridGroup.children[j].lastSegment.point = new Point(zbox.bounds.right, uptHeight);
            j++;
        }
        var fixZ = zbox.bounds.bottom - (globals.TOol_z * mTool.zUnit) - zMark.position.y + mTool.zzeroOffset;
        zMark.position += new Point([zMark.position.x, fixZ]);
        //  zoomOpt.text.content = 'ZOOM: ' + mTool.xyZoom.toFixed(2);
        fabmo.requestStatus();
    }
}

    //--------------------------- request standard transits
function reset_BoxTransits(cur_point) {
    // if (PAnEvent) {
    //   getEnd(setEnd);
    //   return;
    // }
    if (zbox.hitTest(cur_point) || FOcalAxis === 3) {  // Ordered so Z remains responsive
        set_ZboxTransit();
    } else if (cur_point.isInside(xybox.bounds)) {
        set_XYboxTransit();
    }
}
function set_XYboxTransit() {
    xybox.state = true;
    xybox.fillColor = '#0f68cd';//'#e6e6e6'; // 90%
    xybox.opacity = .8;
    zbox.fillColor = '#0f68cd';//'white';
    zbox.opacity = .4;
    zbox.state = false;
    if (LIne_up) LIne_up.remove();
    if (LIne_dn) LIne_dn.remove();
    zMark.fillColor = "black";
    xyMark.fillColor = "white";
    if (FOcalAxis === 1) {
        motion_ln(xyMark.position, new Point(xybox.bounds.right, xyMark.position.y), new Point(xybox.bounds.left, xyMark.position.y));
        FOcalAxis = 1;
    } else {
        motion_ln(xyMark.position, new Point(xyMark.position.x, xybox.bounds.top), new Point(xyMark.position.x, xybox.bounds.bottom));
        FOcalAxis = 2;
    }
}
function set_ZboxTransit() {
    zbox.state = true;
    zbox.fillColor = '#0f68cd';//'#e6e6e6';
    xybox.opacity = .4;
    xybox.fillColor = '#0f68cd';//'white';
    zbox.opacity = .8;
    xybox.state = false;
    zMark.fillColor = "white";
    xyMark.fillColor = "black";
    FOcalAxis = 3;
    if (LIne_up) LIne_up.remove();
    if (LIne_dn) LIne_dn.remove();
    motion_ln(zMark.position, new Point(zMark.position.x, zbox.bounds.top), new Point(zMark.position.x, zbox.bounds.bottom));
}

//---------------------------request user drawn transit
xyMark.onMouseDrag = function (event) {                            // DRAG for Motion Lines (up_line & dn_line)
    if (xybox.contains(event.point)) {                               // Make sure drag is within xybox
        LIne_up.scale(5, xyMark.position);                            // ... extend up_line length a bit
        LIne_dn.scale(5, xyMark.position);                            // ... extend dn_line length a bit
        LIne_full.scale(5, xyMark.position);
        motion_ln(xyMark.position, event.point, null);                // Initialize MOTION LINE
        var intersects_up = LIne_up.getIntersections(xybox);        // now LIMIT up_line to xybox
        var hitOptions = { bounds: true };                            // ... only detect xybox bounds
        var int_pts = 0;
        if (xybox.hitTest(xyMark.position, hitOptions)) {         // ...is tool on box border?
            int_pts += 1;                                         // ......special: now at second intersect
        }
        if (intersects_up.length > int_pts) {                       // ...only 1 intersect beyond possible border
            LIne_up.segments[1].point = intersects_up[int_pts].point;
        }
        var intersects_dn = LIne_dn.getIntersections(xybox);       // and now LIMIT dn_line
        if (intersects_dn.length > 0) {
            LIne_dn.segments[1].point = intersects_dn[0].point;
        }
        LIne_up.removeOn({                        // ... removing line on next touch
            drag: true,
            down: true
        });
        LIne_dn.removeOn({
            drag: true,
            down: true
        });
    }
}
//---------------------------make the transit
function motion_ln(startpt, endpt, dn_limit) {
    if (LIne_up) LIne_up.remove();
    if (LIne_dn) LIne_dn.remove();
    RUn_dist = 0;                                   // zero out any incrementing moveTo distance
    LIne_up = new Path.Line(startpt, endpt);       // create UPward going direction line
    LIne_up.strokeColor = 'green';
    LIne_up.strokeWidth = 4;
    // LIne_up.removeOn ({                        // ... removing line on next touch
    //   drag: true,
    //   down: true
    // });
    var vector = endpt - startpt;                   // and DNward going direction line
    vector = startpt - vector;                      // ... by reversing direction
    if (dn_limit !== null) vector = dn_limit;       // ... or just substitute new endpt for vert/horiz
    LIne_dn = new Path.Line(startpt, vector);
    LIne_dn.strokeColor = 'yellow';
    LIne_dn.strokeWidth = 2;
    // LIne_dn.removeOn ({
    //   drag: true,
    //   down: true
    // });

    LIne_full = new Path.Line(vector, endpt);       // This is phantom continuous line used to move tool
    LIne_full.removeOn({
        drag: true,
        down: true
    });
    RUn_dist = LIne_full.getOffsetOf(startpt);      // Starting location on transit line for incrementing
}

//---------------------------options / HANDLE CLICKS
        view.onClick = function(event) {
          // if (PAnEvent) {
          // // console.debug('#GOT PAN in CLICK >>' + PAnEvent + ', ' + event);
          //   getEnd(setEnd);
          //   return;
          // }
          if (HAndledOther) {return}                        // SKIP-OUT on Special CLICK >
          setTimeout(function() {                           // On REGULAR CLICK >> Handle Transit Line Toggle-Shift
            if (!HAndledDouble) {                           // ... ruling out double click
              if (!cycleOpt.text.state) {                        // ... handling TYPE Transit TOGGLE state here
                  switch(FOcalAxis) {                       // ...... 2-axis cycling
                    case 1:
                      FOcalAxis = 2;
                      break
                    case 2:
                      FOcalAxis = 1;
                      break;
                    case 3:                                 // ......... avoid getting stuck
                      if (event.point.isInside(xybox.bounds)) {
                        FOcalAxis = 1;
                      }
                      break;
                    default:
                  }
              } else {
                  switch(FOcalAxis) {                       // ...... 3-axis cycling
                    case 1:
                      FOcalAxis = 2;
                      break
                    case 2:
                      FOcalAxis = 3;
                      break;
                    case 3:
                      FOcalAxis = 1;
                      break;
                    default:
                  }
              }
              reset_BoxTransits(event.point);               // ... toggling here
            } else {
              HAndledDouble = false;
              HAndledOther = false;
            }
          }, 400);
        }

        view.onDoubleClick = function(event) {             // ON DOUBLE CLICK >> Make Positioning Move
          if (globals.FAbMo_state === "running") return;      // @th?? testing blocking extra motion
          HAndledDouble = true;
          var lastAxis = FOcalAxis;                        // @th?? necessary or complicating??
          var nextX, nextY;
          if (LIne_up) LIne_up.remove();                   // ... clear any existing transits
          if (LIne_dn) LIne_dn.remove();
          if (LIne_full) LIne_full.remove();
              if (event.point.isInside(zbox.bounds)) {            // Z Move (do Z first incase of box overlap)
                nextZ = getZmove(event.point.y);
                if (snapOpt.text.state) {
                  nextZ = getSnapLoc(nextZ, 10);
                }
                doMotion(undefined, undefined, nextZ, 240);
              } else if (event.point.isInside(xybox.bounds)) {    // XY Move
                nextX = (event.point.x - xybox.bounds.left) * mTool.xyRunit;
                nextY = (xybox.bounds.bottom - event.point.y) * mTool.xyRunit;
                if (snapOpt.text.state) {
                  nextX = getSnapLoc(nextX, gridScale);
                  nextY = getSnapLoc(nextY, gridScale);
                }
                doMotion(nextX, nextY, undefined, 240);
              }
          FOcalAxis = lastAxis;
          getStopped(event.point, atStop);                 // **more KLUDGE
          HAndledOther = false;
        }

        // zoomOpt.text.onClick = function(event) {           // Click ZOOM to restore to full size
        //   HAndledOther = true;
        //   mTool.xyZoom = 0.95;
        //   onResize ();
        //   getStart(setStart);                              // **KLUDGE for time
        // }

        // snapOpt.text.onClick = function(event) {
        //   HAndledOther = true;
        //   if (this.state) {
        //     this.state = false;
        //     this.fillColor = 'grey';
        //   } else {
        //     this.state = true;
        //     this.fillColor = 'darkblue';
        //   }
        //   onResize();
        // }
        // cycleOpt.text.onClick = function(event) {
        //   HAndledOther = true;
        //   if (this.state) {
        //     this.state = false;
        //     this.content = 'Cycle:  [X-Y]  X-Y-Z';
        //   } else {
        //     this.state = true;
        //     this.content = 'Cycle:  X-Y  [X-Y-Z]';
        //   }
        //   onResize();
        // }

        // jobButton.text.onClick = function(event) {
        //   HAndledOther = true;
        //   fabmo.launchApp('job-manager');
        // }
        // zeroButton.text.onClick = function(event) {
        //   if (globals.FAbMo_state === "running") return;      // ?? testing blocking extra motion
        //   HAndledOther = true;
        //   fabmo.runSBP('C#,3');
        // }
        // homeButton.text.onClick = function(event) {
        //   if (globals.FAbMo_state === "running") return;      // ?? testing blocking extra motion
        //   HAndledOther = true;
        //   fabmo.runSBP('MH,');
        // }
        // centerButton.text.onClick = function(event) {
        //   if (globals.FAbMo_state === "running") return;      // ?? testing blocking extra motion
        //   HAndledOther = true;
        //   var new_x = 0.5 * mTool.width;
        //   var new_y = 0.5 * mTool.height;
        //   fabmo.runSBP('M2,' + new_x + ', ' + new_y);
        // }

//========================================================================= FabMo Status Responses
var gotOnce = false
globals.UPdateMoPadState = UPdateMoPadState;
function UPdateMoPadState() {
    if (!gotOnce) {
        getStart(setStart);
        gotOnce = true;
    }

    LAstState = globals.FAbMo_state;

    xyMark.position.x = xybox.bounds.left + (globals.TOol_x * mTool.xyUnit); // POSITION XY MARKER
    xyMark.position.y = xybox.bounds.bottom - (globals.TOol_y * mTool.xyUnit);
    zMark.position.x = zbox.bounds.left;
    if (globals.TOol_z < mTool.zsplit) {          //if below split           // POSITION Z MARKER
        zMark.position.y = zbox.position.y - (globals.TOol_z * mTool.zUnit_lower);
    } else {
        zMark.position.y = zbox.position.y - (globals.TOol_z * mTool.zUnit_upper);
    }
    if (globals.FAbMo_state != "running") {
        if (xybox.state) {
            if (LIne_up) LIne_up.segments[0].point = xyMark.position;        // Update position on transit in XY or Z box
            if (LIne_dn) LIne_dn.segments[0].point = xyMark.position;
        } else if (zbox.state) {
            if (LIne_up) LIne_up.segments[0].point = zMark.position;
            if (LIne_dn) LIne_dn.segments[0].point = zMark.position;
        }
    } else {
        if (LIne_up) LIne_up.remove();                                       // ... clear any existing transits
        if (LIne_dn) LIne_dn.remove();
        if (LIne_full) LIne_full.remove();
    }
    textLOCATION.content = globals.TOol_x.toFixed(3) + 'x' + '\n' + globals.TOol_y.toFixed(3) + 'y' + '\n' + globals.TOol_z.toFixed(3) + 'z';
    textLOCATION.position = new Point([view.viewSize.width - 150, 100]);     // fix the location
    zMark.points = 3;        // re-assert shape ??? {{## don't know why needed}}
    zMark.radius1 = 20;
    zMark.radius2 = 10;
    zMark.insertAbove(z_gridGroup);                                          // don't lose Z mark display
    zMark.bringToFront();
    HAndledOther = false;
}

//========================================================================= Get FabMo Config
// wdith and height used as limits for X and Y
globals.GEtMoPadConfig = GEtMoPadConfig;
function GEtMoPadConfig() {
    fabmo.getConfig(function (err, cfg) {
        try {
            if (cfg.machine.envelope) {
                //@th; need to deal with metric load!
                // Hard Code defaults
                mTool.width = cfg.machine.envelope.xmax;
                mTool.height = cfg.machine.envelope.ymax;
                //mTool.zlo = cfg.machine.envelope.zmin;   // ... when available
                //mTool.zhi = cfg.machine.envelope.zmax;
                if (mTool.width > 5) {        // def Handibot
                    mTool.xyZoom = 0.95;
                    mTool.zZoom = 0.90;
                    mTool.zhi = 2;
                    mTool.type = 'handibot';
                }
                if (mTool.width === 24) {
                    mTool.xyZoom = 0.85;
                    mTool.zZoom = 0.90;
                    mTool.zhi = 2;          // *not working at 3
                    mTool.type = 'desktop';
                }
                if (mTool.width > 26) {
                    mTool.xyZoom = 0.80;
                    mTool.zZoom = 0.90;
                    mTool.zhi = 3;
                    mTool.type = 'max';
                }
                if (mTool.width > 40) {
                    mTool.xyZoom = 0.95;
                    mTool.zZoom = 0.90;
                    mTool.zhi = 5;
                    mTool.type = 'full';
                }
                // *dev over-rides
                //make right for testing on HB
                //mTool.width = 6;
                //mTool.height = 8;
                // mTool.xyZoom = 0.95;
                // mTool.zZoom = 0.90;
                mTool.zhi = 2;
console.log(mTool.type,mTool.width,mTool.height)
                mTool.updateDisplays();
            }
        } catch (e) {
            console.error(e);
        }
    });
}


//========================================================================= messy timing stuff for startup
function getStart(callback) {     // allow time for reporting / kludge
    var timer = setTimeout(function () {
        callback();
    }, 150);
}
function getEnd(callback) {       // allow time for reporting / kludge
    if (endtimer) {
        clearTimeout(endtimer);
    }
    var endtimer = setTimeout(function () {
        callback();
    }, 2000);
}

function getStopped(target, callback) {   // ... monitor G2 instead for a move completion, or nothing in queue
    var timer = setTimeout(function () {    // ...... and maybe needs a Z handler too??
        callback(target);
    }, 2500);
}
function setStart() {
    MOveTo_x = globals.TOol_x;    // set starting location for rolling motion ...
    MOveTo_y = globals.TOol_y;    // set starting location for rolling motion ...
    MOveTo_z = globals.TOol_z;    // set starting location for rolling motion ...
    fabmo.requestStatus();        // Trigger reports from tool
    textLOCATION.visible = true;
    var evt = window.document.createEvent('UIEvents');
    evt.initUIEvent('resize', true, false, window, 0);
    window.dispatchEvent(evt);
    reSeedScrollFilters();
    onResize();
    mTool.updateDisplays();
    set_XYboxTransit();           // default start position and xy view !
}

function setEnd(target) {
    console.debug('timed Out >> ');
    //        PAnEvent = false;
}

function atStop(target) {
    reset_BoxTransits(target);
}

function reSeedScrollFilters() {
    MOtionFilt = [200, 200, 200, 200, 200];   // Running-Avg Filters,
    MOtionFilt_avg = 1000;                    // ... for stabilizing scrolling; seeded
    DIrFilt = [1, 1, 1, -1, -1];
    DIrFilt_avg = 1;
    newTime = (new Date()).now;
}

globals.GEtMoPadConfig();



    // if (globals.FAbMo_state === "manual" && globals.G2_killed) {  // clear a persisting flag  **needed?
    //     globals.G2_killed = false;
    //     console.log('manual >>> cleared Killed')
    // }
    // **Something in fabmo setting us to idle after a kill??? NOT WORKING RIGHT!!
    // if (globals.FAbMo_state === "idle") {  
// //        fabmo.manualEnter({ hideKeypad: true, mode: 'raw' });
//         fabmo.manualEnter({ hideKeypad: true, mode: 'enter' });
//         globals.G2_killed = false;
//        console.log('idle >>> reset manual')
        // console.log('idle >>> only noted ...')
    // }


    //let's try simply forcing back to manual if we've been knocked out  
    // if (globals.FAbMo_state != "manual"|| globals.G2_stat === 4) {
    //     fabmo.manualEnter({ hideKeypad: true, mode: 'raw' });
    //     console.log('forcing MANUAL ===>>');
    // };

        // if (globals.G2_killed) {
        //     console.log('skip on KILLED state,G2_stat ', globals.FAbMo_state, globals.G2_stat);
        //     return false;
        // }

