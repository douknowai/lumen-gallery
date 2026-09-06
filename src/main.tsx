import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router'
import './index.css'
import App from './App.tsx'
import CmsPage from './ui/CmsPage'
import { useStore, playerRef } from './state/store'

// 开发期调试钩子：在浏览器 console 可直接操作
//   window.__lumen.teleport(16.5, 0)     // 站到大卫头像旁
//   window.__lumen.look(Math.PI / 2)     // 转向 +X（东）
//   window.__lumen.state()               // 查当前 store/playerRef 状态
if (import.meta.env.DEV) {
  ;(window as unknown as { __lumen: unknown }).__lumen = {
    teleport: (x: number, z: number) => {
      playerRef.x = x;
      playerRef.z = z;
    },
    look: (yaw: number) => {
      playerRef.camYaw = yaw;
      playerRef.yaw = yaw;
    },
    state: () => ({
      appState: useStore.getState().appState,
      player: { x: playerRef.x, z: playerRef.z, yaw: playerRef.yaw, camYaw: playerRef.camYaw },
    }),
    store: useStore,
    playerRef,
  };
  console.info('[LUMEN] dev hook ready: window.__lumen { teleport, look, state }');
}

// PWA：生产环境注册 service worker 实现离线缓存（开发环境不注册，避免干扰 HMR）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败静默忽略，不影响主流程 */
    });
  });
}

// 注意：不使用 StrictMode（会导致 Canvas 效果重复执行）
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/cms" element={<CmsPage />} />
      <Route path="*" element={<App />} />
    </Routes>
  </BrowserRouter>,
)
