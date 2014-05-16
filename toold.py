import requests
import json
import platform
import time
from tinyg import TinyGDriver

URL_FILEINFO = 'http://127.0.0.1:5000/fileinfo'
URL_TOOLUPDATE = 'http://127.0.0.1:5000/update'
URL_GETFILE = 'http://127.0.0.1:5000/getfile'

class Machine(object):
    def __init__(self, g2, name='My Tool'):
        if g2:
            g2.add_response_listener(self.response_listener)
        self.g2 = g2
        self.xpos = 0
        self.ypos = 0
        self.zpos = 0
        self.name = name
        self.update()
    
    def update(self):
        try:
            requests.post(URL_TOOLUPDATE, data=json.dumps(self.state), headers={'content-type':'application/json'})
        except Exception, e:
            print e
            pass

    def response_listener(self, response):
        if 'sr' in response:
            status = response['sr']
            self.xpos = status.get('posx', self.xpos)
            self.ypos = status.get('posy', self.ypos)
            self.zpos = status.get('posz', self.zpos)
            self.update()

    @property
    def state(self):
        return {'name':self.name,
                'xpos':self.xpos,
                'ypos':self.ypos,
                'zpos':self.zpos,
                'status':'idle',
                'id':1}

    def run_file(self, s):
        print s
        #self.g2.status_report()
        for line in s.split('\n'):
            line = str(line)
            self.g2.command(line)
            print repr(line)

try:
    print "Creating G2 object"
    system = platform.system()
    device_strings = {'Darwin':'/dev/cu.usbmodem001', 'Linux':'/dev/ttyACM0', 'Windows':'COM1'}
    devstring = device_strings.get(system, '/dev/null')
    g2 = TinyGDriver(devstring, verbose=True)
    g2.run_in_thread()
    
    print "Configuring unit values"
    for motor, unit_value in [('1', 4000), ('2', 4000), ('3', 4000)]:
        motor_settings = {}
        g2.command({motor + 'sa' : 1.8})
        g2.command({motor + 'tr' : unit_value/200.0})
        g2.command({motor + 'mi' : 1})
        g2.command({motor + 'pm' : 1})
        g2.command({'xtm' : 0})
        g2.command({'ytm' : 0})
        g2.command({'ztm' : 0})
except:
    raise
    g2 = None

machine = Machine(g2)

t = None
while True:
    try:
        machine.update()
        response = requests.get(URL_FILEINFO)
        info = response.json()
        print info
        new_t = info.get('time', None)
        if new_t != t:
            response = requests.get(URL_GETFILE)
            t = new_t
            g2.send_file_string(response.text)
    except Exception, e:
        print e
    time.sleep(2.0)