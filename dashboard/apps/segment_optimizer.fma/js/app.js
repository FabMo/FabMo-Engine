/* Segment Optimizer app — UI wiring around SBPFilter.filterSBP */
(function () {
    "use strict";

    var fabmo = new FabMoDashboard();

    // State for the currently loaded source file and the produced output.
    var input = { text: null, name: null }; // source file
    var output = { text: null, name: null, stats: null }; // optimized result
    var INCH_DEFAULT_MIN = 0.03;
    var MM_DEFAULT_MIN = 0.76; // ~0.03"

    $(function () {
        bindSourceTabs();
        bindFileInput();
        bindQueue();
        bindParams();
        bindActions();
        fabmo.ready();
    });

    // ---- source selection ----------------------------------------------------

    function bindSourceTabs() {
        $('input[name="source"]').on("change", function () {
            var v = $('input[name="source"]:checked').val();
            $("#source-disk").toggle(v === "disk");
            $("#source-queue").toggle(v === "queue");
            if (v === "queue") loadQueue();
        });
    }

    function bindFileInput() {
        $("#file-input").on("change", function () {
            var f = this.files && this.files[0];
            if (!f) return;
            var reader = new FileReader();
            reader.onload = function (e) {
                setInput(e.target.result, f.name);
            };
            reader.onerror = function () {
                fabmo.notify("error", "Could not read that file.");
            };
            reader.readAsText(f);
        });
    }

    function bindQueue() {
        $("#queue-refresh").on("click", function (e) {
            e.preventDefault();
            loadQueue();
        });
        $("#queue-select").on("change", function () {
            var id = $(this).val();
            if (!id) return;
            var name = $(this).find("option:selected").data("name") || (id + ".sbp");
            $.ajax({
                type: "GET",
                url: "/job/" + id + "/file",
                success: function (content) {
                    setInput(content, name);
                },
                error: function () {
                    fabmo.notify("error", "Could not load that job's file.");
                },
            });
        });
    }

    function loadQueue() {
        $("#queue-select").html('<option value="">Loading jobs&hellip;</option>');
        fabmo.getJobsInQueue(function (err, jobs) {
            if (err) {
                $("#queue-select").html('<option value="">(error loading jobs)</option>');
                return;
            }
            var list = [];
            if (jobs) {
                if (jobs.running) list = list.concat(jobs.running);
                if (jobs.pending) list = list.concat(jobs.pending);
            }
            // Only OpenSBP jobs are relevant here.
            list = list.filter(function (j) {
                var n = (j && j.name) || "";
                return /\.sbp$/i.test(n);
            });
            if (!list.length) {
                $("#queue-select").html('<option value="">(no .sbp jobs in queue)</option>');
                return;
            }
            var html = ['<option value="">Select a job&hellip;</option>'];
            list.forEach(function (j) {
                var id = j._id || j.id;
                var name = j.name || String(id);
                html.push('<option value="' + id + '" data-name="' + escapeAttr(name) + '">' + escapeHtml(name) + "</option>");
            });
            $("#queue-select").html(html.join(""));
        });
    }

    // ---- loading a source ----------------------------------------------------

    function setInput(text, name) {
        input.text = text;
        input.name = name || "toolpath.sbp";
        // Reset any previous result.
        output = { text: null, name: null, stats: null };
        $("#results-card").hide();
        $("#download-btn, #submit-btn").prop("disabled", true);

        detectUnits(text);
        var lines = text.split(/\r?\n/).length;
        $("#file-info").text(input.name + "  —  " + lines.toLocaleString() + " lines");
        $("#process-btn").prop("disabled", false);
    }

    // Auto-detect units from a leading SU command, e.g. "SU,MM" / "SU, in".
    function detectUnits(text) {
        var head = text.split(/\r?\n/).slice(0, 80).join("\n");
        var m = head.match(/^\s*SU\s*,?\s*([A-Za-z]+)/im);
        var mm = m && /^m/i.test(m[1]);
        $("#units-label").text(mm ? "mm" : "in");
        $("#units-note").text(mm ? "millimeters" : "inches");
        // If the user hasn't customized the threshold, pick a sensible default.
        var cur = parseFloat($("#minSegLen").val());
        if (cur === INCH_DEFAULT_MIN || cur === MM_DEFAULT_MIN) {
            $("#minSegLen").val(mm ? MM_DEFAULT_MIN : INCH_DEFAULT_MIN);
        }
    }

    // ---- parameters ----------------------------------------------------------

    function bindParams() {
        // Re-enable Optimize whenever a param changes and we have input.
        $("#minSegLen, #maxRun, #angleTol").on("input", function () {
            if (input.text) $("#process-btn").prop("disabled", false);
        });
    }

    function readOpts() {
        return {
            minSegLen: parseFloat($("#minSegLen").val()) || 0,
            maxRun: parseInt($("#maxRun").val(), 10) || 1,
            angleTol: parseFloat($("#angleTol").val()) || 0,
        };
    }

    // ---- actions -------------------------------------------------------------

    function bindActions() {
        $("#process-btn").on("click", function () {
            if (!input.text) {
                fabmo.notify("warn", "Choose a file first.");
                return;
            }
            var r;
            try {
                r = SBPFilter.filterSBP(input.text, readOpts());
            } catch (e) {
                fabmo.notify("error", "Optimize failed: " + e.message);
                return;
            }
            output.text = r.text;
            output.name = outName(input.name);
            output.stats = r.stats;
            showResults(r.stats);
            $("#download-btn, #submit-btn").prop("disabled", false);
        });

        $("#download-btn").on("click", function () {
            if (!output.text) return;
            fabmo._download(output.text, output.name, "text/plain");
        });

        $("#submit-btn").on("click", function () {
            if (!output.text) return;
            var file;
            try {
                file = new File([output.text], output.name, { type: "text/plain" });
            } catch (e) {
                // Older browsers: File constructor may be unavailable; use a Blob.
                file = new Blob([output.text], { type: "text/plain" });
                file.name = output.name;
            }
            $("#submit-btn").prop("disabled", true);
            fabmo.submitJob(file, { stayHere: true }, function (err) {
                $("#submit-btn").prop("disabled", false);
                if (err) {
                    fabmo.notify("error", "Submit failed: " + (err.message || err));
                } else {
                    fabmo.notify("success", "Added “" + output.name + "” to the job queue.");
                }
            });
        });
    }

    function showResults(stats) {
        var movesIn = stats.movesIn || 0;
        var movesOut = stats.movesOut || 0;
        var saved = movesIn - movesOut;
        var html =
            '<div class="stat-big">' + stats.reductionPct + "% fewer cut moves</div>" +
            '<div class="stat-row">Cut moves: <b>' + movesIn.toLocaleString() + "</b> &rarr; <b>" +
            movesOut.toLocaleString() + "</b>  (" + saved.toLocaleString() + " removed)</div>" +
            '<div class="stat-row">Total lines: ' + (stats.linesIn || 0).toLocaleString() +
            " &rarr; " + (stats.linesOut || 0).toLocaleString() + "</div>" +
            '<div class="stat-row muted">Output: ' + escapeHtml(output.name) + "</div>";
        if (movesIn === 0) {
            html += '<div class="stat-row warn">No literal cut-move segments were found to optimize.</div>';
        }
        $("#results").html(html);
        $("#results-card").show();
    }

    // ---- helpers -------------------------------------------------------------

    function outName(name) {
        name = name || "toolpath.sbp";
        return name.replace(/\.sbp$/i, "") + "-optimized.sbp";
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }
    function escapeAttr(s) {
        return escapeHtml(s).replace(/'/g, "&#39;");
    }
})();
