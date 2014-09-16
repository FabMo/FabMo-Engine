var log = require('../../log'); //needed to run
var g2 = require('../../g2');
var chai = require('chai');
var sinon = require('sinon');
var serial_path = 'COM1';


var expect = chai.expect;
var sandbox = sinon.sandbox.create();


describe('G2', function(){
	var driver = new g2.G2();

	beforeEach(function(){
		sandbox.stub(console, "log");
		sandbox.stub(console, "error");
	});

	afterEach(function(){
		sandbox.restore();
	});

	describe('#connect()',function(){
	  	it('should return no error and the driver',function(done){
	  		driver.connect(serial_path, function(err, data) {
	  			expect(err).to.be.false;
	  			expect(data).to.be.an.instanceof(g2.G2);
	  			done();
	  		});
	  	});
  	});


	describe('#toString()',function(){
		it('should return a string',function(done){
			var driver_string = driver.toString();
			expect(driver_string).to.equal("[G2 Driver on '" + serial_path + "']")
			done();
		});
	});

	describe('#onSerialError()',function(){
		it('should print the arg to the console',function(){
			driver.onSerialError("error message");
			sinon.assert.calledOnce(console.error);
      		sinon.assert.calledWithMatch(console.error, /\*error message\*/ )
		});
	}); 
/*
	describe('#write()',function(){
		it('',function(){
			driver.write(args);
			expect(null).to.be.null;
		});
	});

	describe('#writeAndDrain()',function(){
		it('',function(){
			driver.writeAndDrain(args);
			expect(null).to.be.null;
		});
	});

	describe('#jog()',function(){
		it('',function(){
			driver.jog(args);
			expect(null).to.be.null;
		});
	});

	describe('#jog_keepalive()',function(){
		it('',function(){
			driver.jog_keepalive(args);
			expect(null).to.be.null;
		});
	});

	describe('#stopJog()',function(){
		it('',function(){
			driver.stopJog(args);
			expect(null).to.be.null;
		});
	});

	describe('#requestStatusReport()',function(){
		it('',function(){
			driver.requestStatusReport(args);
			expect(null).to.be.null;
		});
	});

	describe('#requestQueueReport()',function(){
		it('',function(){
			driver.requestQueueReport(args);
			expect(null).to.be.null;
		});
	});

	describe('#onData()',function(){
		it('',function(){
			driver.onData(args);
			expect(null).to.be.null;
		});
	});

	describe('#handleQueueReport()',function(){
		it('',function(){
			driver.handleQueueReport(args);
			expect(null).to.be.null;
		});
	});

	describe('#handleFooter()',function(){
		it('',function(){
			driver.handleFooter(args);
			expect(null).to.be.null;
		});
	});

	describe('#handleStatusReport()',function(){
		it('',function(){
			driver.handleStatusReport(args);
			expect(null).to.be.null;
		});
	});

	describe('#onMessage()',function(){
		it('',function(){
			driver.onMessage(args);
			expect(null).to.be.null;
		});
	});

	describe('#feedHold()',function(){
		it('',function(){
			driver.feedHold(args);
			expect(null).to.be.null;
		});
	});

	describe('#resume()',function(){
		it('',function(){
			driver.resume(args);
			expect(null).to.be.null;
		});
	});

	describe('#quit()',function(){
		it('',function(){
			driver.quit(args);
			expect(null).to.be.null;
		});
	});

	describe('#get()',function(){
		it('',function(){
			driver.get(args);
			expect(null).to.be.null;
		});
	});

	describe('#set()',function(){
		it('',function(){
			driver.set(args);
			expect(null).to.be.null;
		});
	});

	describe('#command()',function(){
		it('',function(){
			driver.command(args);
			expect(null).to.be.null;
		});
	});

	describe('#runString()',function(){
		it('',function(){
			driver.runString(args);
			expect(null).to.be.null;
		});
	});

	describe('#runSegment()',function(){
		it('',function(){
			driver.runSegment(args);
			expect(null).to.be.null;
		});
	});

	describe('#expectStateChange()',function(){
		it('',function(){
			driver.expectStateChange(args);
			expect(null).to.be.null;
		});
	});
*/

});