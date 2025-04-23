/**
 * usb-browser.js
 * A standalone, reusable module for the USB File Browser
 * No jQuery dependency - uses Fetch API and native DOM methods
 */

(function (root, factory) {
    /* CommonJS */
    if (typeof module == "object" && module.exports) module.exports = factory();
    /* AMD module */ else if (typeof define == "function" && define.amd) define(factory);
    /* Browser global */ else root.USBBrowser = factory();
})(this, function () {
    "use strict";

    /**
     * USB Browser class
     * Manages a UI for browsing and selecting files from USB devices
     */
    var USBBrowser = function () {
        this.modalElement = null;
        this.currentPath = null;
        this.callback = null;
        this.lastUsedPath = null;
    };

    /**
     * Create and append the modal HTML to the document
     */
    USBBrowser.prototype.createModal = function () {
        // Check if modal already exists in the DOM
        if (document.getElementById("usb-file-browser-modal")) {
            return;
        }

        var modalHtml = `
        <div id="usb-file-browser-modal" class="usb-modal" style="display: none;">
            <div class="usb-modal-content">
                <div class="usb-modal-header">
                    <h3>USB Devices</h3>
                    <div class="usb-header-actions">
                        <button id="usb-refresh-button" class="usb-refresh-button" title="Refresh devices">
                            <i class="fa fa-refresh"></i>
                        </button>
                        <span class="usb-close">&times;</span>
                    </div>
                </div>
                <div class="usb-modal-body">
                    <div class="usb-devices-section">
                        <div id="usb-devices-list" class="usb-devices-list">
                            <p>No USB devices detected.</p>
                        </div>
                            <button id="usb-computer-button" class="usb-computer-button" title="Select from Computer instead">Computer</button>
                        </div>
                    <div class="usb-files-section">
                        <div class="usb-path-bar">
                            <span id="usb-current-path">No device selected</span>
                        </div>
                        <div id="usb-file-list" class="usb-file-list">
                            <p>Select a USB device to browse files.</p>
                        </div>
                        <div class="usb-file-filter">
                                <label for="file-filter-select" style="margin-top: -15px;">Filter by type:</label>                            <select id="file-filter-select">
                                <option value=".sbp">.sbp (ShopBot format files)</option>
                                <option value=".nc, .gcode, .tap, .cnc">.nc, .gcode, .tap, .cnc (gcode format files)</option>
                                <option value="all">All</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="usb-modal-footer">
                    <button id="usb-cancel-button" class="usb-cancel-button">Cancel</button>
                    <button id="usb-select-button" class="usb-select-button" disabled>Select File</button>
                </div>
            </div>
        </div>
        `;

        var modalStyle = `
            <style id="usb-browser-styles">
                .usb-modal {
                    position: fixed;
                    z-index: 9999;
                    left: 0;
                    top: 0;
                    width: 100%;
                    height: 100%;
                    overflow: auto;
                    background-color: rgba(0,0,0,0.4);
                }
                .usb-modal-content {
                    position: fixed; /* Ensure the modal content is fixed relative to the viewport */
                    top: -80px;
                    left: 60px;
                    background-color: #fefefe;
                    margin: 10% auto;
                    padding: 0;
                    border: 1px solid #888;
                    width: 80%;
                    max-width: 800px;
                    border-radius: 5px;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
                }
                .usb-modal-header {
                    display: flex;
                    justify-content: space-between;
                    height: 50px;
                    align-items: center;
                    background-color: #f5f5f5;
                    padding: 0px 15px;
                    border-bottom: 1px solid #ddd;
                    border-radius: 5px 5px 0 0;
                    color: #666; /* Set dark gray color for all text and icons */
                    font-size: 16px;
                    font-weight: bold;
                }
                .usb-header-actions {
                    display: flex;
                    align-items: center;
                    gap: 15px;
                    color: #666; /* Set dark gray color for icons */
                }
                .usb-modal-header h3 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: bold;
                    color: #666; /* Set dark gray color for the title */
                }
                .usb-modal-body {
                    padding: 15px;
                }
                .usb-modal-footer {
                    border-top: 1px solid #ddd;
                    padding: 10px 15px;
                    display: flex;
                    justify-content: flex-end;
                    gap: 10px;
                    border-radius: 0 0 5px 5px;
                }
                .usb-close {
                    color: #666; /* Set dark gray color for the close button */
                    font-size: 28px;
                    font-weight: bold;
                    cursor: pointer;
                    text-transform: uppercase; /* Make the "x" uppercase */
                }
                .usb-close:hover {
                    color: black; /* Change to black on hover */
                }
                .usb-devices-section {
                    display: flex; /* Use flexbox for layout */
                    align-items: center; /* Align items vertically */
                    gap: 10px; /* Add spacing between items */
                    margin-bottom: 15px;
                }
                .usb-devices-list {
                    display: flex; /* Ensure USB device buttons are inline */
                    gap: 10px; /* Add spacing between USB device buttons */
                    flex-wrap: wrap; /* Allow wrapping if there are too many buttons */
                }
                .usb-device-item {
                    padding: 8px 12px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                }
                .usb-device-item:hover {
                    background-color: #f0f0f0;
                }
                .usb-device-item.selected {
                    background-color: #e3f2fd;
                    border-color: #2196F3;
                }
                .usb-computer-button {
                    left: 30px;
                    top: 10px;
                    background-color:rgb(121,115,165);
                    border: 1px rgb(48, 44, 80);
                    color: white;
                    padding: 8px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                    margin-left: 10px; /* Add further spacing from the USB drive buttons */
                    transition: background-color 0.2s, border-color 0.2s;
                }
                .usb-computer-button:hover {
                    background-color: rgb(67, 62, 111);
                    border-color: rgb(54, 50, 89);
                }
                .usb-computer-button:focus {
                    outline: none;
                    box-shadow: 0 0 4px rgb(54, 50, 89, .8); /* Add a subtle glow on focus */
                }
                .usb-path-bar {
                    background-color: #f5f5f5;
                    padding: 8px 12px;
                    border-radius: 4px;
                    margin-bottom: 8px;
                    overflow: auto;
                    white-space: nowrap;
                    font-size: 13px;
                    border: 1px solid #ddd;
                }
                .usb-file-list {
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    max-height: 300px;
                    overflow-y: auto;
                }
                .usb-file-item {
                    padding: 8px 12px;
                    border-bottom: 1px solid #eee;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                }
                .usb-file-item:last-child {
                    border-bottom: none;
                }
                .usb-file-item:hover {
                    background-color: #f5f5f5;
                }
                .usb-file-item.selected {
                    background-color: #e3f2fd;
                }
                .usb-file-icon {
                    margin-right: 10px;
                }
                .usb-file-name {
                    flex-grow: 1;
                }
                .usb-file-size {
                    color: #777;
                    font-size: 0.8em;
                }
                .usb-refresh-button {
                    background: none;
                    border: none;
                    cursor: pointer;
                    color: #666; /* Set dark gray color for the refresh icon */
                    font-size: 16px;
                    margin-top: 18px;
                    padding-right: 15px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    outline: none; /* Remove default focus outline */
                }
                .usb-refresh-button:hover {
                    color: #111;
                    background: none; /* Ensure no background color change */
                    border: none;
                    box-shadow: none; 
                }
                .usb-refresh-button:focus {
                    outline: none; /* Remove default focus outline */
                    background: none; /* Ensure no background color change */
                    color: #666; /* Keep the same color as the default state */
                }
                .usb-file-filter {
                    margin-top: 10px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 14px;
                }
                #file-filter-select {
                    width: 85%;    
                    padding: 5px;
                    font-size: 14px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                }                    
                .usb-cancel-button, 
                .usb-select-button {
                    padding: 6px 14px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                }
                .usb-cancel-button {
                    background-color: #f0f0f0;
                    border: 1px solid #ddd;
                }
                .usb-select-button {
                    background-color: #2196F3;
                    border: 1px solid #1976D2;
                    color: white;
                }
                .usb-select-button:disabled {
                    background-color: #9e9e9e;
                    border: 1px solid #757575;
                    cursor: not-allowed;
                }
                .usb-loading {
                    text-align: center;
                    padding: 15px;
                }
            </style>
        `;

        // Append modal HTML to the document body
        var modalContainer = document.createElement("div");
        modalContainer.innerHTML = modalHtml;
        document.body.appendChild(modalContainer);

        // Append styles to the document head
        if (!document.getElementById("usb-browser-styles")) {
            var styleElement = document.createElement("style");
            styleElement.id = "usb-browser-styles";
            styleElement.innerHTML = modalStyle;
            document.head.appendChild(styleElement);
        }

        this.modalElement = document.getElementById("usb-file-browser-modal");
        this.setupEventListeners();
    };

    /**
     * Set up event listeners for the modal
     */
    USBBrowser.prototype.setupEventListeners = function () {
        var self = this;

        // Close button
        var closeBtn = document.querySelector("#usb-file-browser-modal .usb-close");
        closeBtn.addEventListener("click", function () {
            self.hide();
        });

        // Cancel button
        var cancelBtn = document.getElementById("usb-cancel-button");
        cancelBtn.addEventListener("click", function () {
            self.hide();
        });

        // Computer button
        var computerBtn = document.getElementById("usb-computer-button");
        computerBtn.addEventListener("click", function () {
            self.hide(); // Close the modal

            // Emit a custom event to notify job_manager.js
            var event = new CustomEvent("usbFileSelection", {
                bubbles: true,
                detail: {
                    source: "usb-browser",
                },
            });
            window.top.document.dispatchEvent(event);
        });

        // Select button
        var selectBtn = document.getElementById("usb-select-button");
        selectBtn.addEventListener("click", function () {
            self.selectCurrentFile();
        });

        // Refresh button
        var refreshBtn = document.getElementById("usb-refresh-button");
        refreshBtn.addEventListener("click", function () {
            self.loadUSBDevices();
        });

        // Close when clicking outside the modal
        window.addEventListener("click", function (event) {
            if (event.target === self.modalElement) {
                self.hide();
            }
        });
    };

    /**
     * Show the USB browser
     * @param {Function} callback - Called with the selected file path or null if canceled
     */
    USBBrowser.prototype.show = function (callback) {
        this.createModal();

        document.getElementById("usb-current-path").textContent = "No device selected";
        document.getElementById("usb-file-list").innerHTML = "<p>Select a USB device to browse files.</p>";
        document.getElementById("usb-select-button").disabled = true;

        this.currentPath = null;
        this.callback = callback;
        this.modalElement.style.display = "block";

        // Try to load the last used path from localStorage
        this.lastUsedPath = this.getLastUsedUSBPath();

        this.loadUSBDevices();
    };

    /**
     * Hide the USB browser
     */
    USBBrowser.prototype.hide = function () {
        if (this.modalElement) {
            this.modalElement.style.display = "none";
        }

        if (this.callback) {
            this.callback(null, { cancelled: true });
            this.callback = null;
        }
    };

    /**
     * Load USB devices using Fetch API
     */
    USBBrowser.prototype.loadUSBDevices = function () {
        var self = this;
        var devicesList = document.getElementById("usb-devices-list");

        devicesList.innerHTML = '<p class="usb-loading">Loading devices...</p>';

        // Reset file list and path display
        var fileList = document.getElementById("usb-file-list");
        var pathDisplay = document.getElementById("usb-current-path");

        // Use Fetch API
        fetch("/usb/devices")
            .then(function (response) {
                return response.json();
            })
            .then(function (response) {
                if (response.status === "success" && response.data.devices) {
                    var devices = response.data.devices;

                    if (devices.length === 0) {
                        devicesList.innerHTML =
                            "<p>No USB devices detected. Please connect a USB drive and click Refresh.</p>";
                        fileList.innerHTML = "<p>Select a USB device to browse files.</p>";
                        pathDisplay.textContent = "No device selected";
                        document.getElementById("usb-select-button").disabled = true;
                        self.currentPath = null;
                        return;
                    }

                    var html = "";
                    devices.forEach(function (device) {
                        html += '<div class="usb-device-item" data-path="' + device.path + '">';
                        html += '<div class="usb-device-name">' + device.name + "</div>";
                        html += "</div>";
                    });

                    devicesList.innerHTML = html;

                    // Add click handlers to device items
                    var deviceItems = document.querySelectorAll(".usb-device-item");
                    deviceItems.forEach(function (item) {
                        item.addEventListener("click", function () {
                            // Update selected device
                            deviceItems.forEach(function (el) {
                                el.classList.remove("selected");
                            });
                            item.classList.add("selected");

                            // Load directory contents
                            var path = item.getAttribute("data-path");
                            self.loadUSBDirectory(path);
                        });
                    });

                    // Auto-select the first drive or the last used path if available
                    var deviceToSelect = null;
                    var lastUsedUSBPath = self.getLastUsedUSBPath();

                    // First, try to find and select the last used path
                    if (lastUsedUSBPath) {
                        for (var i = 0; i < devices.length; i++) {
                            if (lastUsedUSBPath.startsWith(devices[i].path)) {
                                deviceToSelect = deviceItems[i];
                                break;
                            }
                        }
                    }

                    // If last path not found or not set, select the first device
                    if (!deviceToSelect && deviceItems.length > 0) {
                        deviceToSelect = deviceItems[0];
                    }

                    // Trigger click on the selected device to load its contents
                    if (deviceToSelect) {
                        deviceToSelect.classList.add("selected");
                        var path = deviceToSelect.getAttribute("data-path");

                        // If we have a remembered path that's deeper than the device root
                        // and it belongs to the selected device, use that
                        if (lastUsedUSBPath && lastUsedUSBPath.startsWith(path) && lastUsedUSBPath !== path) {
                            self.loadUSBDirectory(lastUsedUSBPath);
                        } else {
                            self.loadUSBDirectory(path);
                        }
                    }
                } else {
                    devicesList.innerHTML = "<p>Error loading USB devices. Please try again.</p>";
                    fileList.innerHTML = "<p>Select a USB device to browse files.</p>";
                    pathDisplay.textContent = "No device selected";
                    document.getElementById("usb-select-button").disabled = true;
                }
            })
            .catch(function (err) {
                console.error("Error loading USB devices:", err);
                devicesList.innerHTML = "<p>Error loading USB devices. Please try again.</p>";
                fileList.innerHTML = "<p>Select a USB device to browse files.</p>";
                pathDisplay.textContent = "No device selected";
                document.getElementById("usb-select-button").disabled = true;
            });
    };

    /**
     * Load USB directory using Fetch API
     * @param {string} path - Directory path to load
     */
    USBBrowser.prototype.loadUSBDirectory = function (path) {
        var self = this;
        this.currentPath = path;

        // Save this path as the last used path
        this.saveLastUsedUSBPath(path);

        // Update path display
        document.getElementById("usb-current-path").textContent = path;

        // Show loading
        var fileList = document.getElementById("usb-file-list");
        fileList.innerHTML = '<p class="usb-loading">Loading files...</p>';

        // Get the selected file filter
        var fileFilter = document.getElementById("file-filter-select").value;

        // Use Fetch API
        fetch("/usb/dir?path=" + encodeURIComponent(path))
            .then(function (response) {
                return response.json();
            })
            .then(function (response) {
                if (response.status === "success" && response.data.contents) {
                    var contents = response.data.contents;

                    if (contents.length === 0) {
                        fileList.innerHTML = "<p>This directory is empty.</p>";
                        return;
                    }

                    var html = "";

                    // Add parent directory option if not at root
                    if (path !== "/media/pi" && path !== "/media/root" && path !== "/mnt") {
                        var parentPath = path.split("/").slice(0, -1).join("/") || "/";

                        html += '<div class="usb-file-item" data-path="' + parentPath + '" data-is-dir="true">';
                        html += '<span class="usb-file-icon">📁</span>';
                        html += '<span class="usb-file-name">..</span>';
                        html += "</div>";
                    }

                    // Add directories first
                    contents
                        .filter(function (file) {
                            return file.isDirectory;
                        })
                        .forEach(function (dir) {
                            html += '<div class="usb-file-item" data-path="' + dir.path + '" data-is-dir="true">';
                            html += '<span class="usb-file-icon">📁</span>';
                            html += '<span class="usb-file-name">' + dir.name + "</span>";
                            html += "</div>";
                        });

                    // Then add files based on the selected filter
                    contents
                        .filter(function (file) {
                            if (file.isDirectory) return false;
                            if (fileFilter === "all") return true;
                            return file.name.endsWith(fileFilter);
                        })
                        .forEach(function (file) {
                            html += '<div class="usb-file-item" data-path="' + file.path + '" data-is-dir="false">';
                            html += '<span class="usb-file-icon">📄</span>';
                            html += '<span class="usb-file-name">' + file.name + "</span>";
                            html += '<span class="usb-file-size">' + self.formatFileSize(file.size) + "</span>";
                            html += "</div>";
                        });

                    fileList.innerHTML = html;

                    // Add click handlers to file items
                    var fileItems = document.querySelectorAll(".usb-file-item");
                    fileItems.forEach(function (item) {
                        item.addEventListener("click", function () {
                            var isDir = item.getAttribute("data-is-dir") === "true";
                            var itemPath = item.getAttribute("data-path");

                            if (isDir) {
                                // Navigate to directory
                                self.loadUSBDirectory(itemPath);
                            } else {
                                // Select file
                                fileItems.forEach(function (el) {
                                    el.classList.remove("selected");
                                });
                                item.classList.add("selected");

                                // Enable select button
                                document.getElementById("usb-select-button").disabled = false;
                            }
                        });

                        // Add double-click handler
                        item.addEventListener("dblclick", function () {
                            var isDir = item.getAttribute("data-is-dir") === "true";
                            var itemPath = item.getAttribute("data-path");

                            if (isDir) {
                                // Navigate to directory
                                self.loadUSBDirectory(itemPath);
                            } else {
                                // Select and submit file
                                self.selectFile(itemPath);
                            }
                        });
                    });
                } else {
                    fileList.innerHTML = "<p>Error loading directory. Please try again.</p>";
                }
            })
            .catch(function (err) {
                console.error("Error loading directory:", err);
                fileList.innerHTML = "<p>Error loading directory. Please try again.</p>";
            });
    };

    /**
     * Select current file
     */
    USBBrowser.prototype.selectCurrentFile = function () {
        var selectedFile = document.querySelector(".usb-file-item.selected");
        if (selectedFile && selectedFile.getAttribute("data-is-dir") === "false") {
            var filePath = selectedFile.getAttribute("data-path");
            this.selectFile(filePath);
        }
    };

    /**
     * Select file
     * @param {string} filePath - Path to the selected file
     */
    USBBrowser.prototype.selectFile = function (filePath) {
        // Update lastUsedUSBPath to the directory containing this file
        var directory = filePath.substring(0, filePath.lastIndexOf("/"));
        if (directory) {
            this.saveLastUsedUSBPath(directory);
        }

        var callback = this.callback;
        this.hide();

        if (callback) {
            callback(null, { filePath: filePath });
        }
    };

    /**
     * Format file size
     * @param {number} bytes - File size in bytes
     * @returns {string} Formatted file size
     */
    USBBrowser.prototype.formatFileSize = function (bytes) {
        if (bytes === 0) return "0 B";
        var k = 1024;
        var sizes = ["B", "KB", "MB", "GB", "TB"];
        var i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    /**
     * Get the last used USB path from localStorage
     * @returns {string|null} Last used path or null
     */
    USBBrowser.prototype.getLastUsedUSBPath = function () {
        return localStorage.getItem("fabmo_last_usb_path");
    };

    /**
     * Save the last used USB path to localStorage
     * @param {string} path - Path to save
     */
    USBBrowser.prototype.saveLastUsedUSBPath = function (path) {
        if (path) {
            localStorage.setItem("fabmo_last_usb_path", path);
        }
    };

    /**
     * Trigger the file input dialog
     */
    USBBrowser.prototype.triggerFileInput = function () {
        var fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.style.display = "none"; // Hide the input element
        document.body.appendChild(fileInput);

        fileInput.addEventListener("change", function (event) {
            var selectedFile = event.target.files[0];
            if (selectedFile) {
                console.log("Selected file:", selectedFile.name);
                // Handle the selected file here (e.g., pass it to a callback)
            }
            document.body.removeChild(fileInput); // Clean up the input element
        });

        fileInput.click(); // Trigger the file input dialog
    };

    // Create a singleton instance
    var instance = null;

    return {
        /**
         * Get the USB browser instance (singleton pattern)
         * @returns {USBBrowser} USB browser instance
         */
        getInstance: function () {
            if (!instance) {
                instance = new USBBrowser();
            }
            return instance;
        },
    };
});
