/* LUMEN Service Worker — 离线优先缓存策略
 * 更新缓存内容时 bump CACHE_NAME 版本号（如 v1 -> v2），activate 会清理旧版本。
 */
const CACHE_NAME = 'lumen-v1';
const APP_SHELL = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 跨域资源（字体 CDN 等）交给浏览器默认处理，不在此缓存
  if (url.origin !== self.location.origin) return;

  // AI 接口：始终走网络，不缓存（需要实时响应）
  if (url.pathname.startsWith('/api/')) return;

  // 导航请求：network-first，断网时回退到缓存的 app shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // 静态资源与数据 JSON：stale-while-revalidate（命中缓存即返回，后台静默更新）
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});