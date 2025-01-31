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
        // Recursively get files from subdirectory
        files = files.concat(getFilesRecursively(fullPath));
      } else {
        // Add file to the list
        files.push({
          name: item.name,
          fullPath,
        });
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
      <title>Media Files</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 20px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th, td {
          padding: 10px;
          border: 1px solid #ddd;
        }
        th {
          background-color: #f4f4f4;
        }
        a {
          text-decoration: none;
          color: blue;
        }
        a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <h1>USB Media Files</h1>
      <table>
        <thead>
          <tr>
            <th>File Name</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  files.forEach((file) => {
    html += `
      <tr>
        <td>${file.name}</td>
        <td>
          <a href="/usb_files/read/${encodeURIComponent(
            file.name
          )}" target="_blank">View</a> | 
          <a href="/usb_files/download/${encodeURIComponent(
            file.name
          )}">Download</a> | 
          <a href="/usb_files/delete/${encodeURIComponent(
            file.name
          )}" style="color: red;">Delete</a>
        </td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </body>
    </html>
  `;

  return html;
}

// Function to periodically update the HTML cache
function updateHTMLCache() {
  try {
    let files = [];
    MEDIA_DIRECTORIES.forEach((mediaDir) => {
      if (fs.existsSync(mediaDir)) {
        files = files.concat(getFilesRecursively(mediaDir));
      }
    });
    cachedHTML = generateHTMLPage(files); // Update the cached HTML
  } catch (err) {
    console.error(`Error updating HTML cache: ${err.message}`);
  }
}

// Start periodic remapping every 500ms
setInterval(updateHTMLCache, 500);

// Function to define the USB file routes
module.exports = function (server) {
  // Route to display files in an HTML page
  server.get("/usb_files", (req, res, next) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(cachedHTML); // Serve the cached HTML
    return next();
  });

  server.get("/usb_files/read/:fileName", (req, res, next) => {
    const { fileName } = req.params;
  
    // Search for the file in all media directories
    for (const mediaDir of MEDIA_DIRECTORIES) {
      const files = getFilesRecursively(mediaDir); // Get all files recursively
      const file = files.find((f) => f.name === fileName); // Match by file name
      if (file) {
        // Stream the file content to the client
        fs.createReadStream(file.fullPath)
          .on("error", (err) => {
            console.error(`Error reading file: ${err.message}`);
            res.send(500, { error: "Failed to read file" });
            return next();
          })
          .pipe(res); // Pipe the stream to the response
        return next();
      }
    }
  
    // If the file is not found, return 404
    res.send(404, { error: "File not found" });
    return next();
  });
  
// Route to download a file
    server.get("/usb_files/download/:fileName", (req, res, next) => {
      const { fileName } = req.params;

      // Search for the file in all media directories
      for (const mediaDir of MEDIA_DIRECTORIES) {
        const files = getFilesRecursively(mediaDir); // Get all files recursively
        const file = files.find((f) => f.name === fileName); // Match by file name
        if (file) {
          res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
          res.setHeader("Content-Type", "application/octet-stream");

          // Stream the file content to the client
          fs.createReadStream(file.fullPath)
            .on("error", (err) => {
              console.error(`Error reading file: ${err.message}`);
              res.send(500, { error: "Failed to read file" });
              return next();
            })
            .pipe(res); // Pipe the stream to the response
          return next();
        }
      }

      // If the file is not found, return 404
      res.send(404, { error: "File not found" });
      return next();
    });



  // Route to delete a file
  server.del("/usb_files/delete/:fileName", (req, res, next) => {
    const { fileName } = req.params;
    for (const mediaDir of MEDIA_DIRECTORIES) {
      const fullPath = path.join(mediaDir, fileName);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
          res.redirect("/usb_files"); // Redirect to refresh the file list
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

  // Route to upload a file
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
      res.redirect("/usb_files"); // Redirect to refresh the file list
      return next();
    });
  });
};
