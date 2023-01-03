/* eslint-disable no-unused-vars */
// Generated using webpack-cli http://github.com/webpack-cli
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const lib = "dashboard/static/js/libs";
const js = "dashboard/static/js";
const webpack = require("webpack");
const ProvidePlugin = require("webpack").ProvidePlugin;
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const Promise = require("es6-promise").Promise;
const es6_promise = require("es6-promise").polyfill();

process.traceDeprecation = true;

var cleanOptions = {
    exclude: ["index.html"],
};

var config = {
    mode: "development",
    entry: {
        home: "./dashboard/apps/home.fma/js/home.js",
        dashboard: "./dashboard/static/js/main.js",
        job_manager: "./dashboard/apps/job_manager.fma/js/job_manager.js",
        editor: "./dashboard/apps/editor.fma/js/editor.js",
        configuration: "./dashboard/apps/configuration.fma/js/configuration.js",
        macro_manager: "./dashboard/apps/macro_manager.fma/js/macro_manager.js",
        network_manager:
            "./dashboard/apps/network_manager.fma/js/network_manager.js",
        preview: "./dashboard/apps/previewer.fma/js/app.js",
        selftest: "./dashboard/apps/selftest.fma/js/selftest.js",
    },

    output: {
        path: "/fabmo/dashboard/build",
        publicPath: "/",
        filename: "[name].js",
    },

    resolve: {
        extensions: ["", ".js"],
    },
    module: {
        rules: [
            {
                test: /\\.(js|jsx)$/,
                loader: "babel-loader",
            },
            {
                test: /\.js$/,
                enforce: "pre",
                use: ["source-map-loader"],
            },
            {
                test: /\.css$/i,
                use: [
                    {
                        loader: MiniCssExtractPlugin.loader,
                        options: {
                            publicPath: "/",
                        },
                    },
                    "css-loader",
                ],
            },
            {
                test: /\.(eot|svg|ttf|woff|woff2|png|jpg|gif)$/,
                type: "asset",
            },

            // Add your rules for custom modules here
            // Learn more about loaders from https://webpack.js.org/loaders/
        ],
    },
    plugins: [
        new CleanWebpackPlugin({
            dry: false,
            verbose: true,
            cleanOnceBeforeBuildPatterns: ["**/*", "!index.html"],
        }),

        new ProvidePlugin({
            $: "jquery",
            jQuery: "jquery",
            "window.jQuery": "jquery",
            "windows.jQuery": "jquery",
        }),

        //new HtmlWebpackPlugin(
        //{
        //template: 'index.html',
        //}
        //),

        // Add your plugins here
        // Learn more obout plugins from https://webpack.js.org/configuration/plugins/

        new MiniCssExtractPlugin(),
    ],
};

module.exports = config;
