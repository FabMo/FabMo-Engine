var assert = require('assert');
var safe = require('../lib/safe.js');

describe("safe",function () {
	describe("sure", function () {
		it("should rise up exceptions", function () {
			safe.sure(function (err) {
				assert(err!=null)
				}, function () {
					throw new Error();
			})(null);
		})
		it("should protect inner function from error", function () {
			safe.sure(function (err) {
				assert(err!=null)
				}, function () {
					assert("Should not be executed")
			})(new Error());
		})		
		it("should return value on success instead of function execute", function () {
			safe.sure(function (err,v) {
				assert(err==null)
				assert.equal(v,"value")
				}, "value"
			)(null);
		})			
		it("should not return value if error happens", function () {
			safe.sure(function (err,v) {
				assert(err!=null)
				}, "value"
			)(new Error());
		})		
	})
	describe("trap", function () {
		it("should rise up exceptions to explicetly provided callback", function () {
			safe.trap(function (err) {
				assert(err!=null)
				}, function () {
					throw new Error();
			})(null);
		})
		it("should rise up exceptions to indirectly provided callback", function () {
			safe.trap(function () {
				throw new Error();
			})(null,function (err) {
				assert(err!=null)
			});
		})		
	})
	describe("result", function () {
		it("should rise up exceptions", function () {
			safe.result(function (err) {
				assert(err!=null)
				}, function () {
					throw new Error();
			})(null);
		})
		it("should convert return to callback", function () {
			safe.result(function (err,v) {
				assert(err==null)
				assert.equal(v,"value")
				}, function () {
					return "value"
			})(null);
		})
	})
	describe("sure_result", function () {
		it("should rise up exceptions", function () {
			safe.sure_result(function (err) {
				assert(err!=null)
				}, function () {
					throw new Error();
			})(null);
		})
		it("should protect inner function from error", function () {
			safe.sure_result(function (err) {
				assert(err!=null)
				}, function () {
					assert("Should not be executed")
			})(new Error());
		})		
		it("should convert return to callback", function () {
			safe.sure_result(function (err,v) {
				assert(err==null)
				assert.equal(v,"value")
				}, function () {
					return "value"
			})(null);
		})		
	})
	describe("wrap", function () {
		it("should rise up exceptions", function () {
			safe.wrap(function () {
				throw new Error();
			},function (err) {
				assert(err!=null)
			})(null);
		})
		it("should append callback to inner function", function () {
			safe.wrap(function (cb) {
				cb(new Error())
			},function (err) {
				assert(err!=null)
			})(null);
		})		
	})
	describe("run", function () {
		it("should rise up exceptions", function () {
			safe.run(function () {
				throw new Error();
			},function (err) {
				assert(err!=null)
			});
		})
	})	
	describe("spread", function () {
		it("should convert array to variadic arguments", function () {
			safe.spread(function (a1,a2,a3) {
				assert.equal(a1,"apple");
				assert.equal(a2,"samsung");
				assert.equal(a3,"nokia");
			})(["apple","samsung","nokia"])
		})
	})
	describe("sure_spread", function () {
		it("should rise up exceptions", function () {
			safe.sure_spread(function (err) {
				assert(err!=null)
				}, function () {
					throw new Error();
			})(null);
		})
		it("should protect inner function from error", function () {
			safe.sure_spread(function (err) {
				assert(err!=null)
				}, function () {
					assert("Should not be executed")
			})(new Error());
		})		
		it("should convert array to variadic arguments", function () {
			safe.sure_spread(safe.noop,function (a1,a2,a3) {
				assert.equal(a1,"apple");
				assert.equal(a2,"samsung");
				assert.equal(a3,"nokia");
			})(null,["apple","samsung","nokia"])
		})
	})	
	describe("async", function () {
		var obj = {
			doStuff:function (a,b,cb) {
				cb(null, a+b);
			},
			doBad:function (a,b,cb) {
				throw new Error();
			}
		}		
		it("should rise up exceptions", function () {
			safe.async(obj,"doBad")(function (err,v) {
				assert(err!=null)
			})
		})		
		it("should bind to object function and rise up callback value", function () {
			safe.async(obj,"doStuff",2,3)(function (err,v) {
				assert(err==null);
				assert.equal(v,5)
			})
		})
	})
	describe("back", function () {
		it("should return value in next iteration", function (done) {
			var a = 0;
			safe.back(function (err) { done((err!=null && a==1)?null:new Error("Wrong behavior")) }, new Error())
			a++
		})
	})
	describe("yield", function () {
		it("should execute function in next iteration", function (done) {
			var a = 0;
			safe.yield(function () { done(a==1?null:new Error("Wrong behavior")) })
			a++
		})
	})	
	describe("inherits", function () {
		var parent = function () {
		}
		parent.prototype.parent_function = function () {
		}
		var child = function () {
		}
		safe.inherits(child,parent)		
		child.prototype.child_function = function () {
		}
		it("should make magic that gives child instance methods of parents", function () {
			var obj = new child();
			obj.child_function();
			obj.parent_function();
		})
	})		
})
