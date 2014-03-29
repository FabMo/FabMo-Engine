from tinyg import TinyGDriver
import sys, time

if __name__ == '__main__':
    g2 = TinyGDriver('/dev/cu.usbmodem001', verbose=True)
    #g2.add_response_listener(handle_response)

    with open(sys.argv[1]) as fp:
        gcode = fp.read()

    g2.run_in_thread()

    g2.command({'xvm':100000})
    g2.command({'xfr':100000})
    g2.command({'yvm':100000})
    g2.command({'yfr':100000})
    g2.command({'zvm':100000})
    g2.command({'zfr':100000})
    
    g2.send_file(gcode)

    while True:
        print g2.gcode_queue.qsize(), g2.json_queue.qsize(), g2.qr, g2.connected
        time.sleep(1.0)