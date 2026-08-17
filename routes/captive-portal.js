/*
 * Captive Portal Detection Handler
 * 
 * Modern mobile devices (Android 10+, iOS 13+) check for internet connectivity
 * by requesting specific URLs when connecting to a network. When using direct
 * ethernet connection (192.168.44.1), these checks fail and devices show
 * "No Internet" warnings or refuse to use the connection.
 * 
 * This route handler intercepts these connectivity check requests and returns
 * appropriate responses to convince mobile devices the network is usable.
 * 
 * The DNS configuration (dnsmasq direct-mode.conf) redirects captive portal
 * check domains to 192.168.44.1, and this handler provides the expected responses.
 */

var log = require("../log").logger("captive-portal");

module.exports = function (server) {
    log.info("========================================");
    log.info("LOADING CAPTIVE PORTAL ROUTES");
    log.info("========================================");

    // CRITICAL: Use middleware to intercept captive portal checks BEFORE routing
    // The issue is that requests come in with Host headers like "connectivitycheck.gstatic.com"
    // and Restify includes that in the path as "/connectivitycheck.gstatic.com/generate_204"
    server.use(function captivePortalMiddleware(req, res, next) {
        var path = req.path();
        var host = (req.headers.host || "").toLowerCase();
        var method = req.method;
        
        // List of captive portal check domains
        var captiveDomains = [
            "connectivitycheck.gstatic.com",
            "clients3.google.com",
            "play.googleapis.com",
            "android.clients.google.com",
            "www.google.com",
            "google.com",
            "captive.apple.com",
            "www.apple.com",
            "www.msftconnecttest.com",
            "connectivity.samsung.com",
            "connectivitycheck.samsung.com",
        ];
        
        // Check if this is a captive portal check request based on Host header
        var isCaptiveCheck = captiveDomains.some(function(domain) {
            return host.includes(domain);
        });
        
        // Extract the actual endpoint from the path
        // Path might be "/generate_204" or "/connectivitycheck.gstatic.com/generate_204"
        // We need to get just the last part after any domain component
        var endpoint = path;
        if (path.indexOf("/") !== -1) {
            var pathParts = path.split("/").filter(function(p) { return p.length > 0; });
            // If path has domain, endpoint is the last part, otherwise it's the whole path
            if (pathParts.length > 1 && pathParts[0].includes(".")) {
                endpoint = "/" + pathParts[pathParts.length - 1];
            } else if (pathParts.length > 0) {
                endpoint = "/" + pathParts.join("/");
            }
        }
        
        //log.debug("Path parsing: original=" + path + " endpoint=" + endpoint + " host=" + host);
        
        // Check if this is a captive portal endpoint
        var captiveEndpoints = [
            "/generate_204",
            "/gen_204", 
            "/ncsi.txt",
            "/library/test/success.html",
            "/hotspot-detect.html",
            "/connecttest.txt"
        ];
        
        var isCaptiveEndpoint = captiveEndpoints.indexOf(endpoint) !== -1;
        
        // Handle captive portal requests (either captive domain OR captive endpoint)
        if (isCaptiveCheck || isCaptiveEndpoint) {
            log.info("!!! CAPTIVE PORTAL INTERCEPTED: " + method + " " + endpoint + " (full path: " + path + ") Host: " + host);
            
            // Return HTTP 204 for standard checks
            if (endpoint === "/generate_204" || endpoint === "/gen_204" || endpoint === "/ncsi.txt") {
                // Android expects very specific HTTP 204 response with proper headers
                res.writeHead(204, {
                    "Content-Length": "0",
                    "Connection": "close",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                });
                res.end();
                return next(false); // Stop processing, don't continue to other routes
            }
            
            // iOS specific paths
            if (endpoint === "/library/test/success.html" || endpoint === "/hotspot-detect.html") {
                res.writeHead(200, {
                    "Content-Type": "text/html",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                });
                res.write("<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
                res.end();
                return next(false);
            }
            
            // Windows check
            if (endpoint === "/connecttest.txt") {
                res.writeHead(200, {
                    "Content-Type": "text/plain",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                });
                res.write("Microsoft Connect Test");
                res.end();
                return next(false);
            }
        }
        
        // Not a captive portal check, continue normal routing
        return next();
    });



    log.info("Captive portal detection routes loaded");
};
