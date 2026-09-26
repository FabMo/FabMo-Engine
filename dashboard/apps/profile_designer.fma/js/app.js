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
        selectedApps: {}, // id -> true (installed apps to add)
        profiles: [], // saved profiles [{dir, name, ...}]
        sourceProfile: null, // dirname of the profile being edited
        keptApps: {}, // archive filename -> true (bundled apps to retain)
        sourceHasMacros: false,
        macrosMode: "none", // none | machine | keep
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

    // Must match the server's slugify (routes/profile_designer.js)
    function slugifyName(name) {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
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

    function deletePath(obj, pathArr) {
        var cur = obj;
        for (var i = 0; i < pathArr.length - 1; i++) {
            if (!isObject(cur[pathArr[i]])) return;
            cur = cur[pathArr[i]];
        }
        delete cur[pathArr[pathArr.length - 1]];
    }

    // Apply a saved profile's (possibly nested) config diff onto the
    // working copy. Objects merge recursively; leaves and arrays replace.
    function mergeInto(target, diff) {
        Object.keys(diff).forEach(function (key) {
            if (isObject(diff[key]) && isObject(target[key])) {
                mergeInto(target[key], diff[key]);
            } else {
                target[key] = clone(diff[key]);
            }
        });
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
        var nApps =
            Object.keys(state.selectedApps).filter(function (k) {
                return state.selectedApps[k];
            }).length +
            Object.keys(state.keptApps).filter(function (k) {
                return state.keptApps[k];
            }).length;
        if (nApps > 0 || state.macrosMode !== "none") {
            var ab = document.createElement("span");
            ab.className = "pd-badge";
            ab.textContent = nApps + (state.macrosMode !== "none" ? "+M" : "");
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
        // Profile-only keys have no default — type the input from the
        // current value instead.
        var typeVal = defVal === undefined ? val : defVal;
        var input;
        if (typeof typeVal === "boolean") {
            input = document.createElement("input");
            input.type = "checkbox";
            input.checked = !!val;
            input.addEventListener("change", function () {
                setPath(state.edits[file], pathArr, input.checked);
                onEdit();
            });
        } else if (typeof typeVal === "number") {
            input = document.createElement("input");
            input.type = "number";
            input.step = "any";
            input.value = val;
            input.addEventListener("change", function () {
                var n = parseFloat(input.value);
                setPath(state.edits[file], pathArr, isNaN(n) ? (defVal === undefined ? val : defVal) : n);
                onEdit();
            });
        } else if (Array.isArray(typeVal)) {
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

    // "+ add" affordance at the bottom of a group: create a key that
    // does not exist in the defaults (e.g. a persistent variable like
    // "Bit.Diameter[].uu"). The name is a LITERAL key — opensbp
    // variables are stored flat with dots/brackets in the key itself —
    // and the value is parsed as JSON when possible ({"X":3} makes an
    // object), otherwise kept as a string.
    function addRow(container, file, pathArr, depth) {
        var row = document.createElement("div");
        row.className = "pd-row pd-add-row";
        row.style.paddingLeft = 8 + depth * 16 + "px";

        var nameIn = document.createElement("input");
        nameIn.type = "text";
        nameIn.className = "pd-add-name";
        nameIn.placeholder = "+ new key";
        var valIn = document.createElement("input");
        valIn.type = "text";
        valIn.className = "pd-add-value";
        valIn.placeholder = "value or JSON";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pd-add-btn";
        btn.textContent = "Add";

        function commit() {
            var key = nameIn.value.trim();
            if (!key) return;
            var parent = getPath(state.edits[file], pathArr) || {};
            if (Object.prototype.hasOwnProperty.call(parent, key)) {
                setStatus('"' + key + '" already exists here — edit it in place instead.', "error");
                return;
            }
            var raw = valIn.value.trim();
            var value;
            try {
                value = JSON.parse(raw);
            } catch (e) {
                value = raw;
            }
            setPath(state.edits[file], pathArr.concat([key]), value);
            setStatus("");
            onEdit();
        }
        btn.addEventListener("click", commit);
        valIn.addEventListener("keydown", function (e) {
            if (e.key === "Enter") commit();
        });

        row.appendChild(nameIn);
        row.appendChild(valIn);
        row.appendChild(btn);
        container.appendChild(row);
    }

    function renderRows(container, file, defObj, pathArr, depth) {
        // Union of default keys and working-copy keys: a profile being
        // edited may carry keys the defaults don't have (legacy
        // profiles are often full configs, not diffs) — those must
        // stay visible and editable.
        var editObj = getPath(state.edits[file], pathArr) || {};
        var keys = Object.keys(defObj);
        Object.keys(editObj).forEach(function (k) {
            if (keys.indexOf(k) === -1) keys.push(k);
        });
        keys.forEach(function (key) {
            var childPath = pathArr.concat([key]);
            var defVal = defObj[key];
            var pathStr = childPath.join(".");
            if (defVal === undefined && isObject(editObj[key])) {
                // Profile-only subtree: render as a group against an
                // empty default so its children show as changed
                defVal = {};
            }
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
                if (!state.filter) addRow(body, file, childPath, depth + 1);
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
                var profileOnly = defVal === undefined;
                var reset = document.createElement("button");
                reset.type = "button";
                reset.className = "pd-reset";
                reset.textContent = profileOnly ? "✕" : "↺";
                reset.title = profileOnly
                    ? "Remove from profile (no default exists for this key)"
                    : "Reset to default (" + JSON.stringify(defVal) + ")";
                reset.addEventListener("click", function () {
                    if (profileOnly) deletePath(state.edits[file], childPath);
                    else setPath(state.edits[file], childPath, clone(defVal));
                    onEdit();
                });
                row.appendChild(reset);
            }
            container.appendChild(row);
        });
    }

    function checkboxRow(labelText, checked, onchange) {
        var row = document.createElement("label");
        row.className = "pd-row pd-app-row" + (checked ? " changed" : "");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = checked;
        cb.addEventListener("change", function () {
            onchange(cb.checked);
            onEdit();
        });
        row.appendChild(cb);
        var span = document.createElement("span");
        span.textContent = labelText;
        row.appendChild(span);
        return row;
    }

    function renderAppsTab(container) {
        var wrap = document.createElement("div");
        wrap.className = "pd-apps";

        // Archives already bundled in the profile being edited — these
        // may not be installed on this machine, so they are kept as-is
        // unless unchecked.
        var keptNames = Object.keys(state.keptApps);
        if (keptNames.length > 0) {
            var khead = document.createElement("div");
            khead.className = "pd-group";
            khead.textContent = "Apps bundled in this profile (kept as-is)";
            wrap.appendChild(khead);
            keptNames.forEach(function (f) {
                wrap.appendChild(
                    checkboxRow(f, !!state.keptApps[f], function (on) {
                        state.keptApps[f] = on;
                    })
                );
            });
        }

        var head = document.createElement("div");
        head.className = "pd-group";
        head.textContent = keptNames.length > 0 ? "Add apps installed on this machine" : "Apps to include in this profile";
        wrap.appendChild(head);

        var userApps = state.apps.filter(function (a) {
            return !a.system;
        });
        var systemApps = state.apps.filter(function (a) {
            return a.system;
        });

        if (userApps.length === 0) {
            var none = document.createElement("div");
            none.className = "pd-empty";
            none.textContent = "No user-installed apps on this machine.";
            wrap.appendChild(none);
        }
        userApps.forEach(function (app) {
            wrap.appendChild(
                checkboxRow(app.name, !!state.selectedApps[app.id], function (on) {
                    state.selectedApps[app.id] = on;
                })
            );
        });

        if (systemApps.length > 0) {
            var shead = document.createElement("div");
            shead.className = "pd-group";
            shead.textContent = "System apps (ship with the engine — bundle one only to pin a copy into the profile)";
            wrap.appendChild(shead);
            systemApps.forEach(function (app) {
                wrap.appendChild(
                    checkboxRow(app.name, !!state.selectedApps[app.id], function (on) {
                        state.selectedApps[app.id] = on;
                    })
                );
            });
        }

        var mhead = document.createElement("div");
        mhead.className = "pd-group";
        mhead.textContent = "Macros";
        wrap.appendChild(mhead);

        var options = [
            { value: "none", label: "No macros in this profile" },
            { value: "machine", label: "Capture this machine's current macros" },
        ];
        if (state.sourceHasMacros) {
            options.splice(1, 0, { value: "keep", label: "Keep the profile's existing macros" });
        }
        options.forEach(function (opt) {
            var row = document.createElement("label");
            row.className = "pd-row pd-app-row" + (state.macrosMode === opt.value && opt.value !== "none" ? " changed" : "");
            var rb = document.createElement("input");
            rb.type = "radio";
            rb.name = "pd-macros";
            rb.checked = state.macrosMode === opt.value;
            rb.addEventListener("change", function () {
                if (rb.checked) {
                    state.macrosMode = opt.value;
                    onEdit();
                }
            });
            row.appendChild(rb);
            var span = document.createElement("span");
            span.textContent = opt.label;
            row.appendChild(span);
            wrap.appendChild(row);
        });

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
        if (!state.filter) addRow(editor, file, [], 0);
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
        var appNames = Object.keys(state.keptApps)
            .filter(function (f) {
                return state.keptApps[f];
            })
            .concat(
                state.apps
                    .filter(function (a) {
                        return state.selectedApps[a.id];
                    })
                    .map(function (a) {
                        return a.name;
                    })
            );
        if (appNames.length > 0) out["apps/"] = appNames;
        if (state.macrosMode === "machine") out["macros/"] = "(copied from this machine)";
        if (state.macrosMode === "keep") out["macros/"] = "(kept from " + state.sourceProfile + ")";
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
        var name = $("#pd-name").value.trim();
        // Re-saving the profile currently being edited is the expected
        // flow — no need to ask about overwriting it.
        var editingSelf =
            state.sourceProfile && "fabmo-profile-" + slugifyName(name) === state.sourceProfile;
        var payload = {
            name: name,
            description: $("#pd-desc").value.trim(),
            version: $("#pd-version").value.trim() || "v0.0.1",
            configs: {},
            apps: Object.keys(state.selectedApps).filter(function (id) {
                return state.selectedApps[id];
            }),
            source_profile: state.sourceProfile,
            keep_apps: Object.keys(state.keptApps).filter(function (f) {
                return state.keptApps[f];
            }),
            macros_mode: state.macrosMode,
            overwrite: !!overwrite || editingSelf,
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
                    // The editor is now editing what was just written:
                    // newly-added installed apps became bundled
                    // archives, and captured macros belong to the
                    // profile itself.
                    state.sourceProfile = resp.data.profile;
                    state.apps.forEach(function (a) {
                        if (state.selectedApps[a.id]) {
                            state.keptApps[(slugifyName(a.name) || a.id) + ".fma"] = true;
                        }
                    });
                    state.selectedApps = {};
                    if (state.macrosMode !== "none") {
                        state.sourceHasMacros = true;
                        state.macrosMode = "keep";
                    }
                    refreshProfileList(resp.data.profile).then(renderAll);
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

    // Reset the working state to pristine defaults (a "new profile")
    function startFresh() {
        state.edits = clone(state.defaults);
        state.sourceProfile = null;
        state.keptApps = {};
        state.selectedApps = {};
        state.sourceHasMacros = false;
        state.macrosMode = "none";
        $("#pd-name").value = "";
        $("#pd-desc").value = "";
        $("#pd-version").value = "v0.0.1";
        state.tab = state.files[0];
        setStatus("");
        renderAll();
    }

    // Load a saved profile for editing: its diffs are merged onto the
    // defaults so the editor shows the effective values, and the diff
    // pane reproduces (a cleaned-up version of) the profile itself.
    function loadProfile(dir) {
        setStatus("Loading " + dir + "...");
        fetch("/profile_designer/profile/" + encodeURIComponent(dir))
            .then(function (r) {
                return r.json();
            })
            .then(function (resp) {
                if (resp.status !== "success") {
                    setStatus(resp.message || "Could not load profile", "error");
                    return;
                }
                var p = resp.data;
                state.edits = clone(state.defaults);
                Object.keys(p.configs || {}).forEach(function (file) {
                    if (state.edits[file]) mergeInto(state.edits[file], p.configs[file]);
                    else state.edits[file] = clone(p.configs[file]);
                });
                state.sourceProfile = p.dir;
                state.keptApps = {};
                (p.apps || []).forEach(function (f) {
                    state.keptApps[f] = true;
                });
                state.selectedApps = {};
                state.sourceHasMacros = !!p.has_macros;
                state.macrosMode = p.has_macros ? "keep" : "none";
                $("#pd-name").value = p.package.name || "";
                $("#pd-desc").value = p.package.description || "";
                $("#pd-version").value = p.package.version || "v0.0.1";
                state.tab = state.files[0];
                setStatus("Editing " + (p.package.name || p.dir) + " — saving under the same name updates it in place.");
                renderAll();
            })
            .catch(function (e) {
                setStatus("Could not load profile: " + e.message, "error");
            });
    }

    function refreshProfileList(selected) {
        return fetch("/profile_designer/profiles")
            .then(function (r) {
                return r.json();
            })
            .then(function (resp) {
                state.profiles = (resp.data && resp.data.profiles) || [];
                var sel = $("#pd-source");
                sel.innerHTML = "";
                var fresh = document.createElement("option");
                fresh.value = "";
                fresh.textContent = "New profile (from defaults)";
                sel.appendChild(fresh);
                state.profiles.forEach(function (p) {
                    var o = document.createElement("option");
                    o.value = p.dir;
                    o.textContent = "Edit: " + p.name + (p.version ? " (" + p.version + ")" : "");
                    sel.appendChild(o);
                });
                sel.value = selected || "";
            });
    }

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
        $("#pd-source").addEventListener("change", function () {
            var dir = $("#pd-source").value;
            if (dir) loadProfile(dir);
            else startFresh();
        });

        Promise.all([
            fetch("/profile_designer/defaults").then(function (r) {
                return r.json();
            }),
            fetch("/profile_designer/apps").then(function (r) {
                return r.json();
            }),
            refreshProfileList(),
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
