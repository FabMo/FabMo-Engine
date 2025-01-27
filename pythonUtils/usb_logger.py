import os # For bash command execution
import json # For json handleing
import socket # For querrying the local ip adress
import subprocess # 
import logging
import time # For sequencing updates
import shutil  # For file copy operations
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

def write_to_usb(mount_point, ip_address, fabmo_status, json_content):
    """Write the log file and support contact file to the USB drive."""
    # Unescape the mount point to handle paths with spaces
    unescaped_mount_point = urllib.parse.unquote(mount_point)
    log_file = os.path.join(unescaped_mount_point, "FABMO_STATUS.log")
    support_contact_file = os.path.join(os.path.dirname(__file__), "fabmo_support_contact.txt")
    destination_support_contact_file = os.path.join(unescaped_mount_point, "fabmo_support_contact.txt")
    
    try:
        # Write the log file
        logging.info(f"Attempting to write log file to: {unescaped_mount_point}")
        print(f"Attempting to write log file to: {unescaped_mount_point}")
        with open(log_file, "w") as log:
            log.write("=== FABMO STATUS LOG ===\n")
            log.write(f"Local IP Address: {ip_address}\n\n")
            log.write("=== Fabmo Status ===\n")
            log.write(f"{fabmo_status}\n\n")
            log.write("=== JSON File Contents ===\n")
            log.write(f"{json_content}\n")
            log.flush()  # Flush buffer
            os.fsync(log.fileno())  # Force write to disk
        logging.info(f"Log file '{log_file}' updated successfully.")
        print(f"Log file '{log_file}' updated successfully.")
        
        # Copy the support contact file to the USB drive
        if os.path.exists(support_contact_file):
            shutil.copy(support_contact_file, destination_support_contact_file)
            logging.info(f"Support contact file copied to: {destination_support_contact_file}")
        else:
            logging.warning(f"Support contact file not found at: {support_contact_file}")
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

        current_drives = {
            line.split()[1] for line in lines if "/media/" in line or "/mnt/" in line
        }

        # Detect mounted drives
        active_drives = current_drives & mounted_drives
        for drive in active_drives:
            logging.info(f"Updating log on USB drive: {drive}")
            print(f"Updating log on USB drive: {drive}")
            ip_address = get_local_ip()
            fabmo_status = get_fabmo_status()
            json_content = read_and_concatenate_json_files(json_directory)
            write_to_usb(drive, ip_address, fabmo_status, json_content)

        # Detect newly inserted drives
        new_drives = current_drives - mounted_drives
        if new_drives:
            for drive in new_drives:
                logging.info(f"USB drive detected: {drive} (Path: {drive})")
                print(f"USB drive detected: {drive} (Path: {drive})")
                mounted_drives.add(drive)

        # Detect removed drives
        removed_drives = mounted_drives - current_drives
        if removed_drives:
            for drive in removed_drives:
                logging.info(f"USB drive removed: {drive}")
                mounted_drives.remove(drive)

        # Wait for 10 seconds before updating again
        time.sleep(10)

if __name__ == "__main__":
    # Directory containing JSON files
    json_directory = "/opt/fabmo/config"

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
