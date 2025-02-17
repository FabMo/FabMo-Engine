const fs = require("fs");
const path = require("path");
const multer = require("multer");

const MEDIA_DIRECTORIES = ["/media/pi", "/mnt"];
let cachedHTML = ""; // Cache for the dynamically generated HTML

// Function to recursively get files
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

// Function to generate HTML content
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

// Function to update cached HTML
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

// Update cache every 500ms
setInterval(updateHTMLCache, 500);

module.exports = function (server) {
  // Serve the HTML page
  server.get("/usb_files", (req, res, next) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(cachedHTML);
    return next();
  });

  // Return JSON file list
  server.get("/usb_files/list", (req, res, next) => {
    try {
      let files = [];
      MEDIA_DIRECTORIES.forEach((mediaDir) => {
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
      const file = files.find((f) => f.name === fileName);
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
      const file = files.find((f) => f.name === fileName);
      if (file) {
        res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
        res.setHeader("Content-Type", "application/octet-stream");
        return fs.createReadStream(file.fullPath).pipe(res);
      }
    }
    res.send(404, { error: "File not found" });
    return next();
  });

  // Delete a file
  server.del("/usb_files/delete/:fileName", (req, res, next) => {
    const { fileName } = req.params;
    for (const mediaDir of MEDIA_DIRECTORIES) {
      const fullPath = path.join(mediaDir, fileName);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
          res.send(200, { message: `${fileName} deleted successfully!` });
          return next();
        } catch (err) {
          res.send(500, { error: `Failed to delete file: ${err.message}` });
          return next();
        }
      }
    }
    res.send(404, { error: "File not found" });
    return next();
  });

  // Upload a file
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      for (const dir of MEDIA_DIRECTORIES) {
        if (fs.existsSync(dir) && fs.accessSync(dir, fs.constants.W_OK)) {
          return cb(null, dir);
        }
      }
      cb(new Error("No writable media directory found."));
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname);
    },
  });
  const upload = multer({ storage });

  server.post("/usb_files/upload", (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err || !req.file) {
        res.send(400, { error: "File upload error." });
        return next();
      }
      res.redirect("/usb_files");
      return next();
    });
  });
};
