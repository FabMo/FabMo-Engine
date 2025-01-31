# USB Fabmo Logger

The **USB Fabmo Logger** is a Python-based daemon that monitors for USB flash drive insertions. When a USB flash drive is detected, the tool generates a `FABMO_STATUS.log` file in the root directory of the USB drive. This log file includes the following:

- The local IP address of the device.
- The output of the command `sudo journalctl status fabmo`.
- The concatenated contents of all JSON files located in `/opt/fabmo/config`.

## Features

- **Automatic USB Detection**: Monitors for USB drive insertions and automatically generates a log file.
- **Status Logging**: Collects system and configuration information relevant to the Fabmo service.
- **JSON Concatenation**: Reads and merges the contents of JSON files in `/opt/fabmo/config`.
- **Systemd Service**: Runs as a daemon that starts automatically at system boot.

---

## Installation

### Prerequisites

- Python 3 installed on your system.
- `sudo` privileges for running the `journalctl` command and accessing system mount points.

### Steps


1. **Install the Tool**:
   Use the provided `Makefile` to install the tool.

   ```bash
   sudo make install
   ```

   This will:
   - Copy the `usb_logger.py` script to `/fabmo/pythonUtils`.
   - Create and enable a systemd service to start the daemon on boot.
   - Start the service immediately.

2. **Create the JSON Configuration Directory**:
   Ensure that `/opt/fabmo/config` exists and contains valid JSON files.

   ```bash
   sudo mkdir -p /opt/fabmo/config
   ```

---

## Usage

### Log File Output
When a USB flash drive is inserted, the tool creates a file named `FABMO_STATUS.log` in the root directory of the USB drive. The log file contains:

1. **Local IP Address**:
   The device's local IP address (retrieved programmatically).

2. **Fabmo Status**:
   The output of the command `sudo journalctl status fabmo`.

3. **Concatenated JSON Data**:
   A merged representation of all JSON files in `/opt/fabmo/config`.

---

## Managing the Service

The tool runs as a systemd service named `usb_logger.service`. You can use the following commands to manage it:

- **Start the Service**:
  ```bash
  sudo systemctl start usb_logger.service
  ```

- **Stop the Service**:
  ```bash
  sudo systemctl stop usb_logger.service
  ```

- **Restart the Service**:
  ```bash
  sudo systemctl restart usb_logger.service
  ```

- **Check Service Status**:
  ```bash
  sudo systemctl status usb_logger.service
  ```

- **View Logs**:
  Check the logs for the service using:
  ```bash
  sudo journalctl -u usb_logger.service
  ```

---

## Uninstallation

To remove the tool and its service:

1. **Run the Uninstall Command**:
   ```bash
   sudo make uninstall
   ```

2. **Optional Cleanup**:
   Remove any remaining log files or configuration directories manually if needed.

   ```bash
   sudo rm -rf /var/log/usb_logger.log /opt/fabmo/config
   ```

---

## Troubleshooting

- **Service Not Starting**:
  Ensure Python 3 is installed and accessible at `/usr/bin/python3`.

- **No Log File on USB Drive**:
  Check the service logs for errors:
  ```bash
  sudo journalctl -u usb_logger.service
  ```

- **Invalid JSON Files**:
  Ensure that all JSON files in `/opt/fabmo/config` are valid and properly formatted.

---

## Contributing

Feel free to submit issues or feature requests to the repository. Contributions are welcome via pull requests.

---

## License

This project is licensed under the MIT License. See the LICENSE file for details.
