/*
 * remote_support.js
 *
 * The remote-support controls in the Software section of the General tab.
 * One button gets a code to read to a ShopBot technician; once they are
 * connected a second button can grant them full system access. Sessions
 * last two hours unless ended sooner.
 *
 * Talks to the engine's routes/support.js. The engine says when something
 * changes ("change" event, topic "support"); this does not poll.
 */
var MINUTES = 120;

module.exports = function (fabmo) {
    var session = null;

    // translated text, falling back to English if the dictionary lacks the key
    function tr(key, english) {
        var full = "config.software." + key;
        var text = typeof window.t === "function" ? window.t(full) : "";
        return text && text !== full ? text : english;
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

    function say(text) {
        text = String(text || "");
        $("#support-msg").text(text.charAt(0).toUpperCase() + text.slice(1));
    }

    // "ABC123" -> "ABC 123": easier to read aloud
    function spaced(code) {
        return String(code || "").replace(/^(.{3})(.+)$/, "$1 $2");
    }

    function show(id) {
        ["btn-support-request", "support-waiting", "support-open"].forEach(function (k) {
            $("#" + k).toggle(k === id);
        });
    }

    function render() {
        if (!session) {
            return;
        }
        var p = session.pending;
        if (session.active) {
            var closes = " · " + tr("support_closes", "closes") + " " + clock(session.expires);
            var who = session.techs && session.techs.length ? session.techs.join(", ") : "";
            $("#support-open-text").text(
                session.viaTunnel
                    ? tr("support_you_connected", "You are connected") + closes
                    : (who
                          ? who + " " + tr("support_connected", "connected")
                          : tr("support_nobody", "Open, nobody connected yet")) + closes,
            );
            // granting is the customer's to do; the technician never sees the button
            $("#btn-support-elevate").toggle(session.level !== "system" && !session.viaTunnel);
            $("#support-elevated").toggle(session.level === "system");
            show("support-open");
        } else if (p && p.state !== "failed" && !session.viaTunnel) {
            $("#support-code")
                .text(spaced(p.code))
                .toggle(p.state === "waiting");
            $("#btn-support-cancel").toggle(p.state === "waiting");
            $("#support-wait-text").text(
                p.state === "waiting"
                    ? tr("support_read_code", "Read this code to your technician")
                    : (p.tech || tr("support_your_tech", "Your technician")) +
                          " " +
                          tr("support_is_connecting", "is connecting…"),
            );
            show("support-waiting");
        } else {
            if (p && p.state === "failed") {
                say(p.error);
            }
            // a session can only be opened by someone at the machine
            $("#btn-support-request").toggleClass("disabled", !!session.viaTunnel);
            show("btn-support-request");
        }
    }

    function refresh() {
        return api("GET", "/support/status")
            .then(function (s) {
                session = s;
                render();
            })
            .catch(function () {
                // remote support is not available on this machine (no updater,
                // or an older one): leave the section out rather than show an error
                $("#support-block").hide();
            });
    }

    // Run one action, ignoring repeat clicks while it is in flight
    function act($button, call) {
        if ($button.hasClass("disabled")) {
            return;
        }
        say("");
        $button.addClass("disabled");
        call()
            .then(refresh)
            .catch(function (err) {
                say(err.message);
            })
            .then(function () {
                $button.removeClass("disabled");
            });
    }

    $(function () {
        $("#btn-support-request").click(function (evt) {
            evt.preventDefault();
            act($(this), function () {
                // clear a failed attempt first; harmless when there is none
                return api("POST", "/support/cancel")
                    .catch(function () {})
                    .then(function () {
                        return api("POST", "/support/request", { level: "dashboard", minutes: MINUTES });
                    });
            });
        });

        $("#btn-support-cancel").click(function (evt) {
            evt.preventDefault();
            act($(this), function () {
                return api("POST", "/support/cancel");
            });
        });

        $("#btn-support-elevate").click(function (evt) {
            evt.preventDefault();
            act($(this), function () {
                return api("POST", "/support/elevate");
            });
        });

        $("#btn-support-stop").click(function (evt) {
            evt.preventDefault();
            var viaTunnel = session && session.viaTunnel;
            act($(this), function () {
                return api("POST", "/support/stop").catch(function (err) {
                    // Ended from the technician's side: the connection the
                    // answer would have come back on is what just closed.
                    if (!viaTunnel) {
                        throw err;
                    }
                });
            });
        });

        fabmo.on("change", function (topic) {
            if (topic === "support") {
                say("");
                refresh();
            }
        });
        refresh();
    });
};
