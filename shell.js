/**
 * Kwabz Store — Unified App Shell Logic v3
 * Handles: Common UI, Firebase init, Push Notifications
 */

import { firebaseConfig, STORE_NAME } from './config.js';

const AppShell = {
  _notifListenerActive: false,

  init() {
    this.initFirebase();
    this.injectCommonUI();
    this.bindSupportChatGlobalActions();
    this.injectSupportChat();
    this.setupEventListeners();
    this.initNotifications();
    this.initServiceWorker();
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

      if (isPreviewPage) {
        // Unified Live Preview Sync Controller
        const previewChannel = new BroadcastChannel('kwabz_theme_preview');
        const handleIncomingTheme = (theme) => {
          if (!theme || typeof theme !== 'object') return;
          console.log('[PWA Shell] Preview received theme:', theme);
          
          // 1. Extract theme sub-object if nested
          const t = theme.theme || theme;
          
          // 2. Apply global theme custom colors, typography, settings
          if (typeof KwabzUtils !== 'undefined' && KwabzUtils.applyGlobalTheme) {
            KwabzUtils.applyGlobalTheme(t);
          }
          
          // 3. Trigger page-specific theme handlers if defined
          if (typeof window.applyIndexTheme === 'function') {
            window.applyIndexTheme(t);
          }
          if (typeof window.applyShopTheme === 'function') {
            window.applyShopTheme(t);
          }
          if (typeof window.applyProductTheme === 'function') {
            window.applyProductTheme(t);
          }
          if (typeof window.applyBlogTheme === 'function') {
            window.applyBlogTheme(t);
          }
          
          // 4. Force a local re-render if page functions exist
          if (typeof window.renderPreviewProducts === 'function') {
            window.renderPreviewProducts();
          }
          if (typeof window.renderProducts === 'function') {
            window.renderProducts();
          }
        };

        // Listen via BroadcastChannel
        previewChannel.onmessage = (event) => handleIncomingTheme(event.data);

        // Listen via window postMessage
        window.addEventListener('message', (event) => handleIncomingTheme(event.data));

        // Send handshake on DOM ready
        const sendHandshake = () => {
          if (window.self !== window.top) {
            window.parent.postMessage('PREVIEW_READY', '*');
            console.log('[PWA Shell] Unified PREVIEW_READY handshake sent to parent.');
          }
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', sendHandshake);
        } else {
          sendHandshake();
        }
      }

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
            <a href="blog.html" class="drawer-link ${currentPage === 'blog.html' ? 'active' : ''}"><span class="material-symbols-outlined">article</span> Journal</a>
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

        /* ── Orders Sheet / Support Chat Overlay ── */
        .orders-sheet-overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: 2000;
          align-items: flex-end;
          justify-content: center;
        }
        .orders-sheet-overlay.open {
          display: flex;
        }
        .orders-sheet {
          background: var(--surface-container-lowest);
          border-radius: 2rem 2rem 0 0;
          width: 100%;
          max-width: 600px;
          max-height: 85dvh;
          overflow-y: auto;
          padding: 1.5rem 1.5rem 3rem;
          animation: shellSlideUp 0.35s cubic-bezier(0.16,1,0.3,1);
        }
        .orders-sheet__handle {
          width: 3.5rem;
          height: 6px;
          background: var(--outline-variant);
          border-radius: 3px;
          margin: 0 auto 1rem;
        }
        @keyframes shellSlideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
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
  },

  injectSupportChat() {
    const path = window.location.pathname.toLowerCase();
    // Only show on sellers, seller-store, and blog page, or if opened from account
    const isSellersOrJournal = (path.includes('sellers') || path.includes('blog')) && !path.includes('admin-');
    
    // Inject the Floating Action Button if on sellers or journal pages
    if (isSellersOrJournal && !document.getElementById('floatingSupportChatFab')) {
      const fab = document.createElement('button');
      fab.id = 'floatingSupportChatFab';
      fab.style.cssText = `
        position: fixed;
        bottom: 5.75rem;
        right: 1.25rem;
        width: 3.5rem;
        height: 3.5rem;
        border-radius: 50%;
        background: var(--primary);
        color: #ffffff;
        border: none;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 190;
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), background 0.2s;
        outline: none;
      `;
      fab.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.5rem;">forum</span>';
      
      // Hover and active states
      fab.onmouseenter = () => fab.style.transform = 'scale(1.08)';
      fab.onmouseleave = () => fab.style.transform = 'scale(1)';
      fab.onclick = () => window.openSupportChat();
      
      document.body.appendChild(fab);
    }

    // Inject Support Chat Sheet Overlay if not already present
    if (!document.getElementById('supportChatSheetOverlay')) {
      const sheet = document.createElement('div');
      sheet.id = 'supportChatSheetOverlay';
      sheet.className = 'orders-sheet-overlay';
      sheet.onclick = (e) => { if (e.target === sheet) window.closeSupportChatSheet(); };
      sheet.innerHTML = `
        <div class="orders-sheet" style="display:flex; flex-direction:column; max-width:480px; height:85vh; padding:1.5rem 1.5rem 1rem;">
          <div class="orders-sheet__handle"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;border-bottom:1px solid var(--outline-variant);padding-bottom:0.75rem;">
            <div>
              <h2 style="font-family:var(--font-headline);font-weight:900;font-size:1.25rem;letter-spacing:-0.03em;">Inbox & Support</h2>
              <p style="font-size:0.75rem;color:var(--outline);margin-top:0.25rem;">Chat with support & view store offers</p>
            </div>
            <button onclick="window.closeSupportChatSheet()" style="width:2.5rem;height:2.5rem;border-radius:50%;background:var(--surface-container-high);display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;color:var(--on-surface);">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>

          <!-- Mini-Tabs Control -->
          <div style="display:flex; gap:0.5rem; border-bottom:1px solid var(--outline-variant); margin-bottom:1rem; padding-bottom:0.25rem;">
            <button id="btnOffersTab" onclick="window.switchSupportTab('offers')" style="flex:1; background:none; border:none; color:var(--primary); font-weight:900; font-size:0.875rem; cursor:pointer; padding:0.5rem; border-bottom:2px solid var(--primary); display:flex; align-items:center; justify-content:center; gap:0.25rem;">
              <span class="material-symbols-outlined" style="font-size:1.1rem;">campaign</span> Announcements
            </button>
            <button id="btnChatTab" onclick="window.switchSupportTab('chat')" style="flex:1; background:none; border:none; color:var(--outline); font-weight:700; font-size:0.875rem; cursor:pointer; padding:0.5rem; border-bottom:2px solid transparent; display:flex; align-items:center; justify-content:center; gap:0.25rem;">
              <span class="material-symbols-outlined" style="font-size:1.1rem;">chat</span> Support Chat
            </button>
          </div>

          <!-- Sub-section: Offers / Broadcasts -->
          <div id="supportOffersSection" style="flex:1; overflow-y:auto; display:block;">
            <div id="userBroadcastsList" style="display:flex; flex-direction:column; gap:0.75rem;"></div>
          </div>

          <!-- Sub-section: Support Chat Stream -->
          <div id="supportChatSection" style="flex:1; overflow-y:auto; display:none; flex-direction:column;">
            <div id="userChatStream" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; padding-right:0.25rem;"></div>
            
            <div id="userChatUploadPreview" style="display:none; align-items:center; justify-content:space-between; padding:0.5rem; background:var(--surface-container-high); border-radius:var(--radius-md); margin-bottom:0.5rem; border:1px solid var(--outline-variant);">
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <img id="userChatUploadPreviewImg" style="width:2.5rem; height:2.5rem; object-fit:cover; border-radius:var(--radius-sm);" />
                <span id="userChatUploadPreviewName" style="font-size:0.75rem; color:var(--on-surface); max-width:12rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">image.png</span>
              </div>
              <button type="button" style="background:transparent; border:none; color:var(--error); cursor:pointer; display:flex; align-items:center;" onclick="window.clearUserChatUpload()" title="Remove file">
                <span class="material-symbols-outlined" style="font-size:1.25rem;">cancel</span>
              </button>
            </div>

            <form onsubmit="window.sendUserChatMessage(event)" style="border-top:1px solid var(--outline-variant); padding-top:0.75rem; display:flex; gap:0.5rem; align-items:center; margin-top:0.5rem;">
              <input type="file" id="userChatFileInput" accept="image/*" style="display:none;" onchange="window.handleUserChatFileSelected(event)" />
              <button type="button" class="btn-icon" style="width:2.75rem; height:2.75rem; border-radius:var(--radius-lg); flex-shrink:0; background:var(--surface-container-low); border:1px solid var(--outline-variant); color:var(--outline); cursor:pointer; display:flex; align-items:center; justify-content:center;" onclick="document.getElementById('userChatFileInput').click()" title="Attach image">
                <span class="material-symbols-outlined">image</span>
              </button>
              <input id="userChatInput" class="minimal-input" type="text" placeholder="Type support message..." style="flex:1; height:2.75rem; border-radius:var(--radius-lg); font-size:0.875rem; padding:0 1rem; border:1px solid var(--outline-variant); background:var(--surface-container-low); color:var(--on-surface);" />
              <button type="submit" class="btn-primary" style="width:auto; padding:0 1rem; height:2.75rem; border-radius:var(--radius-lg); display:flex; align-items:center; justify-content:center; background:var(--primary); color:var(--on-primary); border:none; cursor:pointer;">
                <span class="material-symbols-outlined">send</span>
              </button>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(sheet);
    }

    // Inject Edit Chat Message Modal if not already present
    if (!document.getElementById('userEditChatMsgModal')) {
      const modal = document.createElement('div');
      modal.id = 'userEditChatMsgModal';
      modal.className = 'modal-overlay';
      modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('open'); };
      modal.style.zIndex = '2100';
      modal.innerHTML = `
        <div class="modal-content" style="max-width:26rem;">
          <div class="modal-handle"></div>
          <h3 class="font-headline text-headline-sm" style="margin-bottom:0.5rem;color:var(--on-surface);">Edit Message</h3>
          <form onsubmit="window.saveUserEditChatMessage(event)">
            <input type="hidden" id="userEditChatMsgId" />
            <div class="form-group" style="margin-bottom:1.25rem;">
              <label class="form-group__label">Message</label>
              <input id="userEditChatMsgInput" class="minimal-input" type="text" required style="width:100%;height:2.75rem;padding:0 1rem;border-radius:var(--radius-lg);border:1px solid var(--outline-variant);background:var(--surface-container-low);color:var(--on-surface);" />
            </div>
            <div style="display:flex;gap:0.75rem;">
              <button type="button" class="btn-secondary" style="flex:1;padding:0.75rem;border-radius:var(--radius-lg);border:1px solid var(--outline-variant);background:var(--surface-container);color:var(--on-surface);cursor:pointer;"
                onclick="document.getElementById('userEditChatMsgModal').classList.remove('open')">Cancel</button>
              <button type="submit" class="btn-primary" style="flex:1;padding:0.75rem;border-radius:var(--radius-lg);border:none;background:var(--primary);color:var(--on-primary);cursor:pointer;font-weight:700;">Save</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modal);
    }

    // Inject CSS for Support Chat elements
    if (!document.getElementById('support-chat-injected-styles')) {
      const css = document.createElement('style');
      css.id = 'support-chat-injected-styles';
      css.textContent = `
        .broadcast-user-card {
          background: var(--surface-container-low);
          border: 1px solid var(--outline-variant);
          border-radius: var(--radius-xl);
          padding: 1.25rem;
          margin-bottom: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          transition: all 0.2s ease;
        }
        body.dark-mode .broadcast-user-card {
          background: #121212;
        }
        .broadcast-user-card__time {
          font-size: 0.72rem;
          color: var(--outline);
          font-weight: 600;
        }
        .broadcast-user-card__msg {
          font-size: 0.85rem;
          color: var(--on-surface);
          line-height: 1.45;
          white-space: pre-wrap;
          text-align: left;
        }
        .broadcast-user-card__promo {
          align-self: flex-start;
          margin-top: 0.25rem;
          background: var(--primary-container);
          color: var(--on-primary-container);
          padding: 0.35rem 0.75rem;
          border-radius: var(--radius-full);
          font-size: 0.78rem;
          font-weight: 900;
          letter-spacing: 0.05em;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          cursor: pointer;
          border: 1px dashed var(--primary);
        }
        .broadcast-user-card__promo:hover {
          background: var(--primary);
          color: var(--on-primary);
        }
        .chat-bubble-container {
          display: flex;
          flex-direction: column;
          margin-bottom: 0.75rem;
          max-width: 80%;
          position: relative;
        }
        .chat-bubble-container--admin {
          align-self: flex-start;
          align-items: flex-start;
        }
        .chat-bubble-container--user {
          align-self: flex-end;
          align-items: flex-end;
        }
        .chat-bubble {
          padding: 0.75rem 1rem;
          border-radius: 1.15rem;
          font-size: 0.85rem;
          line-height: 1.4;
          white-space: pre-wrap;
          text-align: left;
        }
        .chat-bubble--admin {
          background: var(--surface-container-high);
          color: var(--on-surface);
          border-bottom-left-radius: 0.25rem;
          border: 1px solid var(--outline-variant);
        }
        body.dark-mode .chat-bubble--admin {
          background: #1c1c1e;
        }
        .chat-bubble--user {
          background: var(--primary);
          color: var(--on-primary);
          border-bottom-right-radius: 0.25rem;
        }
        .chat-bubble__meta {
          font-size: 0.65rem;
          color: var(--outline);
          margin-top: 0.2rem;
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .chat-bubble__promo-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.2rem;
          margin-top: 0.4rem;
          background: var(--primary-container);
          color: var(--on-primary-container);
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius-full);
          font-size: 0.72rem;
          font-weight: 800;
          border: 1px dashed var(--primary);
          cursor: pointer;
        }
        .chat-bubble--user .chat-bubble__promo-badge {
          background: rgba(255, 255, 255, 0.2);
          color: inherit;
          border-color: transparent;
        }
        .bubble-actions {
          display: flex;
          gap: 0.4rem;
          margin-top: 0.15rem;
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        .chat-bubble-container:hover .bubble-actions {
          opacity: 1;
        }
        .bubble-action-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--outline);
          font-size: 0.72rem;
          font-weight: 600;
          padding: 0.1rem 0.25rem;
        }
        .bubble-action-btn:hover {
          color: var(--on-surface);
        }
      `;
      document.head.appendChild(css);
    }
  },

  bindSupportChatGlobalActions() {
    window.activeSupportTab = 'offers';
    window.supportChatUnsub = null;
    let selectedChatFile = null;
    let backgroundChatUnsub = null;

    window.handleUserChatFileSelected = function(e) {
      const file = e.target.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        if (typeof KwabzUtils !== 'undefined') KwabzUtils.toast('Only image attachments are allowed', 'error');
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        if (typeof KwabzUtils !== 'undefined') KwabzUtils.toast('Image size must be less than 5MB', 'error');
        return;
      }

      selectedChatFile = file;

      const reader = new FileReader();
      reader.onload = (event) => {
        const preview = document.getElementById('userChatUploadPreview');
        const previewImg = document.getElementById('userChatUploadPreviewImg');
        const previewName = document.getElementById('userChatUploadPreviewName');
        if (preview && previewImg && previewName) {
          previewImg.src = event.target.result;
          previewName.textContent = file.name;
          preview.style.display = 'flex';
        }
      };
      reader.readAsDataURL(file);
    };

    window.clearUserChatUpload = function() {
      selectedChatFile = null;
      const fileInput = document.getElementById('userChatFileInput');
      if (fileInput) fileInput.value = '';
      const preview = document.getElementById('userChatUploadPreview');
      if (preview) preview.style.display = 'none';
    };

    window.openImageFull = function(url) {
      let lightbox = document.getElementById('chatImageLightbox');
      if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'chatImageLightbox';
        lightbox.className = 'modal-overlay';
        lightbox.style.zIndex = '3000';
        lightbox.onclick = () => lightbox.classList.remove('open');
        lightbox.innerHTML = `
          <div style="position:relative; max-width:90vw; max-height:90vh; display:flex; align-items:center; justify-content:center;">
            <img id="chatLightboxImg" style="max-width:100%; max-height:90vh; border-radius:var(--radius-lg); object-fit:contain; box-shadow:0 8px 32px rgba(0,0,0,0.4);" />
            <button class="btn-icon" style="position:absolute; top:1rem; right:1rem; background:rgba(0,0,0,0.5); color:white; border:none; width:2.5rem; height:2.5rem; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer;">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        `;
        document.body.appendChild(lightbox);
      }
      document.getElementById('chatLightboxImg').src = url;
      lightbox.classList.add('open');
    };

    window.showSupportNotificationBadge = function(show) {
      const fab = document.getElementById('floatingSupportChatFab');
      if (!fab) return;
      
      let badge = document.getElementById('floatingSupportChatBadge');
      if (show) {
        if (!badge) {
          badge = document.createElement('div');
          badge.id = 'floatingSupportChatBadge';
          badge.style.cssText = `
            position: absolute;
            top: 0;
            right: 0;
            width: 0.75rem;
            height: 0.75rem;
            background: var(--error);
            border-radius: 50%;
            border: 2px solid var(--primary);
          `;
          fab.appendChild(badge);
        }
      } else {
        if (badge) {
          badge.remove();
        }
      }
    };

    function startBackgroundChatListener(uid) {
      if (backgroundChatUnsub) backgroundChatUnsub();
      if (typeof KwabzStore === 'undefined') return;
      
      backgroundChatUnsub = KwabzStore.onUserChats(uid, (messages) => {
        const lastViewedTime = parseInt(localStorage.getItem('kwabz_last_chat_viewed_time') || '0', 10);
        const overlay = document.getElementById('supportChatSheetOverlay');
        const isSheetOpen = overlay && overlay.classList.contains('open');
        const activeTab = window.activeSupportTab;
        
        let hasUnread = false;
        messages.forEach(m => {
          if (m.sender === 'admin' && new Date(m.created_at).getTime() > lastViewedTime) {
            hasUnread = true;
          }
        });
        
        if (hasUnread && !(isSheetOpen && activeTab === 'chat')) {
          window.showSupportNotificationBadge(true);
        } else {
          window.showSupportNotificationBadge(false);
        }
        
        if (isSheetOpen && activeTab === 'chat') {
          localStorage.setItem('kwabz_last_chat_viewed_time', Date.now().toString());
        }
      });
    }

    if (typeof KwabzStore !== 'undefined') {
      KwabzStore.on('user_changed', (user) => {
        if (user) {
          startBackgroundChatListener(user.uid);
        } else {
          if (backgroundChatUnsub) {
            backgroundChatUnsub();
            backgroundChatUnsub = null;
          }
          window.showSupportNotificationBadge(false);
        }
      });
      const currentUser = KwabzStore.getCurrentUser();
      if (currentUser) {
        startBackgroundChatListener(currentUser.uid);
      }
    }

    window.openSupportChat = function() {
      if (typeof KwabzStore !== 'undefined' && typeof KwabzStore.isAuthReady === 'function' && !KwabzStore.isAuthReady()) {
        if (typeof KwabzUtils !== 'undefined') {
          KwabzUtils.toast('Checking support chat session...', 'info');
        }
        const onUserChanged = () => {
          KwabzStore.off('user_changed', onUserChanged);
          window.openSupportChat();
        };
        KwabzStore.on('user_changed', onUserChanged);
        return;
      }

      const user = KwabzStore.getCurrentUser();
      if (!user) {
        if (typeof KwabzUtils !== 'undefined') {
          KwabzUtils.toast('Please sign in to access support chat', 'error');
        } else {
          alert('Please sign in to access support chat');
        }
        return;
      }
      const overlay = document.getElementById('supportChatSheetOverlay');
      if (overlay) overlay.classList.add('open');
      window.switchSupportTab('offers');
      window.renderUserBroadcasts();

      if (typeof KwabzStore !== 'undefined') {
        KwabzStore.on('broadcasts_changed', () => window.renderUserBroadcasts());
      }
    };

    window.closeSupportChatSheet = function() {
      const overlay = document.getElementById('supportChatSheetOverlay');
      if (overlay) overlay.classList.remove('open');
      if (window.supportChatUnsub) {
        window.supportChatUnsub();
        window.supportChatUnsub = null;
      }
    };

    window.switchSupportTab = function(tab) {
      window.activeSupportTab = tab;
      const btnOffers = document.getElementById('btnOffersTab');
      const btnChat = document.getElementById('btnChatTab');
      const secOffers = document.getElementById('supportOffersSection');
      const secChat = document.getElementById('supportChatSection');

      if (!btnOffers || !btnChat || !secOffers || !secChat) return;

      if (tab === 'offers') {
        btnOffers.style.color = 'var(--primary)';
        btnOffers.style.borderBottomColor = 'var(--primary)';
        btnOffers.style.fontWeight = '900';
        
        btnChat.style.color = 'var(--outline)';
        btnChat.style.borderBottomColor = 'transparent';
        btnChat.style.fontWeight = '700';

        secOffers.style.display = 'block';
        secChat.style.display = 'none';

        if (window.supportChatUnsub) {
          window.supportChatUnsub();
          window.supportChatUnsub = null;
        }
      } else {
        btnChat.style.color = 'var(--primary)';
        btnChat.style.borderBottomColor = 'var(--primary)';
        btnChat.style.fontWeight = '900';
        
        btnOffers.style.color = 'var(--outline)';
        btnOffers.style.borderBottomColor = 'transparent';
        btnOffers.style.fontWeight = '700';

        secOffers.style.display = 'none';
        secChat.style.display = 'flex';

        localStorage.setItem('kwabz_last_chat_viewed_time', Date.now().toString());
        window.showSupportNotificationBadge(false);

        const user = KwabzStore.getCurrentUser();
        if (user && typeof KwabzStore !== 'undefined') {
          if (window.supportChatUnsub) window.supportChatUnsub();
          window.supportChatUnsub = KwabzStore.onUserChats(user.uid, (messages) => {
            localStorage.setItem('kwabz_last_chat_viewed_time', Date.now().toString());
            window.renderUserChatMessages(messages);
          });
        }
      }
    };

    window.renderUserBroadcasts = function() {
      if (typeof KwabzStore === 'undefined') return;
      const broadcasts = KwabzStore.getBroadcasts() || [];
      const container = document.getElementById('userBroadcastsList');
      if (!container) return;

      if (broadcasts.length === 0) {
        container.innerHTML = `
          <div style="text-align:center;padding:3rem;color:var(--outline);">
            <span class="material-symbols-outlined" style="font-size:3rem;">campaign</span>
            <p style="font-weight:700;margin-top:1rem;">No announcements yet</p>
            <p style="font-size:0.8125rem;color:var(--outline);margin-top:0.5rem;">New promotional announcements will show up here.</p>
          </div>`;
        return;
      }

      container.innerHTML = broadcasts.map(b => {
        const dateText = new Date(b.created_at).toLocaleDateString();
        const promoBadge = b.promo_code 
          ? `<div class="broadcast-user-card__promo" onclick="window.copyPromoCode('${b.promo_code}')">
               <span class="material-symbols-outlined" style="font-size:0.875rem;">content_copy</span>
               Copy Code: ${b.promo_code}
             </div>` 
          : '';

        return `
          <div class="broadcast-user-card">
            <span class="broadcast-user-card__time">${dateText}</span>
            <p class="broadcast-user-card__msg">${b.message}</p>
            ${promoBadge}
          </div>
        `;
      }).join('');
    };

    window.renderUserChatMessages = function(messages) {
      const container = document.getElementById('userChatStream');
      if (!container) return;

      if (messages.length === 0) {
        container.innerHTML = `
          <div style="text-align:center;padding:3rem;color:var(--outline);margin-top:auto;">
            <span class="material-symbols-outlined" style="font-size:2.5rem;">support_agent</span>
            <p style="font-weight:700;margin-top:0.5rem;">Need support?</p>
            <p style="font-size:0.75rem;color:var(--outline);margin-top:0.25rem;">Type below to send a message directly to support team.</p>
          </div>`;
        return;
      }

      container.innerHTML = messages.map(m => {
        const isAdmin = m.sender === 'admin';
        const type = isAdmin ? 'admin' : 'user';
        const isOwnMessage = !isAdmin;
        const promoBadge = m.promo_code 
          ? `<div class="chat-bubble__promo-badge" onclick="window.copyPromoCode('${m.promo_code}')">
               <span class="material-symbols-outlined" style="font-size:0.75rem;">content_copy</span>Copy Code: ${m.promo_code}
             </div>` 
          : '';

        const imageHtml = m.image_url
          ? `<div class="chat-bubble__image" style="margin-top:0.5rem; max-width:100%; border-radius:var(--radius-md); overflow:hidden;">
               <img src="${m.image_url}" style="max-width:100%; height:auto; display:block; cursor:pointer;" onclick="window.openImageFull('${m.image_url}')" />
             </div>`
          : '';

        const actionsHtml = isOwnMessage
          ? `<div class="bubble-actions">
               <button class="bubble-action-btn" onclick="window.openUserEditChatMsg('${m.id}', \`${m.message.replace(/`/g, '\\`').replace(/\n/g, '\\n')}\`)">edit</button>
               <button class="bubble-action-btn" style="color:var(--error);" onclick="window.deleteUserChatMessage('${m.id}')">delete</button>
             </div>`
          : '';

        return `
          <div class="chat-bubble-container chat-bubble-container--${type}">
            <div class="chat-bubble chat-bubble--${type}">${m.message || ''}${promoBadge}${imageHtml}</div>
            <div class="chat-bubble__meta">
              <span>${m.sender_name}</span> • <span>${new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            ${actionsHtml}
          </div>
        `;
      }).join('');

      container.scrollTop = container.scrollHeight;
    };

    window.sendUserChatMessage = async function(e) {
      e.preventDefault();
      const input = document.getElementById('userChatInput');
      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (!input || !submitBtn || submitBtn.disabled) return;

      const msg = input.value.trim();
      if (!msg && !selectedChatFile) return;

      if (typeof KwabzStore === 'undefined') return;
      const user = KwabzStore.getCurrentUser();
      if (!user) return;

      const senderName = user.displayName || user.email.split('@')[0] || 'Customer';

      submitBtn.disabled = true;
      const originalHtml = submitBtn.innerHTML;
      submitBtn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:1.125rem;">sync</span>';

      try {
        let imageUrl = null;
        if (selectedChatFile) {
          if (typeof firebase !== 'undefined' && !firebase.storage) {
            await new Promise((resolve) => {
              const script = document.createElement('script');
              script.src = "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage-compat.js";
              script.onload = resolve;
              document.head.appendChild(script);
            });
          }

          const storageRef = firebase.storage().ref();
          const fileRef = storageRef.child(`chat_attachments/${user.uid}/${Date.now()}_${selectedChatFile.name}`);
          
          if (typeof KwabzUtils !== 'undefined') {
            KwabzUtils.toast('Uploading image...', 'info');
          }
          
          const snapshot = await fileRef.put(selectedChatFile);
          imageUrl = await snapshot.ref.getDownloadURL();
        }

        await KwabzStore.sendChatMessage(user.uid, 'user', senderName, msg, null, imageUrl);
        input.value = '';
        window.clearUserChatUpload();
      } catch (err) {
        if (typeof KwabzUtils !== 'undefined') {
          KwabzUtils.toast('Failed to send message: ' + err.message, 'error');
        } else {
          alert('Failed to send message: ' + err.message);
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
      }
    };

    window.openUserEditChatMsg = function(id, message) {
      const modal = document.getElementById('userEditChatMsgModal');
      const inputId = document.getElementById('userEditChatMsgId');
      const inputVal = document.getElementById('userEditChatMsgInput');
      if (modal && inputId && inputVal) {
        inputId.value = id;
        inputVal.value = message;
        modal.classList.add('open');
      }
    };

    window.saveUserEditChatMessage = async function(e) {
      e.preventDefault();
      const id = document.getElementById('userEditChatMsgId').value;
      const message = document.getElementById('userEditChatMsgInput').value.trim();

      if (typeof KwabzStore === 'undefined') return;
      try {
        await KwabzStore.updateChatMessage(id, message);
        if (typeof KwabzUtils !== 'undefined') KwabzUtils.toast('Message updated');
        const modal = document.getElementById('userEditChatMsgModal');
        if (modal) modal.classList.remove('open');
      } catch (err) {
        if (typeof KwabzUtils !== 'undefined') {
          KwabzUtils.toast('Failed to update: ' + err.message, 'error');
        }
      }
    };

    window.deleteUserChatMessage = async function(id) {
      if (!confirm('Are you sure you want to delete this message?')) return;
      if (typeof KwabzStore === 'undefined') return;
      try {
        await KwabzStore.deleteChatMessage(id);
        if (typeof KwabzUtils !== 'undefined') KwabzUtils.toast('Message deleted');
      } catch (err) {
        if (typeof KwabzUtils !== 'undefined') {
          KwabzUtils.toast('Failed to delete: ' + err.message, 'error');
        }
      }
    };

    window.copyPromoCode = function(code) {
      navigator.clipboard.writeText(code).then(() => {
        if (typeof KwabzUtils !== 'undefined') {
          KwabzUtils.toast('Promo code copied: ' + code, 'success');
        }
      }).catch(err => {
        if (typeof KwabzUtils !== 'undefined') {
          KwabzUtils.toast('Failed to copy code', 'error');
        }
      });
    };
  }
};

// Auto-run
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => AppShell.init());
} else {
  AppShell.init();
}

export default AppShell;
