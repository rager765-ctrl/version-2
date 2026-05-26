// ─── 1. Core PWA Engine (Immediate Registration) ────────────────
let deferredPrompt;
const installBtn = document.getElementById('install-btn');

// Capture the install prompt as early as possible
window.addEventListener('beforeinstallprompt', (e) => {
  console.log('[PWA] beforeinstallprompt event captured');
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.style.display = 'flex';
  const heroBtn = document.getElementById('hero-install-btn');
  if (heroBtn) heroBtn.style.display = 'inline-flex';
});

// Hide buttons if already installed
if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
  if (installBtn) installBtn.style.display = 'none';
  const heroBtn = document.getElementById('hero-install-btn');
  if (heroBtn) heroBtn.style.display = 'none';
}

// Service Worker and Live Sync Engine is now centralized globally inside shell.js to support all app routes.

// ─── 2. Install Button Logic ────────────────────────────────────
function handleInstallClick() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  if (isIOS) {
    const msg = 'To install: Tap Share > Add to Home Screen';
    if (typeof KwabzUtils !== 'undefined' && KwabzUtils.toast) KwabzUtils.toast(msg, 'info');
    else alert(msg);
    return;
  }

  if (!deferredPrompt) {
    const msg = 'To install: Tap the browser menu (⋮) and select "Install app".';
    if (typeof KwabzUtils !== 'undefined' && KwabzUtils.toast) KwabzUtils.toast(msg, 'info');
    else alert(msg);
    return;
  }

  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(({ outcome }) => {
    console.log(`[PWA] Install Outcome: ${outcome}`);
    if (outcome === 'accepted') {
      deferredPrompt = null;
      if (installBtn) installBtn.style.display = 'none';
      const heroBtn = document.getElementById('hero-install-btn');
      if (heroBtn) heroBtn.style.display = 'none';
    }
  });
}

if (installBtn) {
  installBtn.addEventListener('click', handleInstallClick);
}

const heroBtn = document.getElementById('hero-install-btn');
if (heroBtn) {
  heroBtn.addEventListener('click', handleInstallClick);
}

window.addEventListener('appinstalled', () => {
  console.log('[PWA] App successfully installed');
  if (installBtn) installBtn.style.display = 'none';
  deferredPrompt = null;
});

// ─── 3. Real-time Firebase Sync handled by KwabzStore (store.js) ──
// Redundant listeners removed to optimize performance and prevent sync loops.


// ─── 4. Theme & Profile Engine ──────────────────────────────
/**
 * Dynamic Status Bar Color Controller
 * Automatically styles the browser address bar & PWA status bar on iOS Safari & Chrome
 * by reading the computed background of the top navigation bar.
 */
function updateDynamicStatusBarColor() {
  const topBar = document.querySelector('.top-app-bar') || document.querySelector('header');
  let themeColorMeta = document.querySelector('meta[name="theme-color"]');
  
  if (!themeColorMeta) {
    themeColorMeta = document.createElement('meta');
    themeColorMeta.setAttribute('name', 'theme-color');
    document.head.appendChild(themeColorMeta);
  }

  // 1. Safe default background colors based on dark-mode class
  const isDarkMode = document.body.classList.contains('dark-mode');
  let finalColor = isDarkMode ? '#000000' : '#ffffff';

  // 2. Extract and blend header background color
  if (topBar) {
    const computedStyle = window.getComputedStyle(topBar);
    const bgColor = computedStyle.backgroundColor;

    if (bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)') {
      const rgba = bgColor.match(/[\d.]+/g);
      if (rgba) {
        const r = parseInt(rgba[0]);
        const g = parseInt(rgba[1]);
        const b = parseInt(rgba[2]);
        const a = rgba[3] !== undefined ? parseFloat(rgba[3]) : 1.0;

        // If it's a glassmorphism style (semi-transparent), perform alpha-blending with body
        if (a < 1.0) {
          const bodyBg = window.getComputedStyle(document.body).backgroundColor;
          let bodyR = isDarkMode ? 0 : 255;
          let bodyG = bodyR, bodyB = bodyR;

          if (bodyBg && bodyBg !== 'transparent' && bodyBg !== 'rgba(0, 0, 0, 0)') {
            const bodyRgba = bodyBg.match(/[\d.]+/g);
            if (bodyRgba) {
              bodyR = parseInt(bodyRgba[0]);
              bodyG = parseInt(bodyRgba[1]);
              bodyB = parseInt(bodyRgba[2]);
            }
          }

          // Blend: color = alpha * fg + (1 - alpha) * bg
          const blendR = Math.round(r * a + bodyR * (1 - a));
          const blendG = Math.round(g * a + bodyG * (1 - a));
          const blendB = Math.round(b * a + bodyB * (1 - a));

          finalColor = "#" + ((1 << 24) + (blendR << 16) + (blendG << 8) + blendB).toString(16).slice(1);
        } else {
          // Solid Color -> Hex converter
          finalColor = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        }
      }
    }
  }

  // 3. Set the meta theme color
  themeColorMeta.setAttribute('content', finalColor);
}

/**
 * Automatically blurs any text input that receives focus instantly on page load
 * or component mount, preventing the mobile virtual keyboard from popping up
 * disruptively before the user has explicitly tapped the input.
 */
function preventMobileKeyboardPopup() {
  document.addEventListener('DOMContentLoaded', () => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      activeEl.blur();
    }
  }, { once: true });
}

const KwabzTheme = (() => {
  const STORAGE_KEY = 'kwabz_theme_mode';

  function applyTheme(mode) {
    if (mode === 'dark') {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem(STORAGE_KEY, mode);
    
    // Defer to allow DOM styling variables to settle, then update status bar color
    setTimeout(updateDynamicStatusBarColor, 50);
  }

  function init() {
    const saved = localStorage.getItem(STORAGE_KEY) || 'light';
    applyTheme(saved);

    document.addEventListener('click', (e) => {
      const toggle = e.target.closest('#theme-toggle');
      if (toggle) {
        const current = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
        applyTheme(current);
      }
    });

    // Watch for dynamic class changes on body (e.g. from script theme changes)
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          updateDynamicStatusBarColor();
        }
      });
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // Also run on dynamic styling variations (e.g., loaded themes)
    window.addEventListener('load', updateDynamicStatusBarColor);
    document.addEventListener('DOMContentLoaded', updateDynamicStatusBarColor);
  }

  return { init, applyTheme };
})();

async function initProfileEngine() {
  const profileForm = document.getElementById('profile-form');
  if (!profileForm) return;

  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = firebase.auth().currentUser;
    if (!user) return;

    const newName = profileForm.querySelector('[name="display-name"]').value.trim();
    const submitBtn = profileForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Syncing...';

    try {
      // Simultaneous Sync: Auth + Firestore
      await Promise.all([
        user.updateProfile({ displayName: newName }),
        firebase.firestore().collection('users').doc(user.uid).set({
          displayName: newName,
          last_updated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
      ]);
      KwabzUtils.toast('Profile synced successfully', 'success');
    } catch (err) {
      KwabzUtils.toast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// ─── 5. Shared UI Components ────────────────────────────────
function quickAdd(productId) {
  if (typeof KwabzStore === 'undefined' || typeof KwabzUtils === 'undefined') return;

  // Require login check
  if (typeof KwabzUtils.requireLogin === 'function' && !KwabzUtils.requireLogin()) return;

  const product = KwabzStore.getProductById(productId);
  if (!product) return;

  KwabzStore.addToCart(product);
  KwabzUtils.toast(`${product.name} added to cart`);
  if (typeof KwabzUtils.updateCartBadge === 'function') {
    KwabzUtils.updateCartBadge();
  }
}

// ─── 6. Initialization ──────────────────────────────────────
/**
 * PWA Native Touch Physics & Standalone Configuration Engine
 */
function initNativePWAEngine() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isStandalone) {
    document.body.classList.add('pwa-standalone');
    console.log('[PWA] Running in standalone mode (Native UI active)');
  }
}

window.addEventListener('load', () => {
  // Initialization is now managed by shell.js to ensure proper Firebase startup order.
  // We only initialize theme here as it doesn't depend on Firebase.
  KwabzTheme.init();
  preventMobileKeyboardPopup();
  initProfileEngine();
  initNativePWAEngine();
});
