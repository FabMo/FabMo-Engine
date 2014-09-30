/routes
=======

This is where application routes are stored.  Each js module in this folder exports a single function, which accepts the restify server object, and is understood to attach routes to it.  Routers are broken up by function.  They can be disabled individually by moving them out of this folder, or changing their names, and new routes can be added simply by putting new modules in this directory.

`index.js` is responsible for loading all the routes, and all the other javascript files in the directory contain the routes themselves. 