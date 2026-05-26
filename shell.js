/**
 * Kwabz Store — Unified App Shell Logic v3
 * Handles: Common UI, Firebase init, Push Notifications
 */

import { firebaseConfig, STORE_NAME } from './config.js';

const AppShell = {
  _notifListenerActive: false,

  init() {
    this.checkForForceUpgrade();
    this.initFirebase();
    this.injectCommonUI();
    this.setupEventListeners();
    this.initNotifications();
    this.initServiceWorker();
  },

  checkForForceUpgrade() {
    const CURRENT_VERSION = 'kwabz-store-prod-v7';
    const savedVersion = localStorage.getItem('kwabz_sw_version_installed');
    if (savedVersion !== CURRENT_VERSION) {
      console.log(`[PWA Shell] Version upgrade detected: ${savedVersion} -> ${CURRENT_VERSION}. Performing nuclear cache purge...`);
      localStorage.setItem('kwabz_sw_version_installed', CURRENT_VERSION);
      
      // Unregister all service workers immediately
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
          for (const reg of registrations) {
            reg.unregister().then(() => console.log('[PWA Shell] Unregistered SW:', reg.scope));
          }
        });
      }
      
      // Delete all Cache Storage instances
      if ('caches' in window) {
        caches.keys().then(keys => {
          Promise.all(keys.map(key => caches.delete(key)))
            .then(() => {
              console.log('[PWA Shell] Deleted all caches.');
              // Hard reload after cache clearing
              setTimeout(() => {
                window.location.reload(true);
              }, 800);
            });
        });
      } else {
        setTimeout(() => window.location.reload(true), 800);
      }
    }
  },

  // ─── Unified Service Worker & Live Sync Engine ────────────────
  initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      console.log('[PWA Shell] Service Worker controller changed. Reloading page immediately to activate new database version...');
      window.location.reload();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => {
          console.log('[PWA Shell] SW Registered at scope:', reg.scope);

          // Highly reactive background updates checks (every 15 mins)
          setInterval(() => {
            reg.update();
          }, 900000);

          // Listen for live Firestore version broadcasts to force background cache invalidation
          if (typeof KwabzStore !== 'undefined') {
            KwabzStore.on('settings_changed', (settings) => {
              const theme = settings?.theme || {};
              if (theme.appVersion) {
                const currentVer = localStorage.getItem('kwabz_app_version') || 'v_initial';
                if (theme.appVersion !== currentVer) {
                  console.log(`[PWA Shell] Real-time version change detected: ${currentVer} -> ${theme.appVersion}. Pulling update...`);
                  localStorage.setItem('kwabz_app_version', theme.appVersion);
                  reg.update();
                }
              }
            });
          }
        })
        .catch(err => console.error('[PWA Shell] SW Registration Failed:', err));
    });
  },

  // ─── Firebase ────────────────────────────────────────────────
  initFirebase() {
    if (typeof firebase === 'undefined') {
      console.warn('[AppShell] Firebase SDK not found on page.');
      return;
    }
    if (!firebase.apps.length) {
      try {
        firebase.initializeApp(firebaseConfig);

      } catch (e) {
        console.error('[AppShell] Firebase Init Error:', e);
      }
    }
    if (typeof KwabzStore !== 'undefined') {
      KwabzStore.init();

      const handleStoreReady = () => {
        window._kwabzStoreReady = true;
        (window._kwabzReadyCallbacks || []).forEach(fn => { try { fn(); } catch(e) { console.error('[AppShell] _onStoreReady callback error:', e); } });
        window._kwabzReadyCallbacks = [];
      };

      if (typeof KwabzStore.isInitialized === 'function' && KwabzStore.isInitialized()) {
        handleStoreReady();
      } else {
        KwabzStore.on('store_initialized', handleStoreReady);
      }

      // ─── Apply Global Brand Theme ───
      const isPreviewPage = window.location.search.includes('preview=');
      if (!isPreviewPage) {
        const settings = KwabzStore.getSettings();
        const theme = (settings && settings.theme) ? settings.theme : settings;
        if (theme && typeof KwabzUtils !== 'undefined' && KwabzUtils.applyGlobalTheme) {
          KwabzUtils.applyGlobalTheme(theme);
        }
      }

      KwabzStore.on('settings_changed', (settings) => {
        if (window.location.search.includes('preview=')) return;
        const theme = (settings && settings.theme) ? settings.theme : settings;
        if (theme && typeof KwabzUtils !== 'undefined' && KwabzUtils.applyGlobalTheme) {
          KwabzUtils.applyGlobalTheme(theme);
        }
      });

      // ─── Visitor Tracking ───────────────────────────────────────
      // Wait for auth state to resolve so registered users get their UID linked.
      // trackVisitor() is a no-op on admin pages (checked internally).
      const _doTrack = () => {
        if (typeof KwabzStore.trackVisitor === 'function') {
          KwabzStore.trackVisitor();
        }
      };
      // If auth is already resolved, track now; otherwise wait for the event
      if (KwabzStore.isAuthReady && KwabzStore.isAuthReady()) {
        _doTrack();
      } else {
        KwabzStore.on('user_changed', _doTrack);
      }
    }
  },

  // ─── Common UI ───────────────────────────────────────────────
  injectCommonUI() {
    const body = document.body;

    // Side Drawer
    if (!document.getElementById('sideDrawer')) {
      const currentPage = window.location.pathname.split('/').pop() || 'index.html';
      const drawer = document.createElement('div');
      drawer.id = 'sideDrawer';
      drawer.className = 'modal-overlay';
      drawer.innerHTML = `
        <div class="modal-content" style="position:fixed;left:0;top:0;height:100%;width:20rem;max-width:80vw;border-radius:0 var(--radius-xl) var(--radius-xl) 0;transform:translateX(-100%);display:flex;flex-direction:column;padding:2rem;">
          <div style="margin-bottom:3rem;">
            <h2 class="font-headline" style="font-weight:900;font-size:1.125rem;letter-spacing:-0.04em;text-transform:uppercase;">${STORE_NAME}</h2>
            <p class="text-label-sm" style="color:var(--outline);">Student-Life Commerce</p>
          </div>
          <nav style="flex:1;display:flex;flex-direction:column;gap:0.25rem;">
            <a href="index.html" class="drawer-link ${currentPage === 'index.html' ? 'active' : ''}"><span class="material-symbols-outlined">home</span> Home</a>
            <a href="shop.html" class="drawer-link ${currentPage === 'shop.html' ? 'active' : ''}"><span class="material-symbols-outlined">storefront</span> Shop</a>
            <a href="sellers.html" class="drawer-link ${currentPage === 'sellers.html' ? 'active' : ''}"><span class="material-symbols-outlined">store</span> Mini Stores</a>
            <a href="account.html" class="drawer-link ${currentPage === 'account.html' ? 'active' : ''}"><span class="material-symbols-outlined">person</span> My Account</a>
            <div style="height:1px;background:var(--outline-variant);opacity:0.3;margin:1rem 0;"></div>
            <a href="admin-login.html" class="drawer-link ${currentPage.startsWith('admin-') ? 'active' : ''}"><span class="material-symbols-outlined">admin_panel_settings</span> Admin Panel</a>
          </nav>
        </div>
      `;
      body.appendChild(drawer);
    }

    // Global styles (drawer + notification banner)
    if (!document.getElementById('shell-styles')) {
      const style = document.createElement('style');
      style.id = 'shell-styles';
      style.textContent = `
        /* ── Side Drawer ── */
        .drawer-link {
          display:flex; align-items:center; gap:1rem;
          padding:0.875rem 1rem; border-radius:var(--radius-lg);
          font-family:var(--font-headline); font-size:0.875rem;
          font-weight:600; color:var(--secondary);
          text-decoration:none; transition:background 0.2s;
        }
        .drawer-link:hover { background: var(--surface-container-high); }
        .drawer-link.active { background:var(--primary); color:var(--on-primary); }
        #sideDrawer .modal-content { transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        #sideDrawer.open .modal-content { transform: translateX(0) !important; }

        /* ── Notification Permission Banner ── */
        #kwabz-notif-banner {
          position: fixed; bottom: 5.5rem; left: 1rem; right: 1rem; z-index: 1000;
          background: var(--surface-container-highest);
          border: 1px solid var(--outline-variant);
          border-radius: var(--radius-2xl);
          padding: 1rem 1.25rem;
          display: flex; align-items: center; gap: 1rem;
          box-shadow: 0 8px 32px rgba(0,0,0,0.18);
          animation: slideUpBanner 0.45s cubic-bezier(0.16,1,0.3,1);
          max-width: 480px; margin: 0 auto;
        }
        @keyframes slideUpBanner {
          from { opacity:0; transform:translateY(2.5rem); }
          to   { opacity:1; transform:translateY(0); }
        }
        #kwabz-notif-banner .nb-icon {
          width:2.75rem; height:2.75rem; border-radius:50%;
          background:var(--primary-container);
          display:flex; align-items:center; justify-content:center;
          flex-shrink:0;
        }
        #kwabz-notif-banner .nb-body { flex:1; min-width:0; }
        #kwabz-notif-banner .nb-title { font-weight:800; font-size:0.875rem; margin-bottom:0.125rem; }
        #kwabz-notif-banner .nb-sub   { font-size:0.75rem; color:var(--outline); line-height:1.4; }
        #kwabz-notif-banner .nb-actions { display:flex; gap:0.5rem; flex-shrink:0; }
        #kwabz-notif-banner .nb-deny {
          padding:0.5rem 0.75rem; border-radius:var(--radius-lg);
          border:none; background:transparent;
          font-size:0.75rem; font-weight:700; color:var(--outline); cursor:pointer;
        }
        #kwabz-notif-banner .nb-allow {
          padding:0.5rem 1rem; border-radius:var(--radius-lg);
          border:none; background:var(--primary); color:var(--on-primary);
          font-size:0.75rem; font-weight:800; cursor:pointer;
          transition: opacity 0.2s;
        }
        #kwabz-notif-banner .nb-allow:hover { opacity: 0.88; }
      `;
      document.head.appendChild(style);
    }

    // Toast container
    if (!document.getElementById('toast-container')) {
      const toasts = document.createElement('div');
      toasts.id = 'toast-container';
      body.appendChild(toasts);
    }
  },

  // ─── Event Listeners ─────────────────────────────────────────
  setupEventListeners() {
    if (typeof KwabzStore !== 'undefined') {
      KwabzStore.on('cart_changed', () => {
        if (typeof KwabzUtils !== 'undefined') KwabzUtils.updateCartBadge();
      });
    }

    const drawer = document.getElementById('sideDrawer');
    if (drawer) {
      drawer.onclick = (e) => { if (e.target === drawer) drawer.classList.remove('open'); };
    }

    if (typeof KwabzUtils !== 'undefined' && KwabzUtils.initAuthNavigation) {
      KwabzUtils.initAuthNavigation();
    }
  },

  // ═══════════════════════════════════════════════════════════
  //  Push Notification System
  // ═══════════════════════════════════════════════════════════
  initNotifications() {
    // Admins don't need "new drop" notifications
    if (window.location.pathname.includes('admin-')) return;
    if (!('Notification' in window)) return;

    // Only open a persistent Firestore listener if permission is already granted.
    // This prevents a live WebSocket connection for the vast majority of visitors.
    if (Notification.permission === 'granted') {
      if (typeof KwabzStore !== 'undefined') {
        const startNotif = () => {
          this._subscribeToNewProducts();
        };
        // Safety: only open Firestore listener after offline persistence has initialized
        if (typeof KwabzStore.isInitialized === 'function' && KwabzStore.isInitialized()) {
          startNotif();
        } else {
          KwabzStore.on('store_initialized', startNotif);
        }
      } else {
        this._subscribeToNewProducts();
      }
    }

    // Show a gentle in-app banner if the user hasn't decided yet (after 8s idle)
    if (Notification.permission === 'default') {
      setTimeout(() => this._showNotifBanner(), 8000);
    }
  },

  _showNotifBanner() {
    if (document.getElementById('kwabz-notif-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'kwabz-notif-banner';
    banner.innerHTML = `
      <div class="nb-icon">
        <span class="material-symbols-outlined" style="color:var(--primary);font-size:1.25rem;">notifications</span>
      </div>
      <div class="nb-body">
        <p class="nb-title">Stay in the loop 🛍️</p>
        <p class="nb-sub">Get notified when new drops land in the store.</p>
      </div>
      <div class="nb-actions">
        <button class="nb-deny" id="nb-deny-btn">No thanks</button>
        <button class="nb-allow" id="nb-allow-btn">Allow</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('nb-allow-btn').onclick = () => {
      banner.remove();
      this._requestPermission();
    };
    document.getElementById('nb-deny-btn').onclick = () => banner.remove();
  },

  async _requestPermission() {
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        if (typeof KwabzUtils !== 'undefined') {
          KwabzUtils.toast('🔔 You\'ll be notified of new drops!');
        }
      }
    } catch (err) {
      console.warn('[AppShell] Notification permission error:', err);
    }
  },

  _subscribeToNewProducts() {
    if (this._notifListenerActive) return;

    if (typeof firebase === 'undefined' || !firebase.apps.length) {
      setTimeout(() => this._subscribeToNewProducts(), 2000);
      return;
    }

    this._notifListenerActive = true;
    const sessionStart = new Date().toISOString();

    try {
      firebase.firestore()
        .collection('product_notifications')
        .orderBy('created_at', 'desc')
        .limit(5)
        .onSnapshot((snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type !== 'added') return;
            const data = change.doc.data();
            // Only show notifications for products added after this session opened
            if (data.created_at <= sessionStart) return;
            this._showProductNotif(data);
          });
        });

    } catch (err) {
      console.warn('[AppShell] Could not subscribe to product_notifications:', err);
    }
  },

  _showProductNotif(product) {
    const title = '🛍️ New Arrival at Kwabz Store!';
    const discStr = product.discount > 0 ? ` — ${product.discount}% OFF!` : '';
    const body = `${product.name}${discStr} | GH₵ ${Number(product.price).toFixed(2)}`;
    const targetPath = product.product_id
      ? `product-detail.html?id=${product.product_id}`
      : 'shop.html';
    const targetUrl = `${location.origin}/${targetPath}`;

    // Browser push notification (if granted)
    if (Notification.permission === 'granted') {
      const options = {
        body,
        icon: '/icon-192x192.png',
        badge: '/icon-72x72.png',
        image: product.image_url || '',
        tag: 'kwabz-product-' + (product.product_id || Date.now()),
        renotify: true
      };

      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, options).catch(err => {
              console.warn('[AppShell] Service Worker broadcast failed, trying desktop fallback:', err);
              new Notification(title, options);
            });
          });
        } else {
          new Notification(title, options);
        }
      } catch (err) {
        console.warn('[AppShell] Could not show Notification:', err);
      }
    }

    // In-app toast — always shown regardless of permission
    if (typeof KwabzUtils !== 'undefined') {
      KwabzUtils.toast(`✨ New drop: ${product.name}`);
    }
  }
};

// Auto-run
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => AppShell.init());
} else {
  AppShell.init();
}

export default AppShell;
