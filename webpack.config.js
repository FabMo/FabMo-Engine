var lib = 'dashboard/static/js/libs';
var js = 'dashboard/static/js';
var webpack = require("webpack");
var ProvidePlugin = require('webpack').ProvidePlugin;
var path = require('path');
var ExtractTextPlugin = require('extract-text-webpack-plugin');
var Promise = require('es6-promise').Promise;
require('es6-promise').polyfill();
var config = {
  entry: {
    dashboard:'./dashboard/static/js/main.js',
    job_manager:'./dashboard/apps/job_manager.fma/js/job_manager.js',
    editor: './dashboard/apps/editor.fma/js/editor.js',
    configuration: './dashboard/apps/configuration.fma/js/configuration.js',
    macro_manager: './dashboard/apps/macro_manager.fma/js/macro_manager.js',
    network_manager: './dashboard/apps/network_manager.fma/js/network_manager.js',
    preview: './dashboard/apps/previewer.fma/js/viewer.js'
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
    { test: /\.css$/, 
      loader: ExtractTextPlugin.extract("style-loader", "css-loader")
    }, {
      test: /\.woff(\?v=\d+\.\d+\.\d+)?$/,
      loader: "url?limit=10000&mimetype=application/font-woff"
    }, {
      test: /\.woff2(\?v=\d+\.\d+\.\d+)?$/,
      loader: "url?limit=10000&mimetype=application/font-woff"
    }, {
      test: /\.ttf(\?v=\d+\.\d+\.\d+)?$/,
      loader: "url?limit=10000&mimetype=application/octet-stream"
    }, {
      test: /\.eot(\?v=\d+\.\d+\.\d+)?$/,
      loader: "file"
    }, {
      test: /\.svg(\?v=\d+\.\d+\.\d+)?$/,
      loader: "url?limit=10000&mimetype=image/svg+xml"
    }, { 
      test: /\.(png|jpg)$/, 
      loader: 'url-loader?name=img/[name].[ext]&limit=100000' },
    ]
  },
  plugins: [
        new ProvidePlugin({
            $: 'jquery',
            jQuery: 'jquery',
            "window.jQuery": 'jquery',
            "windows.jQuery": 'jquery',
            'THREE': 'three'
        }),
        new webpack.optimize.CommonsChunkPlugin("common.js"),
        new ExtractTextPlugin('css/[name].css', {
            allChunks: true
        })
    ],
 
};

module.exports = config;
