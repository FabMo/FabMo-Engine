from flask import Flask, jsonify, request
from fixtures import make_tools
from werkzeug.contrib.fixers import ProxyFix
from werkzeug.contrib.cache import MemcachedCache


app = Flask(__name__)
app.debug = False
app.wsgi_app = ProxyFix(app.wsgi_app)
cache = MemcachedCache(['127.0.0.1:11211'])
app.cache = cache

def get_tools():
    tools = cache.get('tools')
    print "getting tools"
    print tools
    return tools or []

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/update', methods=['POST'])
def update():
    tools = request.json
    print tools
    cache.set('tools',tools)

@app.route('/tools')
def tools():
    return jsonify({'tools':[get_tools()]})

@app.route('/tools/<id>')
def tools_by_id(id):
    tool = get_tools()[0]
    return jsonify({'tool':tool})

@app.route('/gcode', methods=['POST'])
def gcode():
    g_code = request.form['data']
    machine.run_file(g_code)
    return jsonify({'status':'OK'})

if __name__ == '__main__':
    app.run(host='0.0.0.0')
