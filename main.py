import os, time, sys
import zmq
from flask import Flask, jsonify, request, redirect, send_file
from werkzeug.contrib.fixers import ProxyFix
from werkzeug.contrib.cache import MemcachedCache
from werkzeug.utils import secure_filename
from werkzeug.contrib.cache import SimpleCache
from util import jsonp
import glob

UPLOAD_FOLDER = '/opt/shopbot/parts'
#UPLOAD_FOLDER = 'c:\\work\\shopbot'
ALLOWED_EXTENSIONS = set(['nc','g','sbp','gc','gcode'])
ZMQ_PORT = 5556

app = Flask(__name__)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.debug = True
context = zmq.Context()

if not app.debug:
    app.wsgi_app = ProxyFix(app.wsgi_app)

fileinfo = {}

def shopbotd(d):
    '''
    Connect to shopbotd, send the provided python object, and read the response
    '''
    socket = context.socket(zmq.PAIR)
    socket.connect("tcp://localhost:%d" % ZMQ_PORT)
    socket.send_pyobj(d)
    response = socket.recv_pyobj()
    socket.close()
    return response

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1] in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    return app.send_static_file('index.html')

@jsonp
@app.route('/files', methods=['GET'])
def files():
    full_paths = glob.glob(os.path.join(app.config['UPLOAD_FOLDER'], '*.nc'))
    filenames = [fn for path,fn in map(os.path.split, full_paths)]
    filedict = dict([(filename, idx) for (idx,filename) in enumerate(filenames)])
    return jsonify({'files':filedict})

@app.route('/run_file', methods=['GET'])
def run_file():
    id = int(request.args.get('id'))
    full_paths = glob.glob(os.path.join(app.config['UPLOAD_FOLDER'], '*.nc'))
    filenames = [fn for path,fn in map(os.path.split, full_paths)]
    filedict = dict([(idx, full_path) for (idx,full_path) in enumerate(full_paths)])
    full_path = filedict[id]
    print full_path
    shopbotd({'cmd':'run','path':full_path})
    return redirect('/')

@jsonp
@app.route('/status')
def status():
    s = shopbotd({'cmd':'status'})
    return jsonify({'status':s})

@app.route('/stop')
def stop():
    s = shopbotd({'cmd':'stop'})
    print s
    return jsonify({'err':0})

@app.route('/upload', methods=['POST'])
def upload_file():
    global fileinfo
    if request.method == 'POST':
        file = request.files['file']
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            print "Saving: %s" % filename
            full_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(full_path)
            fileinfo = {'name':filename, 'time':time.time(), 'full_path':full_path}
        return redirect('/')


if __name__ == '__main__':
    app.run(host='0.0.0.0')
