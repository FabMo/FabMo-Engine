var fabmo = new FabMoDashboard();

// --- Rotary indexer model presets ---
// Placeholder model so the end-to-end flow is real. Fill in real values
// and add more models as we go.
var ROTARY_MODELS = [
  {
    id: "indexer-placeholder",
    name: "Indexer (placeholder)",
    image: "images/rotary/placeholder.png",
    description: "Example preset — replace with real model values.",
    config: {
      // Shape mirrors fabmo.setConfig() / engine config tree.
      // These are illustrative values only.
      machine: {
        auxiliary: { axis: "A" }
      },
      driver: {
        "4tr": 360,
        "4mi": 10
      }
    }
  }
];

// --- View navigation ---
function showView(id) {
  $(".view").removeClass("active");
  $("#" + id).addClass("active");
  if (id === "view-home") {
    $("#nav-back").hide();
    $("#nav-home").addClass("active");
  } else {
    $("#nav-back").show();
    $("#nav-home").removeClass("active");
  }
}

$(function () {
  // Tile clicks
  $(".tile").on("click", function () {
    showView($(this).data("target"));
  });

  // Nav
  $("#nav-home").on("click", function (e) {
    e.preventDefault();
    showView("view-home");
  });
  $("#nav-back").on("click", function (e) {
    e.preventDefault();
    showView("view-home");
  });

  renderRotaryModels();
  wireRotaryApply();
});

// --- Rotary sub-page ---
var selectedRotary = null;

function renderRotaryModels() {
  var $grid = $("#rotary-model-grid").empty();
  ROTARY_MODELS.forEach(function (m) {
    var $card = $(
      '<div class="model-card" data-id="' + m.id + '">' +
        '<div class="model-card-img" style="background-image:url(\'' + m.image + '\')"></div>' +
        '<div class="model-card-name">' + m.name + '</div>' +
      '</div>'
    );
    $card.on("click", function () {
      selectRotary(m.id);
    });
    $grid.append($card);
  });
}

function selectRotary(id) {
  selectedRotary = ROTARY_MODELS.find(function (m) { return m.id === id; });
  if (!selectedRotary) return;
  $(".model-card").removeClass("selected");
  $('.model-card[data-id="' + id + '"]').addClass("selected");
  $("#rotary-selected-name").text(selectedRotary.name);
  $("#rotary-status").text("").removeClass("ok err");
  $("#rotary-selected").show();
}

function wireRotaryApply() {
  $("#rotary-apply").on("click", function () {
    if (!selectedRotary) return;
    var msg = "Apply " + selectedRotary.name + " setup? This will update axis and driver settings.";
    if (!window.confirm(msg)) return;

    $("#rotary-status").text("Applying...").removeClass("ok err");
    fabmo.setConfig(selectedRotary.config, function (err) {
      if (err) {
        $("#rotary-status").text("Error: " + (err.message || err)).addClass("err");
      } else {
        $("#rotary-status").text("Applied.").addClass("ok");
      }
    });
  });
}
