import random

def make_tools(count):
    tools = []
    TOOL_NAMES = ['Shopbot Desktop', 'Shopbot Buddy', 'Shopbot PRS', 'Shopbot Alpha']
    STATUSES = ['idle','running','homing']
    for i in range(10):
        tool = {'name': random.choice(TOOL_NAMES),
                'xpos': random.random()*24.0,
                'ypos': random.random()*18.0,
                'zpos': random.random()*4.0,
                'status': random.choice(STATUSES),
                'id': i}
        tools.append(tool)
    return tools

