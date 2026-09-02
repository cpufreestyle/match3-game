// 糖果消消乐 Service Worker - 缓存优先策略，支持离线游玩
const CACHE_NAME = 'candy-match-v8'; // ⚠️ 每次部署更新 game.js/style.css/index.html 后必须递增版本号，否则玩家永远加载旧缓存
const ASSETS = [
    './',
    './index.html',
    './privacy.html',
    './style.css',
    './game.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

// 安装：预缓存核心资源
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// 请求拦截：缓存优先，未命中回源并写入缓存（仅同源 GET）
self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

    e.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((resp) => {
                if (resp && resp.ok) {
                    const copy = resp.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return resp;
            }).catch(() => cached);
        })
    );
});
