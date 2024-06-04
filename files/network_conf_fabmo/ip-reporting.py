#!/usr/bin/python3

import tkinter as tk
import subprocess
import syslog
import time
import json

# Monitor the tool's connections every ~5s (depends on wlan rejection) -- 
#     If we get a new -connection/interface- of a higher priority than current ( with: eth > wifi > ap )
#       then> 1) change the title of the display window
#             2) change the displayed IP as it becomes available
#             3) change the ssid name of the AP display (wlan0_ap) to provide info to the user's device
#             4) restart hostapd (and anything else required) to effect and cleanup the name change

syslog.syslog('###=> Launching IP Address Display App ... (in 10sec)')
time.sleep(6)  # Wait for 6 seconds for network to stabilize before starting; was 10s

#-------------------------------------------Initialize wifi/AP at full power
cmd = "sudo /sbin/iwconfig wlan0 power off"
subprocess.run(cmd, stdout=subprocess.PIPE, text=True, shell=True)
cmd = "sudo /sbin/iw dev wlan0_ap set power_save off"
subprocess.run(cmd, stdout=subprocess.PIPE, text=True, shell=True)

class NetworkConfigApp:
    def __init__(self):
        self.config_value = ""
        self.name = "FabMo-# AP@:192.168.42.1"
        self.tool_name = "FabMo-####" 
        self.last_name = ""
        self.last_ssid = ""
        self.last_ip_address_wifi = ""
        self.name_file = "/opt/fabmo/config/engine.json"
        self.initialize_ui()
        print("###===> Starting IP Address Display App ...")
        self.update_ip_display()           # START

    # ------------------------------------------------------------- Setup Tkinter UI 
    def initialize_ui(self):
        self.root = tk.Tk()

        # Set window temporarily on top
        self.root.focus_set()
        self.root.attributes("-topmost", True)
        frame = tk.Frame(self.root)
        frame.pack(padx=10, pady=10)
        self.ip_var = tk.StringVar()
        ip_label = tk.Label(frame, textvariable=self.ip_var, font=("Arial", 18))
        ip_label.pack(pady=5)

        # Set the window position to top right corner
        screen_width = self.root.winfo_screenwidth()
        window_width = 500
        window_height = 220
        x_position = screen_width - window_width - 50
        self.root.geometry(f"{window_width}x{window_height}+{x_position}+100")         

        # Create the label explaining the use of the IP address
        mode_label1 = tk.Label(frame, text="Enter this IP address in your browser\nto access ShopBot.", font=("Arial", 16))
        mode_label1.pack(pady=5)

        mode_label2 = tk.Label(frame, text="- When switching wired connections wait 10 sec\n after disengaging before connecting new cable.", font=("Arial", 12))
        mode_label2.pack(pady=5)

        mode_label3 = tk.Label(frame, text="(Accessing tool from the small screen is easiest using a mouse.)", font=("Arial", 12))
        mode_label3.pack(pady=5)

    def check_dhcp_server(self, interface):
        try:
            result = subprocess.run(['sudo', 'dhclient', '-v', interface], check=True, text=True, capture_output=True)
            if "DHCPACK" in result.stderr:
                print("DHCP server detected.")
                return True
            else:
                print("No DHCP server detected.")
                subprocess.run(['sudo', 'dhclient', '-r', interface], check=True)
                return False
        except subprocess.CalledProcessError as e:
            print(f"dhclient encountered an error: {e}")
            return False
        except subprocess.TimeoutExpired as e:
            print(f"dhclient command timed out: {e}")
            return False

    def read_tool_name(self):
        try:
            with open(self.name_file, "r") as f:
                data = json.load(f)
                self.tool_name = data.get('name', 'no-name').strip()
                if len(self.tool_name) > 12:
                    self.tool_name = self.tool_name[:12]
                return self.tool_name
        except FileNotFoundError:
            print("###=== X Trouble with reading tool_name!")
            syslog.syslog("###=== X Trouble with reading tool_name!") 
            return "no-name"
    
    def get_ip_address(self, interface='wlan0', retries=2, delay=3):  # was 3 & 4
        cmd = f"nmcli -t -f IP4.ADDRESS dev show {interface} | grep IP4.ADDRESS | cut -d: -f2"
        for _ in range(retries):
            try:
                ip_address = subprocess.check_output(cmd, shell=True).decode("utf-8").strip()
                ip_address = ip_address.split("/")[0]  # remove /24
                if ip_address:
                    print(f"    => ip-check: {interface}  {ip_address}") 
                    return ip_address
            except subprocess.CalledProcessError:
                pass
            time.sleep(delay)
        print(f"    => failed to find ip - {interface}")
        syslog.syslog(f"    => failed to find ip - {interface}")
        return "-waiting-"

    def is_eth0_active(self):
        cmd = "nmcli -t -f DEVICE,STATE dev status | grep eth0 | grep -q connected"
        result = subprocess.run(cmd, stdout=subprocess.PIPE, text=True, shell=True)
        return result.returncode == 0

    def get_wlan0_ssid(self):
        cmd = "nmcli -t -f GENERAL.CONNECTION dev show wlan0 | cut -d: -f2"
        result = subprocess.run(cmd, stdout=subprocess.PIPE, text=True, check=True, shell=True)
        return result.stdout.strip()

    def write_wifi_info_to_json(self, wifi_info):
        file_path = "/etc/network_conf_fabmo/recent_wifi.json"
        try:
            with open(file_path, 'w') as json_file:
                json.dump(wifi_info, json_file)
            print(f"WiFi information written to {file_path}")
            syslog.syslog(f"WiFi information written to {file_path}")
        except Exception as e:
            print(f"Failed to write WiFi information to {file_path}: {e}")
            syslog.syslog(f"Failed to write WiFi information to {file_path}: {e }")

    def change_ssid(self, new_ssid):
        ap_connection_name = "wlan0_ap"  # Replace with your actual connection name
        cmd_modify = f"nmcli con modify {ap_connection_name} 802-11-wireless.ssid {new_ssid}"
        cmd_down = f"nmcli con down {ap_connection_name}"
        cmd_up = f"nmcli con up {ap_connection_name}"
        try:
            subprocess.run(cmd_modify, shell=True, check=True)
            subprocess.run(cmd_down, shell=True, check=True)
            subprocess.run(cmd_up, shell=True, check=True)
            syslog.syslog(f"###=> Changing AP Name; NewName={new_ssid}")
            print(f"###=> Changing AP Name; NewName={new_ssid}")
        except subprocess.CalledProcessError as e:
            syslog.syslog(f"###=> Error changing AP Name: {e}")
            print(f"###=> Error changing AP Name: {e}")

    # -------------------------------------------------------------  Main Loop
    def update_ip_display(self):
        syslog.syslog("###=> IP Udate Sequence Starting ...")
        print("###=> IP Udate Sequence Starting ...")

        self.tool_name = self.read_tool_name()
        ip_address = self.get_ip_address("eth0")
        ip_address_wifi = self.get_ip_address("wlan0")
        ip_address_wlan0_ap = self.get_ip_address("wlan0_ap")

        ssid = self.get_wlan0_ssid()
        wifi_info = {
            "ip_address": ip_address_wifi,
            "ssid": ssid if ssid else ""
        }
        
        if ssid != self.last_ssid or ip_address_wifi != self.last_ip_address_wifi:    
            self.write_wifi_info_to_json(wifi_info)
            self.last_ip_address_wifi = ip_address_wifi
            self.last_ssid = ssid
            
        eth = self.is_eth0_active()
        syslog.syslog(f"###=> Checking eth0 = {eth}")
        print(f"###=> Checking eth0 = {eth}")
        syslog.syslog(f"###=> ip_address eth0: {ip_address}")
        print(f"###=> ip_address eth0: {ip_address}")
        syslog.syslog(f"###=> wlan0ssid: {ssid}")
        print(f"###=> wlan0ssid: {ssid}")
        syslog.syslog(f"###=> ip_address_wifi: {ip_address_wifi}")
        print(f"###=> ip_address_wifi: {ip_address_wifi}")
        syslog.syslog(f"###=> ip_address_wlan0_ap: {ip_address_wlan0_ap}")
        print(f"###=> ip_address_wlan0_ap: {ip_address_wlan0_ap}")

        if eth:
            if ip_address.endswith(".44.1"):
                self.root.title("- DIRECT COMPUTER CONNECTION - ")
                self.name = self.tool_name + "-PC@192.168.44.1"
                self.ip_var.set("192.168.44.1")
            else:
                self.root.title("- LOCAL NETWORK (LAN) CONNECTION -")
                self.name = self.tool_name + "-LAN@" + ip_address
                self.ip_var.set(f"{ip_address}")
        elif ssid:
            str_title = "- " + ssid + "- NETWORK WiFi CONNECTION -"
            self.root.title(str_title)
            self.name = self.tool_name + "-wifi@" + ip_address_wifi
            self.ip_var.set(f"{ip_address_wifi}")
        else:
            if ip_address_wlan0_ap.endswith(".42.1"):
                self.root.title("- AP Mode CONNECTION - ")
                self.name = self.tool_name + "-AP@192.168.42.1"
                self.ip_var.set("192.168.42.1")
            else:
                self.root.title("- UNKNOWN NETWORK IP - ")
                self.name = "UNKNOWN@-"
                self.ip_var.set("no-identified-network-ip")

        if self.last_name != self.name:
            self.change_ssid(self.name)
            self.last_name = self.name

        syslog.syslog(f"###=> name={self.name} last_name={self.last_name}")
        syslog.syslog(f"      ip={ip_address}")
        print(f"###=> name={self.name} last_name={self.last_name}")
        print(f"      ip={ip_address}")

        self.root.after(5000, self.update_ip_display)  # Schedule next IP update

    def run(self):
        self.root.mainloop()

if __name__ == "__main__":
    app = NetworkConfigApp()
    app.run()
