/*
 * Remote Support app.
 *
 * One button gets a code to read to the technician; once they are connected
 * a second button can grant them full system access. Sessions last two hours
 * unless ended sooner.
 *
 * Talks to the engine's routes/support.js. The engine says when something
 * changes ("change" event, topic "support"); this page does not poll.
 */
(function () {
    "use strict";

    var MINUTES = 120;
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

    function clock(seconds) {
        return new Date(seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    function sentence(text) {
        text = String(text || "");
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function say(text) {
        $("msg").textContent = text ? sentence(text) : "";
    }

    // "ABC123" -> "ABC 123": easier to read aloud
    function spaced(code) {
        return String(code || "").replace(/^(.{3})(.+)$/, "$1 $2");
    }

    function show(id) {
        ["btn-request", "waiting", "open"].forEach(function (k) {
            $(k).hidden = k !== id;
        });
    }

    function render() {
        if (!session) {
            return;
        }
        var p = session.pending;
        if (session.active) {
            var who = session.techs && session.techs.length ? session.techs.join(", ") : "";
            $("open-text").textContent = session.viaTunnel
                ? "You are connected · closes " + clock(session.expires)
                : (who ? who + " connected" : "Open, nobody connected yet") + " · closes " + clock(session.expires);
            // granting is the customer's to do; the technician never sees the button
            $("btn-elevate").hidden = session.level === "system" || session.viaTunnel;
            $("elevated").hidden = session.level !== "system";
            show("open");
        } else if (p && p.state !== "failed" && !session.viaTunnel) {
            $("wait-code").textContent = spaced(p.code);
            $("wait-code").hidden = p.state !== "waiting";
            $("btn-cancel").hidden = p.state !== "waiting";
            $("wait-text").textContent =
                p.state === "waiting"
                    ? "Read this code to your technician"
                    : (p.tech || "Your technician") + " is connecting…";
            show("waiting");
        } else {
            if (p && p.state === "failed") {
                say(p.error);
            }
            $("btn-request").disabled = !!session.viaTunnel;
            show("btn-request");
        }
    }

    function refresh() {
        return api("GET", "/support/status")
            .then(function (s) {
                session = s;
                render();
            })
            .catch(function (err) {
                say(err.message);
                show("btn-request");
            });
    }

    // Run one action with its button disabled; show what went wrong, if anything.
    function act(button, call) {
        say("");
        button.disabled = true;
        return call()
            .then(refresh)
            .catch(function (err) {
                say(err.message);
            })
            .then(function () {
                button.disabled = false;
            });
    }

    $("btn-request").addEventListener("click", function () {
        act($("btn-request"), function () {
            // clear a failed attempt first; harmless when there is none
            return api("POST", "/support/cancel")
                .catch(function () {})
                .then(function () {
                    return api("POST", "/support/request", { level: "dashboard", minutes: MINUTES });
                });
        });
    });

    $("btn-cancel").addEventListener("click", function () {
        act($("btn-cancel"), function () {
            return api("POST", "/support/cancel");
        });
    });

    $("btn-elevate").addEventListener("click", function () {
        act($("btn-elevate"), function () {
            return api("POST", "/support/elevate");
        });
    });

    $("btn-stop").addEventListener("click", function () {
        var viaTunnel = session && session.viaTunnel;
        act($("btn-stop"), function () {
            return api("POST", "/support/stop").catch(function (err) {
                // Ended from the technician's side: the connection the answer
                // would have come back on is the thing that just closed.
                if (!viaTunnel) {
                    throw err;
                }
            });
        });
    });

    if (fabmo && fabmo.on) {
        fabmo.on("change", function (topic) {
            if (topic === "support") {
                say("");
                refresh();
            }
        });
    }
    refresh();
})();
