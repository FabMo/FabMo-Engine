import json
import platform
import time
import sys
import tinyg
import zmq
import os
from threading import RLock

ZMQ_PORT = 5556

class MachineModel(object):
    def __init__(self, g2, name='My Tool'):
        self.lock = RLock()
        if g2:
            g2.add_response_listener(self.response_listener)
        self.g2 = g2
        self.xpos = 0
        self.ypos = 0
        self.zpos = 0
        self.name = name

    def response_listener(self, response):
        if 'sr' in response:
            with self.lock:
                status = response['sr']
                self.xpos = status.get('posx', self.xpos)
                self.ypos = status.get('posy', self.ypos)
                self.zpos = status.get('posz', self.zpos)

    def get_state(self):
        state = 'idle' if self.g2.gcode_queue.empty() else 'running'
        with self.lock:
            return {'name':self.name,
                    'xpos':self.xpos,
                    'ypos':self.ypos,
                    'zpos':self.zpos,
                    'state':state}

    def run_file(self, filename):
        with open(filename) as fp:
            self.g2.send_file(fp)

    def stop(self):
        self.g2.stop()

# Connect to G2
g2 = tinyg.G2()

# Create the model of the machine
machine = MachineModel(g2)

# Create a socket and listen for a connection
context = zmq.Context()
socket = context.socket(zmq.PAIR)
socket.bind("tcp://*:%d" % ZMQ_PORT)

while True:
    # Receive command object
    msg = socket.recv_pyobj()
    cmd = msg.get('cmd', None)
    if cmd:
        if cmd == 'status':
            state = machine.get_state()
            state['err'] = 0
            socket.send_pyobj(state)
        elif cmd == 'run':
            filename = msg.get('path')
            if os.path.exists(filename):
                machine.run_file(filename)
                socket.send_pyobj({'err':0})
            else:
                socket.send_pyobj({'err':-1})
        elif cmd == 'stop':
            print "STOPPING THE TOOL"
            machine.stop()
            socket.send_pyobj({'err':0})

        else:
            socket.send_pyobj({'err':-1})