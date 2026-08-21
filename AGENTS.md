# AGENTS.md

## 项目概览

**LUMEN 流明 · 3D 虚拟展览馆** — 基于 Three.js + React Three Fiber 的浏览器端 3D 虚拟美术馆模板。

- **技术栈**：Vite 7 + React 19 + TypeScript 5 + Three.js 0.185 + React Three Fiber + Zustand + Tailwind CSS 3
- **AI 能力**：`coze-coding-dev-sdk`（LLM 流式对话 / TTS 语音合成 / ASR 语音识别），运行于 Node 后端
- **包管理器**：pnpm（禁止使用 npm/yarn）
- **端口**：通过 `DEPLOY_RUN_PORT` 环境变量读取（默认 5000）

## 构建与运行

```bash
pnpm install          # 安装依赖
pnpm run dev          # 开发模式（Vite HMR）
pnpm run build        # 类型检查 + 生产构建，输出 dist/
pnpm run preview      # 本地预览构建产物
pnpm run lint         # ESLint 代码检查
```

## 项目结构

```
src/
├── App.tsx                  # 根组件，视图层编排
├── main.tsx                 # 入口（BrowserRouter + 挂载）
├── config/
│   ├── schema.ts            # 展品/角色 TS 类型 + zod 校验
│   └── site.ts              # 速度/相机/灯光预算常量
├── state/store.ts           # Zustand 状态机
├── scene/
│   ├── Gallery.tsx           # Canvas 根组件
│   ├── Avatar.tsx            # 多角色系统
│   ├── FocusRing.tsx         # 聚焦光环
│   ├── textures.ts           # 程序化纹理
│   ├── architecture/         # 墙体/地板/天花/标题墙
│   ├── exhibits/             # 展品组件（WallFrame/Pedestal/Vitrine/Screen/Panel）
│   ├── lighting/             # 灯光系统（GalleryLighting/ExhibitSpot/SpotScheduler）
│   └── cameras/              # 相机系统（ThirdPersonRig/FirstPersonRig/IntroDolly）
├── systems/
│   ├── PlayerController.tsx  # 行走/转向/疾跑
│   ├── collision.ts          # 胶囊 vs AABB/圆柱碰撞
│   ├── zones.ts              # 区域判定
│   ├── interaction.ts        # 展品聚焦与交互
│   └── controls/             # 键盘/指针/触屏输入
├── ui/                       # UI 组件（HUD/ExhibitModal/ExhibitCall/Lightbox/Minimap/CharacterSelector）
├── lib/ai.ts                 # 后端 AI 接口封装（fetch + SSE 流式读取）
├── hooks/                    # 自定义 hooks
└── components/ui/            # shadcn/ui 组件库
api.mjs                       # Node 后端 AI 服务（/api/ai/*，含 LLM 流式 SSE/TTS/ASR）
public/
├── data/
│   ├── exhibits.json         # ★ 展品配置（数据驱动，换展改这里）
│   └── characters.json       # ★ 角色配置
└── assets/                   # 素材目录（artworks/videos/models/textures/characters）
```

## 核心设计原则

- **数据驱动**：展品、展区、文案、出生点全部来自 JSON，代码零硬编码内容
- **灯光预算**：同屏投影光源 ≤4，射灯按玩家距离就近激活
- **移动端降级**：pixelRatio 限制 1.5、关闭射灯阴影、玻璃改磨砂
- **弹窗降帧**：打开弹窗时 3D 降到 30fps
- **AI 语音讲解**：开启后每件展品可「打电话式」对话，链路为 录音 → ASR → LLM 流式 → TTS 播放，全部走 Node 后端真实 SDK 调用

## 状态机

`loading → ready → entering → explore ⇄ modal ⇄ call ⇄ lightbox ⇄ characters`

## 注意事项

- 不使用 React StrictMode（会导致 Canvas 效果重复执行）
- 展品配置错误时控制台输出中文警告并跳过，不阻断整个展览
- 角色切换持久化到 localStorage（`lumen.character`）
- AI 语音讲解开关持久化到 localStorage（`lumen.ai`）
- 后端 AI 接口：`/api/ai/narrate`（口播）、`/api/ai/chat`（SSE 流式对话）、`/api/ai/tts`（合成）、`/api/ai/asr`（识别）

## Git 个人账号接管脚本（scripts/git-sync/）

- **用途**：项目在「公司扣子账号」上部署/打磨后，一键把当前环境的 git 接管回**开发者个人 GitHub 账号**（身份、origin、凭据）。
- **文件**：`scripts/git-sync/setup-git.sh`（执行脚本）、`config.example.sh`（配置模板）、`config.sh`（真实配置，含 PAT，**已被 .gitignore，严禁入库**）。
- **用法**：`cp scripts/git-sync/config.example.sh scripts/git-sync/config.sh` → 填写账号与永久 PAT → `bash scripts/git-sync/setup-git.sh`。
- **永久 PAT**：GitHub → Developer settings → Tokens (classic)，Expiration 选 `No expiration`，勾选 `repo`。
- **关键实现**：凭据写入 `~/.git-credentials`（0600）；**连接校验用内联 token 且先于写凭据**，避免 git credential-store 在 token 被拒时误清空凭据库；重复运行自动去重。
