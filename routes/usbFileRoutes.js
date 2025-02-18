const fs = require("fs");
const path = require("path");
const multer = require("multer");
const fetch = require("node-fetch");

const MEDIA_DIRECTORIES = ["/media/pi", "/mnt"];
const FABMO_SCRIPTS_DIR = "/opt/fabmo/scripts";
let cachedHTML = "";

// Ensure the FabMo scripts directory exists
if (!fs.existsSync(FABMO_SCRIPTS_DIR)) {
    fs.mkdirSync(FABMO_SCRIPTS_DIR, { recursive: true });
}

// Function to recursively get files from USB directories
function getFilesRecursively(directory) {
    let files = [];
    try {
        const items = fs.readdirSync(directory, { withFileTypes: true });
        items.forEach((item) => {
            const fullPath = path.join(directory, item.name);
            if (item.isDirectory()) {
                files = files.concat(getFilesRecursively(fullPath));
            } else {
                files.push({ name: item.name, fullPath });
            }
        });
    } catch (err) {
        console.error(`Error reading directory ${directory}: ${err.message}`);
    }
    return files;
}

// Function to generate USB File Listing HTML
function generateHTMLPage(files) {
    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>USB Media Files</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; border: 1px solid #ddd; }
        th { background-color: #f4f4f4; }
        a { text-decoration: none; color: blue; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <h1>USB Media Files</h1>
      <table>
        <thead>
          <tr><th>File Name</th><th>Actions</th></tr>
        </thead>
        <tbody>`;

    files.forEach((file) => {
        html += `
          <tr>
            <td>${file.name}</td>
            <td>
              <a href="/usb_files/read/${encodeURIComponent(file.name)}" target="_blank">View</a> | 
              <a href="/usb_files/download/${encodeURIComponent(file.name)}">Download</a> | 
              <a href="#" onclick="deleteFile('${file.name}')" style="color: red;">Delete</a>
            </td>
          </tr>`;
    });

    html += `
        </tbody>
      </table>
      <script>
        function deleteFile(fileName) {
          if (confirm("Are you sure you want to delete " + fileName + "?")) {
            fetch("/usb_files/delete/" + encodeURIComponent(fileName), { method: "DELETE" })
              .then(response => response.json())
              .then(data => {
                alert(data.message);
                location.reload();
              })
              .catch(err => alert("Error deleting file: " + err));
          }
        }
      </script>
    </body>
    </html>`;

    return html;
}

// Update cached HTML every 500ms
function updateHTMLCache() {
    try {
        let files = [];
        MEDIA_DIRECTORIES.forEach((mediaDir) => {
            if (fs.existsSync(mediaDir)) {
                files = files.concat(getFilesRecursively(mediaDir));
            }
        });
        cachedHTML = generateHTMLPage(files);
    } catch (err) {
        console.error(`Error updating HTML cache: ${err.message}`);
    }
}

setInterval(updateHTMLCache, 500);

// Function to copy job files to FabMo scripts directory
function copyFilesToFabmo(files) {
    let copiedFiles = [];
    files.forEach(file => {
        const srcPath = file.fullPath;
        const destPath = path.join(FABMO_SCRIPTS_DIR, file.name);

        try {
            fs.copyFileSync(srcPath, destPath);
            copiedFiles.push(destPath);
            console.log(`Copied ${file.name} to ${FABMO_SCRIPTS_DIR}`);
        } catch (err) {
            console.error(`Error copying ${file.name}: ${err.message}`);
        }
    });
    return copiedFiles;
}

// Function to submit jobs to FabMo
async function submitJobToFabmo(filePath, fileName) {
    const jobData = {
        file: filePath,
        name: fileName,
        description: "Imported from USB"
    };

    try {
        const response = await fetch("http://localhost:8080/fabmo/submit_job", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(jobData)
        });

        if (!response.ok) {
            throw new Error(`FabMo Job Submission Failed: ${await response.text()}`);
        }

        console.log(`Job added: ${fileName}`);
    } catch (err) {
        console.error(`Error submitting job ${fileName}: ${err.message}`);
    }
}

// Exporting routes
module.exports = function (server) {
    // Serve USB file listing HTML
    server.get("/usb_files", (req, res, next) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(cachedHTML);
        return next();
    });

    // Return JSON list of USB files
    server.get("/usb_files/list", (req, res, next) => {
        try {
            let files = [];
            MEDIA_DIRECTORIES.forEach(mediaDir => {
                if (fs.existsSync(mediaDir)) {
                    files = files.concat(getFilesRecursively(mediaDir));
                }
            });
            res.send(200, { files });
        } catch (err) {
            console.error(`Error listing USB files: ${err.message}`);
            res.send(500, { error: "Failed to retrieve file list" });
        }
        return next();
    });

    // Read a file
    server.get("/usb_files/read/:fileName", (req, res, next) => {
        const { fileName } = req.params;
        for (const mediaDir of MEDIA_DIRECTORIES) {
            const files = getFilesRecursively(mediaDir);
            const file = files.find(f => f.name === fileName);
            if (file) {
                return fs.createReadStream(file.fullPath).pipe(res);
            }
        }
        res.send(404, { error: "File not found" });
        return next();
    });

    // Download a file
    server.get("/usb_files/download/:fileName", (req, res, next) => {
        const { fileName } = req.params;
        for (const mediaDir of MEDIA_DIRECTORIES) {
            const files = getFilesRecursively(mediaDir);
            const file = files.find(f => f.name === fileName);
            if (file) {
                res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
                res.setHeader("Content-Type", "application/octet-stream");
                return fs.createReadStream(file.fullPath).pipe(res);
            }
        }
        res.send(404, { error: "File not found" });
        return next();
    });

    // Import jobs from USB to FabMo scripts and queue them
    server.post("/usb_files/import_jobs", async (req, res, next) => {
        let jobFiles = [];

        MEDIA_DIRECTORIES.forEach(mediaDir => {
            if (fs.existsSync(mediaDir)) {
                let allFiles = getFilesRecursively(mediaDir);
                let filteredFiles = allFiles.filter(file => file.name.endsWith(".gcode") || file.name.endsWith(".sbp"));
                jobFiles = jobFiles.concat(filteredFiles);
            }
        });

        if (jobFiles.length === 0) {
            res.send(404, { error: "No valid job files found on USB." });
            return next();
        }

        let copiedFiles = copyFilesToFabmo(jobFiles);

        // Submit copied jobs to FabMo queue
        for (let filePath of copiedFiles) {
            await submitJobToFabmo(filePath, path.basename(filePath));
        }

        res.send(200, { message: `${copiedFiles.length} job(s) imported successfully.` });
        return next();
    });
};
