from flask import Flask, jsonify
from fixtures import make_tools
from tinyg import TinyGDriver

app = Flask(__name__)
app.debug = True

class Machine(object):
    def __init__(self, g2, name='My Tool'):
        g2.add_response_listener(self.response_listener)
        self.g2 = g2
        self.xpos = 0
        self.ypos = 0
        self.zpos = 0
        self.name = name

    def response_listener(self, response):
        if 'sr' in response:
            status = response['sr']
            self.xpos = status.get('posx', self.xpos)
            self.ypos = status.get('posy', self.ypos)
            self.zpos = status.get('posz', self.zpos)

    @property
    def state(self):
        return {'name':self.name,
                'xpos':self.xpos,
                'ypos':self.ypos,
                'zpos':self.zpos,
                'status':'idle'}

g2 = TinyGDriver('COM18')
machine = Machine(g2)

def get_tools():
    state = machine.state
    state['id'] = 1
    return [state]

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/tools')
def tools():
    return jsonify({'tools':get_tools()})

@app.route('/tools/<id>')
def tools_by_id(id):
    return jsonify({'tool':get_tools()[0]})

if __name__ == '__main__':
    app.run()