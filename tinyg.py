import json
import serial
from contextlib import contextmanager
from Queue import Queue, Empty
from threading import RLock
from util import ThreadWorker

class TinyGException(Exception): pass

class TinyGDriver(object):
	'''
	Driver for TinyG.  Sends commands, interprets responses.
	'''
	def __init__(self, port, verbose=False):
		self.portname = port
		self.revision = None
		self.verbose = verbose
		try:
			with open('data/tinyg_errors.json') as fp:
				error_codes = json.load(fp)
				self.error_codes = {int(x):y for x,y in error_codes.items()}
		except:
			self.error_codes = {}
		self.output_queue = Queue()
		self.response = []
		self.connected = False
		self.response_listeners = []
		self.lock = RLock()

	def add_response_listener(self, listener):
		with self.lock:
			self.response_listeners.append(listener)

	def remove_response_listener(self, listener):
		with self.lock:
			self.response_listeners.remove(listener)

	def connect(self):
		self.port = serial.Serial(self.portname,timeout=3)
		self.connected = True

	def disconnect(self):
		self.connected = False
		self.port.close()

	def poll(self):
		if not self.connected:
			return

		# READ
		chars = self.port.inWaiting()
		if chars:
			incoming_data = self.port.read(chars)
			for c in incoming_data:
				if c != '\n':
					self.response.append(c)
				else:
					self.handle_response(''.join(self.response))
					self.response = []
		# WRITE
		try:
			command = self.output_queue.get(block=False)
			self.log('--G2--> %s' % command)
			self.port.write(command)
		except Empty:
			pass

	def run(self):
		while True:
			self.poll()

	def handle_response(self, s):
		try:
			response = json.loads(s)
			self.log('<--G2-- %s' % s)
			for listener in self.response_listeners:
				listener(response)
		except:
			self.log(s)

	def format_command(self, d):
		if isinstance(d, dict):
			return json.dumps(d) + '\n'
		else:
			return d.strip() + '\n'
	def check_footer(self, footer):
		revision, status, bytes, checksum = footer
		if self.revision == None:
			self.revision = revision
		else:
			if self.revision != revision:
				raise Exception('Revision mismatch. Expected %s but got %s' % (self.revision, revision))
		if status != 0:
			error, msg = self.error_codes.get(status, ('UNKNOWN_ERROR_%d' % status, 'Unknown error code (%d)' % status))
			raise TinyGException(error)

	def command(self, cmd):
		self.output_queue.put(self.format_command(cmd))

	def log(self, s):
		if self.verbose:
			print s

	def status_report(self):
		self.command({'sr':''})
		
def handle_response(x):
	print x

if __name__ == '__main__':
	g2 = TinyGDriver('COM18', verbose=True)
	g2.add_response_listener(handle_response)
	g2.connect()
	thread = ThreadWorker(g2.run)
	thread.start()

	while True:
		s = raw_input('TinyG> ')
		g2.command(s)