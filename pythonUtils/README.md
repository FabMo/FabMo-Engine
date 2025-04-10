# USB Fabmo Logger

The **USB Fabmo Logger** is a Python-based daemon that monitors for USB flash drive insertions. When a USB flash drive is detected, the tool generates a `##-FABMO-##.log` file and an `##-accessSHOPBOT-##.html file in the root directory of the USB drive. This log file includes the following:

- The local IP address of the device.
- other info useful for diagnosing problems

The html file provide a link to start FabMo/ShopBot on a device on the same network.


# I2C Display

The **I2C Display** script can be used to drive an I2C display from the Raspberry Pi to proovide the tool's IP address and other system Info. This syetem is in-active by default and requires additional hardware. 


## License

This project is licensed under the MIT License. See the LICENSE file for details.
