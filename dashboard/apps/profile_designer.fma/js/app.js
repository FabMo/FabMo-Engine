/*
 * Profile Designer
 *
 * Machine profiles are applied ON TOP of the default profile, so a good
 * profile contains only the settings that differ from the defaults.
 * This app loads the default profile's config files, lets the user edit
 * values, and continuously derives the diff — which is exactly what gets
 * written as the profile's config/*.json files on save, along with a
 * package.json, a selection of installed apps, and (optionally) the
 * machine's current macros.
 */
(function () {
    "use strict";

    var CONFIG_LABELS = {
        machine: "Machine",
        opensbp: "OpenSBP",
        g2: "G2 (motion)",
        engine: "Engine",
        instance: "Instance",
    };
    var APPS_TAB = "__apps__";

    var state = {
        files: [], // config file order from the server
        defaults: {}, // file -> pristine default object
        edits: {}, // file -> working copy (deep clone of default + edits)
        apps: [], // eligible apps [{id, name}]
        selectedApps: {}, // id -> true
        includeMacros: false,
        tab: null,
        filter: "",
    };

    var $ = function (sel) {
        return document.querySelector(sel);
    };

    // ---------- utilities ----------

    function clone(o) {
        return JSON.parse(JSON.stringify(o));
    }

    function isObject(v) {
        return v !== null && typeof v === "object" && !Array.isArray(v);
    }

    function leafEqual(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function getPath(obj, pathArr) {
        var cur = obj;
        for (var i = 0; i < pathArr.length; i++) {
            if (cur === undefined || cur === null) return undefined;
            cur = cur[pathArr[i]];
        }
        return cur;
    }

    function setPath(obj, pathArr, value) {
        var cur = obj;
        for (var i = 0; i < pathArr.length - 1; i++) {
            if (!isObject(cur[pathArr[i]])) cur[pathArr[i]] = {};
            cur = cur[pathArr[i]];
        }
        cur[pathArr[pathArr.length - 1]] = value;
    }

    // The heart of the app: recursively compare the working copy to the
    // default and keep only what changed. Objects recurse; everything
    // else (leaves and arrays) is atomic.
    function diffObject(def, edit) {
        var out = {};
        Object.keys(edit).forEach(function (key) {
            var dv = def ? def[key] : undefined;
            var ev = edit[key];
            if (isObject(ev) && isObject(dv)) {
                var sub = diffObject(dv, ev);
                if (Object.keys(sub).length > 0) out[key] = sub;
            } else if (!leafEqual(dv, ev)) {
                out[key] = ev;
            }
        });
        return out;
    }

    function countLeaves(o) {
        if (!isObject(o)) return 1;
        var n = 0;
        Object.keys(o).forEach(function (k) {
            n += countLeaves(o[k]);
        });
        return n;
    }

    function fileDiff(file) {
        return diffObject(state.defaults[file], state.edits[file]);
    }

    function changeCount(file) {
        return countLeaves(fileDiff(file));
    }

    // ---------- rendering ----------

    function renderTabs() {
        var nav = $("#pd-tabs");
        nav.innerHTML = "";
        state.files.forEach(function (file) {
            var count = changeCount(file);
            var b = document.createElement("button");
            b.type = "button";
            b.className = "pd-tab" + (state.tab === file ? " active" : "");
            b.textContent = CONFIG_LABELS[file] || file;
            if (count > 0) {
                var badge = document.createElement("span");
                badge.className = "pd-badge";
                badge.textContent = count;
                b.appendChild(badge);
            }
            b.addEventListener("click", function () {
                state.tab = file;
                state.filter = "";
                $("#pd-filter").value = "";
                renderAll();
            });
            nav.appendChild(b);
        });
        var apps = document.createElement("button");
        apps.type = "button";
        apps.className = "pd-tab" + (state.tab === APPS_TAB ? " active" : "");
        apps.textContent = "Apps & Macros";
        var nApps = Object.keys(state.selectedApps).filter(function (k) {
            return state.selectedApps[k];
        }).length;
        if (nApps > 0 || state.includeMacros) {
            var ab = document.createElement("span");
            ab.className = "pd-badge";
            ab.textContent = nApps + (state.includeMacros ? "+M" : "");
            apps.appendChild(ab);
        }
        apps.addEventListener("click", function () {
            state.tab = APPS_TAB;
            renderAll();
        });
        nav.appendChild(apps);
    }

    function inputFor(file, pathArr, defVal) {
        var val = getPath(state.edits[file], pathArr);
        var input;
        if (typeof defVal === "boolean") {
            input = document.createElement("input");
            input.type = "checkbox";
            input.checked = !!val;
            input.addEventListener("change", function () {
                setPath(state.edits[file], pathArr, input.checked);
                onEdit();
            });
        } else if (typeof defVal === "number") {
            input = document.createElement("input");
            input.type = "number";
            input.step = "any";
            input.value = val;
            input.addEventListener("change", function () {
                var n = parseFloat(input.value);
                setPath(state.edits[file], pathArr, isNaN(n) ? defVal : n);
                onEdit();
            });
        } else if (Array.isArray(defVal)) {
            input = document.createElement("input");
            input.type = "text";
            input.className = "pd-json";
            input.value = JSON.stringify(val);
            input.title = "Edited as JSON (arrays are all-or-nothing)";
            input.addEventListener("change", function () {
                try {
                    setPath(state.edits[file], pathArr, JSON.parse(input.value));
                    input.classList.remove("bad");
                } catch (e) {
                    input.classList.add("bad");
                    return;
                }
                onEdit();
            });
        } else {
            input = document.createElement("input");
            input.type = "text";
            input.value = val === null || val === undefined ? "" : String(val);
            input.addEventListener("change", function () {
                setPath(state.edits[file], pathArr, input.value);
                onEdit();
            });
        }
        return input;
    }

    function renderRows(container, file, defObj, pathArr, depth) {
        Object.keys(defObj).forEach(function (key) {
            var childPath = pathArr.concat([key]);
            var defVal = defObj[key];
            var pathStr = childPath.join(".");
            if (state.filter && !isObject(defVal) && pathStr.toLowerCase().indexOf(state.filter) === -1) {
                return;
            }
            if (isObject(defVal)) {
                // Group: render header + children; skip the header when
                // filtering finds nothing underneath
                var group = document.createElement("div");
                var head = document.createElement("div");
                head.className = "pd-group";
                head.style.paddingLeft = 8 + depth * 16 + "px";
                head.textContent = key;
                var body = document.createElement("div");
                renderRows(body, file, defVal, childPath, depth + 1);
                if (state.filter && body.children.length === 0) return;
                var collapsed = depth === 0 && !state.filter && Object.keys(defVal).length > 8;
                if (collapsed) body.classList.add("hidden");
                head.addEventListener("click", function () {
                    body.classList.toggle("hidden");
                });
                group.appendChild(head);
                group.appendChild(body);
                container.appendChild(group);
                return;
            }
            var row = document.createElement("div");
            row.className = "pd-row";
            row.style.paddingLeft = 8 + depth * 16 + "px";
            var changed = !leafEqual(defVal, getPath(state.edits[file], childPath));
            if (changed) row.classList.add("changed");

            var label = document.createElement("label");
            label.className = "pd-key";
            label.textContent = key;
            label.title = pathStr;
            row.appendChild(label);

            row.appendChild(inputFor(file, childPath, defVal));

            if (changed) {
                var reset = document.createElement("button");
                reset.type = "button";
                reset.className = "pd-reset";
                reset.textContent = "↺";
                reset.title = "Reset to default (" + JSON.stringify(defVal) + ")";
                reset.addEventListener("click", function () {
                    setPath(state.edits[file], childPath, clone(defVal));
                    onEdit();
                });
                row.appendChild(reset);
            }
            container.appendChild(row);
        });
    }

    function renderAppsTab(container) {
        var wrap = document.createElement("div");
        wrap.className = "pd-apps";

        var head = document.createElement("div");
        head.className = "pd-group";
        head.textContent = "Apps to include in this profile";
        wrap.appendChild(head);

        if (state.apps.length === 0) {
            var none = document.createElement("div");
            none.className = "pd-empty";
            none.textContent = "No user-installed apps on this machine. (System apps ship with the engine and are never packaged into profiles.)";
            wrap.appendChild(none);
        }
        state.apps.forEach(function (app) {
            var row = document.createElement("label");
            row.className = "pd-row pd-app-row" + (state.selectedApps[app.id] ? " changed" : "");
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = !!state.selectedApps[app.id];
            cb.addEventListener("change", function () {
                state.selectedApps[app.id] = cb.checked;
                onEdit();
            });
            row.appendChild(cb);
            var span = document.createElement("span");
            span.textContent = app.name;
            row.appendChild(span);
            wrap.appendChild(row);
        });

        var mhead = document.createElement("div");
        mhead.className = "pd-group";
        mhead.textContent = "Macros";
        wrap.appendChild(mhead);

        var mrow = document.createElement("label");
        mrow.className = "pd-row pd-app-row" + (state.includeMacros ? " changed" : "");
        var mcb = document.createElement("input");
        mcb.type = "checkbox";
        mcb.checked = state.includeMacros;
        mcb.addEventListener("change", function () {
            state.includeMacros = mcb.checked;
            onEdit();
        });
        mrow.appendChild(mcb);
        var mspan = document.createElement("span");
        mspan.textContent = "Include this machine's current macros in the profile";
        mrow.appendChild(mspan);
        wrap.appendChild(mrow);

        container.appendChild(wrap);
    }

    function renderEditor() {
        var editor = $("#pd-editor");
        editor.innerHTML = "";
        if (state.tab === APPS_TAB) {
            $("#pd-filter").style.visibility = "hidden";
            $("#pd-file-changes").textContent = "";
            renderAppsTab(editor);
            return;
        }
        $("#pd-filter").style.visibility = "visible";
        var file = state.tab;
        var n = changeCount(file);
        $("#pd-file-changes").textContent = n === 0 ? "no changes" : n + " change" + (n === 1 ? "" : "s");
        renderRows(editor, file, state.defaults[file], [], 0);
    }

    function renderPreview() {
        var out = {};
        var total = 0;
        state.files.forEach(function (file) {
            var d = fileDiff(file);
            if (Object.keys(d).length > 0) {
                out["config/" + file + ".json"] = d;
                total += countLeaves(d);
            }
        });
        out["package.json"] = {
            name: $("#pd-name").value || "(unnamed)",
            description: $("#pd-desc").value || "",
            version: $("#pd-version").value || "v0.0.1",
        };
        var appNames = state.apps
            .filter(function (a) {
                return state.selectedApps[a.id];
            })
            .map(function (a) {
                return a.name;
            });
        if (appNames.length > 0) out["apps/"] = appNames;
        if (state.includeMacros) out["macros/"] = "(copied from this machine)";
        $("#pd-preview").textContent = JSON.stringify(out, null, 2);
        $("#pd-change-total").textContent = total === 0 ? "" : "(" + total + " settings)";
    }

    function renderAll() {
        renderTabs();
        renderEditor();
        renderPreview();
    }

    function onEdit() {
        renderAll();
    }

    // ---------- status + save ----------

    function setStatus(msg, kind, actions) {
        var el = $("#pd-status");
        el.innerHTML = "";
        el.className = "pd-status" + (kind ? " " + kind : "");
        el.appendChild(document.createTextNode(msg || ""));
        (actions || []).forEach(function (a) {
            var b = document.createElement("button");
            b.type = "button";
            b.textContent = a.label;
            b.addEventListener("click", a.onclick);
            el.appendChild(b);
        });
    }

    function save(overwrite) {
        var payload = {
            name: $("#pd-name").value.trim(),
            description: $("#pd-desc").value.trim(),
            version: $("#pd-version").value.trim() || "v0.0.1",
            configs: {},
            apps: Object.keys(state.selectedApps).filter(function (id) {
                return state.selectedApps[id];
            }),
            include_macros: state.includeMacros,
            overwrite: !!overwrite,
        };
        if (!payload.name) {
            setStatus("Give the profile a name before saving.", "error");
            $("#pd-name").focus();
            return;
        }
        state.files.forEach(function (file) {
            var d = fileDiff(file);
            if (Object.keys(d).length > 0) payload.configs[file] = d;
        });

        setStatus("Saving...");
        fetch("/profile_designer/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        })
            .then(function (r) {
                return r.json();
            })
            .then(function (resp) {
                if (resp.status === "success") {
                    var extra =
                        resp.data.app_errors && resp.data.app_errors.length
                            ? " (some apps could not be copied: " + resp.data.app_errors.join(", ") + ")"
                            : "";
                    setStatus("Saved to " + resp.data.path + extra, "ok");
                } else if (resp.data && resp.data.exists) {
                    setStatus("Profile '" + resp.data.profile + "' already exists.", "error", [
                        {
                            label: "Overwrite",
                            onclick: function () {
                                save(true);
                            },
                        },
                    ]);
                } else {
                    setStatus(resp.message || "Save failed", "error");
                }
            })
            .catch(function (e) {
                setStatus("Save failed: " + e.message, "error");
            });
    }

    // ---------- init ----------

    function init() {
        $("#pd-save").addEventListener("click", function () {
            save(false);
        });
        $("#pd-filter").addEventListener("input", function () {
            state.filter = $("#pd-filter").value.trim().toLowerCase();
            renderEditor();
        });
        ["pd-name", "pd-desc", "pd-version"].forEach(function (id) {
            document.getElementById(id).addEventListener("input", renderPreview);
        });

        Promise.all([
            fetch("/profile_designer/defaults").then(function (r) {
                return r.json();
            }),
            fetch("/profile_designer/apps").then(function (r) {
                return r.json();
            }),
        ])
            .then(function (results) {
                var defs = results[0].data;
                state.files = defs.files;
                state.defaults = defs.configs;
                state.edits = clone(defs.configs);
                state.apps = results[1].data.apps || [];
                state.tab = state.files[0];
                renderAll();
            })
            .catch(function (e) {
                setStatus("Could not load defaults: " + e.message, "error");
            });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
