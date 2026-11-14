#!/usr/bin/env node
// Regenerates demo/regdemo.sbp and demo/regdemo.svg from the one geometry
// source in js/regcore.js. The PDF is printed from the SVG:
//   chromium --headless --no-pdf-header-footer --print-to-pdf=demo/regdemo.pdf demo/regdemo.html
var fs = require("fs");
var path = require("path");
var core = require("../js/regcore.js");
var out = path.join(__dirname, "..", "demo");
var d = core.demoDesign();
fs.writeFileSync(path.join(out, "regdemo.sbp"), core.demoSBP(d));
fs.writeFileSync(path.join(out, "regdemo.svg"), core.demoSVG(d));
fs.writeFileSync(
    path.join(out, "regdemo.html"),
    "<!doctype html><meta charset=utf-8><title>Print Registration demo sheet</title>" +
        "<style>@page{size:" + d.sheet.w + "in " + d.sheet.h + "in;margin:0}html,body{margin:0}svg{display:block}</style>\n" +
        core.demoSVG(d) + "\n"
);
console.log("wrote regdemo.sbp, regdemo.svg, regdemo.html in " + out);
