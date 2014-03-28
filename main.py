from flask import Flask, jsonify
from fixtures import make_tools

app = Flask(__name__)
app.debug = True

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/tools')
def tools():
    return jsonify({'tools':make_tools(10)})

if __name__ == '__main__':
    app.run()