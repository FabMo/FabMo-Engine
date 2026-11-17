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
        ["loading", "closed", "waiting", "open", "remote-closed"].forEach(function (k) {
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
        } else if (session.pending && !session.viaTunnel) {
            renderPending(session.pending);
            show("waiting");
        } else {
            show(session.viaTunnel ? "remote-closed" : "closed");
        }
    }

    // "ABC123" -> "ABC 123": easier to read aloud
    function spaced(code) {
        return String(code || "").replace(/^(.{3})(.+)$/, "$1 $2");
    }

    function renderPending(p) {
        $("wait-code").textContent = spaced(p.code);
        $("wait-code").hidden = p.state !== "waiting";
        $("btn-cancel").disabled = p.state === "connecting";
        $("cancel-msg").textContent = "";
        if (p.state === "waiting") {
            $("wait-title").textContent = "Read this code to your technician";
            $("wait-text").textContent =
                "The code works until " +
                clock(p.expires * 1000) +
                ". Nothing is connected yet: the machine joins only when your technician enters the code.";
            $("btn-cancel").textContent = "Cancel";
        } else if (p.state === "connecting") {
            $("wait-title").textContent = (p.tech || "Your technician") + " is connecting…";
            $("wait-text").textContent =
                "The first time, the machine downloads the support software, which can take a minute.";
        } else {
            $("wait-title").textContent = "The connection was not made";
            $("wait-text").textContent = p.error || "Something went wrong.";
            $("btn-cancel").textContent = "Start again";
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

    function chosen() {
        return {
            level: document.querySelector('input[name="level"]:checked').value,
            minutes: parseInt($("minutes").value, 10),
        };
    }

    $("btn-request").addEventListener("click", function () {
        var msg = $("request-msg");
        msg.className = "rs-msg";
        msg.textContent = "Asking for a code…";
        $("btn-request").disabled = true;
        api("POST", "/support/request", chosen())
            .then(function () {
                msg.textContent = "";
                refresh();
            })
            .catch(function (err) {
                msg.className = "rs-msg err";
                msg.textContent = err.message;
            })
            .then(function () {
                $("btn-request").disabled = false;
            });
    });

    $("btn-cancel").addEventListener("click", function () {
        $("btn-cancel").disabled = true;
        api("POST", "/support/cancel")
            .then(refresh)
            .catch(function (err) {
                $("cancel-msg").className = "rs-msg err";
                $("cancel-msg").textContent = err.message;
            })
            .then(function () {
                $("btn-cancel").disabled = false;
            });
    });

    $("btn-start").addEventListener("click", function () {
        var key = $("key").value.trim();
        var msg = $("start-msg");
        msg.className = "rs-msg";
        if (!key) {
            msg.className = "rs-msg err";
            msg.textContent = "Paste in the support key your technician gave you.";
            return;
        }
        var choice = chosen();
        $("btn-start").disabled = true;
        msg.textContent = "Connecting… this can take up to a minute.";
        api("POST", "/support/start", { key: key, level: choice.level, minutes: choice.minutes })
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
