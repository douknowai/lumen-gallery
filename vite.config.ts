import path from "path"
import fs from "node:fs"
import react from "@vitejs/plugin-react"
import { defineConfig, type Connect } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'

/**
 * 开发环境中，将 /api/ai/* 路由转发给 Node 侧的 api.mjs（调用 coze-coding-dev-sdk）。
 * 生产环境则由 dist/server.js 在静态服务前处理同样的路由，二者复用同一份实现。
 */
function lumenAiApi() {
  return {
    name: "lumen-ai-api",
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "") as string
        // dev-only 截图端点：接收 canvas.toDataURL 的 base64 落盘（素材采集辅助）
        if (url.startsWith("/api/dev-screenshot") && req.method === "POST") {
          let body = ""
          req.on("data", (c) => (body += c))
          req.on("end", () => {
            try {
              const { name, data } = JSON.parse(body)
              const dir = path.resolve("dev-shots")
              fs.mkdirSync(dir, { recursive: true })
              fs.writeFileSync(path.join(dir, name), Buffer.from(data, "base64"))
              res.end("ok")
            } catch (e) {
              res.writeHead(500)
              res.end(String(e))
            }
          })
          return
        }
        if (!url.startsWith("/api/")) {
          next()
          return
        }
        try {
          // 动态 import：仅在请求到达时才加载，避免打包器在加载 config 时介入 SDK
          const { handleApiRequest } = await import("./api.mjs")
          await handleApiRequest(req, res)
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" })
          }
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "AI 服务调用失败" }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [inspectAttr(), react(), lumenAiApi()],
  server: {
    port: Number(process.env.DEPLOY_RUN_PORT) || 5000,
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // 生产禁用 WebXR 模拟器：@iwer/* 仅用于浏览器内模拟 XR 设备（含约 5MB 房间模型），
      // 真机 Quest 场景不需要，替换为空实现以避免被 rollup 打进产物。
      "@iwer/devui": path.resolve(__dirname, "./src/scene/xr/shims/emulate-deps.js"),
      "@iwer/sem": path.resolve(__dirname, "./src/scene/xr/shims/emulate-deps.js"),
      iwer: path.resolve(__dirname, "./src/scene/xr/shims/emulate-deps.js"),
    },
  },
  build: {
    // three / recharts 为单体大依赖，单独成 chunk 提升并行加载与 PWA 长期缓存命中；阈值贴合重 3D 应用实际体量
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          charts: ["recharts"],
        },
      },
    },
  },
});