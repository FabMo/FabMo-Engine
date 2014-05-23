import json
import serial
from contextlib import contextmanager
from Queue import Queue, Empty
from threading import RLock, Thread
import platform

BUFFER_SKID = 4
MAX_THROTTLE = 20
DEVICE_STRINGS = {  'Darwin':['/dev/cu.usbmodem%03d' % port for port in range(1,11)], 
                    'Linux': ['/dev/ttyACM%d' % port for port in range(10)], 
                    'Windows':['COM%d' % port for port in range(3,51)]}

def G2():
    system = platform.system()
    comports = DEVICE_STRINGS.get(system, None)
    g2 = None
    print "Creating G2 object"
    if comports:
        # Try each one in turn
        for port in comports:
            try:
                g2 = TinyGDriver(port, verbose=True)
            except Exception, e:
                print e
                continue
            # Start running the first one that seems valid
            if g2:
                g2.run_in_thread()
                return g2
            else:
                raise Exception('Could not find G2 connected to host.')
    else:
        raise Exception('Platform Unsupported')

class ThreadWorker(Thread):
    def __init__(self, callable, *args, **kwargs):
        super(ThreadWorker, self).__init__()
        self.callable = callable
        self.args = args
        self.kwargs = kwargs
        self.setDaemon(True)

    def run(self):
        try:
            self.callable_return = self.callable(*self.args, **self.kwargs)
        except Exception, e:
            pass # TODO fix explicitly silenced error

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
        self.json_queue = Queue()
        self.gcode_queue = Queue()
        self.response = []
        self.connected = False
        self.response_listeners = []
        self.qr = 28
        self.qi = 0
        self.qo = 0
        self.throttle_count = 0
        self.lock = RLock()

    def __del__(self):
        self.disconnect()

    def add_response_listener(self, listener):
        with self.lock:
            self.response_listeners.append(listener)

    def remove_response_listener(self, listener):
        with self.lock:
            self.response_listeners.remove(listener)

    def _on_connect(self):
        self.command({'qv':2})  # Set triple queue reports

    def _on_disconnect(self):
        pass

    def _on_response(self, response):
        self.qr = response.get('qr', self.qr)
        self.qi = response.get('qi', self.qi)
        self.qo = response.get('qo', self.qo)
        if 'qr' in response:
            self.throttle_count = 0
        id, status, rx, checksum = response.get('f',[0,0,0,0])
        if status:
            error, msg = self.error_codes.get(status, ('UNKNOWN_ERROR_%d' % status, 'Unknown error code (%d)' % status))
            self.log(msg)
                        
    def connect(self):
        self.port = serial.Serial(self.portname,timeout=3)
        self.connected = True
        self._on_connect()

    def disconnect(self):
        self.connected = False
        try:
            self.port.close()
        except:
            pass
        self._on_disconnect()

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

        # WRITE (JSON)
        try:
            command = self.json_queue.get(block=False)
            self.log('--> %s' % repr(command))
            self.port.write(command)
        except Empty:
            pass

        # WRITE (GCODE)
        if self.qr > BUFFER_SKID and self.throttle_count < MAX_THROTTLE:
            try:
                command = self.gcode_queue.get(block=False)
                self.log('--> %s' % repr(command))
                self.port.write(command)
                self.throttle_count += 1;
            except Empty:
                pass
            except Exception, e:
                print e

    def run(self):
        try:
            while self.connected:
                self.poll()
        except Exception, e:
            print "EPIC FAIL:" + str(e)

    def run_in_thread(self):
        self.connect()
        thread = ThreadWorker(self.run)
        thread.start()
        return thread
        
    def handle_response(self, s):
        try:
            response = json.loads(s)
            self.log('<--- %s' % s)
            self._on_response(response)
            for listener in self.response_listeners:
                listener(response)
        except Exception, e:
            print e
            self.log(s)

    def command(self, cmd):
        if isinstance(cmd, dict):
            self.json_queue.put(str(json.dumps(cmd) + '\n'))
        else:
            self.gcode_queue.put(str(cmd.strip() + '\n'))

#        if status != 0:
#            error, msg = self.error_codes.get(status, ('UNKNOWN_ERROR_%d' % status, 'Unknown error code (%d)' % status))
#            raise TinyGException(error)

    def stop(self):
        while not self.gcode_queue.empty():
            self.gcode_queue.get()
            
    def log(self, s):
        if self.verbose:
            print s

    def status_report(self):
        self.command({'sr':''})

    def send_file(self, f):
        for line in f.readlines():
            self.gcode_queue.put(line)

    def send_file_string(self, s):
        for line in s.split('\n'):
            self.gcode_queue.put(line)
            