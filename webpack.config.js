var lib = 'dashboard/static/js/libs';
var js = 'dashboard/static/js';
var webpack = require("webpack");
var ProvidePlugin = require('webpack').ProvidePlugin;
var path = require('path');
var ExtractTextPlugin = require('extract-text-webpack-plugin');
var CleanWebpackPlugin = require('clean-webpack-plugin');
var Promise = require('es6-promise').Promise;
require('es6-promise').polyfill();


var cleanOptions = {
  exclude:  ['index.html'],
}

var config = {
  entry: {
    home:'./dashboard/apps/home.fma/js/home.js',
    dashboard:'./dashboard/static/js/main.js',
    job_manager:'./dashboard/apps/job_manager.fma/js/job_manager.js',
    editor: './dashboard/apps/editor.fma/js/editor.js',
    configuration: './dashboard/apps/configuration.fma/js/configuration.js',
    macro_manager: './dashboard/apps/macro_manager.fma/js/macro_manager.js',
    network_manager: './dashboard/apps/network_manager.fma/js/network_manager.js',
    preview: './dashboard/apps/previewer.fma/js/app.js',
    selftest: './dashboard/apps/selftest.fma/js/selftest.js'
  },
  output: {
    path: 'dashboard/build',
    publicPath: "/",
    filename: "[name].js"
    // filename: "[name].[chunkhash].js"
  },
  resolve: {
  // modulesDirectories: [lib],
   extensions: ['', '.js'],

 },
  module: {
    loaders: [
      {test: /\.js$/,
      include :[
          path.resolve(__dirname, 'src'),
          path.resolve(__dirname, 'node_modules', 'camelcase'),
          path.resolve(__dirname, 'node_modules', 'camelcase-keys'),
          path.resolve(__dirname, 'node_modules', 'decamelize-keys'),
          path.resolve(__dirname, 'node_modules', 'quick-lru'),
        ],
      loader: 'babel-loader',
      query: {
        "presets": [
          ["env", {
            "targets": {
              "node": "0.10.44"
            }
          }]
        ]
      
      }
      },
      { test: /\.css$/, loader: ExtractTextPlugin.extract("style-loader", "css-loader")},
      { test: /\.(ttf|eot|svg|woff|woff2)(\?v=[0-9]\.[0-9]\.[0-9])?$/, loader: 'file-loader?limit=100000' },
      { test: /\.(png|jpg)$/, loader: 'url-loader?name=img/[name].[ext]&limit=100000' },
    ]
  },
  plugins: [
      new CleanWebpackPlugin('./dashboard/build', cleanOptions),

        
        new ProvidePlugin({
            $: 'jquery',
            jQuery: 'jquery',
            "window.jQuery": 'jquery',
            "windows.jQuery": 'jquery',
            'THREE': 'three'
        }),
       
        
        new webpack.optimize.CommonsChunkPlugin({
          name: "common"
        }),
        new ExtractTextPlugin('css/[name].css', {
            allChunks: true
        })
    ],

};

module.exports = config;
