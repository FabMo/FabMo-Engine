module.exports = function(grunt) {
	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		'groc': {
			javascript: ["*.js", "*.md", "*/*.js", "*/*.md"],
			options: {
				"out": "docs-dist/"
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
        'mochaTest' : {
            test:{
                src: ["test/*.js"]
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
	grunt.loadNpmTasks('grunt-gh-pages');
	grunt.loadNpmTasks('grunt-open');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-available-tasks');
    grunt.loadNpmTasks('grunt-apidoc');

    grunt.registerTask('doc', 'Generate engine documentation in HTML format.', ['groc', 'apidoc']);
	grunt.registerTask('doc-dist', 'Generate documentation and publish to github-pages.', ['groc', 'apidoc', 'gh-pages']);
	grunt.registerTask('doc-view', 'Generate documentation and view locally in web browser.', ['groc', 'apidoc', 'open']);
    grunt.registerTask('test', 'Run tests.', 'mochaTest');
    grunt.registerTask('default', 'availabletasks');
};
