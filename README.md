The Shopbot Example Application Framework
=========================================

The purpose of this project is to provide a simple application framework for developing and testing the technical details of running a shopbot app ecosystem.

Prerequisites
-------------
* Python
* Flask
* Pyserial
* Running the app requires internet access currently, due to web dependencies (bootstrap)

Running
-------
Once the prerequisites are installed, to run the application, simply run main.py.  If you are on windows, you may get a network warning.  Click 'Allow'  To view the app UI, navigate your browser to http://localhost:5000/

Notes
-----
main.py will look for a tinyg board on startup.  If it encounters an error on communicating with one, it will simply run the web portion of the app without connection to a tool. 

https://github.com/ShopBotTools/shopbot-example-app/blob/master/main.py#L42

Check the above source code line, and adjust for your G2 board in order to get a proper connection.
