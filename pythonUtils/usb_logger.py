import os # For bash command execution
import json # For json handleing
import socket # For querrying the local ip adress
import subprocess # 
import logging
import time # For sequencing updates
import shutil  # For file operations
import urllib.parse  # For unescaping paths

# Configure logging
logging.basicConfig(
    filename="/var/log/usb_logger.log",
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)


def get_local_ip():
    """Get the local IP address of the machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # Connect to a public DNS server
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception as e:
        logging.error(f"Error getting IP address: {e}")
        return f"Error getting IP address: {e}"

def get_fabmo_status():
    """Fetch logs for the Fabmo service using journalctl."""
    try:
        # Use systemctl to fetch the status of the fabmo service
        result = subprocess.run(
            ["sudo", "systemctl", "status", "fabmo"],
            capture_output=True,
            text=True
        )
        return result.stdout if result.returncode == 0 else result.stderr
    except Exception as e:
        logging.error(f"Error running journalctl command: {e}")
        return f"Error running journalctl command: {e}"

def get_fabmo_updater_status():
    """Fetch logs for the Fabmo-Updater service using journalctl."""
    try:
        # Use systemctl to fetch the status of the fabmo service
        result = subprocess.run(
            ["sudo", "systemctl", "status", "fabmo-updater"],
            capture_output=True,
            text=True
        )
        return result.stdout if result.returncode == 0 else result.stderr
    except Exception as e:
        logging.error(f"Error running journalctl command: {e}")
        return f"Error running journalctl command: {e}"

def get_heat_volts_status():
    """Fetch logs for ck_heat_volts."""
    try:
        # Fetch the status of ck_heat_volts (others ck_s currently require gtk)
        result = subprocess.run(
            ["sudo", "ck_heat_volts"],
            capture_output=True,
            text=True
        )
        return result.stdout if result.returncode == 0 else result.stderr
    except Exception as e:
        logging.error(f"Error running ck_ command: {e}")
        return f"Error running ck_ command: {e}"

def read_and_concatenate_json_files(directory):
    """Read and concatenate all JSON files in the given directory."""
    concatenated_json = {}
    try:
        for filename in os.listdir(directory):
            if filename.endswith(".json"):
                filepath = os.path.join(directory, filename)
                with open(filepath, "r") as f:
                    data = json.load(f)
                    concatenated_json.update(data)  # Merge the JSON contents
        return json.dumps(concatenated_json, indent=4)  # Pretty-print JSON
    except Exception as e:
        logging.error(f"Error reading JSON files in {directory}: {e}")
        return f"Error reading JSON files in {directory}: {e}"

def decode_path(path):
    """
    Decode escaped octal characters in paths like \040 (space)
    Used to convert paths from /proc/mounts format to actual filesystem paths
    """
    # Replace escaped octal characters (like \040 for space)
    result = ''
    i = 0
    while i < len(path):
        if path[i:i+1] == '\\' and i+4 <= len(path) and path[i+1:i+4].isdigit():
            # Convert octal to character
            char_code = int(path[i+1:i+4], 8)
            result += chr(char_code)
            i += 4
        else:
            result += path[i]
            i += 1
    return result

def write_to_usb(mount_point, ip_address, fabmo_status, fabmo_updater_status, heat_volts_status, json_content):
    """Write the status log file and HTML access file to the USB drive."""
    try:
        # Decode the mount point to handle escaped characters like \040 for space
        real_mount_point = decode_path(mount_point)
        
        # Create paths for our files
        log_file = os.path.join(real_mount_point, "##-FABMO-##.log")
        html_file = os.path.join(real_mount_point, "##-accessSHOPBOT-##.html")
        support_contact_file = os.path.join(os.path.dirname(__file__), "fabmo_support_contact.txt")
        
        # Read support contact information
        support_contact_info = ""
        if os.path.exists(support_contact_file):
            try:
                with open(support_contact_file, "r") as f:
                    support_contact_info = f.read()
            except Exception as e:
                logging.error(f"Error reading support contact file: {e}")
                support_contact_info = "Support contact information not available."
        else:
            support_contact_info = "Support contact information file not found."
        
        # Ensure the mount point exists
        if not os.path.exists(real_mount_point):
            logging.error(f"Mount point does not exist: {real_mount_point} (from {mount_point})")
            print(f"Mount point does not exist: {real_mount_point} (from {mount_point})")
            return

        # Try to write the log file
        logging.info(f"Attempting to write log file to: {real_mount_point}")
        print(f"Attempting to write log file to: {real_mount_point}")
        
        with open(log_file, "w") as log:
            log.write("=== FABMO IP (enter in your browser) ===\n")
            log.write(f"Tool's IP Address: {ip_address}\n\n")
            log.write("=== Support Contact Information ===\n")
            log.write(f"{support_contact_info}\n\n")
            log.write("=== FabMo Status ===\n")
            log.write(f"{fabmo_status}\n\n")
            log.write("=== FabMo-Updater Status ===\n")
            log.write(f"{fabmo_updater_status}\n\n")
            log.write("=== heat_volts Status ===\n")
            log.write(f"{heat_volts_status}\n\n")
            log.write("=== JSON File Contents ===\n")
            log.write(f"{json_content}\n")
            log.flush()  # Flush buffer
            os.fsync(log.fileno())  # Force write to disk
        
        logging.info(f"Log file '{log_file}' updated successfully.")
        print(f"Log file '{log_file}' updated successfully.")
        
        # Create HTML file with clickable link
        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Access Your ShopBot</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            text-align: center;
        }}
        h1 {{
            color: #2c3e50;
        }}
        .access-link {{
            display: inline-block;
            background-color: #3498db;
            color: white;
            padding: 15px 25px;
            text-decoration: none;
            border-radius: 5px;
            font-size: 18px;
            margin: 20px 0;
            transition: background-color 0.3s;
        }}
        .access-link:hover {{
            background-color: #2980b9;
        }}
        .explanation {{
            background-color: #f9f9f9;
            border-left: 4px solid #3498db;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
        }}
    </style>
</head>
<body>
    <h1>ShopBot CNC Access</h1>
    
    <a href="http://{ip_address}" class="access-link">Click to go to Your ShopBot</a>
    
    <div class="explanation">
        <p>This link will open FabMo in your web browser to access your ShopBot CNC machine. 
        FabMo provides a user-friendly interface for operating your tool and managing files, 
        while its on-the-tool software is a powerful real-time motion system for running jobs, and fast, smooth machining.</p>
        
        <p>Make sure your computer is connected to the same network as the ShopBot for this link to work properly. FabMo's initial
        default logon --    (User:) admin     (Passkey:) go2fabmo   (both lower case)</p>
    </div>
    
    <p><small>Generated: {time.strftime("%Y-%m-%d %H:%M:%S")}</small></p>
</body>
</html>
"""
        
        try:
            with open(html_file, "w") as f:
                f.write(html_content)
                f.flush()
                os.fsync(f.fileno())
            logging.info(f"HTML access file created successfully at {html_file}")
            print(f"HTML access file created successfully at {html_file}")
        except Exception as e:
            logging.error(f"Error creating HTML access file: {e}")
            print(f"Error creating HTML access file: {e}")
        
        logging.info(f"Successfully wrote files to USB at decoded path: {real_mount_point}")
    except Exception as e:
        logging.error(f"Error writing to USB drive: {e}")
        print(f"Error writing to USB drive: {e}")

def monitor_usb(json_directory):
    """Monitor for USB drive insertion and continuously update log file."""
    mounted_drives = set()

    while True:
        # List all mounted devices
        with open("/proc/mounts", "r") as f:
            lines = f.readlines()

        # Extract mount points - important: keep them exactly as they appear in /proc/mounts
        current_drives = set()
        for line in lines:
            if "/media/" in line or "/mnt/" in line:
                parts = line.split()
                if len(parts) >= 2:
                    # Use the mount point directly, without modifications
                    current_drives.add(parts[1])
        
        # Detect mounted drives and update them
        active_drives = current_drives & mounted_drives
        for drive in active_drives:
            logging.info(f"Updating log on USB drive: {drive}")
            print(f"Updating log on USB drive: {drive}")
            ip_address = get_local_ip()
            fabmo_status = get_fabmo_status()
            fabmo_updater_status = get_fabmo_updater_status()
            heat_volts_status = get_heat_volts_status()
            json_content = read_and_concatenate_json_files(json_directory)
            write_to_usb(drive, ip_address, fabmo_status, fabmo_updater_status, heat_volts_status, json_content)

        # Detect newly inserted drives
        new_drives = current_drives - mounted_drives
        if new_drives:
            for drive in new_drives:
                logging.info(f"USB drive detected: {drive}")
                print(f"USB drive detected: {drive}")
                ip_address = get_local_ip()
                fabmo_status = get_fabmo_status()
                fabmo_updater_status = get_fabmo_updater_status()
                heat_volts_status = get_heat_volts_status()
                json_content = read_and_concatenate_json_files(json_directory)
                write_to_usb(drive, ip_address, fabmo_status, fabmo_updater_status, heat_volts_status, json_content)
                mounted_drives.add(drive)

        # Detect removed drives
        removed_drives = mounted_drives - current_drives
        if removed_drives:
            for drive in removed_drives:
                logging.info(f"USB drive removed: {drive}")
                mounted_drives.remove(drive)

        # Wait for 20 seconds before updating again
        time.sleep(20)

def toggle_logging(enable=True):
    """Enable or disable logging to a server file."""
    logger = logging.getLogger()
    if enable:
        # Check if a file handler already exists
        if not any(isinstance(handler, logging.FileHandler) for handler in logger.handlers):
            file_handler = logging.FileHandler("/var/log/usb_logger.log")
            file_handler.setLevel(logging.INFO)
            file_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
            logger.addHandler(file_handler)
            print("Logging enabled.")
    else:
        # Remove all file handlers
        logger.handlers = [handler for handler in logger.handlers if not isinstance(handler, logging.FileHandler)]
        print("Logging disabled.")

if __name__ == "__main__":
    # Directory containing JSON files
    json_directory = "/opt/fabmo/config"

    # Disable logging for normal operations (=False)
    toggle_logging(enable=False)

    if not os.path.exists(json_directory):
        logging.error(f"JSON directory '{json_directory}' not found. Please provide a valid directory.")
        print(f"JSON directory '{json_directory}' not found. Please provide a valid directory.")
    else:
        logging.info("Monitoring for USB drive insertion and updating logs...")
        print("Monitoring for USB drive insertion and updating logs...")
        try:
            monitor_usb(json_directory)
        except KeyboardInterrupt:
            logging.info("USB logger daemon stopped.")
            print("USB logger daemon stopped.")
        except Exception as e:
            logging.error(f"Unexpected error: {e}")
            print(f"Unexpected error: {e}")