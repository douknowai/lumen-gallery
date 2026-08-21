# LUMEN 流明 · 3D 虚拟展览馆

一个**可复用**的浏览器端 3D 虚拟美术馆模板：一次搭建，换数据即换展。
适用于作品集展示、品牌宣传、艺术展览、博物馆、数字展厅等场景。

- 渲染引擎：Three.js + React Three Fiber（TypeScript）
- 数据驱动：全部展品由 `public/data/exhibits.json` 配置，**无需改代码**即可换展
- 演示内容：19 件展品 —— 11 件公共领域画作 + 4 件真实 3D 扫描雕塑（维纳斯 / 大卫头像 / 思想者 / 掷铁饼者，来自 SMK 丹麦国家美术馆与独立扫描者，CC0 / CC-BY）+ 文本 / 视频 / 链接展品，来源与许可见 `public/assets/ASSETS-LICENSE.md`
- AI 语音讲解：每件展品可「打电话式」对话（录音 → ASR → LLM 流式 → TTS 播报），见「四、AI 语音讲解」

---

## 一、快速开始

```bash
# 环境要求：Node.js 20+（推荐 22+）与 pnpm
pnpm install      # 安装依赖
pnpm dev          # 开发模式，默认 http://localhost:5000（端口由 DEPLOY_RUN_PORT 决定）
pnpm build        # 类型检查 + 生产构建，输出 dist/
pnpm preview      # 本地预览构建产物
pnpm lint         # ESLint 代码检查
```

浏览器打开后：加载完成 → 点击「进入展厅」→ 开始漫游。

### 操作方式

| 平台 | 操作 |
|---|---|
| 桌面 | `WASD / 方向键` 行走 · `Shift` 疾跑 · 鼠标拖拽（或点击画面锁定指针）转视角 · 滚轮缩放 · `V` 切换第一 / 第三人称 · `E` 查看聚焦展品 · `H` 帮助 · `Esc` 返回 / 释放指针 |
| 移动端 | 左下虚拟摇杆移动 · 右侧屏幕拖拽转视角 · 双指捏合缩放 · 点按展品直接打开详情 |

靠近展品时：射灯增亮 + 地面黄铜光环呼吸，按 `E` 或点击打开博物馆标签式详情弹窗；图片类展品支持「放大浏览」进入全屏灯箱（滚轮 / 捏合缩放 ×1–×4）。

顶栏「角色」按钮可在 4 个内置角色间即时切换（Quaternius CC0），配置见「三、角色系统」。

---

## 二、换展只需三步（核心用法）

> 类比：`exhibits.json` 是「展览策划案」，代码是「展馆建筑与工作人员」。换展 = 换策划案 + 换展品，建筑不动。

1. **放素材** —— 把新素材放进 `public/assets/` 对应目录：
   - 图片 → `artworks/`（JPG，长边 ≤1600px）
   - 视频 → `videos/`（MP4 + 同名 poster.jpg）
   - 模型 → `models/`（GLB，建议 Draco 压缩 ≤2MB；不配模型会自动用程序化抽象雕塑占位）
2. **改配置** —— 编辑 `public/data/exhibits.json`：改 `gallery` 展览文案与出生点，增删 `exhibits` 数组里的展品（字段见下表）。
3. **刷新** —— 标题墙、前言面板、小地图、弹窗全部自动更新。

### exhibits.json 字段速查

```jsonc
{
  "gallery": {                       // 展览全局信息
    "title": "经典的回响", "titleEn": "Echoes of the Masters",
    "subtitle": "…", "preface": "…",  // 前言显示在序厅面板
    "spawn": { "position": [0,0,5.2], "headingDeg": 180 },  // 出生点
    "accent": "#A67C3D"               // 主题强调色（聚焦光环 / 按钮）
  },
  "zones": [ /* 展区，bounds=[minX,minZ,maxX,maxZ]，同时驱动碰撞与小地图 */ ],
  "exhibits": [{
    "id": "P-01",                    // 唯一编号
    "type": "image",                 // image | video | model | text | link
    "zone": "painting",              // 所属 zones[].id
    "mount": "wall-frame",           // wall-frame | pedestal | vitrine | screen | panel
    "title": "神奈川冲浪里", "titleEn": "The Great Wave",
    "artist": "葛饰北斋", "year": "c.1831", "medium": "木刻版画",
    "credit": "大都会艺术博物馆 · Public Domain",
    "description": "…",               // 弹窗正文（≤300字）
    "src": "/assets/artworks/hokusai-wave.jpg",
    "position": [-16, 1.6, -4.94],   // 世界坐标（米）
    "rotationDeg": 0,                // 朝向，0 = 面向 +Z
    "size": { "w": 1.6, "h": 1.1 },  // 物理尺寸（米）
    "frame": "black",                // oak | black | gilt | none（wall-frame 专用）
    "focusRadius": 2.6,              // 聚焦触发半径（可选）
    "spotlight": true,               // 是否配轨道射灯（可选）
    "spin": true,                    // pedestal 展品缓速自转（可选）
    // —— model（pedestal）专用字段 ——
    "modelScale": 1,                 // 模型整体缩放倍率（可选）
    "modelRotationDeg": 0            // 模型绕 X 轴矫正（度数，可选）；扫描「躺平」的雕塑配 -90 让它立起
  }]
}
```

**类型 × 展陈方式**：image→wall-frame/vitrine · text→panel · video→screen · model→pedestal · link→panel（带「前往访问 ↗」按钮）。
配置错误（坐标越界 / zone 不存在 / 类型不符）时控制台输出**中文警告并跳过该展品**，不会让整个展览崩掉。

### 坐标怎么定？

展厅是固定几何（序厅 + 西翼绘画长廊 + 东翼雕塑厅 + 北侧影像厅，共 19 个预留点位）。所有墙画 `position` 的 X/Z 贴墙（墙面坐标见 `src/scene/architecture/Walls.tsx` 顶部注释），Y 为画面中心高（挂画一般 1.6m）；座地展品 Y=0。运行时看浏览器控制台的警告可快速定位配错的展品。

---

## 三、角色系统（characters.json）

漫游角色由 `public/data/characters.json` 配置驱动：顶栏「设置」按钮（或加载页「设置 →」）
打开选择器即时切换，原地淡入生效；选择持久化到 localStorage（`lumen.character`），下次访问自动恢复。

### 内置角色一览

| id | 名称 | 定位 | 模型 | 身高 |
|---|---|---|---|---|
| casual-man | 阿澈 | 休闲男观众 | Quaternius（CC0） | 1.78m |
| casual-woman | 小满 | 休闲女观众 | Quaternius（CC0） | 1.70m |
| business-man | 顾先生 | 商务正装 | Quaternius（CC0） | 1.80m |
| worker | 老周 | 场馆工作人员 | Quaternius（CC0） | 1.76m |

### characters.json 字段

```jsonc
{
  "default": "casual-man",          // 默认角色 id（本地未选择时使用）
  "characters": [{
    "id": "casual-man",             // 唯一编号
    "name": "阿澈",                 // 选择器卡片主标题
    "label": "休闲男观众",           // 定位标签
    "desc": "…",                    // 一句话描述
    "src": "/assets/characters/casual-man.glb",  // GLB 路径；null = 内置程序化人台
    "height": 1.78,                 // 目标身高（米）：按包围盒等比缩放、脚底对齐地面
    "clips": {                      // 可选：动画 clip 名映射（命名不符约定时用）
      "idle": "CharacterArmature|Idle",
      "walk": "CharacterArmature|Walk",
      "run":  "CharacterArmature|Run"
    }
  }]
}
```

配置错误（字段缺失 / id 重复 / default 不存在）时控制台输出**中文警告**并跳过坏条目或回退默认；
整个文件缺失或彻底不合法时回退为「仅内置人台」，不阻断展览。

### 添加自己的角色

1. 把 GLB 放进 `public/assets/characters/`（建议 ≤2MB，含骨骼动画）。
2. 在 `characters.json` 的 `characters` 数组里加一条配置（字段见上）。
3. 动画命名约定：需含 `CharacterArmature|Idle`、`CharacterArmature|Walk`、`CharacterArmature|Run`
   三条 clip（Quaternius 角色包天然符合；注意包内 `animations[0]` 是 Death，务必**按名索引**）。
   命名不同则用 `clips` 字段显式映射（如 `"idle": "MyRig|Stand"`）。
4. 模型需 **+Z 朝前**建模（与朝向约定一致）；身高由 `height` 字段归一化，无需手动缩放。

动画状态机：速度 <0.1 m/s 播 Idle、<3.1 m/s 播 Walk、更快播 Run（疾跑），
切换时 0.25s crossFade 平滑过渡。全部 GLB 在加载页统一预载并计入进度条，
运行中切换角色为内存缓存命中、无需等待。

---

## 四、AI 语音讲解

开启后，每件展品都能以**第一人称**与你语音对话，交互形态是「打电话」：展品是通话对象，UI 表现为通话卡片 + 展品头像 + 左右对话气泡，而非技术面板。

- **链路**：录音 → ASR 语音识别 → LLM 流式对话 → TTS 语音合成播放
- **输入模式**（二选一，持久化记忆）：
  - **按住说话**：长按麦克风按钮或按住 `空格` 键，松手结束
  - **免提**：前端 Web Audio 能量检测（VAD）自动断句，无需按键
- **通话形态**：可折叠为悬浮胶囊 + 底部字幕，边走动边看展品边对话；AI 播报 / 回复以影视字幕显示在页面底部，你说的内容以更小一号文字叠于其上
- **音色**：小荷 / 灿灿（女声）、云舟 / 一尘（男声），默认「小荷」

### 后端接口（`api.mjs`，均为 POST）

| 接口 | 作用 |
|---|---|
| `/api/ai/narrate` | 展品口播介绍（LLM 生成口播稿 → TTS 合成） |
| `/api/ai/chat` | 与展品对话（LLM 流式，SSE 打字机式返回） |
| `/api/ai/tts` | 文本转语音 |
| `/api/ai/asr` | 语音识别（base64 或 URL） |

展品「人格」通过 system prompt 注入，做到数据驱动、每件展品有自己的故事，后端零文件依赖。

> **运行依赖**：AI 能力基于 `coze-coding-dev-sdk`，需在支持该 SDK 的运行环境（如 Coze 开发 / 生产环境）中运行，SDK 从运行环境读取鉴权信息。纯本地静态预览时 `/api/ai/*` 不可用，其余展厅功能不受影响。

---

## 五、目录说明

```
public/
  data/exhibits.json        ★ 展品配置文件（换展改这里）
  data/characters.json      ★ 角色配置文件（换角色改这里）
  assets/
    artworks/  videos/  models/  textures/   # 素材目录（换展替换这里）
    characters/                              # 角色 GLB（Quaternius CC0）
    ASSETS-LICENSE.md                          # 演示素材来源与许可清单
src/
  config/     schema.ts（展品+角色 TS 类型 + zod 校验）· site.ts（速度/相机/灯光预算常量）· voices.ts（讲解音色）
  state/      store.ts（zustand 状态机：loading→ready→entering→explore⇄modal⇄call⇄lightbox⇄characters）
  scene/      Gallery.tsx（Canvas 根组件）
    architecture/   墙体 / 地板 / 天花 / 轨道 / 标题墙（固定几何）
    exhibits/       ExhibitRoot（按配置分发）→ WallFrame / Pedestal / Vitrine / Screen / Panel
    lighting/       半球光+天窗平行光 / 展品射灯 / SpotScheduler（就近激活 ≤8 盏）
    cameras/        ThirdPersonRig / FirstPersonRig / IntroDolly / CameraDirector
    Avatar.tsx（多角色：GLB 骨骼动画 + 程序化人台回退）· FocusRing.tsx · textures.ts（程序化纹理）
  systems/    PlayerController（行走/转向/疾跑）· collision.ts（胶囊 vs AABB/圆柱）
              zones.ts（区域判定）· interaction.ts（最近展品聚焦 + 射线点击）
              controls/  键盘 / 指针视角 / 触屏摇杆与捏合
  lib/        ai.ts（后端 AI 接口封装：fetch + SSE 流式读取）
  ui/         LoadingOverlay / HUD / CharacterSelector（设置面板）/ Minimap(SVG 小地图) / ExhibitModal / ExhibitCall（语音通话）/ Lightbox / 移动端控件等
api.mjs       # AI 语音讲解后端（/api/ai/*，基于 coze-coding-dev-sdk）
server.js     # 生产静态服务（含 SPA 回退 + /api 分发）
scripts/
  smoke-characters.mjs      # 角色系统冒烟测试（GLB clip 校验 + characters.json zod 校验）
```

组件均可单独抽离复用：例如把 `scene/exhibits/WallFrame.tsx` 拿走就是一个带博物馆标签的画框组件。

---

## 六、技术要点（为什么这么设计）

- **数据驱动**：展品、展区、文案、出生点全部来自 JSON；代码零硬编码内容。
- **碰撞**：角色是胶囊体，墙体 / 展台是 AABB / 圆柱，逐帧解算推挤——墙体数据与 `zones` 共用同一份坐标合同，不会出现「撞墙判定和小地图不一致」。
- **灯光预算**：同屏投影光源 ≤4（1 盏 2048 平行光 + ≤3 盏 512 射灯），射灯按玩家距离就近激活——美术馆可以挂 19 盏灯，但只点亮你身边的几盏，帧率才稳。
- **移动端降级**：pixelRatio 限制 1.5、关闭射灯阴影、玻璃改磨砂、雾裁远景。
- **弹窗降帧**：打开弹窗时 3D 降到 30fps 省电；`frameloop` 按需推进。
- **纹理零依赖**：地板 / 灰泥墙纹理由 `src/scene/textures.ts` 运行时 Canvas 程序化生成，无外部素材、许可干净。

### URL 参数（可选）

| 参数 | 作用 |
|---|---|
| `?enter=1` | 资源就绪后自动进入展厅（kiosk / 嵌入式数字展厅免点击） |
| `?lowspec=1` | 低性能模式：关阴影、渲染分辨率减半、关抗锯齿（极弱设备兜底） |

---

## 七、常见问题

- **构建报错 `Cannot find module 'framer-motion'`**？说明 `node_modules` 是旧模板的，`pnpm install` 一次即可（依赖在 package.json 里已声明）。
- **展品没出现**？打开浏览器控制台看中文警告——90% 是 `position` 越界或 `zone` 拼写与 zones[].id 不一致。
- **图片黑 / 裂**？检查 `src` 路径是否以 `/assets/...` 开头（public 目录下的文件用根路径引用，不要写 `public/`）。
- **想换 / 加角色模型**？把 glb 放进 `public/assets/characters/`，在 `public/data/characters.json` 里加一条配置即可（动画命名约定与 `clips` 映射见「三、角色系统」），无需改代码。
- **AI 语音讲解没反应**？请确认运行环境支持 `coze-coding-dev-sdk` 并已正确配置鉴权；纯静态托管下 `/api/ai/*` 不可用。

---

## 八、部署

项目包含一个轻量 Node 服务（`server.js`）：在提供静态前端的同时承载 `/api/ai/*` 语音讲解接口。

```bash
pnpm build               # 产出 dist/（已包含 server.js 与 api.mjs）
node dist/server.js      # 启动服务，默认端口 5000（由 DEPLOY_RUN_PORT 决定）
```

- **完整部署（含 AI 语音讲解）**：把 `dist/` 部署到任意 Node.js 运行时，启动命令 `node dist/server.js`；AI 能力依赖 `coze-coding-dev-sdk`，需在支持该 SDK 的运行环境（如 Coze 环境）中运行。
- **仅静态展示（不用 AI）**：把 `dist/` 上传到任意静态托管（Vercel / Netlify / Cloudflare Pages / Surge 等）即可，但 `/api/ai/*` 不可用；若托管在子路径下，把 `vite.config.ts` 的 `base` 与 `public/404.html` 的 `basePath` 改成对应子路径。

---

## 九、许可

- 代码：MIT（可自由商用 / 二改）
- 演示素材：全部为公共领域或 CC0 / CC-BY 资源，逐件来源见 `public/assets/ASSETS-LICENSE.md`；视频为 Blender 基金会《Sintel》预告片（CC-BY 3.0）；角色模型为 Quaternius 出品（Public Domain / CC0）。换成自己的素材后请更新该清单。