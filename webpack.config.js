var lib = 'dashboard/static/js/libs';
var js = 'dashboard/static/js';
var webpack = require("webpack");
var ProvidePlugin = require('webpack').ProvidePlugin;
var path = require('path');
var ExtractTextPlugin = require('extract-text-webpack-plugin');
var config = {
  entry: {
    dashboard:'./dashboard/static/js/main.js',
    app:'./dashboard/apps/job_manager.fma/js/job_manager.js'
  }, 
  output: {
    path: './dashboard/build',
    publicPath: "../",
   filename: "[name].js"
  },
  resolve: {
  // modulesDirectories: [lib],
   extensions: ['', '.js'],

 },
  module: {
    loaders: [
      { test: /\.css$/, loader: ExtractTextPlugin.extract("style-loader", "css-loader")},
      { test: /\.woff(2)?(\?v=[0-9]\.[0-9]\.[0-9])?$/, loader: "url-loader?limit=10000&minetype=application/font-woff" },
      { test: /\.(ttf|eot|svg|woff|woff2)(\?v=[0-9]\.[0-9]\.[0-9])?$/, loader: 'file-loader?limit=100000' },
      { test: /\.(png|jpg)$/, loader: 'url-loader?name=img/[name].[ext]&limit=100000' },
    ]
  },
  plugins: [
        new ProvidePlugin({
            $: 'jquery',
            jQuery: 'jquery',
            "window.jQuery": 'jquery',
            "windows.jQuery": 'jquery'
        }),
        new webpack.optimize.CommonsChunkPlugin("common.js"),
        new ExtractTextPlugin('css/[name].css', {
            allChunks: true
        })
    ],
 
};

module.exports = config;
