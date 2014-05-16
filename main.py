from flask import Flask, jsonify, request, redirect, send_file
from fixtures import make_tools
from werkzeug.contrib.fixers import ProxyFix
from werkzeug.contrib.cache import MemcachedCache
from werkzeug.utils import secure_filename
import os, time
from werkzeug.contrib.cache import SimpleCache

UPLOAD_FOLDER = '/tmp'
ALLOWED_EXTENSIONS = set(['nc','g','sbp','gc','gcode'])
MEMCACHE_ADDRESS = '127.0.0.1:11211'

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.debug = True
app.wsgi_app = ProxyFix(app.wsgi_app)

if app.debug:
    cache = SimpleCache()
else:
    cache = MemcachedCache([MEMCACHE_ADDRESS])
app.cache = cache

fileinfo = {}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1] in ALLOWED_EXTENSIONS

def get_tools():
    return cache.get('tools')

@app.route('/')
def index():
    print "INDEX"
    return app.send_static_file('index.html')

@app.route('/update', methods=['POST'])
def update():
    tools = request.json
    print tools
    cache.set('tools',[tools])
    print cache.get('tools')
    return jsonify({'err':0})

@app.route('/fileinfo', methods=['GET'])
def get_fileinfo():
    return jsonify(fileinfo)

@app.route('/getfile', methods=['GET'])
def get_file():
    return send_file(fileinfo['full_path'])

@app.route('/tools')
def tools():
    return jsonify({'tools':get_tools()})

@app.route('/tools/<id>')
def tools_by_id(id):
    tool = get_tools()[0]
    return jsonify({'tool':tool})

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
