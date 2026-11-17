/*
 * support_banner.js
 *
 * A marker, visible on every page of the dashboard, that a remote-support
 * session is open - so nobody at the machine is unaware that someone outside
 * the shop can reach it. Opening and closing sessions is the Remote Support
 * app's job (dashboard/apps/support.fma); this only shows the state and
 * offers the way out.
 *
 * It asks the engine once on load and again whenever the engine says the
 * session changed ("change" event, topic "support"). It does not poll.
 */
var el = null;

function build(dashboard) {
    var style = document.createElement("style");
    style.textContent =
        "#support-banner{position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:39000;" +
        "display:none;align-items:center;gap:10px;max-width:92vw;padding:5px 8px 5px 12px;" +
        "background:#c77700;color:#fff;border-radius:16px;box-shadow:0 1px 6px rgba(0,0,0,.35);" +
        "font:600 13px/1.2 'Helvetica Neue',Helvetica,Arial,sans-serif;white-space:nowrap}" +
        "#support-banner .sb-text{cursor:pointer;overflow:hidden;text-overflow:ellipsis}" +
        "#support-banner .sb-dot{width:9px;height:9px;border-radius:50%;background:#fff;flex:none}" +
        "#support-banner button{font:inherit;color:#c77700;background:#fff;border:0;border-radius:11px;" +
        "padding:3px 10px;margin:0;cursor:pointer;flex:none;height:auto;line-height:1.2}";
    document.head.appendChild(style);

    el = document.createElement("div");
    el.id = "support-banner";
    var dot = document.createElement("span");
    dot.className = "sb-dot";
    var text = document.createElement("span");
    text.className = "sb-text";
    text.title = "Open Remote Support";
    text.addEventListener("click", function () {
        dashboard.launchApp("support");
    });
    var end = document.createElement("button");
    end.type = "button";
    end.textContent = "End";
    end.title = "Close the support connection now";
    end.addEventListener("click", function () {
        end.disabled = true;
        fetch("/support/stop", { method: "POST", credentials: "same-origin" })
            .catch(function () {
                /* ended from the far side: the connection itself just went away */
            })
            .then(function () {
                end.disabled = false;
                refresh();
            });
    });
    el.appendChild(dot);
    el.appendChild(text);
    el.appendChild(end);
    document.body.appendChild(el);
}

function refresh() {
    if (!el) {
        return;
    }
    fetch("/support/status", { credentials: "same-origin" })
        .then(function (r) {
            return r.json();
        })
        .then(function (j) {
            var s = j && j.status === "success" ? j.data : null;
            if (!s || !s.active) {
                el.style.display = "none";
                return;
            }
            var until = new Date(s.expires * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
            var who = s.techs && s.techs.length ? s.techs.join(", ") + " connected" : "nobody connected yet";
            el.querySelector(".sb-text").textContent = s.viaTunnel
                ? "You are on a remote support session · closes " + until
                : "Remote support is open: " + who + " · closes " + until;
            el.style.display = "flex";
        })
        .catch(function () {
            el.style.display = "none";
        });
}

exports.init = function (dashboard) {
    build(dashboard);
    dashboard.engine.on("change", function (topic) {
        if (topic === "support") {
            refresh();
        }
    });
    dashboard.engine.on("connect", refresh);
    refresh();
};
