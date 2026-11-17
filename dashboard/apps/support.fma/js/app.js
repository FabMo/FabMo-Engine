/*
 * Remote Support app.
 *
 * Opens and closes a remote-support session (engine routes/support.js, which
 * relays to the updater) and shows the audit log of what was done over it.
 * The engine tells us when something changes ("change" event, topic
 * "support"); this page does not poll the server.
 */
(function () {
    "use strict";

    var fabmo = typeof FabMoDashboard !== "undefined" ? new FabMoDashboard() : null;
    var session = null;

    function $(id) {
        return document.getElementById(id);
    }

    function api(method, path, body) {
        var opts = { method: method, credentials: "same-origin", headers: {} };
        if (body) {
            opts.headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }
        return fetch(path, opts)
            .then(function (r) {
                return r.json();
            })
            .then(function (j) {
                if (!j || j.status !== "success") {
                    throw new Error((j && j.message) || "The machine did not answer as expected.");
                }
                return j.data;
            });
    }

    function clock(ms) {
        return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    function stamp(ms) {
        var d = new Date(ms);
        var today = new Date().toDateString() === d.toDateString();
        return (today ? "" : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " ") + clock(ms);
    }

    function show(id) {
        ["loading", "closed", "open", "remote-closed"].forEach(function (k) {
            $(k).hidden = k !== id;
        });
    }

    function render() {
        if (!session) {
            return;
        }
        if (session.active) {
            $("open-level").textContent =
                session.level === "system" ? "Full system access (dashboard and command line)" : "Dashboard";
            $("open-techs").textContent =
                session.techs && session.techs.length ? session.techs.join(", ") : "Nobody has connected yet";
            $("open-until").textContent = clock(session.expires * 1000);
            $("open-title").textContent = session.viaTunnel
                ? "You are connected to this machine through a support session"
                : "A support session is open";
            show("open");
        } else {
            show(session.viaTunnel ? "remote-closed" : "closed");
        }
    }

    function renderLog(rows) {
        var body = $("log").querySelector("tbody");
        body.textContent = "";
        $("log-empty").hidden = rows.length > 0;
        $("log").hidden = rows.length === 0;
        rows.forEach(function (e) {
            var tr = document.createElement("tr");
            if (/^Support session/.test(e.what)) {
                tr.className = "rs-mark";
            }
            [stamp(e.time), e.who || e.from || "", e.what + (e.detail && !/^[A-Z]+ \//.test(e.detail) ? " (" + e.detail + ")" : "")].forEach(
                function (text) {
                    var td = document.createElement("td");
                    td.textContent = text;
                    tr.appendChild(td);
                }
            );
            body.appendChild(tr);
        });
    }

    function refresh() {
        api("GET", "/support/status")
            .then(function (s) {
                session = s;
                render();
            })
            .catch(function (err) {
                $("loading").textContent = "Remote support is not available: " + err.message;
                show("loading");
            });
        api("GET", "/support/log")
            .then(renderLog)
            .catch(function () {
                /* the log is secondary; leave what is shown */
            });
    }

    $("btn-start").addEventListener("click", function () {
        var key = $("key").value.trim();
        var msg = $("start-msg");
        msg.className = "rs-msg";
        if (!key) {
            msg.className = "rs-msg err";
            msg.textContent = "Paste in the support key your technician gave you.";
            return;
        }
        var level = document.querySelector('input[name="level"]:checked').value;
        $("btn-start").disabled = true;
        msg.textContent = "Connecting… this can take up to a minute.";
        api("POST", "/support/start", { key: key, level: level, minutes: parseInt($("minutes").value, 10) })
            .then(function () {
                $("key").value = "";
                msg.textContent = "";
                refresh();
            })
            .catch(function (err) {
                msg.className = "rs-msg err";
                msg.textContent = err.message.charAt(0).toUpperCase() + err.message.slice(1);
            })
            .then(function () {
                $("btn-start").disabled = false;
            });
    });

    $("btn-stop").addEventListener("click", function () {
        var msg = $("stop-msg");
        $("btn-stop").disabled = true;
        msg.className = "rs-msg";
        msg.textContent = "Closing the connection…";
        api("POST", "/support/stop")
            .then(function () {
                msg.textContent = "";
                refresh();
            })
            .catch(function (err) {
                // Ending it from the technician's side cuts the connection
                // this answer would have come back on - that is success.
                if (session && session.viaTunnel) {
                    msg.textContent = "The session has been closed.";
                    return;
                }
                msg.className = "rs-msg err";
                msg.textContent = err.message;
            })
            .then(function () {
                $("btn-stop").disabled = false;
            });
    });

    if (fabmo && fabmo.on) {
        fabmo.on("change", function (topic) {
            if (topic === "support") {
                refresh();
            }
        });
    }
    refresh();
})();
