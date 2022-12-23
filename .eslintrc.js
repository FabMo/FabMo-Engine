module.exports = {
    env: {
        node: true,
        commonjs: true,
        es2021: true,
    },
    globals: {
        async: true,
        clearTimeout: true,
        log: true,
        process: true,
        setImmediate: true,
        setTimeout: true,
    },
    plugins: ["jest", "prettier"],

    extends: ["eslint:recommended", "prettier"],
    parserOptions: {
        ecmaVersion: 12,
    },
    rules: {
        "no-mixed-spaces-and-tabs": "off",
        "prettier/prettier": ["error"],
    },
    ignorePatterns: [
        "dashboard/static/js/libs/socket.io.js",
        "dashboard/static/js/libs/hammer.js",
        "dashboard/static/js/libs/hammer.min.js",
        "dashboard/static/js/libs/jquery.min.js",
        "dashboard/static/js/libs/lockr.min.js",
        "dashboard/static/js/libs/moment.js",
        "dashboard/static/js/libs/pako.min.js",
        "dashboard/static/js/libs/require.js",
        "dashboard/static/js/libs/toastr.min.js",
        "dashboard/static/js/libs/underscore.js",
        "dashboard/static/js/libs/foundation.min.js",
        "dashboard/static/js/libs/backbone.js",
        "dashboard/static/js/events.js",
        "dashboard/apps/previewer.fma/js/three.js",
        "dashboard/apps/job_manager.fma/js/moment.js",
        "dashboard/apps/job_manager.fma/js/Sortable.js",
        "dashboard/apps/home.fma/js/Sortable.js",
        "dashboard/apps/editor.fma/js/codemirror.js",
        "dashboard/apps/editor.fma/js/cm-addon/**",
    ],
    overrides: [
        {
            env: { browser: true, jquery: true },
            files: ["dashboard/**"],
        },
        {
            files: ["test/**"],
            plugins: ["jest"],
            extends: ["plugin:jest/recommended"],
            rules: { "jest/prefer-expect-assertions": "off" },
        },
    ],
};
