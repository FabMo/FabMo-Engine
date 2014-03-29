from tinyg import TinyGDriver
        
def handle_response(x):
    print x

if __name__ == '__main__':
    g2 = TinyGDriver('/dev/cu.usbmodem001', verbose=True)
    #g2.add_response_listener(handle_response)
    g2.run_in_thread()

    g2.command({'1tr':119.69})
    g2.command({'xtm':0})
    g2.command({'xvm':100000})
    g2.command({'xfr':100000})
    g2.command({'1mi':8})
    g2.command({'1sa':1.8})

    while True:
        s = raw_input('TinyG> ')
        print ''
        g2.command(s)
