// Layout tab — manual control orientation. Primary interaction: the
// operator stands fixed at the bottom of the diagram holding the keypad
// in one giant hand, and the curved turn arrows spin the TABLE in front
// of them in 90° steps. The keypad mapping follows the table orientation
// so keypad-up is always "away from the operator". Because the mapping
// is constrained to pure rotations, the table's quarter-turn and the
// stored mapping are one-to-one — no extra config key is needed (and a
// config saved by the older walk-around-the-table UI loads unchanged).
// Manual fine-tuning remains: click a machine-motion arrow then a
// keypad button, OR drag a keypad button onto a machine-motion arrow.
// Both paths feed the same assignment logic, which treats the user's
// intent as a coherent rotation — so a manual assignment also visibly
// spins the table to the matching orientation.
//
// Persisted to engine config at machine.manual.layout_mapping. Live
// dashboard keypad picks up changes via a localStorage ping (storage
// event listener in main.js).
(function () {
  'use strict';

  var DEFAULT_MAPPING = { 'X+': '→', 'X-': '←', 'Y+': '↑', 'Y-': '↓' };

  // Color is tied to the keypad direction (positionally fixed on the
  // keypad) — the machine arrows take the color of the keypad button
  // currently mapped to them, so reassigning visibly recolors the
  // diagram as well.
  var DIR_COLOR = {
    '↑': '#27ae60', // green
    '↓': '#c0392b', // red
    '←': '#e67e22', // orange
    '→': '#0066cc'  // blue
  };
  var DIR_STROKE = {
    '↑': '#0d5a2c',
    '↓': '#621509',
    '←': '#7a3d04',
    '→': '#003a6e'
  };

  // CCW around the compass — used to rotate the whole mapping when the
  // user picks a new direction for any single axis.
  var DIR_ORDER = ['→', '↑', '←', '↓'];
  function rotateDir(dir, q) {
    var i = DIR_ORDER.indexOf(dir);
    if (i < 0) return dir;
    return DIR_ORDER[(i + q + 4) % 4];
  }
  function rotationBetween(from, to) {
    var fromI = DIR_ORDER.indexOf(from);
    var toI = DIR_ORDER.indexOf(to);
    if (fromI < 0 || toI < 0) return 0;
    return (toI - fromI + 4) % 4;
  }

  // Table orientation is tableQ quarter-turns CLOCKWISE from default.
  // Rotating the table q quarter-turns CW turns every motion arrow q
  // quarter-turns CW on screen, so each axis maps to its default keypad
  // direction rotated q CW = (4-q) CCW. (This is numerically identical
  // to the old operator-side encoding — side index s stored the same
  // mapping — so persisted configs are compatible both ways.)
  function mappingForQuarter(q) {
    var m = {};
    Object.keys(DEFAULT_MAPPING).forEach(function (a) {
      m[a] = rotateDir(DEFAULT_MAPPING[a], (4 - q) % 4);
    });
    return m;
  }

  function quarterFromMapping(mapping) {
    return (4 - rotationBetween(DEFAULT_MAPPING['X+'], mapping['X+'])) % 4;
  }

  // Pivot of the table art in machine-layer coordinates.
  var TABLE_CX = 260, TABLE_CY = 180;

  var fabmo = null;
  function getFabmo() {
    if (fabmo) return fabmo;
    if (typeof require === 'function') {
      try {
        var Fabmo = require('../../../static/js/libs/fabmo.js');
        fabmo = new Fabmo();
        return fabmo;
      } catch (e) { /* fall through */ }
    }
    return null;
  }

  function init() {
    var $tab = $('#tabpanel9');
    if (!$tab.length || $tab.data('layout-initialized')) return;
    $tab.data('layout-initialized', true);

    var mapping = Object.assign({}, DEFAULT_MAPPING);
    var armed = null;
    var originCorner = 'bl';
    var tableQ = quarterFromMapping(mapping);

    // Continuous display angle so consecutive quarter-turns keep spinning
    // the same way instead of snapping back through 0.
    var displayAngle = 0;
    var animFrame = null;

    function setTableAngle(a) {
      $tab.find('.table-group').attr('transform',
        'rotate(' + a + ' ' + TABLE_CX + ' ' + TABLE_CY + ')');
    }

    // Animate displayAngle to the nearest angle equivalent to tableQ*90,
    // taking the short way around.
    function spinTableToQ(animate) {
      var target = tableQ * 90;
      var delta = ((target - displayAngle) % 360 + 360) % 360;
      if (delta > 180) delta -= 360;
      target = displayAngle + delta;
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      if (!animate || delta === 0) {
        displayAngle = target;
        setTableAngle(displayAngle);
        return;
      }
      var from = displayAngle;
      var start = null;
      var DURATION = 350;
      function step(ts) {
        if (start === null) start = ts;
        var t = Math.min((ts - start) / DURATION, 1);
        var ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        displayAngle = from + delta * ease;
        setTableAngle(displayAngle);
        if (t < 1) {
          animFrame = requestAnimationFrame(step);
        } else {
          animFrame = null;
          displayAngle = target;
          setTableAngle(displayAngle);
        }
      }
      animFrame = requestAnimationFrame(step);
    }

    function dirToAxis(dir) {
      var found = null;
      Object.keys(mapping).forEach(function (a) {
        if (mapping[a] === dir) found = a;
      });
      return found;
    }

    function paintMotionArrow($arrow, isArmed, isDropHover) {
      var $rect = $arrow.find('.kp-mini');
      var axis = $arrow.data('axis');
      var dir = mapping[axis];
      // Fill follows the keypad direction the axis is mapped to, so it
      // visibly changes when the user reassigns.
      $rect.attr('fill', DIR_COLOR[dir]);
      if (isArmed || isDropHover) {
        $rect.attr('stroke', '#fff').attr('stroke-width', 3);
      } else {
        $rect.attr('stroke', DIR_STROKE[dir]).attr('stroke-width', 1.5);
      }
    }

    function paintKeypadButton($btn) {
      // Pentagon fill color is fixed by the keypad direction (positional).
      // The axis label inside the glyph follows the current mapping, like
      // the live keypad's orientation remap rewrites its labels.
      var dir = $btn.data('dir');
      $btn.find('.glyph-shape').css('fill', DIR_COLOR[dir]);
      var labelAxis = dirToAxis(dir);
      // "X+" -> "X +" to match the spaced labels in the markup
      $btn.find('.glyph-label').text(labelAxis ? labelAxis.charAt(0) + ' ' + labelAxis.charAt(1) : '');
    }

    function repaintAll() {
      $tab.find('.motion-arrow').each(function () {
        var $arr = $(this);
        paintMotionArrow($arr, armed === $arr.data('axis'), false);
      });
      $tab.find('.kp-btn').each(function () {
        paintKeypadButton($(this));
      });
    }

    function setStatus(text, color) {
      $tab.find('.status-text').text(text).css('color', color || '#666');
    }

    function persist() {
      var f = getFabmo();
      if (f && f.setConfig) {
        f.setConfig({
          machine: {
            manual: {
              layout_mapping: mapping,
              layout_origin_corner: originCorner
            }
          }
        }, function (err) {
          if (err) {
            console.warn('Failed to save layout config:', err);
            setStatus(window.t('config.layout.status_save_failed'), '#c0392b');
          }
        });
      }
      try {
        window.localStorage.setItem('fabmo.layout_mapping', JSON.stringify(mapping));
      } catch (e) { /* ignore */ }
    }

    function applyOriginCornerVisual() {
      $tab.find('.origin-corner').each(function () {
        var $c = $(this);
        var isActive = $c.data('corner') === originCorner;
        $c.find('.origin-dot').attr('fill', isActive ? '#0066cc' : 'transparent');
      });
      // Move the "0,0" label to the active corner's group so it follows.
      var $active = $tab.find('.origin-corner[data-corner="' + originCorner + '"]');
      $tab.find('.origin-corner text').remove();
      if ($active.length) {
        var cx = parseFloat($active.find('circle').attr('cx'));
        var cy = parseFloat($active.find('circle').attr('cy'));
        // Anchor the label diagonally inside the table from the corner,
        // centered on that point, so it clears the corner circle at any
        // table orientation.
        var dx = (originCorner.indexOf('r') >= 0) ? -24 : 24;
        var dy = (originCorner.indexOf('b') >= 0) ? -14 : 18;
        var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', cx + dx);
        label.setAttribute('y', cy + dy);
        label.setAttribute('text-anchor', 'middle');
        // The corner group rides the table rotation; counter-rotate the
        // label about its own anchor so it stays upright and readable.
        label.setAttribute('transform',
          'rotate(' + (-tableQ * 90) + ' ' + (cx + dx) + ' ' + (cy + dy) + ')');
        label.setAttribute('font-size', '12');
        label.setAttribute('font-weight', 'bold');
        label.setAttribute('fill', '#0066cc');
        label.textContent = '0,0';
        $active[0].appendChild(label);
      }
    }

    function loadFromEngine() {
      var f = getFabmo();
      if (!f || !f.getConfig) return;
      f.getConfig(function (err, cfg) {
        if (err || !cfg || !cfg.machine || !cfg.machine.manual) return;
        var saved = cfg.machine.manual.layout_mapping;
        if (saved && typeof saved === 'object') {
          mapping = Object.assign({}, DEFAULT_MAPPING, saved);
        }
        var savedCorner = cfg.machine.manual.layout_origin_corner;
        if (savedCorner && ['tl','tr','bl','br'].indexOf(savedCorner) >= 0) {
          originCorner = savedCorner;
        }
        tableQ = quarterFromMapping(mapping);
        spinTableToQ(false);
        applyOriginCornerVisual();
        repaintAll();
      });
    }

    // Core assignment: axis A should be triggered by keypad direction D.
    // Apply as a rotation so the whole mapping stays a coherent
    // rotation-from-default.
    function assign(axis, dir) {
      var q = rotationBetween(mapping[axis], dir);
      if (q !== 0) {
        Object.keys(mapping).forEach(function (a) {
          mapping[a] = rotateDir(mapping[a], q);
        });
      }
      armed = null;
      // A manual assignment is still a rotation, so it lands the table
      // on a definite orientation — spin it there too.
      tableQ = quarterFromMapping(mapping);
      spinTableToQ(true);
      applyOriginCornerVisual();
      setStatus(axis + window.t('config.layout.status_assigned_prefix') + dir + window.t('config.layout.status_assigned_suffix'), '#27ae60');
      repaintAll();
      persist();
    }

    // ---- Table path: turn arrows spin the table in front of the fixed
    // operator; the mapping follows so keypad-up always moves away from
    // the operator.

    $tab.on('click', '.turn-arrow', function (e) {
      e.stopPropagation();
      var step = ($(this).data('turn') === 'cw') ? 1 : 3;
      tableQ = (tableQ + step) % 4;
      mapping = mappingForQuarter(tableQ);
      armed = null;
      spinTableToQ(true);
      applyOriginCornerVisual();
      repaintAll();
      persist();
      setStatus(window.t('config.layout.status_table_rotated'), '#27ae60');
    });

    // ---- Click path: arm a motion arrow, then click a keypad button.

    $tab.on('click', '.origin-corner', function () {
      originCorner = $(this).data('corner');
      applyOriginCornerVisual();
      persist();
    });

    $tab.on('click', '.motion-arrow', function () {
      var axis = $(this).data('axis');
      armed = (armed === axis) ? null : axis;
      if (armed) {
        setStatus(window.t('config.layout.status_armed_prefix') + armed + window.t('config.layout.status_armed_suffix'), DIR_COLOR[mapping[axis]]);
      } else {
        setStatus(window.t('config.layout.status_click_arrow'));
      }
      repaintAll();
    });

    $tab.on('click', '.kp-btn', function () {
      if (!armed) return; // no-op if no motion is armed — the drag path handles the other order
      var dir = $(this).data('dir');
      assign(armed, dir);
    });

    // ---- Drag path: mousedown on a keypad button, drop on a motion arrow.
    // Uses pointer events with a small dead-zone so a quick click still
    // falls through to the click handler above.

    $tab.on('mousedown', '.kp-btn', function (e) {
      if (e.button !== 0) return;
      var dir = $(this).data('dir');
      var startX = e.clientX, startY = e.clientY;
      var dragging = false;
      var $ghost = null;

      function makeGhost() {
        return $('<div></div>').css({
          position: 'fixed',
          pointerEvents: 'none',
          width: '44px',
          height: '44px',
          background: DIR_COLOR[dir] || '#313366',
          border: '2px solid #fff',
          borderRadius: '8px',
          color: '#fff',
          fontSize: '22px',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: '0.92',
          boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
          zIndex: 9999
        }).text(dir).appendTo('body');
      }

      function dropTargetAt(x, y) {
        var el = document.elementFromPoint(x, y);
        return $(el).closest('.motion-arrow');
      }

      function onMove(ev) {
        if (!dragging) {
          var dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (dx * dx + dy * dy < 25) return; // 5px dead-zone
          dragging = true;
          $ghost = makeGhost();
          setStatus(window.t('config.layout.status_drop_prefix') + dir + window.t('config.layout.status_drop_suffix'), '#666');
        }
        $ghost.css({ left: (ev.clientX - 22) + 'px', top: (ev.clientY - 22) + 'px' });
        // Live drop-target highlight
        $tab.find('.motion-arrow').each(function () {
          paintMotionArrow($(this), armed === $(this).data('axis'), false);
        });
        var $tgt = dropTargetAt(ev.clientX, ev.clientY);
        if ($tgt.length) paintMotionArrow($tgt, false, true);
      }

      function onUp(ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!dragging) return; // click path handles it
        if ($ghost) $ghost.remove();
        var $tgt = dropTargetAt(ev.clientX, ev.clientY);
        repaintAll();
        if ($tgt.length) {
          assign($tgt.data('axis'), dir);
        } else {
          setStatus(window.t('config.layout.status_drop_cancelled'), '#999');
        }
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    spinTableToQ(false);
    applyOriginCornerVisual();
    repaintAll();
    loadFromEngine();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
