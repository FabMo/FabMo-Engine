import os
import time
import socket
import subprocess
from PIL import Image, ImageDraw
from ssd1309 import SSD1309
import board
import busio
import psutil

# Function to get the IP address of the device
def get_ip_address():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip_address = s.getsockname()[0]
        s.close()
        return ip_address
    except OSError:
        return "No IP address"

# Function to get the current network name (Ethernet, Wi-Fi, or Access Point)
def get_network_name():
    try:
        network_status = subprocess.check_output("nmcli -t -f TYPE,STATE,CONNECTION dev status", shell=True).decode('utf-8')
        for line in network_status.splitlines():
            if "ethernet:connected" in line:
                return f"Eth: {line.split(':')[-1]}"
            elif "wifi:connected" in line:
                wifi_connection_name = line.split(":")[-1]
                if wifi_connection_name == "wlan0_ap":
                    return f"AP: {get_ap_ssid()}"
                elif wifi_connection_name == "direct connection":
                    return "Direct Connection"
                return f"Wifi: {wifi_connection_name}"
        return "No network connected"
    except subprocess.CalledProcessError:
        return "Unable to retrieve network information"

# Function to get the Wi-Fi SSID when in Access Point mode
def get_ap_ssid():
    try:
        result = subprocess.check_output("iw dev wlan0 info | grep ssid", shell=True).decode('utf-8')
        return result.split(":")[1].strip()
    except subprocess.CalledProcessError:
        return "Unknown SSID"

# Function to get the CPU temperature
def get_cpu_temperature():
    try:
        temp = subprocess.check_output("vcgencmd measure_temp", shell=True).decode("utf-8")
        return temp.split('=')[1].strip()
    except subprocess.CalledProcessError:
        return "N/A"

# Function to check for USB drive insertion
def get_usb_drive():
    for partition in psutil.disk_partitions():
        if 'media' in partition.mountpoint or 'mnt' in partition.mountpoint:
            return partition.mountpoint
    return None

# Function to list files on the USB drive
def list_files_on_usb(mountpoint):
    try:
        return os.listdir(mountpoint)
    except FileNotFoundError:
        return []

# Function to display a list of files on the screen
def display_files(display, files):
    img = Image.new('1', (128, 64), 1)  # Blank screen
    draw = ImageDraw.Draw(img)
    for i, file_name in enumerate(files[:4]):  # Show up to 4 files
        draw.text((0, i * 16), file_name[:16], fill=0)  # Truncate long names
    buffer = list(img.getdata())
    display.display_buffer(buffer)

# Load and prepare the image with text for normal display
def load_inverted_image_with_text(image_path, text_ip, text_network, text_temp):
    img = Image.new('1', (128, 64), 1)
    draw = ImageDraw.Draw(img)
    logo = Image.open(image_path).convert('1').resize((30, 30))
    logo = Image.eval(logo, lambda x: 255 - x)
    img.paste(logo, (64, 0))

    draw.text((0, 0), f"Temp: {text_temp}", fill=0)
    draw.text((0, 28), f"IP: {text_ip}", fill=0)
    draw.text((0, 48), f"{text_network}", fill=0)

    buffer = []
    image_data = list(img.getdata())
    for y in range(0, img.height, 8):
        for x in range(img.width):
            byte = 0
            for bit in range(8):
                if y + bit < img.height:
                    byte |= (0x01 if image_data[(y + bit) * img.width + x] == 0 else 0x00) << bit
            buffer.append(byte)
    return buffer

# Main program
def main():
    i2c = busio.I2C(board.SCL, board.SDA)
    display = SSD1309(i2c)
    display.clear_display(0xFF)

    previous_usb = None

    while True:
        # Check for USB drive
        usb_mount = get_usb_drive()
        if usb_mount and usb_mount != previous_usb:
            files = list_files_on_usb(usb_mount)
            display_files(display, files)
            previous_usb = usb_mount
            time.sleep(5)  # Display files for 5 seconds
        elif not usb_mount:
            previous_usb = None
            # Regular display if no USB detected
            network_name = get_network_name()
            ip_address = "192.168.44.1" if network_name == "Direct Connection" else get_ip_address()
            cpu_temp = get_cpu_temperature()

            image_buffer = load_inverted_image_with_text("FabMo.png", ip_address, network_name, cpu_temp)
            display.display_buffer(image_buffer)
            time.sleep(20)  # Update every 20 seconds

if __name__ == "__main__":
    main()
