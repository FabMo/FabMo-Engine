// Applies a user's manual-control orientation mapping to the live keypad
// DOM by swapping the action classes (x_pos/x_neg/y_pos/y_neg) on each
// button while leaving the visual icon untouched. This lets a user
// standing on a non-default side of the machine press the button that
// LOOKS like "up" and have it move the machine in whatever direction
// they configured.
//
// mapping: object keyed by machine motion (X+, X-, Y+, Y-), valued by the
//   keypad direction that should produce it (↑, ↓, ←, →). Defaults to the
//   natural mapping when absent.
//
// Each keypad button needs a `data-keypad-orig` attribute identifying the
// button's apparent direction(s) so we can reapply the mapping regardless
// of current state.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KeypadOrientation = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT_MAPPING = { "X+": "→", "X-": "←", "Y+": "↑", "Y-": "↓" };

  // axis -> class fragment
  var AXIS_CLASS = {
    "X+": "x_pos",
    "X-": "x_neg",
    "Y+": "y_pos",
    "Y-": "y_neg"
  };
  var ALL_ACTION_CLASSES = ["x_pos", "x_neg", "y_pos", "y_neg"];

  function invertMapping(mapping) {
    var inv = {};
    Object.keys(mapping).forEach(function (axis) {
      inv[mapping[axis]] = axis;
    });
    return inv;
  }

  function applyOrientation(rootEl, mapping) {
    if (!rootEl) return;
    mapping = mapping || DEFAULT_MAPPING;

    // Sanity: backfill any missing keys with defaults so we don't silently
    // produce a button with no action class.
    var m = Object.assign({}, DEFAULT_MAPPING, mapping);
    var inv = invertMapping(m);

    var $buttons = $(rootEl).find("[data-keypad-orig]");
    $buttons.each(function () {
      var $btn = $(this);
      // data-keypad-orig can be one of "↑", "↓", "←", "→" for a cardinal
      // button, or a two-char string like "↑←" for a diagonal.
      var orig = ($btn.attr("data-keypad-orig") || "").trim();
      if (!orig) return;

      // Strip any existing action classes — we'll rewrite them.
      ALL_ACTION_CLASSES.forEach(function (c) { $btn.removeClass(c); });

      // For each apparent direction this button represents, look up the
      // machine motion it should now produce and add that class.
      var dirs = orig.split("");
      dirs.forEach(function (dir) {
        var axis = inv[dir];
        if (axis && AXIS_CLASS[axis]) {
          $btn.addClass(AXIS_CLASS[axis]);
        }
      });
    });
  }

  return {
    DEFAULT_MAPPING: DEFAULT_MAPPING,
    apply: applyOrientation,
    invert: invertMapping
  };
});
