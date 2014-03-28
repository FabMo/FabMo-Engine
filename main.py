from flask import Flask, jsonify
app = Flask(__name__)
app.debug = True

import random
TOOLS = []
TOOL_NAMES = ['Shopbot Desktop', 'Shopbot Buddy', 'Shopbot PRS', 'Shopbot Alpha']
STATUSES = ['idle','running','homing']
for i in range(10):
    tool = {'name': random.choice(TOOL_NAMES),
            'xpos': random.random()*24.0,
            'ypos': random.random()*18.0,
            'zpos': random.random()*4.0,
            'status': random.choice(STATUSES),
            'id': i}
    TOOLS.append(tool)

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/tools')
def tools():
    return jsonify({'tools':TOOLS})

if __name__ == '__main__':
    app.run()