/* 小耶体感乐园 · Service Worker
   只做两件事：
   ① 让网站能"装"到桌面（PWA 的前提）
   ② 断网时还能打开首页（游戏本身需要联网，不缓存）           */

var CACHE = 'xiaoye-v2';
var SHELL = [
  './',
  './manifest.webmanifest',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .catch(function () {})
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) {
        return Promise.all(ks.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* 跨域（jsDelivr 的体感模型等）直接放行，不插手 */
  if (url.origin !== self.location.origin) return;

  /* 同源：网络优先，失败回缓存 —— 保证更新总能拿到，断网也不白屏 */
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var cp = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, cp); }).catch(function () {});
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('./');
          return new Response('', { status: 504, statusText: 'offline' });
        });
      })
  );
});