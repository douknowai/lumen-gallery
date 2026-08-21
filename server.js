import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./api.mjs";

const PORT = parseInt(process.env.DEPLOY_RUN_PORT || "5000", 10);
// 从自身所在目录提供静态文件（build 阶段会复制到 dist/ 中）
const DIST = dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

createServer(async (req, res) => {
  try {
    let pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;

    // AI 接口：先交给 api.mjs 处理（LLM / TTS / ASR）
    if (pathname.startsWith("/api/")) {
      await handleApiRequest(req, res);
      return;
    }

    if (pathname === "/") pathname = "/index.html";

    const filePath = join(DIST, pathname);

    // 安全：防止目录穿越
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (!existsSync(filePath)) {
      // SPA fallback: 非静态资源回退到 index.html
      const fallback = join(DIST, "index.html");
      if (existsSync(fallback)) {
        const content = await readFile(fallback);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(content);
        return;
      }
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(500);
    res.end("Internal Server Error");
    console.error(err);
  }
}).listen(PORT, () => {
  console.log(`Serving dist/ on http://0.0.0.0:${PORT}`);
});
