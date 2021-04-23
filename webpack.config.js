// Generated using webpack-cli http://github.com/webpack-cli
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    mode: 'development',
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
      path: '/fabmo/dashboard/build',
      publicPath: "/",
      filename: "[name].js"
      // filename: "[name].[chunkhash].js"
      //  path: path.resolve(__dirname, 'dist'),
    },
  

    devServer: {
        open: true,
        host: 'localhost',
    },

    plugins: [
        new HtmlWebpackPlugin({
            template: 'index.html',
        }),

        // Add your plugins here
        // Learn more obout plugins from https://webpack.js.org/configuration/plugins/
    ],
    module: {
        rules: [
            {
                test: /\\.(js|jsx)$/,
                loader: 'babel-loader',
            },
            {
                test: /\.css$/i,
                use: ['style-loader','css-loader'],
            },
            {
                test: /\.(eot|svg|ttf|woff|woff2|png|jpg|gif)$/,
                type: 'asset',
            },

            // Add your rules for custom modules here
            // Learn more about loaders from https://webpack.js.org/loaders/
        ],
    },
};
