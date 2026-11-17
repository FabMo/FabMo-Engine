/*
 * support_banner.js
 *
 * A marker, visible on every page of the dashboard, that a remote-support
 * session is open - so nobody at the machine is unaware that someone outside
 * the shop can reach it. Sessions are opened from the configuration app
 * (General tab, Software section); this shows the state, offers the way
 * out, and is where the customer answers when a technician asks to move the
 * machine.
 *
 * It asks the engine once on load and again whenever the engine says the
 * session changed ("change" event, topic "support"). It does not poll.
 */
var el = null;
var parts = {};

function clock(seconds) {
    return new Date(seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function post(path, body) {
    var opts = { method: "POST", credentials: "same-origin", headers: {} };
    if (body) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).catch(function () {
        /* ended from the far side: the connection itself just went away */
    });
}

function button(label, title, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", function () {
        b.disabled = true;
        onClick().then(function () {
            b.disabled = false;
            refresh();
        });
    });
    el.appendChild(b);
    return b;
}

function build(dashboard) {
    var style = document.createElement("style");
    style.textContent =
        "#support-banner{position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:39000;" +
        "display:none;align-items:center;gap:8px;max-width:94vw;padding:5px 8px 5px 12px;" +
        "background:#c77700;color:#fff;border-radius:16px;box-shadow:0 1px 6px rgba(0,0,0,.35);" +
        "font:600 13px/1.2 'Helvetica Neue',Helvetica,Arial,sans-serif;white-space:nowrap}" +
        "#support-banner.sb-ask{background:#b3261e;font-size:15px;padding:9px 10px 9px 16px;border-radius:22px;top:8px}" +
        "#support-banner .sb-text{cursor:pointer;overflow:hidden;text-overflow:ellipsis}" +
        "#support-banner .sb-dot{width:9px;height:9px;border-radius:50%;background:#fff;flex:none}" +
        "#support-banner button{font:inherit;color:#23262b;background:#fff;border:0;border-radius:11px;" +
        "padding:3px 10px;margin:0;cursor:pointer;flex:none;height:auto;line-height:1.2}" +
        "#support-banner.sb-ask button{padding:6px 14px;border-radius:14px}";
    document.head.appendChild(style);

    el = document.createElement("div");
    el.id = "support-banner";
    var dot = document.createElement("span");
    dot.className = "sb-dot";
    parts.text = document.createElement("span");
    parts.text.className = "sb-text";
    parts.text.title = "Open Settings (Remote Support is under Software)";
    parts.text.addEventListener("click", function () {
        dashboard.launchApp("config");
    });
    el.appendChild(dot);
    el.appendChild(parts.text);
    parts.allow = button("Allow for 10 minutes", "Let the technician move the machine", function () {
        return post("/support/motion", { allow: true });
    });
    parts.deny = button("No", "Do not let the technician move the machine", function () {
        return post("/support/motion", { allow: false });
    });
    parts.stopMotion = button("Stop allowing", "The technician may no longer move the machine", function () {
        return post("/support/motion", { allow: false });
    });
    parts.end = button("End", "Close the support connection now", function () {
        return post("/support/stop");
    });
    document.body.appendChild(el);
}

function show(node, on) {
    node.style.display = on ? "" : "none";
}

function render(s) {
    if (!s || !s.active) {
        el.style.display = "none";
        return;
    }
    var m = s.motion || {};
    var closes = " · closes " + clock(s.expires);
    var who = s.techs && s.techs.length ? s.techs.join(", ") : "";
    var asking = !s.viaTunnel && !!m.request;
    var text;
    if (s.viaTunnel) {
        // what the technician sees
        text =
            "You are on a remote support session" +
            closes +
            (m.allowed
                ? " · you may move the machine until " + clock(m.until)
                : m.request
                  ? " · waiting for the customer to allow motion"
                  : "");
    } else if (asking) {
        text = (m.request.who || "The technician") + " wants to move the machine";
    } else if (m.allowed) {
        text = "Remote support: " + (who || "the technician") + " may move the machine until " + clock(m.until);
    } else {
        text = "Remote support is open: " + (who ? who + " connected" : "nobody connected yet") + closes;
    }
    parts.text.textContent = text;
    el.className = asking ? "sb-ask" : "";
    show(parts.allow, asking);
    show(parts.deny, asking);
    show(parts.stopMotion, !s.viaTunnel && m.allowed);
    show(parts.end, !asking);
    el.style.display = "flex";
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
            render(j && j.status === "success" ? j.data : null);
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
