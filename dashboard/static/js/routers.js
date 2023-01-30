/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
/*
 * routers.js defines the application routers which map URLs to application functions.
 */
define(function (require) {
    var $ = require("jquery");
    var Backbone = require("backbone");
    var auth = require("./auth.js");
    var FabMoAPI = require("./libs/fabmoapi.js");
    var engine = new FabMoAPI();
    var defaultApp = "";

    // Make defaultApp choice available here and elsewhere
    engine.getConfig(function (err, data) {
        defaultApp = data.machine.default_app;
        localStorage.setItem("defaultapp", newDefault);
    });

    var Router = Backbone.Router.extend({
        routes: {
            "app/:id": "_launchApp",
            menu: "show_menu",
            "": "show_menu",
            "authentication(?message=:message)": "show_auth",
        },
        launchApp: function (id, args, callback) {
            callback = callback || function () {};

            // Manage highlight on left-side menus: full, colapsed, & slide-out
            $(".left-off-canvas-menu a").css("background-color", ""); // restore style sheet settings non-highlight
            $(".left-off-canvas-menu a").parent().css("background-color", "");
            let activeNow = "";
            switch (id) {
                case "job-manager":
                    activeNow = "#icon_jobs";
                    break;
                case "editor":
                    activeNow = "#icon_editor";
                    break;
                case "config":
                    activeNow = "#icon_settings";
                    break;
                case "macros":
                    activeNow = "#icon_folder";
                    break;
                case "video":
                    activeNow = "#icon_video";
                    break;
                case "home":
                    if (defaultApp != "home") {
                        activeNow = "#icon_apps";
                    } else {
                        activeNow = "#icon_home";
                    }
                    break;
                case defaultApp:
                    activeNow = "#icon_home";
                    break;
            }
            if (activeNow != "") {
                let st = $("#left-menu").css("height");
                let stnum = parseInt(st.replace(/^\D+/g, ""), 10);
                if (stnum <= 500) {
                    // slide-out used
                    activeNow = "#util-menu-wide " + activeNow;
                    $(activeNow).parent().css("background-color", "#777");
                    $(activeNow).css("background-color", "#777");
                } else {
                    activeNow = "#util-menu-small " + activeNow;
                    $(activeNow).css("background-color", "#777");
                }
            }
            this.context.launchApp(
                id,
                args || {},
                function (err, data) {
                    if (err) {
                        return callback(err);
                    }
                    this.navigate("app/" + id);
                }.bind(this)
            );
        },
        _launchApp: function (id) {
            this.launchApp(id);
        },
        show_menu: function () {
            this.launchApp(defaultApp);
        },
        show_auth: function (message) {
            if (message) {
                message.toString();
                var par = message.replace(/-/g, " ");
                $("#add_err").html(
                    '<div class="error"> <i class="fa fa-exclamation-circle" aria-hidden="true"></i><span> ' +
                        par +
                        "</span></div>"
                );
                $("#add_err").removeAttr("style");
            }

            $.ajax({
                url: "authentication/logout",
                success: function (result) {},
            });
            $("#mainContent").show();
            auth();
        },
        loadView: function (view) {
            this.view && this.view.remove();
            this.view = view;
        },
        setContext: function (context) {
            this.context = context;
        },
        /*
			initialize: function(options) {
				$('a[href^="#"]').on('click', function(e) { this.navigate('/'); }.bind(this));
			}*/
    });

    return Router;
});
