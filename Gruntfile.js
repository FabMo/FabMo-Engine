module.exports = function(grunt) {
	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		'groc': {
			javascript: ["*.js", "README.md"],
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
        }
	});
	grunt.loadNpmTasks('grunt-groc');
	grunt.loadNpmTasks('grunt-gh-pages');
	grunt.loadNpmTasks('grunt-open');
	
    grunt.registerTask('doc', ['groc']);
	grunt.registerTask('doc-dist', ['groc', 'gh-pages']);
	grunt.registerTask('doc-view', ['groc', 'open']);

};
