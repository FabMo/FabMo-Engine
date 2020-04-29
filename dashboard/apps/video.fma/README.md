FabMo Video Camera App
======================

The video camera app makes it possible to see video from an attached USB video
camera in FabMo.

## Features

  * Video is automatically resized to fit the web browser.
  * Works with USB cameras that support MJPEG format video (e.g. Logitech C615)
  * Automatically detects when the camera is plugged or unplugged.
  * Support multiple simultaneous camera clients.  Up to four by default.
  * Automatic detection of supported cameras.

## Install

This is a system app so the app itself does not require installation.
However, the camera server which this app connects to must be installed on the
RaspberryPi with the following commands:

```
sudo apt-get update
sudo apt-get install -y python3-pyudev python3-tornado
sudo systemctl enable /opt/fabmo/approot/approot/video.fma/camera-server.service
sudo systemctl start camera-server
```

The camera server will start automatically on subsequent reboots.

## Camera Server Options

The camera server supports the following command line options:

| Option               | Description                                  |
| -------------------- | -------------------------------------------- |
| -p PORT, --port PORT | Set the server port.                         |
| -a IP, --addr IP     | Set the server IP address.                   |
| --width WIDTH        | Set the video width.                         |
| --height HEIGHT      | Set the video height.                        |
| --fps FPS            | Set the frames per second.                   |
| --camera_clients NUM | Set the maximum number of connected clients. |

These options can be passed to the camera server by adding them to the
``camera-server.service`` file and reloading with:

```
sudo systemctl daemon-reload
sudo systemctl restart camera-server
```

## Files

| File                  | Description                                    |
| --------------------- | ---------------------------------------------- |
| package.json          | Application meta data.                         |
| index.html            | Application HTML file.                         |
| icon.png              | Application icon.                              |
| camera-server.service | SystemD service configuration.                 |
| camera-server         | Camera server Python code.                     |
| v4l2.py               | Video4Linux definitions used by camera-server. |
| README.md             | This file.                                     |
| images/in-use.jpg     | Displayed when are too many camera clients.    |
| images/offline.jpg    | Displayed when no USB camera is plugged in.    |
| js/video.js           | Resizes the video to fit the browser screen.   |
