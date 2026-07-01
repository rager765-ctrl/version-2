/**
 * Kwabz Store Online — Utility Functions
 */

const KwabzUtils = {
  /**
   * Format a number as USD currency.
   */
  formatPrice(amount) {
    return 'GH₵' + parseFloat(amount).toFixed(2);
  },

  getColorName(hex) {
    if (!hex) return '';
    const cleanHex = hex.trim().toUpperCase();
    const map = {
      '#000000': 'Black',
      '#FFFFFF': 'White',
      '#FF0000': 'Red',
      '#FF6B00': 'Orange',
      '#FFD700': 'Gold',
      '#00C853': 'Green',
      '#2979FF': 'Blue',
      '#AA00FF': 'Purple',
      '#FF4081': 'Pink',
      '#795548': 'Brown',
      '#607D8B': 'Grey',
      '#F5F5F5': 'Off-White',
      '#BDBDBD': 'Silver',
      '#FF8F00': 'Amber',
      '#00BCD4': 'Cyan'
    };
    return map[cleanHex] || hex;
  },

  triggerPushNotification(title, body, tag, icon, imageUrl) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const options = {
      body: body,
      icon: icon || '/icon-192x192.png',
      badge: '/icon-72x72.png',
      tag: tag || 'kwabz-' + Date.now(),
      renotify: true
    };
    if (imageUrl) options.image = imageUrl;

    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, options).catch(err => {
            new Notification(title, options);
          });
        });
      } else {
        new Notification(title, options);
      }
    } catch (err) {
      console.warn('Notification failed:', err);
    }
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  /**
   * Apply global theme settings (fonts, colors, glass opacity)
   */
  applyGlobalTheme(theme) {
    if (!theme) return;

    if (theme.fontFamily) {
      document.documentElement.style.setProperty('--font-headline', theme.fontFamily);
      document.documentElement.style.setProperty('--font-body', theme.fontFamily);
    }

    if (theme.primaryColor) {
      document.documentElement.style.setProperty('--primary', theme.primaryColor);
      document.querySelectorAll('.btn-landing--primary').forEach(el => {
        el.style.color = theme.primaryColor;
      });
    }

    const isDark = document.documentElement.classList.contains('dark-mode') || document.body.classList.contains('dark-mode');
    const opacity = (theme.glassOpacity !== undefined && theme.glassOpacity !== null) ? theme.glassOpacity : 0.8;
    const bg = isDark ? `rgba(20, 20, 20, ${opacity})` : `rgba(255, 255, 255, ${opacity})`;
    const topBar = document.querySelector('.top-app-bar');
    if (topBar) topBar.style.backgroundColor = bg;
    const dock = document.querySelector('.bottom-nav') || document.querySelector('.bottom-nav-admin');
    if (dock) dock.style.backgroundColor = bg;

    // ── Persist resolved tokens so next page load can apply them synchronously ──
    try {
      localStorage.setItem('kwabz_nav_bg_cache', bg);
      if (theme.primaryColor) localStorage.setItem('kwabz_primary_cache', theme.primaryColor);
      if (theme.fontFamily) localStorage.setItem('kwabz_font_cache', theme.fontFamily);
      if (theme.authLoginImage) localStorage.setItem('kwabz_auth_login_img_cache', theme.authLoginImage);
      if (theme.authSignupImage) localStorage.setItem('kwabz_auth_signup_img_cache', theme.authSignupImage);
    } catch (_) {}

    // Custom Login & Sign-up Page Banner Images
    const path = window.location.pathname.split('/').pop() || 'index.html';
    const isLogin = path === 'login.html';
    const isSignup = path === 'signup.html';
    const authHeader = document.querySelector('.auth-top-header');

    if (authHeader) {
      if (isLogin && theme.authLoginImage) {
        const isDark = document.documentElement.classList.contains('dark-mode');
        const overlay = isDark
          ? 'linear-gradient(135deg, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0.85) 100%)'
          : 'linear-gradient(135deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.75) 100%)';
        authHeader.style.background = `${overlay}, url('${theme.authLoginImage}') center/cover no-repeat`;
      } else if (isSignup && theme.authSignupImage) {
        const isDark = document.documentElement.classList.contains('dark-mode');
        const overlay = isDark
          ? 'linear-gradient(135deg, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0.85) 100%)'
          : 'linear-gradient(135deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.75) 100%)';
        authHeader.style.background = `${overlay}, url('${theme.authSignupImage}') center/cover no-repeat`;
      }
    }

    // Dynamic Brand/Logo Rendering
    const brandTitleEl = document.querySelector('.top-app-bar__title');
    if (brandTitleEl) {
      const logoType = theme.logoType || 'text';
      const logoText = theme.logoText || 'Kwabz Store';
      const logoImageUrl = theme.logoImageUrl || '';

      const isBrandingPage = window.location.pathname.endsWith('index.html') ||
        window.location.pathname.endsWith('shop.html') ||
        window.location.pathname === '/' ||
        brandTitleEl.textContent.trim().toLowerCase() === 'kwabz store' ||
        brandTitleEl.textContent.trim().toLowerCase() === 'kwabz';

      if (isBrandingPage) {
        if (logoType === 'image' && logoImageUrl) {
          brandTitleEl.innerHTML = `<img src="${logoImageUrl}" alt="${logoText}" style="max-height: 2.2rem; max-width: 160px; object-fit: contain; vertical-align: middle; display: block;" />`;
        } else {
          brandTitleEl.textContent = logoText;
        }
      }
    }

    const drawerTitleEl = document.querySelector('#sideDrawer h2');
    if (drawerTitleEl) {
      const logoText = theme.logoText || 'Kwabz Store';
      drawerTitleEl.textContent = logoText.toUpperCase();
    }

    // Recalculate status bar color to align with new theme or glass settings
    if (typeof updateDynamicStatusBarColor === 'function') {
      setTimeout(updateDynamicStatusBarColor, 50);
    }
  },

  /**
   * Synchronously apply cached theme tokens before first paint.
   * Call this inline in <head> immediately after the dark-mode script.
   * Eliminates nav/bar color flash on page load and page switches.
   */
  applyThemeInstant() {
    try {
      const navBg = localStorage.getItem('kwabz_nav_bg_cache');
      const primary = localStorage.getItem('kwabz_primary_cache');
      const font = localStorage.getItem('kwabz_font_cache');
      const parts = [];
      if (navBg) {
        parts.push(
          `.top-app-bar { background-color: ${navBg} !important; }`,
          `.bottom-nav { background-color: ${navBg} !important; }`,
          `.bottom-nav-admin { background-color: ${navBg} !important; }`
        );
      }
      if (primary) {
        parts.push(`:root { --primary: ${primary}; }`);
      }
      if (font) {
        parts.push(`:root { --font-headline: ${font}; --font-body: ${font}; }`);
      }
      if (parts.length > 0) {
        const s = document.createElement('style');
        s.id = 'kwabz-instant-theme';
        s.textContent = parts.join('\n');
        // Insert as first child of <head> so it beats stylesheet defaults
        document.head.insertBefore(s, document.head.firstChild);
      }
    } catch (_) {}
  },

  /**
   * Calculate discounted price.
   */
  calcDiscountedPrice(price, discountPercent) {
    if (!discountPercent || discountPercent <= 0) return price;
    return price * (1 - discountPercent / 100);
  },

  /**
   * Gets the effective discount for a product (checks if seller has a global discount)
   */
  getEffectiveDiscount(product) {
    if (!product) return 0;
    if (product.seller_id && product.seller_id !== 'main' && typeof KwabzStore !== 'undefined') {
      const seller = KwabzStore.getSellerById(product.seller_id);
      if (seller && seller.discount > 0) return seller.discount;
    }
    return product.discount || 0;
  },

  /**
   * Format ISO date string to readable format.
   */
  formatDate(val) {
    if (!val) return '';
    const ms = KwabzUtils.getSafeTime(val);
    if (ms === 0) return 'Recently';
    return new Date(ms).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  },

  /**
   * Relative time (e.g., "2 mins ago").
   */
  timeAgo(val) {
    if (!val) return 'Never';
    const ms = KwabzUtils.getSafeTime(val);
    if (ms === 0) return 'Recently';
    
    const diff = Math.floor((Date.now() - ms) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
    return KwabzUtils.formatDate(ms);
  },

  /**
   * Helper to normalize a date/timestamp to epoch milliseconds for safe math & sorting.
   */
  getSafeTime(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (typeof val.seconds === 'number') return val.seconds * 1000;
    if (typeof val._seconds === 'number') return val._seconds * 1000;
    if (val.toDate && typeof val.toDate === 'function') return val.toDate().getTime();
    const parsed = new Date(val).getTime();
    return isNaN(parsed) ? 0 : parsed;
  },

  /**
   * Get URL query parameter.
   */
  getParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  },

  /**
   * Show a toast notification.
   */
  toast(message, type = 'success') {
    const existing = document.getElementById('kwabz-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'kwabz-toast';
    toast.className = `kwabz-toast kwabz-toast--${type}`;
    toast.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:18px;">
        ${type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info'}
      </span>
      <span>${message}</span>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('kwabz-toast--visible'));
    setTimeout(() => {
      toast.classList.remove('kwabz-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  },

  /**
   * Robust +233 formatting logic for Ghana WhatsApp
   */
  formatWhatsAppPhone(phone) {
    if (!phone) return null;
    let raw = phone.toString().trim();

    // If explicitly starts with '+', preserve the exact international country code
    if (raw.startsWith('+')) {
      return '+' + raw.replace(/\D/g, '');
    }

    let clean = raw.replace(/\D/g, '');

    // Local Ghanaian number style starting with '0'
    if (clean.startsWith('0')) {
      return '+233' + clean.substring(1);
    }

    // Fully formatted local style starting with '233' of correct length
    if (clean.startsWith('233') && clean.length >= 12) {
      return '+' + clean;
    }

    // Local Ghanaian number missing leading '0' (typically 9 digits)
    if (clean.length === 9) {
      return '+233' + clean;
    }

    // Otherwise, assume it's already an international number formatted without '+' (e.g. 1555... or 234...)
    if (clean.length >= 10) {
      return '+' + clean;
    }

    // Fallback default
    if (!clean.startsWith('233')) {
      clean = '233' + clean;
    }
    return '+' + clean;
  },

  /**
   * Convert a file to a data URL (for local image preview/storage).
   */
  fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /**
   * Check if admin is logged in, redirect if not.
   */
  requireAdmin() {
    if (!KwabzStore.isAdminLoggedIn()) {
      window.location.href = 'admin-login.html';
      return false;
    }
    return true;
  },

  /**
   * Render the cart badge count in a nav element.
   */
  updateCartBadge() {
    const badges = document.querySelectorAll('[data-cart-badge]');
    if (typeof KwabzStore === 'undefined') return;
    const count = KwabzStore.getCartItemCount();
    badges.forEach(badge => {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    });
  },

  /**
   * Enforce Google Chrome (Specifically block Samsung Internet)
   */
  enforceChrome() {
    const ua = navigator.userAgent;
    const isSamsung = ua.includes('SamsungBrowser');

    if (isSamsung) {
      const currentUrl = window.location.href;
      const chromeIntent = `intent://${currentUrl.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`;

      document.body.innerHTML = `
        <div style="position:fixed;inset:0;z-index:99999;background:white;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;font-family:sans-serif;">
          <div style="width:80px;height:80px;background:#F2F2F2;border-radius:24px;display:flex;align-items:center;justify-content:center;margin-bottom:2rem;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
          </div>
          <h1 style="font-size:1.5rem;font-weight:800;margin-bottom:0.75rem;letter-spacing:-0.02em;">Browser Not Supported</h1>
          <p style="color:#666;line-height:1.6;margin-bottom:2.5rem;max-width:20rem;">
            Samsung Internet is currently not supported for <strong>Kwabz Store</strong>. Please use Google Chrome for the best experience.
          </p>
          <a href="${chromeIntent}" style="background:black;color:white;padding:1rem 2rem;border-radius:100px;text-decoration:none;font-weight:700;font-size:0.875rem;display:flex;align-items:center;gap:0.75rem;">
            Open in Google Chrome
            <span class="material-symbols-outlined" style="font-size:1.25rem;">open_in_new</span>
          </a>
          <p style="margin-top:2rem;font-size:0.75rem;color:#999;max-width:18rem;">
            Switching to Chrome will ensure all features work correctly.
          </p>
        </div>
      `;
      document.body.style.overflow = 'hidden';
      return false;
    }
    return true;
  },

  /**
   * Initialize Auth-responsive navigation across all pages.
   */
  initAuthNavigation() {
    if (typeof KwabzStore === 'undefined') return;

    const updateUI = (user) => {
      // 1. Bottom Nav Elements
      const navLink = document.getElementById('authNavLink');
      const navText = document.getElementById('authNavText');
      const navIcon = navLink ? navLink.querySelector('.material-symbols-outlined') : null;

      // 2. Header Action Icons (Universal Selector)
      const headerBtns = document.querySelectorAll('header .icon-btn');

      if (user) {
        if (navLink) navLink.href = 'account.html';
        if (navText) navText.textContent = 'Account';
        if (navIcon) navIcon.classList.add('filled');

        headerBtns.forEach(btn => {
          if (btn.href && (btn.href.includes('login') || btn.href.includes('account'))) {
            btn.href = 'account.html';
          }
        });
      } else {
        if (navLink) navLink.href = 'login.html';
        if (navText) navText.textContent = 'Sign In';
        if (navIcon) navIcon.classList.remove('filled');

        headerBtns.forEach(btn => {
          if (btn.href && (btn.href.includes('login') || btn.href.includes('account'))) {
            btn.href = 'login.html';
          }
        });
      }
    };

    // Listen for state changes
    KwabzStore.on('user_changed', updateUI);

    // Initial check (if already loaded or optimistically cached)
    const currentUser = KwabzStore.getCurrentUser();
    const cachedUid = localStorage.getItem('kwabz_auth_cache');

    if (currentUser) {
      updateUI(currentUser);
    } else if (cachedUid) {
      // Optimistically point to Account to prevent redirect loop while loading/syncing
      updateUI({ uid: cachedUid });
    } else {
      // If we are currently "syncing", we wait for the first user_changed
      // Otherwise we can safely update empty UI
      if (KwabzStore.getSyncStatus() !== 'syncing') {
        updateUI(null);
      }
    }
  },

  /**
   * Require user to be logged in. Prevents unauthorized content flashes by hiding
   * the page until authentication state is verified.
   */
  requireLogin() {
    const checkRedirect = () => {
      const path = window.location.pathname.split('/').pop() || 'index.html';
      if (path === 'login.html' || path === 'signup.html') return;

      document.documentElement.style.display = 'none';
      const search = window.location.search;
      const current = encodeURIComponent(path + search);
      window.location.replace(`login.html?redirect=${current}`);
    };

    // 1. If Firebase is ready and we have NO user, redirect immediately
    if (KwabzStore.isAuthReady()) {
      if (!KwabzStore.getCurrentUser()) {
        checkRedirect();
        return false;
      }
      return true;
    }

    // 2. Optimistic Rendering: If we have a cached UID, don't hide yet
    const cachedUid = localStorage.getItem('kwabz_auth_cache');
    if (!cachedUid) {
      document.documentElement.style.display = 'none';
    }

    KwabzStore.on('user_changed', (user) => {
      if (user) {
        document.documentElement.style.display = ''; // Show page
      } else {
        checkRedirect();
      }
    });

    // Watchdog to prevent permanent white screen (reduced to 1s for better UX)
    setTimeout(() => {
      if (!KwabzStore.isAuthReady()) {
        if (!KwabzStore.getCurrentUser() && !localStorage.getItem('kwabz_auth_cache')) checkRedirect();
        else document.documentElement.style.display = '';
      }
    }, 1000);

    return true; // We return true to let the script continue, but the UI is hidden
  },

  /**
   * Alias for requireLogin.
   */
  requireAuth() {
    return this.requireLogin();
  },

  /**
   * Redirect to admin login if administrator is not authenticated.
   * Uses a strict gate to prevent admin-panel flashes for non-admins.
   */
  requireAdmin() {
    const check = () => {
      if (!KwabzStore.isAdminLoggedIn()) {
        document.documentElement.style.display = 'none';
        window.location.href = 'admin-login.html';
        return false;
      }
      document.documentElement.style.display = '';
      return true;
    };

    // 1. Optimistic Rendering: If we have a cached admin flag, don't hide yet
    const cachedAdmin = localStorage.getItem('kwabz_admin_auth');
    if (!cachedAdmin) {
      document.documentElement.style.display = 'none';
    }

    if (!KwabzStore.isAuthReady()) {
      KwabzStore.on('user_changed', (user) => {
        if (user && KwabzStore.isAdminLoggedIn()) {
          document.documentElement.style.display = '';
        } else if (KwabzStore.isAuthReady()) {
          check();
        }
      });

      // Safety timeout (reduced for better UX)
      setTimeout(() => {
        if (!KwabzStore.isAuthReady() || !KwabzStore.isAdminLoggedIn()) {
          check();
        }
      }, 1500);

      return true;
    }

    // Watchdog: Periodically re-verify admin state in the background
    if (!window._adminWatchdogStarted) {
      window._adminWatchdogStarted = true;
      setInterval(() => {
        if (!KwabzStore.isAdminLoggedIn()) {
          KwabzUtils.toast('Session expired. Redirecting...', 'error');
          setTimeout(() => window.location.href = 'admin-login.html', 1500);
        }
      }, 300000); // Check every 5 minutes
    }

    return check();
  },

  /**
   * Smart Branding: Update page headers based on session context.
   */
  applySmartBranding() {
    const sellerName = sessionStorage.getItem('kwabz_active_seller_name');
    const sellerId = sessionStorage.getItem('kwabz_active_seller_id');
    const titleEl = document.querySelector('.top-app-bar__title');
    const backBtn = document.querySelector('.top-app-bar .icon-btn'); // Usually back btn is first

    if (sellerName && titleEl) {
      titleEl.textContent = sellerName;
      if (backBtn && backBtn.href.includes('shop.html')) {
        backBtn.href = `seller-store.html?id=${sellerId}`;
      }
    }
  },

  /**
   * Check if cart belongs to a single seller for contextual branding.
   */
  getCartBranding() {
    const cart = KwabzStore.getCart();
    if (cart.length === 0) return null;

    // Check if all items in product list have same seller_id
    const products = KwabzStore.getAllProducts();
    const itemSellers = cart.map(item => {
      const p = products.find(prod => prod.id === item.product_id);
      return p ? p.seller_id : null;
    });

    const firstSeller = itemSellers[0];
    const isPure = itemSellers.every(s => s === firstSeller && s !== null && s !== 'main');

    if (isPure) {
      const seller = KwabzStore.getSellers().find(s => s.id === firstSeller);
      return seller ? seller.name : null;
    }
    return null;
  },

  clearSmartBranding() {
    sessionStorage.removeItem('kwabz_active_seller_id');
    sessionStorage.removeItem('kwabz_active_seller_name');
  },

  audioCtx: null,

  initAudio() {
    if (this.audioCtx) return this.audioCtx;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    } catch (e) {
      console.warn('AudioContext failed to initialize:', e);
    }
    return this.audioCtx;
  },

  /**
   * Synthesize a premium chiptune chime sound using Web Audio API (0% external dependencies)
   */
  playNotificationSound() {
    try {
      const ctx = this.initAudio();
      if (!ctx) return;

      // If context is suspended, try to resume it (will succeed if called within a user gesture)
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => { });
      }

      // Chime 1 (high note)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      gain1.gain.setValueAtTime(0.12, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.3);

      // Chime 2 (higher note, slightly delayed)
      setTimeout(() => {
        try {
          if (ctx.state === 'suspended') return;
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.frequency.setValueAtTime(880, ctx.currentTime); // A5
          gain2.gain.setValueAtTime(0.12, ctx.currentTime);
          gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
          osc2.start();
          osc2.stop(ctx.currentTime + 0.4);
        } catch (innerErr) {
          console.warn('Delayed audio playback failed:', innerErr);
        }
      }, 80);
    } catch (e) {
      console.warn('Audio alert blocked or unsupported:', e);
    }
  },

  /**
   * Display a native system notification with sound
   */
  showNotification(title, body) {
    if (!('Notification' in window)) return;

    const options = {
      body,
      icon: '/icon-192.png',
      badge: '/icon-96x96.png',
      vibrate: [100, 50, 100],
      tag: 'kwabz-order-update',
      renotify: true
    };

    const trigger = () => {
      // Use Service Worker's showNotification (Industry standard for mobile / Android / iOS PWA support!)
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, options).catch(err => {
            console.warn('[Notification] Service Worker showNotification failed, trying fallback:', err);
            try {
              new Notification(title, options);
            } catch (fallbackErr) {
              console.warn('[Notification] Fallback also failed:', fallbackErr);
            }
          });
        });
      } else {
        // Desktop / Fallback API
        try {
          new Notification(title, options);
        } catch (e) {
          console.warn('[Notification] Standard Notification fallback failed:', e);
        }
      }
      this.playNotificationSound();
      this.toast(title + ' ' + body, 'info'); // Also show an in-app toast
    };

    if (Notification.permission === 'granted') {
      trigger();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') trigger();
      });
    }
  },

  /**
   * Biometric Login Support & Helpers (WebAuthn / Passkeys)
   */
  isBiometricSupported() {
    return !!(window.PublicKeyCredential &&
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function');
  },

  hasBiometricSetup() {
    return !!localStorage.getItem('kwabz_biometric_cred_id') && !!localStorage.getItem('kwabz_biometric_user');
  },

  async registerBiometric(email, password) {
    if (!this.isBiometricSupported()) {
      throw new Error('Biometric authentication is not supported on this device or browser.');
    }

    let isAvailable = false;
    try {
      isAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
      console.warn('Biometric hardware check error:', e);
    }

    if (!isAvailable) {
      throw new Error('No biometric hardware (like Touch ID, Face ID, or Windows Hello) was found or enabled on this device.');
    }

    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const userId = new Uint8Array(16);
    window.crypto.getRandomValues(userId);

    const publicKeyCredentialCreationOptions = {
      challenge: challenge,
      rp: {
        name: "Kwabz Store"
      },
      user: {
        id: userId,
        name: email,
        displayName: email
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred"
      },
      timeout: 60000
    };

    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    });

    if (!credential) {
      throw new Error('Failed to register biometric credentials.');
    }

    const credIdHex = Array.from(new Uint8Array(credential.rawId))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    localStorage.setItem('kwabz_biometric_cred_id', credIdHex);

    const encryptedPw = await this._encrypt(password, credIdHex + '_kwabz_secure_pepper_1928!');
    const payload = {
      email: email,
      password: encryptedPw,
      registeredAt: Date.now()
    };
    localStorage.setItem('kwabz_biometric_user', JSON.stringify(payload));

    return true;
  },

  disableBiometric() {
    localStorage.removeItem('kwabz_biometric_cred_id');
    localStorage.removeItem('kwabz_biometric_user');
  },

  async _encrypt(text, keyMaterial) {
    const enc = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(keyMaterial));
    const key = await crypto.subtle.importKey(
      'raw',
      hash,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      enc.encode(text)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  },

  async _decrypt(encryptedBase64, keyMaterial) {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(keyMaterial));
    const key = await crypto.subtle.importKey(
      'raw',
      hash,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    const combined = new Uint8Array(
      atob(encryptedBase64).split('').map(c => c.charCodeAt(0))
    );
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    );
    return dec.decode(decrypted);
  },

  async authenticateBiometric() {
    if (!this.hasBiometricSetup()) {
      throw new Error('Biometric login is not set up on this device.');
    }

    const credIdHex = localStorage.getItem('kwabz_biometric_cred_id');
    const credIdBytes = new Uint8Array(credIdHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const publicKeyCredentialRequestOptions = {
      challenge: challenge,
      allowCredentials: [{
        id: credIdBytes,
        type: 'public-key'
      }],
      userVerification: 'required',
      timeout: 60000
    };

    const assertion = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions
    });

    if (!assertion) {
      throw new Error('Biometric verification failed.');
    }

    const userJson = localStorage.getItem('kwabz_biometric_user');
    if (!userJson) {
      throw new Error('Biometric credentials missing or corrupted.');
    }

    const user = JSON.parse(userJson);
    const decryptedPw = await this._decrypt(user.password, credIdHex + '_kwabz_secure_pepper_1928!');
    return {
      email: user.email,
      password: decryptedPw
    };
  },

  /**
   * Geolocation utility
   */
  useLiveLocation: async function (inputId) {
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;

    if (!navigator.geolocation) {
      this.toast('Geolocation is not supported by your browser', 'error');
      return;
    }

    const prevValue = inputEl.value;
    inputEl.value = 'Locating device...';
    inputEl.disabled = true;

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`);
          const data = await res.json();
          if (data && data.display_name) {
            // Simplify address for delivery
            const address = data.address;
            const simplified = [address.amenity || address.building || address.road, address.suburb || address.city || address.town].filter(Boolean).join(', ');
            inputEl.value = simplified || data.display_name;
            inputEl.setAttribute('data-lat', lat);
            inputEl.setAttribute('data-lon', lon);
            this.toast('Location found successfully', 'success');
          } else {
            inputEl.value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
            inputEl.setAttribute('data-lat', lat);
            inputEl.setAttribute('data-lon', lon);
            this.toast('Coordinates grabbed, but street name lookup failed', 'warning');
          }
        } catch (err) {
          inputEl.value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
          inputEl.setAttribute('data-lat', lat);
          inputEl.setAttribute('data-lon', lon);
          this.toast('Location found (offline mode)', 'info');
        } finally {
          inputEl.disabled = false;
        }
      },
      (error) => {
        inputEl.value = prevValue;
        inputEl.disabled = false;
        this.toast('Failed to get location. Check permissions.', 'error');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  },
  /**
   * Get an optimized Cloudinary image URL with auto format, quality, and custom width
   * @param {String} url 
   * @param {Number} [width=500] 
   * @returns {String}
   */
  getOptimizedImageUrl(url, width = 500) {
    if (!url || typeof url !== 'string') return url || '';
    if (url.includes('res.cloudinary.com') && url.includes('/image/upload/')) {
      if (url.includes('/q_auto') || url.includes('/f_auto') || url.includes('/w_')) {
        return url;
      }
      return url.replace('/image/upload/', `/image/upload/q_auto,f_auto,w_${width}/`);
    }
    return url;
  },

  /**
   * Upload an image to Cloudinary (using unsigned preset or client signed upload)
   * @param {File|String} fileOrBase64 - File object or base64 data URL
   * @param {Object} [options={}] - Config overrides
   * @returns {Promise<String>} The public secure URL of the uploaded asset
   */
  async uploadToCloudinary(fileOrBase64, options = {}) {
    const cloudName = options.cloudName || 'dcix8pa5a';
    const apiKey = options.apiKey || '379252623331886';
    const apiSecret = options.apiSecret || ''; // Specify apiSecret to enable signed uploads client-side
    const presetName = options.uploadPreset || 'j5l8qibi'; // Cloudinary default unsigned preset

    const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
    const formData = new FormData();
    formData.append('file', fileOrBase64);

    if (apiSecret) {
      const timestamp = Math.round((new Date()).getTime() / 1000);
      formData.append('timestamp', timestamp);
      formData.append('api_key', apiKey);

      const strToSign = `timestamp=${timestamp}${apiSecret}`;
      const signature = await this.sha1(strToSign);
      formData.append('signature', signature);
    } else {
      formData.append('upload_preset', presetName);
    }

    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || 'Failed to upload asset to Cloudinary');
    }

    const data = await response.json();
    return data.secure_url;
  },

  async sha1(string) {
    const utf8 = new TextEncoder().encode(string);
    const hashBuffer = await crypto.subtle.digest('SHA-1', utf8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
};

// ─── Automatic Global Theme Application (on settings change only) ───
if (typeof KwabzStore !== 'undefined') {
  KwabzStore.on('settings_changed', (settings) => {
    if (window.location.search.includes('preview=')) return;
    if (settings && settings.theme) KwabzUtils.applyGlobalTheme(settings.theme);
  });

  // Apply theme immediately if already loaded in store
  const settings = typeof KwabzStore.getSettings === 'function' ? KwabzStore.getSettings() : null;
  if (settings && settings.theme) {
    KwabzUtils.applyGlobalTheme(settings.theme);
  }
}

// Auto-run browser enforcement
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => KwabzUtils.enforceChrome());
} else {
  KwabzUtils.enforceChrome();
}

// Automatically unlock the AudioContext on first user interaction with the document
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    if (typeof KwabzUtils !== 'undefined' && typeof KwabzUtils.initAudio === 'function') {
      const ctx = KwabzUtils.initAudio();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().then(() => {
          console.log('[KwabzUtils] AudioContext successfully unlocked by user gesture.');
          cleanup();
        }).catch(err => console.warn('[KwabzUtils] Failed to unlock AudioContext:', err));
      } else if (ctx && ctx.state === 'running') {
        cleanup();
      }
    }
  };

  const cleanup = () => {
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };

  window.addEventListener('click', unlockAudio);
  window.addEventListener('touchstart', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
}

// ─── Live Order Status Notification Banner Dynamic Engine ───
if (typeof KwabzStore !== 'undefined') {
  const isCustomerPage = !window.location.pathname.includes('admin-') && !window.location.pathname.includes('seller-dashboard') && !window.location.pathname.includes('diagnostics');
  if (isCustomerPage) {
    let activeUpdateOrderId = null;
    let activeUpdateOrderStatus = null;

    function checkOrderUpdates(orders) {
      if (!orders || !orders.length) {
        hideOrderUpdateBanner();
        return;
      }

      let ackStatuses = {};
      try {
        ackStatuses = JSON.parse(localStorage.getItem('kwabz_ack_order_statuses') || '{}');
      } catch (e) { }

      // Find the first order that has a status different from acknowledged status
      const updatedOrder = orders.find(order => {
        const lastAck = ackStatuses[order.id];
        return lastAck !== order.status;
      });

      if (updatedOrder) {
        showOrderUpdateBanner(updatedOrder);
      } else {
        hideOrderUpdateBanner();
      }
    }

    function showOrderUpdateBanner(order) {
      activeUpdateOrderId = order.id;
      activeUpdateOrderStatus = order.status;

      let banner = document.getElementById('orderUpdateBanner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'orderUpdateBanner';
        banner.style.cssText = `
          display: none;
          position: fixed;
          bottom: 7rem;
          left: 50%;
          transform: translateX(-50%) translateY(20px);
          width: calc(100% - 2rem);
          max-width: 400px;
          background: rgba(18, 18, 22, 0.97);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          color: white;
          padding: 0.875rem 1rem 0.875rem 0;
          border-radius: 1.25rem;
          z-index: 10000;
          box-shadow: 0 12px 40px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.1);
          align-items: center;
          gap: 0;
          justify-content: space-between;
          opacity: 0;
          overflow: hidden;
          transition: all 0.45s cubic-bezier(0.16, 1, 0.3, 1);
        `;
        banner.innerHTML = `
          <div id="orderUpdateBannerAccent" style="width:4px; min-height:100%; align-self:stretch; background:#3b82f6; border-radius:4px 0 0 4px; flex-shrink:0; margin-right:0.875rem; transition:background 0.3s;"></div>
          <div style="display:flex; align-items:center; gap:0.75rem; cursor:pointer; flex:1; min-width:0;" id="orderUpdateBannerBody">
            <div id="orderUpdateBannerIconContainer"
              style="width:2.25rem; height:2.25rem; background:rgba(59,130,246,0.15); border-radius:0.75rem; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:background 0.3s;">
              <span class="material-symbols-outlined" style="color:#3b82f6; font-size:1.25rem; transition:color 0.3s;" id="orderUpdateBannerIcon">inventory_2</span>
            </div>
            <div style="text-align:left; flex:1; min-width:0; overflow:hidden;">
              <p id="orderUpdateBannerTitle"
                style="font-size:0.8rem; font-weight:800; font-family:var(--font-headline); letter-spacing:-0.01em; margin:0; line-height:1.25; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                Order Update</p>
              <p id="orderUpdateBannerDesc"
                style="font-size:0.7rem; color:rgba(255,255,255,0.6); margin:0.125rem 0 0; font-weight:500; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                Your order status has been updated.</p>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:0.375rem; flex-shrink:0; padding-right:0.25rem;">
            <button id="orderUpdateBannerAction"
              style="background:white; color:#111; font-size:0.7rem; font-weight:900; padding:0.4rem 0.875rem; border-radius:100px; text-transform:uppercase; letter-spacing:0.06em; border:none; cursor:pointer; white-space:nowrap;">TRACK</button>
            <button id="orderUpdateBannerClose"
              style="color:rgba(255,255,255,0.4); width:1.75rem; height:1.75rem; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.07); border-radius:50%; border:none; cursor:pointer; flex-shrink:0;"
              aria-label="Dismiss"><span class="material-symbols-outlined" style="font-size:1rem;">close</span></button>
          </div>
        `;
        document.body.appendChild(banner);

        document.getElementById('orderUpdateBannerClose').addEventListener('click', (e) => {
          dismissOrderUpdateBanner(e);
        });
      }

      const titleEl = document.getElementById('orderUpdateBannerTitle');
      const descEl = document.getElementById('orderUpdateBannerDesc');
      const actionBtn = document.getElementById('orderUpdateBannerAction');
      const iconEl = document.getElementById('orderUpdateBannerIcon');
      const iconContainer = document.getElementById('orderUpdateBannerIconContainer');

      if (!titleEl || !descEl || !actionBtn) return;

      const orderLabel = order.order_label || order.order_number || order.id.substring(0, 8);

      let statusColor = '#3b82f6';
      let statusIcon = 'inventory_2';
      let statusText = order.status ? order.status.toUpperCase() : 'PENDING';

      if (order.status === 'completed' || order.status === 'delivered') {
        statusColor = '#10b981';
        statusIcon = 'check_circle';
      } else if (order.status === 'cancelled') {
        statusColor = '#ef4444';
        statusIcon = 'cancel';
      } else if (order.status === 'shipped' || order.status === 'dispatched') {
        statusColor = '#f59e0b';
        statusIcon = 'motorcycle';
      }

      const accentEl = document.getElementById('orderUpdateBannerAccent');

      if (iconEl) {
        iconEl.textContent = statusIcon;
        iconEl.style.color = statusColor;
      }
      if (iconContainer) {
        const rgb = statusColor === '#3b82f6' ? '59,130,246'
          : statusColor === '#10b981' ? '16,185,129'
            : statusColor === '#ef4444' ? '239,68,68'
              : '245,158,11';
        iconContainer.style.background = `rgba(${rgb}, 0.15)`;
      }
      if (accentEl) {
        accentEl.style.background = statusColor;
      }

      titleEl.textContent = `Order Status Update!`;
      descEl.textContent = `Order #${orderLabel} is now ${statusText}`;

      actionBtn.onclick = () => {
        window.location.href = `receipt.html?id=${order.id}`;
      };

      const pwaBanner = document.getElementById('pwaPromoBanner');
      if (pwaBanner && pwaBanner.style.display !== 'none') {
        pwaBanner.style.opacity = '0';
        pwaBanner.style.transform = 'translateX(-50%) translateY(30px)';
        setTimeout(() => pwaBanner.style.display = 'none', 500);
      }

      banner.style.display = 'flex';
      setTimeout(() => {
        banner.style.opacity = '1';
        banner.style.transform = 'translateX(-50%) translateY(0)';
      }, 50);
    }

    function hideOrderUpdateBanner() {
      const banner = document.getElementById('orderUpdateBanner');
      if (banner && banner.style.display !== 'none') {
        banner.style.opacity = '0';
        banner.style.transform = 'translateX(-50%) translateY(30px)';
        setTimeout(() => banner.style.display = 'none', 500);
      }
    }

    function dismissOrderUpdateBanner(e) {
      if (e) e.stopPropagation();
      if (activeUpdateOrderId && activeUpdateOrderStatus) {
        let ackStatuses = {};
        try {
          ackStatuses = JSON.parse(localStorage.getItem('kwabz_ack_order_statuses') || '{}');
        } catch (e) { }

        ackStatuses[activeUpdateOrderId] = activeUpdateOrderStatus;
        localStorage.setItem('kwabz_ack_order_statuses', JSON.stringify(ackStatuses));
      }
      hideOrderUpdateBanner();

      const isIndex = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
      if (isIndex) {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
        const isPromoDismissed = localStorage.getItem('kwabz_onboarding_complete');
        if (isPromoDismissed !== 'true' && !isStandalone) {
          const banner = document.getElementById('pwaPromoBanner');
          if (banner) {
            banner.style.display = 'flex';
            setTimeout(() => {
              banner.style.opacity = '1';
              banner.style.transform = 'translateX(-50%) translateY(0)';
            }, 600);
          }
        }
      }
    }

    const initOrderNotifier = () => {
      KwabzStore.on('user_orders_changed', (orders) => {
        checkOrderUpdates(orders);
      });
      const initialOrders = KwabzStore.getUserOrders();
      if (initialOrders && initialOrders.length) {
        checkOrderUpdates(initialOrders);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initOrderNotifier);
    } else {
      initOrderNotifier();
    }
  }
}

// ─── Global Pull-To-Refresh (Customer Pages) ────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!('ontouchstart' in window)) return;
  const path = window.location.pathname;
  if (path.includes('admin') || path.includes('seller')) return;

  let touchStartY = 0;
  let isRefreshing = false;

  const ptrEl = document.createElement('div');
  ptrEl.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.5rem; transition: transform 0.2s;">sync</span>';
  ptrEl.style.cssText = 'position:fixed; top:-60px; left:50%; transform:translateX(-50%); background:var(--primary); color:white; width:40px; height:40px; border-radius:50%; box-shadow:0 8px 24px rgba(0,0,0,0.25); display:flex; align-items:center; justify-content:center; z-index:99999; transition: top 0.2s cubic-bezier(0.4, 0, 0.2, 1);';
  document.body.appendChild(ptrEl);

  const spinStyle = document.createElement('style');
  spinStyle.innerHTML = '@keyframes spin-fast { 100% { transform: rotate(360deg); } } .ptr-spinning { animation: spin-fast 0.6s linear infinite !important; }';
  document.head.appendChild(spinStyle);
  const iconEl = ptrEl.querySelector('span');

  document.addEventListener('touchstart', e => {
    if (window.scrollY <= 5 && !isRefreshing) { touchStartY = e.touches[0].clientY; }
    else { touchStartY = 0; }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (touchStartY > 0 && !isRefreshing) {
      const pullDist = e.touches[0].clientY - touchStartY;
      if (pullDist > 0) {
        if (pullDist < 120) {
          ptrEl.style.transition = 'none';
          ptrEl.style.top = `${-60 + (pullDist / 1.5)}px`;
          iconEl.style.transform = `rotate(${pullDist * 2}deg)`;
        }
        if (pullDist > 15 && e.cancelable) e.preventDefault();
      }
    }
  }, { passive: false });

  document.addEventListener('touchend', async e => {
    if (touchStartY > 0 && !isRefreshing) {
      const pullDist = e.changedTouches[0].clientY - touchStartY;
      if (pullDist > 70) {
        isRefreshing = true;
        ptrEl.style.transition = 'top 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
        ptrEl.style.top = '70px';
        iconEl.classList.add('ptr-spinning');

        if (window.KwabzStore) {
          try {
            if (typeof window.KwabzStore.fetchProducts === 'function') await window.KwabzStore.fetchProducts();
            if (typeof window.KwabzStore.fetchCategories === 'function') await window.KwabzStore.fetchCategories();
          } catch (err) { }
        } else {
          setTimeout(() => window.location.reload(), 500);
        }

        setTimeout(() => {
          ptrEl.style.transition = 'top 0.3s ease-in';
          ptrEl.style.top = '-60px';
          setTimeout(() => { iconEl.classList.remove('ptr-spinning'); isRefreshing = false; }, 300);
        }, 800);
      } else {
        ptrEl.style.transition = 'top 0.3s ease-out';
        ptrEl.style.top = '-60px';
      }
    }
    touchStartY = 0;
  });
});


