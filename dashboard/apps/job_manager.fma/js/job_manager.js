require('./jquery.dragster.js');
require('jquery');
var Foundation = require('../../../static/js/libs/foundation.min.js');
var moment = require('../../../static/js/libs/moment.js');
var Sortable = require('./Sortable.js');
var Fabmo = require('../../../static/js/libs/fabmo.js');
var fabmo = new Fabmo;
// ... there remains lots of old "tour" stuff here, needs to be carefully cleaned
// eg > var cameFromTour = false;

// Current position in the history browser
var historyStart = 0;
var historyCount = 10;
var historyTotal = 0;
// Timer for the running job indicator
var blinkTimer = null;

// The currently running Job ID
var currentJobId = -1;
var currentStatus = {};


$('body').bind('focusin focus', function(e){
    e.preventDefault();
})

function fileUploadProgress(progress) {
  var pg = (progress * 100).toFixed(0) + '%';
  $('.progressbar .bar-fill').width(pg);
  if (progress === 1) {
    setTimeout(function() {
      $('.progressbar').addClass('hide');
      $('.progressbar .bar-fill').width(0);
    }, 200);
  }
}

function setupDropTarget() {
  $('#tabpending').dragster({
    enter: function(devt, evt) {
      $('#tabpending').addClass('hover');
      return false;
    },

    leave: function(devt, evt) {
      $('#tabpending').removeClass('hover');
      return false;
    },
    drop: function(devt, evt) {
      evt.preventDefault();
      try {
        file = evt.originalEvent.dataTransfer.files;
        if (file.length > 0) {
          var file_size = file[0].size;
          $('.progressbar').removeClass('hide');
          fabmo.on('upload_progress', function(progress) {
            fileUploadProgress(progress.value);
          });
          fabmo.submitJob(file, {
            compressed: file.size > 2000000 ? true : false
          }, function(err, data) {
            if (err) {
              console.log(err);
              fabmo.notify('error', err);
              return
            } else {
              updateQueue()
            }
          });
        }
      } catch (e) {
      } finally {
        $('#tabpending').removeClass('hover');
        return false;
      }
    }
  });
}



// USB-drive file input - this implements a self-contained USB file browser
function setupUSBFileInput() {
  console.log("Setting up USB File Input");
  
  // Find the file input container
  const fileInput = document.querySelector('.submitWrapper');
  if (!fileInput) return;
  
  // Create a container for our USB button
  const usbButtonContainer = document.createElement('div');
  usbButtonContainer.style.display = 'inline-block';
  usbButtonContainer.style.marginLeft = '10px';
  
  // Create the USB button with compatible styling
  const usbButton = document.createElement('button');
  usbButton.type = 'button';
  usbButton.id = 'usb-file-button';
  usbButton.className = 'btn btn-primary usb-file-button';
  usbButton.innerHTML = '<i class="fa fa-usb"></i> USB';
  
  // Add the button to the container
  usbButtonContainer.appendChild(usbButton);
  
  // Add click handler with debugging
  usbButton.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Show the USB browser dialog
    showUSBBrowser(function(err, result) {
      if (err) {
        console.error("USB browser error:", err);
        fabmo.notify('error', 'Error accessing USB: ' + err.message);
      } else if (result && result.filePath) {
        submitUSBFile(result.filePath, function(err, job) {
          if (err) {
            console.error("Error submitting USB file:", err);
            fabmo.notify('error', 'Error submitting file: ' + err.message);
          } else {
            console.log("File submitted successfully:", job);
            fabmo.notify('success', 'File loaded successfully from USB');
            updateQueue();
            updateHistory();
            updateOrder();
    
          }
        });
      }
    });
    
    return false;
  };
  
  // Insert the USB button container after the file input
  fileInput.parentNode.insertBefore(usbButtonContainer, fileInput.nextSibling);
  console.log("USB button added to DOM");
  
  // Create and add the modal to the DOM
  createUSBBrowserModal();
}

// Create the USB browser modal
function createUSBBrowserModal() {
  if (document.getElementById('usb-file-browser-modal')) {
    return;
  }
  
  const modalHtml = `
    <div id="usb-file-browser-modal" class="modal" style="display: none;">
      <div class="modal-content">
        <div class="modal-header">
          <h3>USB Devices</h3>
          <div class="header-actions">
            <button id="usb-refresh-button" class="usb-refresh-button" title="Refresh devices">
              <i class="fa fa-refresh"></i>
            </button>
            <span class="close">&times;</span>
          </div>
        </div>
        <div class="modal-body">
          <div class="usb-devices-section">
            <div id="usb-devices-list" class="usb-devices-list">
              <p>No USB devices detected.</p>
            </div>
          </div>
          <div class="usb-files-section">
            <div class="usb-path-bar">
              <span id="usb-current-path">No device selected</span>
            </div>
            <div id="usb-file-list" class="usb-file-list">
              <p>Select a USB device to browse files.</p>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="usb-cancel-button" class="usb-cancel-button">Cancel</button>
          <button id="usb-select-button" class="usb-select-button" disabled>Select File</button>
        </div>
      </div>
    </div>
  `;
  
  const modalStyle = `
    <style>
      #usb-file-browser-modal {
        position: fixed;
        z-index: 1000;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        overflow: auto;
        background-color: rgba(0,0,0,0.4);
      }
      
      #usb-file-browser-modal .modal-content {
        background-color: #fefefe;
        margin: 10% auto;
        padding: 0;
        border: 1px solid #888;
        width: 80%;
        max-width: 800px;
        border-radius: 5px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      }
      
      #usb-file-browser-modal .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background-color: #f5f5f5;
        padding: 10px 15px;
        border-bottom: 1px solid #ddd;
        border-radius: 5px 5px 0 0;
      }
      
      #usb-file-browser-modal .header-actions {
        display: flex;
        align-items: center;
        gap: 15px;
      }
      
      #usb-file-browser-modal .modal-header h3 {
        margin: 0;
        font-size: 16px;
        font-weight: bold;
      }
      
      #usb-file-browser-modal .modal-body {
        padding: 15px;
      }
      
      #usb-file-browser-modal .modal-footer {
        border-top: 1px solid #ddd;
        padding: 10px 15px;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        border-radius: 0 0 5px 5px;
      }
      
      #usb-file-browser-modal .close {
        color: #aaa;
        font-size: 22px;
        font-weight: bold;
        cursor: pointer;
      }
      
      #usb-file-browser-modal .close:hover {
        color: black;
      }
      
      #usb-file-browser-modal .usb-devices-section {
        margin-bottom: 15px;
      }
      
      #usb-file-browser-modal .usb-devices-list {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      }
      
      #usb-file-browser-modal .usb-device-item {
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s;
      }
      
      #usb-file-browser-modal .usb-device-item:hover {
        background-color: #f0f0f0;
      }
      
      #usb-file-browser-modal .usb-device-item.selected {
        background-color: #e3f2fd;
        border-color: #2196F3;
      }
      
      #usb-file-browser-modal .usb-path-bar {
        background-color: #f5f5f5;
        padding: 8px 12px;
        border-radius: 4px;
        margin-bottom: 8px;
        overflow: auto;
        white-space: nowrap;
        font-size: 13px;
        border: 1px solid #ddd;
      }
      
      #usb-file-browser-modal .usb-file-list {
        border: 1px solid #ddd;
        border-radius: 4px;
        max-height: 300px;
        overflow-y: auto;
      }
      
      #usb-file-browser-modal .usb-file-item {
        padding: 8px 12px;
        border-bottom: 1px solid #eee;
        cursor: pointer;
        display: flex;
        align-items: center;
      }
      
      #usb-file-browser-modal .usb-file-item:last-child {
        border-bottom: none;
      }
      
      #usb-file-browser-modal .usb-file-item:hover {
        background-color: #f5f5f5;
      }
      
      #usb-file-browser-modal .usb-file-item.selected {
        background-color: #e3f2fd;
      }
      
      #usb-file-browser-modal .usb-file-icon {
        margin-right: 10px;
      }
      
      #usb-file-browser-modal .usb-file-name {
        flex-grow: 1;
      }
      
      #usb-file-browser-modal .usb-file-size {
        color: #777;
        font-size: 0.8em;
      }
      
      #usb-file-browser-modal .usb-refresh-button {
        background: none;
        border: none;
        cursor: pointer;
        color: #555;
        font-size: 16px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      #usb-file-browser-modal .usb-refresh-button:hover {
        color: #000;
      }
      
      #usb-file-browser-modal .usb-cancel-button, 
      #usb-file-browser-modal .usb-select-button {
        padding: 6px 14px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      }
      
      #usb-file-browser-modal .usb-cancel-button {
        background-color: #f0f0f0;
        border: 1px solid #ddd;
      }
      
      #usb-file-browser-modal .usb-select-button {
        background-color: #2196F3;
        border: 1px solid #1976D2;
        color: white;
      }
      
      #usb-file-browser-modal .usb-select-button:disabled {
        background-color: #9e9e9e;
        border: 1px solid #757575;
        cursor: not-allowed;
      }
      
      #usb-file-browser-modal .loading {
        text-align: center;
        padding: 15px;
      }
    </style>
  `;
  
  // Append modal and styles to document
  const modalContainer = document.createElement('div');
  modalContainer.innerHTML = modalHtml + modalStyle;
  document.body.appendChild(modalContainer);
  
  // Set up event listeners
  setupUSBBrowserEventListeners();
}

// Set up event listeners for the modal
function setupUSBBrowserEventListeners() {
  // Close button
  const closeBtn = document.querySelector('#usb-file-browser-modal .close');
  closeBtn.addEventListener('click', hideUSBBrowser);
  
  // Cancel button
  const cancelBtn = document.getElementById('usb-cancel-button');
  cancelBtn.addEventListener('click', hideUSBBrowser);
  
  // Select button
  const selectBtn = document.getElementById('usb-select-button');
  selectBtn.addEventListener('click', selectCurrentFile);
  
  // Refresh button
  const refreshBtn = document.getElementById('usb-refresh-button');
  refreshBtn.addEventListener('click', loadUSBDevices);
  
  // Close when clicking outside the modal
  const modal = document.getElementById('usb-file-browser-modal');
  window.addEventListener('click', function(event) {
    if (event.target === modal) {
      hideUSBBrowser();
    }
  });
}

// Current state
let currentPath = null;
let usbBrowserCallback = null;

// Show the USB browser
function showUSBBrowser(callback) {
  document.getElementById('usb-current-path').textContent = 'No device selected';
  document.getElementById('usb-file-list').innerHTML = '<p>Select a USB device to browse files.</p>';
  document.getElementById('usb-select-button').disabled = true;
  currentPath = null;
  usbBrowserCallback = callback;
  document.getElementById('usb-file-browser-modal').style.display = 'block';
  loadUSBDevices();
}

// Function to get the last used USB path
function getLastUsedUSBPath() {
  return localStorage.getItem('fabmo_last_usb_path');
}

// Function to save the last used USB path
function saveLastUsedUSBPath(path) {
  if (path) {
    localStorage.setItem('fabmo_last_usb_path', path);
  }
}

// Hide the USB browser
function hideUSBBrowser() {
  document.getElementById('usb-file-browser-modal').style.display = 'none';
  if (usbBrowserCallback) {
    usbBrowserCallback(null, { cancelled: true });
    usbBrowserCallback = null;
  }
  // Note: We're not clearing lastUsedUSBPath, preserving it for next time
}

// Load USB devices
function loadUSBDevices() {
  const devicesList = document.getElementById('usb-devices-list');
  devicesList.innerHTML = '<p class="loading">Loading devices...</p>';
  
  // Reset file list and path when refreshing devices
  const fileList = document.getElementById('usb-file-list');
  const pathDisplay = document.getElementById('usb-current-path');
  
  // Make AJAX request to get USB devices
  $.ajax({
    url: '/usb/devices',
    type: 'GET',
    dataType: 'json',
    success: function(response) {
      if (response.status === 'success' && response.data.devices) {
        const devices = response.data.devices;
        
        if (devices.length === 0) {
          devicesList.innerHTML = '<p>No USB devices detected. Please connect a USB drive and click Refresh.</p>';
          
          // Reset file list and path display when no devices are found
          fileList.innerHTML = '<p>Select a USB device to browse files.</p>';
          pathDisplay.textContent = 'No device selected';
          
          // Disable select button
          document.getElementById('usb-select-button').disabled = true;
          
          // Clear currentPath
          currentPath = null;
          
          return;
        }
        
        let html = '';
        devices.forEach(function(device) {
          html += '<div class="usb-device-item" data-path="' + device.path + '">';
          html += '<div class="usb-device-name">' + device.name + '</div>';
          html += '</div>';
        });
        
        devicesList.innerHTML = html;
        
        // Add click handlers to device items
        const deviceItems = document.querySelectorAll('.usb-device-item');
        deviceItems.forEach(function(item) {
          item.addEventListener('click', function() {
            // Update selected device
            deviceItems.forEach(function(el) {
              el.classList.remove('selected');
            });
            item.classList.add('selected');
            
            // Load directory contents
            const path = item.getAttribute('data-path');
            loadUSBDirectory(path);
          });
        });
        
        // Auto-select the first drive or the last used path if available
        let deviceToSelect = null;
        const lastUsedUSBPath = getLastUsedUSBPath();
        
        // First, try to find and select the last used path
        if (lastUsedUSBPath) {
          for (let i = 0; i < devices.length; i++) {
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
          deviceToSelect.classList.add('selected');
          const path = deviceToSelect.getAttribute('data-path');
          
          // If we have a remembered path that's deeper than the device root
          // and it belongs to the selected device, use that
          if (lastUsedUSBPath && lastUsedUSBPath.startsWith(path) && lastUsedUSBPath !== path) {
            loadUSBDirectory(lastUsedUSBPath);
          } else {
            loadUSBDirectory(path);
          }
        }
      } else {
        devicesList.innerHTML = '<p>Error loading USB devices. Please try again.</p>';
        
        // Reset file list and path display on error
        fileList.innerHTML = '<p>Select a USB device to browse files.</p>';
        pathDisplay.textContent = 'No device selected';
        
        // Disable select button
        document.getElementById('usb-select-button').disabled = true;
      }
    },
    error: function(err) {
      console.error('Error loading USB devices:', err);
      devicesList.innerHTML = '<p>Error loading USB devices. Please try again.</p>';
      
      // Reset file list and path display on error
      fileList.innerHTML = '<p>Select a USB device to browse files.</p>';
      pathDisplay.textContent = 'No device selected';
      
      // Disable select button
      document.getElementById('usb-select-button').disabled = true;
    }
  });
}

// Load USB directory
function loadUSBDirectory(path) {
  currentPath = path;
  
  // Save this path as the last used path
  saveLastUsedUSBPath(path);
  
  // Update path display
  document.getElementById('usb-current-path').textContent = path;
  
  // Show loading
  const fileList = document.getElementById('usb-file-list');
  fileList.innerHTML = '<p class="loading">Loading files...</p>';
  
  // Make AJAX request to get directory contents
  $.ajax({
    url: '/usb/dir?path=' + encodeURIComponent(path),
    type: 'GET',
    dataType: 'json',
    success: function(response) {
      if (response.status === 'success' && response.data.contents) {
        const contents = response.data.contents;
        
        if (contents.length === 0) {
          fileList.innerHTML = '<p>This directory is empty.</p>';
          return;
        }
        
        let html = '';
        
        // Add parent directory option if not at root
        if (path !== '/media/pi' && path !== '/media/root' && path !== '/mnt') {
          const parentPath = path.split('/').slice(0, -1).join('/') || '/';
          
          html += '<div class="usb-file-item" data-path="' + parentPath + '" data-is-dir="true">';
          html += '<span class="usb-file-icon">📁</span>';
          html += '<span class="usb-file-name">..</span>';
          html += '</div>';
        }
        
        // Add directories first
        contents.filter(function(file) {
          return file.isDirectory;
        }).forEach(function(dir) {
          html += '<div class="usb-file-item" data-path="' + dir.path + '" data-is-dir="true">';
          html += '<span class="usb-file-icon">📁</span>';
          html += '<span class="usb-file-name">' + dir.name + '</span>';
          html += '</div>';
        });
        
        // Then add files
        contents.filter(function(file) {
          return !file.isDirectory;
        }).forEach(function(file) {
          html += '<div class="usb-file-item" data-path="' + file.path + '" data-is-dir="false">';
          html += '<span class="usb-file-icon">📄</span>';
          html += '<span class="usb-file-name">' + file.name + '</span>';
          html += '<span class="usb-file-size">' + formatFileSize(file.size) + '</span>';
          html += '</div>';
        });
        
        fileList.innerHTML = html;
        
        // Add click handlers to file items
        const fileItems = document.querySelectorAll('.usb-file-item');
        fileItems.forEach(function(item) {
          item.addEventListener('click', function() {
            const isDir = item.getAttribute('data-is-dir') === 'true';
            const itemPath = item.getAttribute('data-path');
            
            if (isDir) {
              // Navigate to directory
              loadUSBDirectory(itemPath);
            } else {
              // Select file
              fileItems.forEach(function(el) {
                el.classList.remove('selected');
              });
              item.classList.add('selected');
              
              // Enable select button
              document.getElementById('usb-select-button').disabled = false;
            }
          });
          
          // Add double-click handler
          item.addEventListener('dblclick', function() {
            const isDir = item.getAttribute('data-is-dir') === 'true';
            const itemPath = item.getAttribute('data-path');
            
            if (isDir) {
              // Navigate to directory
              loadUSBDirectory(itemPath);
            } else {
              // Select and submit file
              selectFile(itemPath);
            }
          });
        });
      } else {
        fileList.innerHTML = '<p>Error loading directory. Please try again.</p>';
      }
    },
    error: function(err) {
      console.error('Error loading directory:', err);
      fileList.innerHTML = '<p>Error loading directory. Please try again.</p>';
    }
  });
}

// Select current file
function selectCurrentFile() {
  const selectedFile = document.querySelector('.usb-file-item.selected');
  if (selectedFile && selectedFile.getAttribute('data-is-dir') === 'false') {
    const filePath = selectedFile.getAttribute('data-path');
    selectFile(filePath);
  }
}

// Select file
function selectFile(filePath) {
  // Update lastUsedUSBPath to the directory containing this file
  const directory = filePath.substring(0, filePath.lastIndexOf('/'));
  if (directory) {
    saveLastUsedUSBPath(directory);
  }
  
  const callback = usbBrowserCallback;
  hideUSBBrowser();
  if (callback) {
    callback(null, { filePath: filePath });
  }
}

// Submit USB file
function submitUSBFile(filePath, callback) {
  // Show the regular spinner while submitting
  const usbButton = document.getElementById('usb-file-button');
  usbButton.innerHTML = '<i class="fa fa-circle-o-notch fa-spin"></i> USB';
  usbButton.disabled = true;
  
  // Make AJAX request to submit file
  $.ajax({
    url: '/usb/submit',
    type: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ path: filePath }),
    dataType: 'json',
    success: function(response) {
      usbButton.innerHTML = '<i class="fa fa-usb"></i> USB';
      usbButton.disabled = false;
      
      if (response.status === 'success' && response.data.job) {
        callback(null, response.data.job);
      } else {
        callback(new Error('Failed to submit job'));
      }
    },
    error: function(err) {
      usbButton.innerHTML = '<i class="fa fa-usb"></i> USB';
      usbButton.disabled = false;
      console.error('Error submitting USB file:', err);
      callback(err);
    }
  });
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}



function updateQueue(callback) {
  callback = callback || function() {};
  // Update the queue display.
  fabmo.getJobsInQueue(function(err, jobs) {
    numberJobs = jobs.pending.length;
    var jobElements = document.getElementById("queue_table").childElementCount;
    if (err) {
      return callback(err);
    }

    // if (jobs.pending.length === jobElements && jobs.pending.length != 0 && jobs.running.length === 0) {
    //   return
    // } else {
      jobs.pending.sort(function(a, b) {
        return a.order - b.order;
      });
      if (jobs.running.length) {
        var current = jobs.running[0];
        jobs.pending.unshift(current);
        addQueueEntries(jobs.pending);
        runningJob(current);
      } else {
        runningJob(null);
        addQueueEntries(jobs.pending);
      }
    // }
    callback();
  });

}

function clearQueue() {
  var elements = document.getElementsByClassName('job_item');
  while (elements.length > 0) {
    elements[0].parentNode.removeChild(elements[0]);
  }
  updateOrder();
}

function clearRecent() {
  var elements = document.getElementsByClassName('recent_item');
  while (elements.length > 0) {
    elements[0].parentNode.removeChild(elements[0]);
  }
}

function createQueueMenu(id) {
  var menu = "<div data-jobid='JOBID' class='ellipses' title='more actions'><span>...</span></div><div class='commentBox'></div><div class='dropDown'><ul class='jobActions'><li><a class='previewJob' data-jobid='JOBID'>Preview Job</a></li><li><a class='editJob' data-jobid='JOBID'>Edit Job</a></li><li><a class='downloadJob' data-jobid='JOBID'>Download Job as CNC File</a></li><li><a class='deleteJob' data-jobid='JOBID'>Delete Job</a></li></ul></div>";
  return menu.replace(/JOBID/g, id);
}

function createRecentMenu(id) {
  var menu = "<div  class='ellipses' title='Run Again'><i data-jobid='JOBID'class='fa fa-arrow-circle-up add resubmitJob' aria-hidden='true'></i></div>";
  return menu.replace(/JOBID/g, id);
}

function makeActions() {
  var actions = '<div> <div class="small-2 medium-4 columns play-button" style="text-align:right;"> <div class="radial_progress"> <div class="percent_circle"> <div class="mask full"><div class="fill"></div></div><div class="mask half"><div class="fill"></div><div class="fill fix"> </div> </div> <div class="shadow"> </div> </div> <div class="inset"> <div id="run-next" class="play"><span></span></div> </div></div></div></div><div class="small-8 medium-12 icon-row" sortable="false"><div class="medium-1 small-2 columns"><a class="preview" title="Preview Job"><img  class="svg" src="css/images/visible9.svg"></a></div><div class="medium-1 small-2 columns"><a class="edit" title="Edit Job"><img class="svg" src="images/edit_icon.png"></a></div><div class="medium-1 small-2 columns"><a class="download" title="Download Job as CNC File"><img  class="svg" src="css/images/download151.svg"></a></div><div class="medium-1 small-2 columns"><a class="cancel" title="Cancel Job"><img  class="svg" src="css/images/recycling10.svg"></a></div><div class="sm-1 columns"></div></div><div class="row"></div><div class="job-lights-container"><div class="job-status-light one off"><div class="job-status-indicator"></div></div><div class="job-status-light two off"><div class="job-status-indicator"></div></div><div class="job-status-light three off"><div class="job-status-indicator"></div></div></div>'
  return actions;
}

// Returns an img string DOM element for holding the job preview thumbnail.
// function createPreviewThumbnail(job, width, height) {
//   var img = document.createElement("img");
//   img.style.marginRight = "4px";
//   img.width = width;
//   img.height = height;
//   img.alt = "[No possible preview]";
//   img.src = "/job/" + job._id + "/thumbnail";
//   return img.outerHTML;
// }

function search(nameKey, arr) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i]._id.toString() === nameKey) {
      return true;
    }
  }
}

function addQueueEntries(jobs) {
  var elements = document.getElementsByClassName('job_item'); //All current jobs in DOM
  var table = document.getElementById('queue_table');
  var recent = [];


  for (var j = 0; j < elements.length; j++) { /// If a job is in the DOM and is not pending remove it
    var found = search(elements[j].id, jobs);
    if (found) {

    } else {
      $('#' + elements[j].id).remove();
    }
  }


  if (jobs.length) {
    $('.no-jobs').css('left', '-2000px'); /// Remove no jobs menu
    nextJob();
    /// add logic to check if these exist in right order
    clearQueue();
    for (var i = 0; i < jobs.length; i++) {
      // if ($('#' + jobs[i]._id).length < 1) { // If a job already has a card do nothing else make a card for job
        var listItem = document.createElement("div");
        listItem.setAttribute("id", jobs[i]._id);
        listItem.setAttribute("class", "job_item");
        listItem.setAttribute("data-id", jobs[i]._id);
        table.appendChild(listItem);
        var id = document.getElementById(jobs[i]._id);
        id.innerHTML = '<div id="menu"></div><div class="job_name">' + jobs[i].name + '</div><div class="description">' + jobs[i].description + '</div><div class="created-date">'+ moment(jobs[i].created_at).fromNow(); +'</div>';
        var menu = id.firstChild;
        menu.innerHTML = createQueueMenu(jobs[i]._id);
      // }
    };
    setFirstCard(); //Add play button and css style for first card
    isTestJob = jobs[0];
    bindMenuEvents();
  } else {
    clearQueue();
    $('.no-jobs').css('left', '0px');
    fabmo.getJobHistory({
      start: 0,
      count: 0
    }, function(err, jobs) {
      var arr = jobs.data;
      var i = 0;
      for (var a = 0; a < arr.length; a++) {
        if (i === 4) {
          break;
        } else {
          var result = recent.filter(function(e) {
            return e.file_id == arr[a].file_id;
          });
          if (result.length === 0) {
            recent.push(arr[a]);
            i++;
          }
        }
      }
      var recentJobs = document.getElementById('recent');
      clearRecent();
      for (var i = 0; i < recent.length; i++) {
        var recentItem = document.createElement("div");
        recentItem.setAttribute("id", recent[i]._id);
        recentItem.setAttribute("class", "recent_item");
        recentItem.setAttribute("data-id", recent[i]._id);
        recentJobs.appendChild(recentItem);
        var id = document.getElementById(recent[i]._id);
        id.innerHTML = '<div id="menu"></div><div id="name">' + recent[i].name + '</div><div class="description">' + recent[i].description + '</div><div class="created-date">Last Run: '+ moment(recent[i].created_at).fromNow(); +'</div>';
        var menu = id.firstChild;


        menu.innerHTML = createRecentMenu(recent[i]._id);

      };
      bindMenuEvents();

      if (err) {
        return callback(err);
      }
    });
  }

}


function setFirstCard() {
  var firstId = $('.job_item').first().attr('id');
  var el = document.getElementById(firstId);
  var cardActions = document.createElement("div");
  hideDropDown();  ////## trying here to prevent clickability issue after choosing from 'recent'; update to #48395 
  cardActions.setAttribute("id", "actions");
  el.appendChild(cardActions);
  var actions = document.getElementById("actions");
  actions.innerHTML = makeActions();
  $('.cancel').data('id', firstId);
  $('.preview').data('id', firstId);
  $('.download').data('id', firstId);
  $('.edit').data('id', firstId);

}


/*
 * -----------
 *   HISTORY
 * -----------
 */

function updateHistory(callback) {
  fabmo.getJobHistory({
    start: historyStart,
    count: historyCount
  }, function(err, jobs) {
    if (err) {
      return callback(err);
    }
    // Hide/show the next/prev buttons according to the history total
    historyTotal = jobs.total_count;
    $('#history_page_next').toggle(historyTotal > (historyStart + historyCount));
    $('#history_page_prev').toggle(historyStart > 0);
    // Eliminate entries in the table and repopulate with fresh data
    clearHistory();
    addHistoryEntries(jobs.data);
    typeof callback === 'function' && callback();
  });
}

function historyPreviousPage(callback) {
  historyStart -= historyCount;
  if (historyStart < 0) {
    historyStart = 0;
  }
  updateHistory(callback);
}

function historyNextPage(callback) {
  historyStart += historyCount;
  updateHistory(callback);
}

function clearHistory() {
  var table = document.getElementById('history_table');
  var rows = table.rows.length;
  for (var i = 0; i < rows; i++) {
    table.deleteRow(0);
  }
}

function createHistoryMenu(id) {
  var menu = "<div class='ellipses' title='More Actions'><span>...</span></div><div class='commentBox'></div><div class='dropDown'><ul class='jobActions'><li><a class='previewJob' data-jobid='JOBID'>Preview Job</a></li><li><a class='editJob' data-jobid='JOBID'>Edit Job</a></li><li><a class='resubmitJob' data-jobid='JOBID'>Add To Queue</a></li><li><a class='downloadJob' data-jobid='JOBID'>Download Job as CNC File</a></li><li><a class='deleteJob' data-jobid='JOBID'>Delete Job</a></li></ul></div>"
  return menu.replace(/JOBID/g, id)
}

function addHistoryEntries(jobs) {
  var table = document.getElementById('history_table');
  jobs.forEach(function(job) {
    var row = table.insertRow(table.rows.length);
    var menu = row.insertCell(0);
    menu.className += ' actions-control';
    var thumbnail = row.insertCell(1);
    thumbnail.style.width = "60px";
    var name = row.insertCell(2);
    var done = row.insertCell(3);
    var time = row.insertCell(4);

    menu.innerHTML = createHistoryMenu(job._id);
    name.innerHTML = '<div class="job-' + job.state + '">' + job.name + '</div>';
    done.innerHTML = moment(job.finished_at).fromNow();
    time.innerHTML = moment.utc(job.finished_at - job.started_at).format('HH:mm:ss');
  });
  bindMenuEvents();
}

function hideDropDown() {
  $('.dropDownWrapper').hide();
  $('.dropDown').hide();
  $('.commentBox').hide();
}

function bindMenuEvents() {

  $('.resubmitJob').off('click');
  $('.resubmitJob').click(function(e) {
    fabmo.resubmitJob(this.dataset.jobid, function(err, result) {
      //refresh_jobs_list();
      updateOrder();
      fabmo.getJobsInQueue(function(err, data) {
        $('.toggle-topbar').click();
        $('#nav-pending').click();
        updateQueue(false);
      });
    });
    hideDropDown();
  });

  $('.previewJob').off('click');
  $('.previewJob').click(function(e) {
    e.preventDefault();
    fabmo.launchApp('previewer', {
      'job': this.dataset.jobid
    });
    hideDropDown();
  });

  $('.editJob').off('click');
  $('.editJob').click(function(e) {
    e.preventDefault();
    fabmo.launchApp('editor', {
      'job': this.dataset.jobid
    });
    hideDropDown();
  });

  $('.downloadJob').off('click')
  $('.downloadJob').click(function(e) {
    fabmo.navigate('/job/' + this.dataset.jobid + '/file');
  });

  $('.deleteJob').off('click')
  $('.deleteJob').click(function(e) {
    fabmo.deleteJob(this.dataset.jobid, function(err,data){
      if(err){
        console.log(err);
      } else {
        updateQueue();
        updateHistory();
        updateOrder();
      }
    });
  });

  $('.dropDownWrapper').off('click')
  $('.dropDownWrapper').click(function() {
    hideDropDown();
  });

  $('.ellipses').off('click')
  $('.ellipses').click(function(evt) {
    //create and show a transparent overlay that you can click to close
    $('.dropDownWrapper').show();
    var dd = $(this).nextAll();
    dd.show();
  });

}


function noJob() {
  $('.with-job').data('job', false);
  $('.up-next').css('left', '-2000px');
};

function nextJob(job) {
  $('.with-job').data('job', true);
  $('.with-job').css('left', '10px');
  $('.up-next').css('left', '0px');
};

// Job should be the running job or null
function runningJob(job) {
  if (!job) {
    setProgress(status);
    $('.play').removeClass('active')
    $('body').css('background-color', '#EEEEEE');
    $('.play-button').show();
    sortable.options.disabled = false;
    return
  }

  $('.cancel').slideUp(100);
  $('.download').slideUp(100);
  $('.edit').slideUp(100);

  // $('.preview').slideUp(100); // Here if the live viewer button moves
  $('.preview').off('click');
  $('.preview').click(function(e) {
    e.preventDefault();
    fabmo.launchApp('previewer', {
      'job': job._id,
      "isLive": true
    });
    hideDropDown();
  });

  $('body').css('background-color', '#898989');
  $('.topjob').addClass('running');
  $('.up-next').css('left', '-2000px');
  $('.no-jobs').css('left', '-2000px');
  $('.now-running').css('left', '0px');
  $('.play-button').show();
  if (!$('.play').hasClass('active')){
    $('.play').addClass('active');
  }
  sortable.options.disabled = true;
};

var setProgress = function(status) {
  var prog = ((status.line / status.nb_lines) * 100).toFixed(2);
  if (prog > 100) {
    prog = 100;
  }
  if (isNaN(prog)) {
    prog = 0;
  }
  var percent = Math.ceil(prog);
  var rotation = Math.ceil(180 * (percent / 100));
  var fill_rotation = rotation;
  var fix_rotation = rotation * 2;
  var transform_styles = ['-webkit-transform', '-ms-transform', 'transform'];
  if (!status.job) {
    $('.up-next').css('left', '-2000px');
    $('.now-running').css('left', '-2000px');

    for (i in transform_styles) {
      $('.fill, .mask.full').css(transform_styles[i], 'rotate(0deg)');
      $('.fill.fix').css(transform_styles[i], 'rotate(0deg)');
    }

  }
  for (i in transform_styles) {
    $('.fill, .mask.full').css(transform_styles[i], 'rotate(' + fill_rotation + 'deg)');
    $('.fill.fix').css(transform_styles[i], 'rotate(' + fix_rotation + 'deg)');
  }
}


/*
 * ---------
 *  STATUS
 * ---------
 */

function handleStatusReport(status) {
  // Either we're running a job currently or null
  try {
    var jobId = status.job._id || null;
    var jobState = status.state;

  } catch (e) {
    var jobid = null;
  }

  if (jobId && jobState === "running") { // Job is currently running
    setProgress(status);
  }
}

function updateOrder(){
  var newOrder = sortable.toArray();
  fabmo.getJobsInQueue(function(err, jobs) {
    for (i = 0; i < newOrder.length; i++) {
      var id = jobs.pending.filter(function(id) {
        return id._id == newOrder[i];
      });
      id[0].order = i + 1;
      fabmo.updateOrder({
        id: id[0]._id,
        order: id[0].order
      }, function(err, result) {
        if (err) {
          console.log(err);
        } else {
          updateQueue();
        }
      });
    }
  });
}

var el = document.getElementById('queue_table');
var sortable = Sortable.create(el, {
  ghostClass: 'ghost',
  chosenClass: 'chosen',
  dataIdAttr: 'data-id',
  clickDelay: 0,
  touchDelay: 100,
  animation: 150,
  filter: ".cancel, .preview, .edit, .download, .play, .previewJob, .editJob, .downloadJob, .deleteJob, .ellipses",
  onStart: function(evt) {
    var remove = document.getElementById('actions');
    remove.parentNode.removeChild(remove);
    var ctrl = evt.item;
    ctrl.removeAttribute("style");
  },
  onFilter: function(evt) {
    var item = evt.item,
      ctrl = evt.target;
    var id = ctrl.getAttribute('data-jobid');
    if (Sortable.utils.is(ctrl, ".cancel")) {
      fabmo.deleteJob($('.cancel').data('id'), function(err, data) {
        updateQueue();
        updateHistory();

      });
    } else if (Sortable.utils.is(ctrl, ".preview")) {
      fabmo.launchApp('previewer', {
        'job': $('.preview').data('id')
      });
    } else if (Sortable.utils.is(ctrl, ".edit")) {
      fabmo.launchApp('editor', {
        'job': $('.edit').data('id')
      });
    } else if (Sortable.utils.is(ctrl, ".download")) {
      $('.download').attr({
        'data-href': '/job/' + $('.download').data('id') + '/file'
      });
      fabmo.navigate($('.download').data('href'));
    } else if (Sortable.utils.is(ctrl, ".ellipses")) {
      var dd = ctrl.parentNode.childNodes[2];
      var cd = ctrl.parentNode.childNodes[1];
      $('.dropDownWrapper').show();
      dd.style.display = 'block';
      cd.style.display = 'block';
    } else if (Sortable.utils.is(ctrl, ".previewJob")) {
      fabmo.launchApp('previewer', {
        'job': id
      });
      hideDropDown();
    } else if (Sortable.utils.is(ctrl, ".editJob")) {
      fabmo.launchApp('editor', {
        'job': id
      });
      hideDropDown();
    } else if (Sortable.utils.is(ctrl, ".downloadJob")) {
      fabmo.navigate('/job/' + id + '/file');
    } else if (Sortable.utils.is(ctrl, ".deleteJob")) {
      fabmo.deleteJob(id);

    }
  },

  onMove: function(evt) {
    var ctrl = evt.dragged;
    ctrl.removeAttribute("style");
  },
  onEnd: function(evt) {
    var firstJob = document.getElementById('queue_table').firstChild;
    var cardActions = document.createElement("div");
    setFirstCard();
    updateOrder();
    $('.cancel').show(500);
    $('.download').show(500);
    $('.edit').show(500);
    $('.preview').show(500);
    $('.play-button').show();
  }
});

var current_job_id = 0;

function runNext() {
  $('#queue_table').on('click touchstart', '.play', function(e) {
    if ($('.play').hasClass('active')) {
      fabmo.pause(function(err, data) {});
    } else {
      jobLoading = true; 
      $('.play').addClass('loading');
      fabmo.runNext(function(err, data) {
        if (err) {
          fabmo.notify(err);
        } else {
        }
      });
    }
  });
}

function findUpTag(el, id) {
  while (el.parentNode) {
    el = el.parentNode;
    if (el.id === id)
      return el;
  }
  return null;
}

//   ... generally modified to include transforms page from here on 

var unit_label_index = {}
var registerUnitLabel = function(label, in_label, mm_label) {
  var labels = {
    'in' : in_label,
    'mm' : mm_label
  }
  unit_label_index[label] = labels;
}

var updateLabels = function(unit) {
	$.each(unit_label_index, function(key, value) {
		$(key).html(value[unit]);
	});
}

var flattenObject = function(ob) {
  var toReturn = {};
  for (var i in ob) {
    if (!ob.hasOwnProperty(i)) continue;

    if ((typeof ob[i]) == 'object') {
      var flatObject = flattenObject(ob[i]);
      for (var x in flatObject) {
        if (!flatObject.hasOwnProperty(x)) continue;

        toReturn[i + '-' + x] = flatObject[x];
      }
    } else {
      toReturn[i] = ob[i];
    }
  }
  return toReturn;
};

function update() {
  fabmo.getConfig(function(err, data) {
    var ckTransform = false;  // for TRANSFORM state test below
    if(err) {
      console.error(err);
    } else {
      configData = data;
        ['opensbp'].forEach(function(branchname) {
                branch = flattenObject(data[branchname]);
          for(key in branch) {
            v = branch[key];

            // Quick Display of TRANSFORM STATE in Job-manager nav bar
            if (key === "transforms-rotate-apply") {
                if (v===true) {ckTransform = true};
            }
            if (key === "transforms-scale-apply") {
                if (v===true) {ckTransform = true};
            }
            if (key === "transforms-move-apply") {
                if (v===true) {ckTransform = true};
            }
            if (key === "transforms-shearx-apply") {
                if (v===true) {ckTransform = true};
            }
            if (key === "transforms-sheary-apply") {
                if (v===true) {ckTransform = true};
            }
            if (key === "transforms-interpolate-apply") {
                if (v===true) {ckTransform = true};
            }
            if (key === "transforms-level-apply") {
                if (v===true) {ckTransform = true};
            }
            if (ckTransform === true) {
                $('#nav-transforms').text('TRANSFORMS - ON');
                $('#nav-transforms').css('color', '#FF4013');
            } else {
                $('#nav-transforms').text('TRANSFORMS - OFF');
                $('#nav-transforms').css('color', 'grey')
            }

            input = $('#' + branchname + '-' + key);
            if(input.length) {
                if (input.is(':checkbox')){
                  if (v){
                      input.prop( "checked", true );
                  } else {
                      input.prop( "checked", false );
                  }
                } else {
                  input.val(String(v));
                }
            }
          }
      });
    }
  });
}

function setConfig(id, value) {
	var parts = id.split("-");
	var o = {};
	var co = o;
	var i=0;

	do {
	  co[parts[i]] = {};
	  if(i < parts.length-1) {
	    co = co[parts[i]];
	  }
	} while(i++ < parts.length-1 );
	co[parts[parts.length-1]] = value;
	fabmo.setConfig(o, function(err, data) {
    notifyChange(err,id);
    update();
	});
}

var notifyChange = function(err,id){
  if(err){
    $('#'+id).addClass("flash-red");
  }else{
    $('#'+id).addClass("flash-green");
  }
  setTimeout(function(){$('#'+id).removeClass("flash-red flash-green")},500);
};


var configData = null;
$(document).ready(function() {
    $(document).foundation();

    fabmo.on('job_end',function (cmd) {
        updateQueue();
        updateHistory();
    });

    fabmo.on('job_start',function (cmd, data) {
        updateQueue();
        updateHistory();
    });

    // The queue will update when the status report comes in
    // But the history needs to be updated manually
    fabmo.requestStatus();
    updateQueue();
    updateHistory();

    setupDropTarget();
    runNext();

    setupUSBFileInput()

    ////## this did not fix issue with another client
    ////## TODO // look for some sort of change 
    // Because the job-manager may be changed by another client device, we need to update the queue manually
    // ... it is not efficient to use the status report to update the queue as it is not always sent or too frequently sent
    // Try an interval of 2 seconds for updateQueue
    // setInterval(updateQueue, 2000); //Disrupts the job-manager UI 

////## th - experiment on FLOW back re: Sb4 and similar apps

    // get info for setting up exit-back behavior
    let this_App = "job-manager";
    let default_App = localStorage.getItem("defaultapp");
    let back_App = localStorage.getItem("backapp");
    let current_App = localStorage.getItem("currentapp");
    // do nothing if current (e.g. refreshes and returns)
    if (this_App != current_App) {
        back_App = current_App;
        if (back_App === null || back_App === "") {back_App = default_App};
        back_App = default_App; // * > always to here for job-manager
        current_App = this_App;
        localStorage.setItem("currentapp", current_App);
        localStorage.setItem("backapp", back_App);
    } 

    $(".exit-button").on("click", function(){
        fabmo.launchApp(back_App);
    });
 
    document.onkeyup = function (evt) {
        if (evt.key === "Escape") {
            evt.preventDefault();
            fabmo.launchApp(back_App);
        }
    };

    // set focus at the end of 'ready'.

////##


    $('#history_page_next').click(function(evt) {
        evt.preventDefault();
        historyNextPage();
    });

    $('#history_page_prev').click(function(evt) {
        evt.preventDefault();
        historyPreviousPage();
    });

    $('.no-jobs-item').click(function(e) {
        $('#job_selector').click();
    });

    $('#clear-jobs').click(function(e) {
        fabmo.clearJobQueue(function(err, data) {
        updateQueue();
        });
    });

    $('.submit-button').click(function(evt) {
        jQuery('#file').trigger('click');
    });

    $('.without-job').click(function(evt) {
        jQuery('#file').trigger('click');
    });

    $('#file').change(function(evt) {
        var file_size = $('#fileform').find('input:file')[0].files[0].size;
        $('.progressbar').removeClass('hide');
        fabmo.on('upload_progress', function(progress) {
        fileUploadProgress(progress.value);
        });
        fabmo.submitJob($('#fileform'), {
        compressed: file_size > 2000000 ? true : false
        }, function(err, data) {
        if (err) {
            fabmo.notify('error', err);
        }
        resetFormElement($('#file'));
        updateQueue();
        updateOrder();
        $('#nav-pending').click();
        });
    });

    // FOR TRANSFORMS 
    // Setup Unit Labels
    registerUnitLabel('.in_mm_label', 'in', 'mm');
    registerUnitLabel('.ipm_mmpm_label', 'in/min', 'mm/min');
    registerUnitLabel('.ips_mmps_label', 'in/sec', 'mm/sec');
    registerUnitLabel('.inpm2_mmpm2_label', 'in/min<sup>2</sup>', 'mm/min<sup>2</sup>');
    registerUnitLabel('.inrev_mmrev_label', 'in/rev', 'mm/rev');
    registerUnitLabel('.inpm3_mmpm3_label', 'in/min<sup>3</sup>', 'mm/min<sup>3</sup>');

    $('#nav-transforms').click(function(evt) {
        evt.preventDefault();
      });

    // Populate Settings
    update();

    ///tool tip logic
    $('.tool-tip').click(function(){
        var tip =$(this).parent().data('tip');
        var eTop = $(this).offset().top;
        var eLeft = $(this).offset().left;
        var realTop = eTop - 10;
        $('.tip-output').show();
        var eWidth = $('.tip-output').width();
        var realLeft = eLeft - eWidth - 40;
        $('.tip-text').text(tip);
        $('.tip-output').css('top', realTop + 'px');
        $('.tip-output').css('left', realLeft + 'px');
    });

    $('body').scroll(function(){
        $('.tip-output').hide();
    });

    $('body').click(function(event){   
        if($(event.target).attr('class') == "tool-tip"){
            return
        } else {
            $('.tip-output').hide();
        }
    });

    // Update settings on change
    $('.driver-input').change( function() {
      var parts = this.id.split("-");
      var new_config = {};
      new_config.driver = {};
      var v = parts[1];
      if(v === "gdi") {
          new_config.driver.gdi = this.value;
          if (this.value == 0) { fabmo.runGCode("G90"); }
          else { fabmo.runGCode("G91"); }
          fabmo.setConfig(new_config, function(err, data) {
              notifyChange(err, data.driver.gid);
              setTimeout(update, 500);
          });
      // Handle getting the driver input value from seconds to min before saving to g2.config
      } else if(v === "xfr" || v === "yfr" || v === "zfr" || v === "afr" || v === "bfr" || v === "cfr") {
          new_config.driver[v] = this.value * 60;
          setConfig(this.id,  new_config.driver[v]);
          }    
      else {
          setConfig(this.id, this.value);
      }
      // How to send G90 or G91 from here?
  });

  $('.opensbp-input').change( function() {
    setConfig(this.id, this.value);
});

    $('.opensbp-values').change( function() {
       var parts = this.id.split("-");
       var new_config = {};
       new_config.driver = {};
       var v = parts[1];

       if (!configData) { return; }
       if(v !== undefined) {
           if(v === "units1"){
               new_config.driver['1tr']=(360/configData.driver["1sa"])*configData.driver["1mi"]/this.value;
           }
           else if(v === "units2"){
               new_config.driver['2tr']=(360/configData.driver["2sa"])*configData.driver["2mi"]/this.value;
           }
           else if(v === "units3"){
               new_config.driver['3tr']=(360/configData.driver["3sa"])*configData.driver["3mi"]/this.value;
           }
           else if(v === "units4"){
               new_config.driver['4tr']=(360/configData.driver["4sa"])*configData.driver["4mi"]/this.value;
           }
           else if(v === "units5"){
               new_config.driver['5tr']=(360/configData.driver["5sa"])*configData.driver["5mi"]/this.value;
           }
           else if(v === "units6"){
               new_config.driver['6tr']=(360/configData.driver["6sa"])*configData.driver["6mi"]/this.value;
           }
           fabmo.setConfig(new_config, function(err, data) {
               notifyChange(err,id);
               setTimeout(update, 500);
           });
       }
    });

    fabmo.on('reconnect', function() {
        update();  // for transforms
        updateQueue();
        updateOrder();
        updateHistory();
    });

    fabmo.on('status', function(status) {
        updateLabels(status.unit);     // for trnasforms
        handleStatusReport(status);
        if (status.job == null && status.state != 'idle') {
        $('.play-button').hide();
        $('.play').removeClass('loading');
        } else if (status.state == 'idle' && el.firstChild) {
        $('.play-button').show();
        } 
    });
    fabmo.requestStatus(); ////##right place for this status?

    function resetFormElement(e) {
        e.wrap('<form>').closest('form').get(0).reset();
        e.unwrap();
    }

    fabmo.getAppArgs(function(err, args) {
      if('tab' in args) {
          var tab = $("#" + args.tab);
          if(tab.length) {
              tab.click();
          } else {
              console.log('Tab not found: ' + args.tab);
          }
      }
    });

    update();  
    $(window).trigger("focus");

    window.addEventListener('keyup', function(event) {
      // If the key is either the + or the _ , then send the key code to the parent window
      if (event.key === "+" || event.key === "_" || event.key === "<" || event.key === ">") {
          //console.log("Sending key code to parent window: " + event.key);
          window.parent.postMessage({ key: event.key }, '*');
          event.stopPropagation();
          event.preventDefault();
      }
    });

});
