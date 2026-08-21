import path from "path"
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
    },
  },
});