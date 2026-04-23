// ESLint v9 flat config format
const js = require("@eslint/js");
const globals = require("globals");
const prettier = require("eslint-plugin-prettier");
const jest = require("eslint-plugin-jest");

module.exports = [
    // Global ignores
    {
        ignores: [
            "dashboard/static/js/libs/**",
            "dashboard/apps/**",
            "dashboard/build/**",
            "routes/video.js",
            "runtime/opensbp/sbp_parser.js",
            "log.js",
            "node_modules/**",
        ],
    },

    // Base configuration for all JS files
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                ...globals.commonjs,
                async: "readonly",
                log: "readonly",
                process: "readonly",
                setImmediate: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                console: "readonly",
            },
        },
        plugins: {
            prettier,
        },
        rules: {
            ...js.configs.recommended.rules,
            "no-mixed-spaces-and-tabs": "off",
            "prettier/prettier": "warn",
            "no-unused-vars": "warn",
        },
    },

    // Browser/jQuery environment for dashboard
    {
        files: ["dashboard/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.jquery,
                $: "readonly",
                jQuery: "readonly",
                Backbone: "readonly",
                _: "readonly",
            },
        },
    },

    // Jest environment for test files
    {
        files: ["test/**/*.js", "**/*.test.js"],
        plugins: {
            jest,
        },
        languageOptions: {
            globals: {
                ...globals.jest,
            },
        },
        rules: {
            ...jest.configs.recommended.rules,
        },
    },
];
