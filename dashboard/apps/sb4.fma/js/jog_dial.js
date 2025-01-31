//*th NOW here for transition to different scroll MOtion-Pad graphic ...

//* jog_dial.js ... change to jog_pad
/*
* evolved from from JogDial.js - v 1.0
* Copyright (c) 2014 Sean Oh (ohsiwon@gmail.com)
* Licensed under the MIT license
* - generally used set up; upper file functions
* - added primarily lower file functions ...
* - sorry about the conflicting use of "Jog"
* - ought to be re-done from scratch now ...
*/


//,,,,,,,,,,fix need to have this respond to axis choice
var sel_axis = 1 //X
var sel_axis_phy_distance = 24                                           // *needs to be tool size from config; dealing with metric???
var sel_axis_turns = 4
var sel_axis_rot_tot_distance = sel_axis_turns * 360
var sel_axis_multiplier = sel_axis_phy_distance / sel_axis_rot_tot_distance
var sel_axis_divider = sel_axis_rot_tot_distance / sel_axis_phy_distance;  
var divider = sel_axis_divider * Math.PI;
var JDbase = "";

//(function (window, undefined) {
//  'use strict';

  var bar = document.getElementById('jog_dial_one_meter_inner');

  /*
  * Constructor
  * JogDial
  * @param  {HTMLElement}    element
  * @param  {Object}         options
  * return  {JogDial.Instance}
  * TWO USES OF "wheel" HERE are vey CONFUSING; mousewheel vs the jogDialwheel
  */
  var JogDial = function (element, options) {
    return new JogDial.Instance(element, options || {});
  };

  /*
  * Set constant values and functions
  */
 
  function setConstants() {
    if (JogDial.Ready) {
      return;
    }

    // Constants
    JogDial.Doc   = window.document;
    JogDial.ToRad   = Math.PI / 180;
    JogDial.ToDeg   = 180 / Math.PI;

    // Detect mouse event type
    JogDial.ModernEvent   = (JogDial.Doc.addEventListener) ? true : false;
    JogDial.MobileRegEx   = '/Mobile|iP(hone|od|ad)|Android|BlackBerry|IEMobile|Kindle|NetFront|Silk-Accelerated|(hpw|web)OS|Fennec|Minimo|Opera M(obi|ini)|Blazer|Dolfin|Dolphin|Skyfire|Zune/';
    JogDial.MobileEvent   = ('ontouchstart' in window) && window.navigator.userAgent.match(JogDial.MobileRegEx);
    JogDial.PointerEvent  = (window.navigator.pointerEnabled || window.navigator.msPointerEnabled) ? true : false;

    // Predefined options
    JogDial.Defaults = {
      debug : false,
      touchMode : 'knob',  // knob | wheel  // $$means must engage knob
      knobSize : '20%',                     // $$how big know is relative to ... wheel ???
      wheelSize : '500%',                   // ?? size of wheel relative too ??? ##Set large to be forgiving of finger position during spinning
      zIndex : 99,                        // 9999?? for ??
      minDegree : null,  // (null) infinity
      maxDegree : null   // (null) infinity
    };

    // Predefined rotation info
    JogDial.DegInfo = {
      rotation: 0,
      quadrant: 1
    };

    // Predefined DOM events
    JogDial.DomEvent = {
      MOUSE_DOWN: 'mousedown',
      MOUSE_MOVE: 'mousemove',
      MOUSE_OUT: 'mouseout',
      MOUSE_UP: 'mouseup',

     KEY_DOWN: 'keydown',
     KEY_UP: 'keyup',
     WHEEL: 'wheel'
    };

    // Predefined custom events
    JogDial.CustomEvent = {
      MOUSE_DOWN: 'mousedown',
      MOUSE_MOVE: 'mousemove wheel',
      MOUSE_UP: 'mouseup',

     KEY_DOWN: 'keydown',
     KEY_UP: 'keyup',
    };

    // Utilities
    JogDial.utils  = {
      extend : function (target, src) {    // ?? .. ok so what is happening here
        for (var key in src) {
          target[key] = src[key];
        }
        return target;
      },

      //Return css styling
      getComputedStyle: function (el, prop) {
        if (window.getComputedStyle) { // W3C Standard
          return window.getComputedStyle(el).getPropertyValue(prop);
        }
        else if (el.currentStyle) { // IE7 and 8
          return el.currentStyle[prop];
        }
      },

                                                          // ==================================================================
      //Calculating x and y coordinates                   // Action triggered by PRESS (403) or DRAG (429)
      getCoordinates: function (e) {                      //    ... only dragged or triggered if in AREA
        e = e || window.event;
        var target = e.target || e.srcElement,
          rect   = target.getBoundingClientRect(),
          _x   = ((JogDial.MobileEvent) ? e.targetTouches[0].clientX : e.clientX) - rect.left,
          _y   = ((JogDial.MobileEvent) ? e.targetTouches[0].clientY : e.clientY) - rect.top;
        return {x:_x,y:_y};
      },
      // Return the current quadrant.
      // Note: JogDial's Cartesian plane is flipped, hence it's returning reversed value.
      getQuadrant: function(x, y){                         //            3  |  4
        if (x>0 && y>0) return 4;                          //            ---+---
        else if (x<0 && y>0) return 3;                     //            2  |  1
        else if (x<0 && y<0) return 2;
        else if (x>=0 && y<0) return 1;
      },
      // Use quadrant to return the total rotation value adding or subtracting 360 if needed
      getRotation: function(self, quadrant, newDegree){    //  **Key here is source of newDegree     
        var rotation, delta = 0, info = self.info;
          if(quadrant == 1 && info.old.quadrant == 2){     //From 360 to 0
            delta = 360;
          }
          else if(quadrant == 2 && info.old.quadrant == 1){//From 0 to 360
            delta = -360;
          }
        rotation = newDegree + delta - info.old.rotation + info.now.rotation;
        info.old.rotation = newDegree; // return 0 ~ 360
        info.old.quadrant = quadrant; // return 1 ~ 4
        return rotation;
      },

      //Checking collision  //@th initial state check for in knob, but does not include outside wheel ##need to listen for any
                                                          // ## Returns true (on knob) or false if in box; but outside excluded!
      checkBoxCollision: function (bound ,point) {
//console.log("ckCollision: ",bound ,point)
//console.log(bound.x1 < point.x
//   && bound.x2 > point.x
//   && bound.y1 < point.y
//   && bound.y2 > point.y)
        return bound.x1 < point.x
        && bound.x2 > point.x
        && bound.y1 < point.y
        && bound.y2 > point.y;
      },

      // AddEvent, cross-browser support (IE7+)
      addEvent: function (el, type, handler, capture) {
        type = type.split(' ');
//console.log('adding event listener: ', el,type, handler, capture);
        for(var i=0; i < type.length; i++) {
          if (el.addEventListener) {
            el.addEventListener(type[i], handler, capture);
          }
          else if (el.attachEvent) {
            el.attachEvent('on'+type[i], handler);
          }
        }
      },

      removeEvent: function (el, type, handler) {       // RemoveEvent, cross-browser support (IE7+)
        type = type.split(' ');
        for(var i=0; i < type.length; i++) {
          if (el.addEventListener) {
            el.removeEventListener(type[i], handler);
          }
          else if (el.detachEvent) {
            el.detachEvent('on'+type[i], handler);
          }
        }
      },

      triggerEvent: function(el, type){                  // --------------@th ##SET MAIN EVENT??? TriggerEvent, cross-browser support (IE7+) 
        var evt;
        if (JogDial.Doc.createEvent) { // W3C Standard
          evt = JogDial.Doc.createEvent("HTMLEvents");
          evt.initEvent(type, true, true);
          el.dispatchEvent(evt);
        }
        else { // IE7 and 8
          evt = JogDial.Doc.createEventObject();
          evt.target = {};
          JogDial.utils.extend(evt.target, el);
          el.fireEvent('on' + type, evt);
        }
      },

      convertClockToUnit: function (n) {
        return n%360-90;
      },

      convertUnitToClock: function (n) {
        return (n >= -180 && n < -90 ) ? 450+n : 90+n;
      },
 
                                                         //============================================================
      update_loc: function () {                          // ---------------------------------- MOVE the FOLLOWER MARKER
        var follow_radn = globals.TOol_x / sel_axis_multiplier;  // turn location to degrees
        follow_radn = (follow_radn)%360;                         // place in current circle
        follow_radn = follow_radn * Math.PI /180;                // make RADIAN
        follow_radn = follow_radn - 1.5708                       // back up 90 deg  ##not clear where this 90 degree things comes and goes from
        var _x =  (Math.cos(follow_radn) * 110) + 117,      // multiplier is scale factor + offset 115,65      
            _y =  (Math.sin(follow_radn) * 110) + 29;       //25,-25
          document.querySelector("#jog_dial_follower").style.left = _x + 'px';
          document.querySelector("#jog_dial_follower").style.top = _y + 'px';
      }

    };
    JogDial.Ready = true;
  };

  /*
  * Constructor
  * JogDial.Instance
  * @param  {HTMLElement}    element
  * @param  {Object}         options
  * return  {JogDial.Instance}
  */
  JogDial.Instance = function (el ,opt) {
    // Prevent duplication
    if (el.getAttribute('_jogDial_')) {
      window.alert('Please Check your code:\njogDial can not be initialized twice in a same element.');
      return false;
    }

    // Set global contant values and functions
    setConstants();

    // Set this instance
    setInstance(this, el, opt);

    // Set stage
    setStage(this);

    // Set events
    setEvents(this);

    // Set angle
    //angleTo(this, JogDial.utils.convertClockToUnit(this.opt.degreeStartAt));

    return this;
  };

  /*
  * Prototype inheritance
  */
  JogDial.Instance.prototype = {
    on: function onEvent(type, listener) {
      JogDial.utils.addEvent(this.knob, type, listener, false);
      return this;
    },
    off: function onEvent(type, listener) {
      JogDial.utils.removeEvent(this.knob, type, listener);
      return this;
    },
    trigger: function triggerEvent(type, data) {
      switch (type){
        case 'angle':
          angleTo(this, JogDial.utils.convertClockToUnit(data), data);
          break;
        default:
          window.alert('Please Check your code:\njogDial does not have triggering event [' + type + ']');
          break;
      }
      return this;
    },
    angle: function angle(data) {
      var deg = data;
      //var deg = (data > this.opt.maxDegree) ? this.opt.maxDegree : data;
console.log("gotcall- ", data,deg, this.opt.maxDegree);      
      angleTo(this, JogDial.utils.convertClockToUnit(deg), deg);
//      angleTo(this, JogDial.utils.convertClockToUnit(deg));
    }
  };

  function setInstance(self, el, opt){
    self.base = el;
    self.base.setAttribute('_JogDial_', true);
    self.opt = JogDial.utils.extend(JogDial.utils.extend({}, JogDial.Defaults), opt);
    self.info = {} || self;
    self.info.now = JogDial.utils.extend({},JogDial.DegInfo);
    self.info.old = JogDial.utils.extend({},JogDial.DegInfo);
    self.info.snapshot = JogDial.utils.extend({},self.info);
    self.info.snapshot.direction = null;

    JDbase = self.base;
console.log("jog-base-initiated", JDbase);    

  };

  function setStage(self) {
    /*
    * Create new elements
    * {HTMLElement}  JogDial.Instance.knob
    * {HTMLElement}  JogDial.Instance.wheel
    */
    var item   = {},
    BId      = self.base.getAttribute("id"),
    BW       = self.base.clientWidth,
    BH       = self.base.clientHeight,
    opt     = self.opt,
    K       = item.knob = document.createElement('div'),
    W       = item.wheel = document.createElement('div'),
    KS       = K.style,
    WS       = W.style,
    KRad, WRad, WMargnLT, WMargnTP;

    //Set position property as relative if it's not predefined in Stylesheet
    if (JogDial.utils.getComputedStyle(self.base, 'position') === 'static') {
      self.base.style.position = 'relative';
    }

    //Append to base and extend {object} item
    self.base.appendChild(K);
    self.base.appendChild(W);
    JogDial.utils.extend(self, item);

    //Set global position and size
    KS.position = WS.position = 'absolute';   
    KS.width = KS.height = opt.knobSize;
    WS.width = WS.height = opt.wheelSize;

    KRad = K.clientWidth/2;                 // Set Radius of WHEEL ?
    WRad = W.clientWidth/2;   

    K.setAttribute('id', BId + '_knob');    // Set Knob Propeties
    KS.margin = -KRad + 'px 0 0 ' + -KRad + 'px';
    KS.zIndex = opt.zIndex;

    W.setAttribute('id', BId + '_wheel');   //Set wheel properties
    WMargnLT = (BW-W.clientWidth)/2;
    WMargnTP = (BH-W.clientHeight)/2;
    //WS.left = WS.top = 0;
    //WS.margin = WMargnTP + 'px 0 0 ' + WMargnLT + 'px';
    WS.left = '-400px';
    WS.top = '-400px';
    WS.zIndex = opt.zIndex;
//    self.radius = WRad - KRad;
//    self.center = {x:WRad+WMargnLT, y:WRad+WMargnTP};
    self.radius = 110;                      //100## Set Radius and Center Point for KNOB rotation, hard-coded fussing; probably better way
    self.center = {x:117, y:119};               
  };

  function setEvents(self) {
    /*
    * Set events to control elements
    * {HTMLElement}  JogDial.Instance.knob
    * {HTMLElement}  JogDial.Instance.wheel
    */
    //Detect event support type and override values
      if (JogDial.PointerEvent) { // Windows 8 touchscreen
        JogDial.utils.extend(JogDial.DomEvent,{
          MOUSE_DOWN: 'pointerdown MSPointerDown',
          MOUSE_MOVE: 'pointermove MSPointerMove',
          MOUSE_OUT: 'pointerout MSPointerOut',
          MOUSE_UP: 'pointerup pointercancel MSPointerUp MSPointerCancel'
        });
      }
      else if (JogDial.MobileEvent) { // Mobile standard
        JogDial.utils.extend(JogDial.DomEvent,{
          MOUSE_DOWN: 'touchstart',
          MOUSE_MOVE: 'touchmove',
          MOUSE_OUT: 'touchleave',
          MOUSE_UP: 'touchend'
        });
      }

    var opt = self.opt,
    info = self.info,
    //                T = self.myframe,  //##
    K = self.knob,
    W = self.wheel;
    self.pressed = false;

    // Add Defined DOM events from above
    JogDial.utils.addEvent(W, JogDial.DomEvent.MOUSE_DOWN, mouseDownEvent, false);
    JogDial.utils.addEvent(W, JogDial.DomEvent.MOUSE_MOVE, mouseDragEvent, false);
    JogDial.utils.addEvent(W, JogDial.DomEvent.MOUSE_UP, mouseUpEvent, false);
    JogDial.utils.addEvent(W, JogDial.DomEvent.MOUSE_OUT, mouseUpEvent, false);

    JogDial.utils.addEvent(document, JogDial.DomEvent.KEY_DOWN, keyDownEvent);
    //JogDial.utils.addEvent(document, JogDial.DomEvent.KEY_UP, keyUpEvent);
    JogDial.utils.addEvent(document, JogDial.DomEvent.WHEEL, wheelEvent);
  
    function mouseDownEvent(e) {                    // mouseDownEvent (MOUSE_DOWN)
      switch (opt.touchMode) {
        case 'knob':
        default:
          self.pressed = JogDial.utils.checkBoxCollision({
            x1: K.offsetLeft - W.offsetLeft,
            y1: K.offsetTop - W.offsetTop,
            x2: K.offsetLeft - W.offsetLeft + K.clientWidth,
            y2: K.offsetTop - W.offsetTop + K.clientHeight
            }, JogDial.utils.getCoordinates(e));
          break;
        case 'wheel':
          self.pressed = true;
          mouseDragEvent(e);
          break;
      }
      //Trigger down event
      if(self.pressed) JogDial.utils.triggerEvent(self.knob, JogDial.CustomEvent.MOUSE_DOWN);
    };

    function keyDownEvent(e) {
      if (globals.JOg_pad_open) {
        let dist = .1;
        e.preventDefault();  //#this does work on preventing key entry
        if (e.repeat) {
          return;
        } else {
          switch (e.keyCode) {
            case 37: // [left-arrow]
               injectMove(self, info, -1*dist);
              break;	
            case 38: // [up-arrow]
                // ... to be next axis up
                // test inject g-code
                
              break;
            case 39: // [right-arrow]
                injectMove(self, info, dist);
              break;	
            case 40: // [down-arrow]
                $('#jog_dial_sel_char').trigger('click');// ... to be next axis down
                break;
            case 65:  //A
              break;
            case 81: //Q
             break;	
          };
        };	
      }
    };  

    // function keyUpEvent(e) { 
    //     switch (e.keyCode) {
    //       case 65:  //A
    //         console.log("off A");
    //        break;
    //       case 81: //Q
    //         console.log("off Q");
    //        break;	
    //     }
    // };

// thinking about speed of spinning vs how long since last vector

    let delta = 0;
    let dist = 0;
    let last_tic_time = 0;                                  // ###################################################################
    function wheelEvent(e) {                                // MOUSE WHEEL SCROLLING MOTION
      if (globals.JOg_pad_open) {                           // ###################################################################
//        e.preventDefault();       // #does not seem to actually prevent scroll event at this point
        let move = 0;
        let last_tic_dur = e.timeStamp - last_tic_time;
//        let delta = Math.max(-1, Math.min(1, (e.wheelDelta || -e.detail)));
        //just template for using delta ...      myimage.style.width = Math.max(50, Math.min(800, myimage.width + (30 * delta))) + "px";
          if (last_tic_dur > 500) { 
            delta = Math.max(-1, Math.min(1, (e.wheelDelta || -e.detail)));
            dist = 0;
          }   
          if (last_tic_dur > 25) { 
            if (last_tic_dur < 1000) {
              dist = dist + .5;
              move = dist * delta;
              injectMove(self, info, move);                 // <<=================
                dist = 0;  //*** trying
            }  
            last_tic_time = e.timeStamp
          }
          // angleTo(self, JogDial.utils.convertClockToUnit(info.now.rotation + move));
          // info.now.rotation += move;
          
        }  
    };  

    //-------------------------------------------------------------------------------------------------------------------------------
    var lastRot = 0;                                        // ##################################################################
    function mouseDragEvent(e) {                            // MOUSE DRAG > mouseDragEvent (MOUSE_MOVE) and all related
      if (self.pressed) {                                   // ##################################################################
        (e.preventDefault) ? e.preventDefault() : e.returnValue = false;
        // var info = self.info, opt = self.opt,
        var offset = JogDial.utils.getCoordinates(e),
        _x = offset.x -self.center.x + W.offsetLeft,
        _y = offset.y -self.center.y + W.offsetTop,
        radian = Math.atan2(_y, _x) * JogDial.ToDeg,
        quadrant = JogDial.utils.getQuadrant(_x, _y),
        degree = JogDial.utils.convertUnitToClock(radian),
        rotation;
        //Calculate the current rotation value based on pointer offset
        info.now.rotation = JogDial.utils.getRotation(self, (quadrant == undefined) ? info.old.quadrant : quadrant  , degree);

        if (info.now.rotation > 6/sel_axis_multiplier) {
          info.now.rotation = 6.000/sel_axis_multiplier;
        }
        if (info.now.rotation < 0) {
          info.now.rotation = 0.000;
        }

        rotation = info.now.rotation;

        if(opt.maxDegree != null && opt.maxDegree <= rotation){
          if(info.snapshot.direction == null){
            info.snapshot.direction = 'right';
            info.snapshot.now = JogDial.utils.extend({},info.now);
            info.snapshot.old = JogDial.utils.extend({},info.old);
          }
            rotation = opt.maxDegree;
            radian = JogDial.utils.convertClockToUnit(rotation);
            degree = JogDial.utils.convertUnitToClock(radian);
        }
        else if(opt.minDegree != null && opt.minDegree >= rotation){
          if(info.snapshot.direction == null){
            info.snapshot.direction = 'left';
            info.snapshot.now = JogDial.utils.extend({},info.now);
            info.snapshot.old = JogDial.utils.extend({},info.old);
          }
            rotation = opt.minDegree;
            radian = JogDial.utils.convertClockToUnit(rotation);
            degree = JogDial.utils.convertUnitToClock(radian);
        }
        else if(info.snapshot.direction != null){
          info.snapshot.direction = null;
        }
        
        JogDial.utils.extend(self.knob, {                // Update JogDial data information
          rotation: rotation,
          degree: degree
        });
//        angleTo(self, radian);                           // Update ANGLE and Do MOTION
//        if (Math.abs(lastRot - rotation) >= 10) {           // ##Appears to be our STEP TEST
        if (Math.abs(lastRot - rotation) >= 2) {           // ##Appears to be our STEP TEST
            lastRot = rotation;
            Haptics.vibrate(5);                             // HAPTICS  & SOUND ACTION
            beep(20, 1400, 2);            
console.log('at DRAG- ', info.now.rotation, rotation, rotation * Math.PI / 180)
            //============================================
            _domotion(sel_axis_multiplier * info.now.rotation,); // probably don't want to do this division
            //============================================
            var bar_width = Math.round((rotation/360)*10) + '%';   // size of indicator bar moves
            $("#jog_dial_one_meter_inner").css('width',bar_width);
        }
        info.now.rotation = lastRot;
        info.old.rotation = lastRot;
        radian = JogDial.utils.convertClockToUnit(rotation);
        angleTo(self, radian);                           // Update ANGLE and Do MOTION
//console.log("dragEvt: ", degree, lastRot, rotation, info.old.rotation, info.now.rotation);
      }
    };

    function mouseUpEvent() {                               // mouseUpEvent (MOUSE_UP, MOUSE_OUT)
//console.log('got mouse-up in main')
      if(self.pressed){
        self.pressed = false;
        if(self.info.snapshot.direction != null){
          self.info.now = JogDial.utils.extend({},info.snapshot.now);
          self.info.old = JogDial.utils.extend({},info.snapshot.old);
          self.info.snapshot.direction = null;
        }
        // Trigger up event
        JogDial.utils.triggerEvent(self.knob, JogDial.CustomEvent.MOUSE_UP);
      }
    };
  };
                                                            //-------------------------------------------------
  function angleTo(self, radian, triggeredDegree) {         // HAVE WE MOVED ENOUGH TO Increment?
    radian *= JogDial.ToRad;
    var _x =  Math.cos(radian) * self.radius + self.center.x,
        _y =  Math.sin(radian) * self.radius + self.center.y,
        quadrant = JogDial.utils.getQuadrant(_x, _y),
        degree = JogDial.utils.convertUnitToClock(radian);
    self.knob.style.left = _x + 'px';
    self.knob.style.top = _y + 'px';
    if(self.knob.rotation == undefined){    // Update JogDial data information for start
      JogDial.utils.extend(self.knob, {
        rotation: self.opt.degreeStartAt,
        degree: JogDial.utils.convertUnitToClock(radian)
      });
    }
    if(triggeredDegree){
      // Update JogDial data information
      self.info.now = JogDial.utils.extend({},{rotation:triggeredDegree, quadrant: quadrant});
      self.info.old = JogDial.utils.extend({},{rotation: triggeredDegree%360, quadrant: quadrant});
      JogDial.utils.extend(self.knob, {
        rotation: triggeredDegree,
        degree: triggeredDegree%360
      });
    }
    //Trigger move event
    JogDial.utils.triggerEvent(self.knob, JogDial.CustomEvent.MOUSE_MOVE);
  };

  //-------------------------------------------------------------------------// #################################################
  function injectMove(self, info, dist) {                                    // *** INJECT MOTION (with alternates to wheel drag)
                                                                             // #################################################
//console.log("self- ", self, info, dist);
//console.log("INJECT>>  ",info.now.rotation, info.now.rotation + dist, sel_axis_multiplier, sel_axis_multiplier * (info.now.rotation + dist))
console.log("distance now = ", dist);
info.now.rotation += dist;

if (info.now.rotation > 6/sel_axis_multiplier) {                              // Maintain motion limits
  info.now.rotation = 6.000/sel_axis_multiplier;
}
if (info.now.rotation < 0) {
  info.now.rotation = 0.000;
}

angleTo(self, JogDial.utils.convertClockToUnit(info.now.rotation));
    //beep(10, 400, 5);
    beep(20, 1800, 1);
    info.old.rotation = info.now.rotation;
    var bar_width = Math.round((info.now.rotation/360)*10) + '%';             // size of indicator bar moves
    $("#jog_dial_one_meter_inner").css('width',bar_width);
    //============================================
    //      doMotion(info.now.rotation * Math.PI / 180,); // probably don't want to do this division
    _domotion((sel_axis_multiplier * info.now.rotation),); 
//    _domotion(sel_axis_multiplier * (info.now.rotation + dist)); 
    //============================================

    //console.log("injEvt: ", info.old.rotation, info.now.rotation);
    //console.log(info.old.rotation * Math.PI / 180)
    //var new_rad = info.old.rotation * Math.PI / 180;
    ////var new_rad = globals.TOol_x * Math.PI / 180;
    ////var _x =  Math.cos(new_rad) * 165,
    ////_y =  Math.sin(new_rad) * 165;
    //quadrant = JogDial.utils.getQuadrant(_x, _y),
    //degree = JogDial.utils.convertUnitToClock(radian);
    ////document.querySelector("#jog_dial_follower").style.left = _x + 'px';
    ////document.querySelector("#jog_dial_follower").style.top = _y + 'px';
    //              var lastRot = info.now.rotation;
  }

  function _domotion(move_to) {        // =============== General call to motion generator
    let axis_start_str = "TOol_" +  (globals.JOg_Axis.toLowerCase());
    
    doMotion(globals.JOg_Axis, globals[axis_start_str], move_to);                 // ... generally compile
//console.log(globals.JOg_Axis + ">  ", axis_start_str, globals[axis_start_str], move_to)    
    $('#jog_dial_loc_trgt').val(move_to.toFixed(3));
  }

  // UMD Wrapper pattern: Based on returnExports.js script from (https://github.com/umdjs/umd/blob/master/returnExports.js)
  if (typeof define === 'function' && define.amd) {
      // AMD. Register as an anonymous module.
      define(function() { return JogDial; });
  } else if (typeof exports === 'object') {
      // Node. Does not work with strict CommonJS, but
      // only CommonJS-like environments that support module.exports,
      // like Node.
      module.exports = JogDial;
  } else {
      // Browser globals
      window.JogDial = JogDial;
  }
//})(window);

//---------------------------------------------ON-app LOAD  
var dialOne;
window.onload = function(){
  var cur_deg = ((globals.TOol_x - 1.5708)%360);                                 // start now at current location
console.log("deg>  ", cur_deg)
  var bar = document.getElementById('jog_dial_one_meter_inner');
  dialOne = JogDial(document.getElementById('jog_dial_one'),
        {minDegree:null, maxDegree:null})
  .on('mousemove', function(evt){
        bar.style.width = Math.round((evt.target.rotation/360)*10) + '%';   // size of indicator bar moves // ##@th added for bar control???
  });

  //  beep(20, 1800, 1);
  // beep(50, 100, 200);
}

/*
* - general idea; 10 turns of wheel to cover the axis, each turn 360 degree = 1/10 distance (e.g. .6 for handibotX)
* - do we coast in time or distance or both. what marker syncs with what marker?
* - filtering the start; filtering reverses
*
*
*/
//--------------------------------------------SOUNDS
const a=new AudioContext()
//console.log(a.baseLatency)
function beep(vol, freq, duration){
  v=a.createOscillator()
  u=a.createGain()
  v.connect(u)
  v.frequency.value=freq
  v.type="square"
  u.connect(a.destination)
  u.gain.value=vol*0.01
  v.start(a.currentTime)
  v.stop(a.currentTime+duration*0.001)
}

