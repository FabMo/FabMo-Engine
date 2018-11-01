module.exports = function(grunt) {
grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        'clean' : {
            'docs' : ['docs-dist']
        },
        'groc': {
            javascript: ["*.js","*.md","**/*.js","**/*.md"],
            options: {
                "out": "docs-dist/",
                "except":[
                    "Gruntfile.js",
                    "dashboard/apps",
                    "dashboard/apps/**",
                    "dashboard/build",
                    "dashboard/build/**",
                    "node_modules",
                    "node_modules/**",
                    "dashboard/static",
                    "dashboard/static/**",
                    "docs-dist",
                    "docs-dist/**"
                ],
                "repository-url" : "https://github.com/FabMo/FabMo-Engine.git"
            },
        },
        'gh-pages': {
            options: {
                base: 'docs-dist'
            },
            src: ['**']
        },
        'open' : {
            'file' : {
                path : 'docs-dist/index.html'
            }
        },
        'availabletasks' : {
            'tasks' : {
                options: {
                    showTasks: ['user'],
                    filter: 'exclude',
                    tasks: ['availabletasks', 'default']
                }
            }
        },
        'apidoc' : {
            myapp: {
                src: "routes",
                dest: "docs-dist/api",
                debug: true
            }
        }
    });
    grunt.loadNpmTasks('grunt-groc');
    grunt.loadNpmTasks('grunt-contrib-clean');
    grunt.loadNpmTasks('grunt-gh-pages');
    grunt.loadNpmTasks('grunt-open');
    grunt.loadNpmTasks('grunt-available-tasks');
    grunt.loadNpmTasks('grunt-apidoc');

    grunt.registerTask('doc', 'Generate engine documentation in HTML format.', ['clean', 'groc', 'apidoc']);
    grunt.registerTask('doc-dist', 'Generate documentation and publish to github-pages.', ['doc', 'gh-pages']);
    grunt.registerTask('doc-view', 'Generate documentation and view locally in web browser.', ['doc', 'open']);
    grunt.registerTask('default', 'availabletasks');
};
