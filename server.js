/* Minimal static server for previewing SHEGLAM PK locally. */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 5599;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";

    let filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    // Clean URLs: /face -> /face.html
    if (!path.extname(filePath) && fs.existsSync(filePath + ".html")) filePath += ".html";

    fs.readFile(filePath, (err, data) => {
      if (err) {
        const nf = path.join(ROOT, "404.html");
        if (fs.existsSync(nf)) {
          res.writeHead(404, { "Content-Type": TYPES[".html"] });
          return res.end(fs.readFileSync(nf));
        }
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("Not found");
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log("SHEGLAM PK running on http://localhost:" + PORT));
