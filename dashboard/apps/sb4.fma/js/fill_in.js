/*
 * fill_in.js — the parameter list of the Fill-In sheet (the "legal pad").
 *
 * Opening and closing the sheet, the FP/FL "File Ready to Run" mode and the
 * RUN button stay where they were (displayFillIn in sb_app.js, the handlers
 * in init_setActions.js). This file builds the rows for a command from the
 * engine's command table (cmds[], from /opensbp/commands) and keeps the
 * Command Line (#cmd-input) in step with what is written on the pad, so that
 * what the pad shows is exactly what RUN sends.
 *
 * What the command table gives for each parameter, and how it is used:
 *   name, desc        label and its tooltip
 *   disptype          "2" = required (red *), "0" = obsolete: no row, but the
 *                     parameter keeps its (empty) place in the command
 *   opts              a choice: shown as a drop-down list
 *   default,          the starting value; for a choice the default is the
 *   default_desc      first item of the list
 *   range             shown as a note beside the field
 * The table's "type" is not used: it does not line up with the parameters.
 *
 * Settings commands (V*) are treated differently. A blank parameter of a V
 * command means "leave this setting alone", so the sheet must not send the
 * table's canned defaults (that would reset speeds, limits, etc.). For V
 * commands the fields start blank — or showing the current value where it is
 * known — and only the fields the user changes are sent.
 */

var fiCmd = null;       // command the sheet is open on; null in the file-ready mode
var fiSetting = false;  // true for a settings (V*) command
var fiEnterDown = false; // ENTER went down in a field (see the key handlers below)

// Current values that can be shown for settings commands: opensbp config key
// by parameter position (same order as the command reads its arguments, see
// runtime/opensbp/commands/value.js).
var FI_CURRENT = {
    VS: [
        "movexy_speed", "movez_speed", "movea_speed", "moveb_speed", "movec_speed",
        "jogxy_speed", "jogz_speed", "joga_speed", "jogb_speed", "jogc_speed"
    ],
    VC: ["cutterDia", null, null, "safeZpullUp", null, "pocketOverlap", "safeApullUp"]
};

function fiHasText(v) {
    return v !== undefined && v !== null && String(v) !== "";
}

// The list of a choice parameter: its default first, then the options.
function fiChoices(p) {
    if (!p.opts || !p.opts.length) {
        return null;
    }
    var list = [];
    var seen = {};
    function add(value, desc) {
        value = String(value);
        if (seen[value]) {
            if (desc && !seen[value].desc) {
                seen[value].desc = desc;
            }
            return;
        }
        seen[value] = { value: value, desc: desc || "" };
        list.push(seen[value]);
    }
    if (fiHasText(p.default)) {
        add(p.default, p.default_desc);
    }
    p.opts.forEach(function (o) {
        add(o.value, o.desc);
    });
    return list;
}

// Tooltip: the description plus, for a choice, its list of values.
function fiTip(p, choices) {
    var tip = p.desc || "";
    if (choices) {
        choices.forEach(function (c) {
            tip += "\n" + c.value + " = " + c.desc;
        });
    }
    return tip;
}

// Note beside a field: what the default means, and the allowed range.
function fiNote(p, choices) {
    var parts = [];
    if (!choices && !fiSetting && fiHasText(p.default) && p.default_desc) {
        parts.push(p.default + " = " + p.default_desc);
    }
    if (p.range) {
        var lo = fiHasText(p.range[0]) ? String(p.range[0]) : "";
        var hi = fiHasText(p.range[1]) ? String(p.range[1]).trim() : "";
        if (lo && hi) {
            parts.push(lo + " – " + hi);
        } else if (hi) {
            parts.push(isNaN(Number(hi.replace(/,/g, ""))) ? hi : "≤ " + hi);
        } else if (lo) {
            parts.push("≥ " + lo);
        }
    }
    return parts.join("; ");
}

// A command's parameters ([] for a command the table lists without any).
function fiParams(command) {
    return (cmds[command] && cmds[command].params) || [];
}

function fiClearRows() {
    fiCmd = null;
    fiSetting = false;
    $(".fi-listing").empty();
    $("#fi_preview").text("");
}

// Build the rows of the sheet for a command.
function fiBuildRows(command) {
    var $list = $(".fi-listing").empty();
    fiCmd = command;
    fiSetting = command.charAt(0) === "V";

    fiParams(command).forEach(function (p, i) {
        if (p.disptype === "0") {
            return; // obsolete: no row, the slot stays empty
        }
        var id = "fi_" + (i + 1);
        var choices = fiChoices(p);
        var tip = fiTip(p, choices);
        var $field;

        var $label = $("<label></label>").attr("for", id).attr("title", tip).text(p.name || "");
        if (p.disptype === "2") {
            $label.append('<span class="fi-req">*</span>');
        }

        if (choices) {
            $field = $("<select></select>");
            if (fiSetting) {
                $field.append($("<option></option>").val("").text(window.t("sb4.fillin.no_change")));
            } else if (!fiHasText(p.default)) {
                $field.append($("<option></option>").val("").text(""));
            }
            choices.forEach(function (c) {
                $field.append($("<option></option>").val(c.value).text(c.desc ? c.value + " — " + c.desc : c.value));
            });
            $field.prop("selectedIndex", 0);
        } else {
            $field = $('<input type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">');
            $field.val(!fiSetting && fiHasText(p.default) ? String(p.default) : "");
        }
        $field.addClass("fi-field").attr("id", id).attr("data-idx", i).attr("title", tip);
        if (p.disptype === "2") {
            $field.attr("data-req", "1");
        }
        $field.attr("data-initial", $field.val() || "");

        $list.append(
            $label,
            $('<div class="fi-cell fi_val"></div>').append($field),
            $('<div class="fi-note"></div>').text(fiNote(p, choices))
        );
    });

    fiShowCurrent(command);
}

// For a settings command, show the values the tool has now. They are for
// reference: a field left at its current value is not sent.
function fiShowCurrent(command) {
    var keys = FI_CURRENT[command];
    if (!keys) {
        return;
    }
    fabmo.getConfig(function (err, data) {
        if (err || !data || !data.opensbp || fiCmd !== command) {
            return; // no config, or the sheet has moved on to another command
        }
        keys.forEach(function (key, i) {
            var val = key ? data.opensbp[key] : undefined;
            var $f = $("#fi_" + (i + 1));
            if (val === undefined || val === null || !$f.length) {
                return;
            }
            if ($f.val() !== $f.attr("data-initial")) {
                return; // already being edited
            }
            $f.val(String(val)).attr("data-initial", String(val));
        });
        fiSync();
    });
}

// The command as written on the pad: "CC, 5, T, 1". Parameters with no row
// and (for settings commands) unchanged fields are empty places; trailing
// empty places are dropped.
function fiAssemble() {
    var vals = [];
    var i;
    for (i = 0; i < fiParams(fiCmd).length; i++) {
        vals.push("");
    }
    $("#fi-modal .fi-field").each(function () {
        var $f = $(this);
        var v = $.trim($f.val() || "");
        if (fiSetting && v === $f.attr("data-initial")) {
            v = "";
        }
        vals[Number($f.attr("data-idx"))] = v;
    });
    while (vals.length && vals[vals.length - 1] === "") {
        vals.pop();
    }
    return vals.length ? fiCmd + ", " + vals.join(", ") : fiCmd;
}

// Put the pad's command on the Command Line and in the sheet's preview line,
// and mark required fields that are still empty.
function fiSync() {
    if (!fiCmd) {
        return;
    }
    var line = fiAssemble();
    $("#cmd-input").val(line);
    $("#fi_preview").text(line);
    $("#fi-modal .fi-field[data-req]").each(function () {
        $(this).toggleClass("fi-missing", $.trim($(this).val() || "") === "");
    });
}

$(document).ready(function () {
    $("#fi-modal").on("input change", ".fi-field", fiSync);

    // ENTER in a field runs the command. The run is done on key-UP: RUN closes
    // the sheet and hands the keyboard back to the Command Line, and a run on
    // key-down would leave the key-up to land there, where ENTER on an empty
    // line means "re-run the last file".
    $("#fi-modal").on("keydown", ".fi-field", function (e) {
        var $fields, at;
        if (e.key === "Enter") {
            e.preventDefault(); // never submit the form
            fiEnterDown = true;
        } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && this.tagName === "INPUT") {
            $fields = $("#fi-modal .fi-field");
            at = $fields.index(this) + (e.key === "ArrowDown" ? 1 : -1);
            if (at >= 0 && at < $fields.length) {
                e.preventDefault();
                $fields.eq(at).focus();
                if ($fields.eq(at).is("input")) {
                    $fields.eq(at).select();
                }
            }
        }
    });
    $("#fi-modal").on("keyup", ".fi-field", function (e) {
        if (e.key === "Enter" && fiEnterDown) {
            fiEnterDown = false;
            fiSync();
            $("#btn_ok_run").click();
        }
    });
    $("#fi-modal form").on("submit", function (e) {
        e.preventDefault();
    });
    $("#fi_close_x").on("click", function () {
        $("#btn_cmd_quit").click();
    });
});
