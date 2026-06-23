// Layout tab — manual control orientation. User can either click a
// machine-motion arrow then a keypad button, OR drag a keypad button
// onto a machine-motion arrow. Both paths feed the same assignment
// logic. The assignment treats the user's intent as a coherent rotation
// around the machine, so picking X+ = ↑ pulls X- to ↓ and rotates the Y
// axis to fill the freed horizontal slots — matches how operators think
// about "where I'm standing relative to the machine".
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
      // Keypad button color is fixed by the keypad direction (positional).
      var dir = $btn.data('dir');
      $btn.css('background-color', DIR_COLOR[dir]);
    }

    function paintLabelRow(dir) {
      var $row = $('.kp-label-row[data-dir="' + dir + '"]');
      var axis = dirToAxis(dir);
      var $axisCell = $row.find('.kp-axis');
      if (axis) {
        $axisCell.text(axis).css('color', DIR_COLOR[dir]);
      } else {
        $axisCell.text('—').css('color', '#999');
      }
    }

    function repaintAll() {
      $tab.find('.motion-arrow').each(function () {
        var $arr = $(this);
        paintMotionArrow($arr, armed === $arr.data('axis'), false);
      });
      $tab.find('.kp-btn').each(function () {
        paintKeypadButton($(this));
      });
      ['↑', '↓', '←', '→'].forEach(paintLabelRow);
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
        // Position the label inside the table relative to the corner.
        var dx = (originCorner.indexOf('r') >= 0) ? -32 : 14;
        var dy = (originCorner.indexOf('b') >= 0) ? -2 : 4;
        var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', cx + dx);
        label.setAttribute('y', cy + dy);
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
      setStatus(axis + window.t('config.layout.status_assigned_prefix') + dir + window.t('config.layout.status_assigned_suffix'), '#27ae60');
      repaintAll();
      persist();
    }

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
          background: '#313366',
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

    repaintAll();
    loadFromEngine();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
