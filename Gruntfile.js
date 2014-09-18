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
		}
	});
	grunt.loadNpmTasks('grunt-groc');
	grunt.loadNpmTasks('grunt-gh-pages');
	grunt.registerTask('doc', ['groc']);
	grunt.registerTask('doc-dist', ['groc', 'gh-pages']);

};