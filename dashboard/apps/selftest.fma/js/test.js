var tests = [];

function RegisterTest(options, f) {
	var test = {
		name : options['name'] || 'Untitled Test',
		description : options['description'] || 'No description provided',
		index : tests.length,
		timeout : options['timeout'] || 5000,
		run : false,
		passed : false,
		error : null
		func = f || function() {},
	}
	tests.push(test);
}

function PassTest(test) {
	test.run = true;
	test.passed = true;
	test.error = null;
}

function FailTest(test, err) {
	test.run = true;
	test.passed = false;
	test.error = err;
}

function RunTest(idx) {
	var test = tests[idx];
	try {
		tests.func(function testCallback(err) {
			if(err) {
				FailTest(test, err);
			} else {
				PassTest(test);
			}
		});
	} catch(e) {
		FailTest(test, e);
	}
}

