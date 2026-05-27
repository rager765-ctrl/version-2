// ═══════════════════════════════════════════════════════════════
//  Kwabz Store — Service Worker v3
//  Handles: Cache/Fetch, Firebase Messaging Background Push,
//           Notification Click Navigation
// ═══════════════════════════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ─── Firebase Init (mirrors config.js) ──────────────────────
firebase.initializeApp({
  apiKey: "AIzaSyAt6xHMVvJ82iJSb8XO_bYGfxLKncG8oUE",
  authDomain: "mr-rager.firebaseapp.com",
  projectId: "mr-rager",
  storageBucket: "mr-rager.firebasestorage.app",
  messagingSenderId: "731077938078",
  appId: "1:731077938078:web:878fc483d6e1921bcca48f"
});

const messaging = firebase.messaging();

// ─── Background FCM Message Handler ─────────────────────────
// Fires when app is in the background / closed and a push arrives via FCM
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background FCM message received:', payload);

  const { title, body, image } = payload.notification || {};
  const data = payload.data || {};

  self.registration.showNotification(title || '🛍️ New Arrival at Kwabz Store!', {
    body: body || 'Check out the latest drop now.',
    icon: '/icon-192x192.png',
    badge: '/icon-72x72.png',
    image: image || data.image_url || '',
    tag: 'kwabz-new-product-' + (data.product_id || Date.now()),
    renotify: true,
    data: {
      product_id: data.product_id || '',
      url: data.product_id
        ? `/product-detail.html?id=${data.product_id}`
        : '/shop.html'
    },
    actions: [
      { action: 'view', title: '👀 View Product' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  });
});

// ─── Notification Click Handler ──────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/shop.html';
  const fullUrl = self.location.origin + targetUrl;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus an already-open tab if one exists
      for (const client of windowClients) {
        if (client.url === fullUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) return clients.openWindow(fullUrl);
    })
  );
});

// ─── Cache Config ────────────────────────────────────────────
// Auto-stamped at install time — no manual bumping needed.
// Every new SW deploy gets a unique version, forcing cache refresh.
// IMPORTANT: Bump SW_VERSION on every deploy to force cache refresh on all devices.
// Last bumped: 2026-05-27
const SW_VERSION = 'kwabz-store-prod-v8';
const CACHE_CODE  = SW_VERSION + '-code';   // HTML / JS / CSS  → Network-First
const CACHE_ASSET = SW_VERSION + '-assets'; // Images / Icons    → Cache-First

// Code files: always try the network first so GitHub deploys take effect immediately.
const CODE_EXTENSIONS = ['.html', '.js', '.css', '.json'];

// Static assets that rarely change — serve from cache for speed.
const STATIC_ASSETS = [
  'favicon.png',
  'apple-touch-icon.png',
  'icon-72x72.png',
  'icon-96x96.png',
  'icon-128x128.png',
  'icon-144x144.png',
  'icon-152x152.png',
  'icon-192x192.png',
  'icon-192.png',
  'icon-384x384.png',
  'icon-512x512.png',
  'icon-512.png',
  'maskable-icon.png',
];

// ─── Install: pre-cache static assets only ───────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_ASSET).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Take control immediately — don't wait for old SW to die
  self.skipWaiting();
});

// ─── Activate: delete ALL old caches ─────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_CODE && key !== CACHE_ASSET)
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch Strategy ──────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  const isGstatic = url.origin === 'https://www.gstatic.com';
  if (e.request.method !== 'GET' || (url.origin !== self.location.origin && !isGstatic)) return;

  const path = url.pathname;
  const isCodeFile = !isGstatic && (CODE_EXTENSIONS.some((ext) => path.endsWith(ext)) || path === '/' || path.endsWith('/'));

  if (isCodeFile) {
    // ── Stale-While-Revalidate for HTML / JS / CSS ─────────
    // Instantly serves the cached page in under 1ms, while fetching any updates
    // in the background to keep the PWA freshly synchronized without flashes.
    e.respondWith(
      caches.match(e.request).then((cachedRes) => {
        const networkFetch = fetch(e.request).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_CODE).then((cache) => cache.put(e.request, resClone));
          }
          return networkRes;
        }).catch((err) => {
          console.warn('[SW] Background revalidation failed:', err);
        });

        return cachedRes || networkFetch;
      })
    );
  } else {
    // ── Cache-First for images / icons ─────────────────────
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_ASSET).then((cache) => cache.put(e.request, resClone));
          }
          return networkRes;
        });
      })
    );
  }
});

