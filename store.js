/**
 * Kwabz Store Online — Global State Manager (v2)
 * Features: Real-time listeners, Firebase Auth, User-specific Cart
 */

// Dynamically load full Google Fonts on admin and seller dashboard pages since they are excluded from the main HTML pre-fetching optimization
if (typeof window !== 'undefined' && window.location && (window.location.pathname.includes('admin') || window.location.pathname.includes('seller') || window.location.href.includes('admin') || window.location.href.includes('seller'))) {
  if (!document.querySelector('link[href*="Material+Symbols+Outlined"]')) {
    const preconnect1 = document.createElement('link');
    preconnect1.rel = 'preconnect';
    preconnect1.href = 'https://fonts.googleapis.com';
    document.head.appendChild(preconnect1);

    const preconnect2 = document.createElement('link');
    preconnect2.rel = 'preconnect';
    preconnect2.href = 'https://fonts.gstatic.com';
    preconnect2.crossOrigin = 'anonymous';
    document.head.appendChild(preconnect2);

    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Inter:wght@100..900&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap';
    document.head.appendChild(fontLink);
  }
}

const KwabzStore = (() => {
  // ─── Storage Keys ──────────────────────────────────────────
  let lastRefreshTime = 0;
  const KEYS = {
    CART: 'kwabz_cart',
    WISHLIST: 'kwabz_wishlist',
    ADMIN_AUTH: 'kwabz_admin_auth',
    LOCAL_DATA_MIGRATED: 'kwabz_data_migrated_to_firestore',
    CACHE_PRODUCTS: 'kwabz_cache_products',
    CACHE_CATEGORIES: 'kwabz_cache_categories',
    CACHE_ORDERS: 'kwabz_cache_orders',
    CACHE_TIMESTAMP: 'kwabz_cache_ts',
    SETTINGS: 'kwabz_settings',
    CACHE_SELLERS: 'kwabz_cache_sellers',
    USER_ORDERS: 'kwabz_my_orders',   // Per-user order history (local)
    CACHE_BLOG_POSTS: 'kwabz_cache_blog_posts',
    CACHE_PROMO_CODES: 'kwabz_cache_promo_codes',
    CACHE_BUNDLES: 'kwabz_cache_bundles',
  };

  // ─── IndexedDB Wrapper (Optimized Caching) ───
  const kwabz_idb = {
    _db: null,
    async init() {
      if (this._db) return this._db;
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('kwabz_store_db', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('keyval');
        req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
        req.onerror = () => reject('idb err');
      });
    },
    async get(key) {
      try {
        const db = await this.init();
        return new Promise((resolve, reject) => {
          const req = db.transaction('keyval').objectStore('keyval').get(key);
          req.onsuccess = e => resolve(e.target.result);
          req.onerror = () => reject('idb err');
        });
      } catch (e) { return null; }
    },
    async set(key, val) {
      try {
        const db = await this.init();
        return new Promise((resolve, reject) => {
          const req = db.transaction('keyval', 'readwrite').objectStore('keyval').put(val, key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject('idb err');
        });
      } catch (e) { }
    }
  };

  // ─── Safe localStorage helper (handles QuotaExceededError) ──
  function _safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
        console.warn('[KwabzStore] localStorage quota exceeded. Clearing old caches...');
        // Free up space by removing the largest caches first
        try {
          localStorage.removeItem(KEYS.CACHE_PRODUCTS);
          localStorage.removeItem(KEYS.CACHE_CATEGORIES);
          localStorage.removeItem(KEYS.CACHE_ORDERS);
          localStorage.removeItem(KEYS.CACHE_SELLERS);
          // Retry once
          localStorage.setItem(key, value);
        } catch (e2) {
          console.warn('[KwabzStore] Could not write to localStorage even after cleanup. Running from memory only.');
        }
      } else {
        console.warn('[KwabzStore] localStorage write failed:', e);
      }
    }
  }

  // Helper to fetch with an execution timeout to support fast mobile fallback on slow connections
  function fetchWithTimeout(resource, options = {}) {
    const { timeout = 4000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    return fetch(resource, {
      ...options,
      signal: controller.signal
    }).then(response => {
      clearTimeout(id);
      return response;
    }).catch(error => {
      clearTimeout(id);
      throw error;
    });
  }

  window.RENDER_API_BASE = 'https://nodejs-backend-1-ucbq.onrender.com';
  const CACHE_TTL = 15 * 60 * 1000; // 15 minutes in ms

  // ─── State ────────────────────────────────────────────────
  let localProducts = [];
  let localCategories = [];
  let localOrders = [];
  let localCart = [];
  let localWishlist = [];
  let currentUser = null;
  let isFirestoreInitialized = false;
  let isInitializing = false;
  let localSellers = [];
  let localBlogPosts = [];
  let localPromoCodes = [];
  let localBundles = [];
  let localSettings = { newTagDuration: 7 };
  let localRole = null; // 'admin' or null
  let syncStatus = 'syncing'; // Always start syncing — only go 'online' when Firestore actually responds (not from stale cache)
  let presenceInterval = null;
  let isAuthResolved = false;
  let isConnectionOnline = navigator.onLine;

  // Per-user local order history (guest + logged-in)
  let userOrders = [];
  let previousUserOrderStatuses = null;
  let previousUserOrderLocations = null;

  // Real-time listener unsubscribers
  const unsubscribers = {
    products: null,
    categories: null,
    orders: null,
    cart: null,
    wishlist: null,
    settings: null,
    sellers: null,
    blogPosts: null,
    userOrders: null,   // User-specific order listener
    presence: null,     // Listener for admin presence
    promoCodes: null,   // Promo codes listener
    sync: {
      products: false,
      categories: false,
      sellers: false,
      promoCodes: false
    }
  };

  // ─── Event System ──────────────────────────────────────────
  const listeners = {};

  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
  }

  function off(event, callback) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(cb => cb !== callback);
  }

  function emit(event, data) {
    if (event === 'firestore_read' && typeof data === 'number' && data > 0) {
      try {
        const todayKey = 'kwabz_fb_reads_' + new Date().toISOString().slice(0, 10);
        // Clean up reads counters from previous days to keep localStorage tidy
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('kwabz_fb_reads_') && k !== todayKey) {
            localStorage.removeItem(k);
          }
        });
        let dailyReadCount = parseInt(localStorage.getItem(todayKey) || '0', 10);
        dailyReadCount += data;
        localStorage.setItem(todayKey, String(dailyReadCount));
      } catch (e) {
        console.warn('[KwabzStore] Failed to write reads to localStorage:', e);
      }
    }

    if (listeners[event]) {
      listeners[event].forEach(cb => {
        try {
          cb(data);
        } catch (err) {
          console.error(`[KwabzStore] Error in listener for "${event}":`, err);
        }
      });
    }
  }

  // ─── ID Generator ──────────────────────────────────────────
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  function isAdminLoggedIn() {
    if (localStorage.getItem('kwabz_admin_bypass') === 'true') {
      return true;
    }
    // Treat as a regular customer if User mode is active
    if (localStorage.getItem('kwabz_user_mode') === 'true') {
      return false;
    }
    if (localStorage.getItem('kwabz_suspended') === 'true') {
      return false;
    }
    if (localRole === 'admin') return true;

    // Strict alignment check if auth state has resolved
    if (isAuthResolved) {
      const user = firebase.auth().currentUser;
      const ADMIN_EMAILS = ['admin@kwabzstore.com', 'admin@kwabz.com', 'kelvin@kwabz.com'];
      if (user && (ADMIN_EMAILS.includes(user.email) || localRole === 'admin')) {
        if (localStorage.getItem('kwabz_suspended') === 'true') return false;
        localRole = 'admin';
        return true;
      }
      // Since the Auth has fully resolved and we are NOT an authenticated admin user,
      // clean up stale optimistic role/localStorage.
      if (localStorage.getItem(KEYS.ADMIN_AUTH) === 'true') {
        localStorage.removeItem(KEYS.ADMIN_AUTH);
        localRole = null;
      }
      return false;
    }

    // Optimistic fallback before auth is resolved
    if (localStorage.getItem(KEYS.ADMIN_AUTH) === 'true') {
      return true;
    }
    return false;
  }

  // ─── Firebase Auth ────────────────────────────────────────
  function setupAuthListener() {
    firebase.auth().onAuthStateChanged(async user => {
      currentUser = user;
      if (user) {
        // Enforce suspension check synchronously from cache
        if (localStorage.getItem('kwabz_suspended') === 'true') {
          localRole = null;
          localStorage.removeItem(KEYS.ADMIN_AUTH);
          localStorage.removeItem('kwabz_login_time');
          await firebase.auth().signOut();
          window.location.href = 'index.html';
          return;
        }

        // Enforce 24-hour session limit
        const now = Date.now();
        const loginTimeStr = localStorage.getItem('kwabz_login_time');
        if (loginTimeStr) {
          const loginTime = parseInt(loginTimeStr, 10);
          if (now - loginTime > 24 * 60 * 60 * 1000) {
            console.log('[KwabzStore] User session expired (24 hours limit). Logging out...');
            await logout();
            const isAdminPage = window.location.pathname.includes('admin-') || window.location.pathname.includes('sellers.html');
            if (isAdminPage) {
              window.location.href = 'admin-login.html';
            } else {
              window.location.reload();
            }
            return;
          }
        } else {
          localStorage.setItem('kwabz_login_time', now.toString());
        }

        localStorage.setItem('kwabz_auth_cache', user.uid);

        const isUserMode = localStorage.getItem('kwabz_user_mode') === 'true';
        const ADMIN_EMAILS = ['admin@kwabzstore.com', 'admin@kwabz.com', 'kelvin@kwabz.com'];
        if (ADMIN_EMAILS.includes(user.email)) {
          localRole = isUserMode ? null : 'admin';
          if (!isUserMode) {
            localStorage.setItem(KEYS.ADMIN_AUTH, 'true');
          }
          isAuthResolved = true; // Resolve early for known admins
          emit('user_changed', user);
        }

        const fetchUserRole = () => {
          if (unsubscribers.userProfile) unsubscribers.userProfile();
          
          unsubscribers.userProfile = firebase.firestore().collection('users').doc(user.uid)
            .onSnapshot(async (doc) => {
              try {
                if (doc.exists) {
                  const isSuspended = doc.data().suspended === true;
                  if (isSuspended) {
                    localRole = null;
                    localStorage.setItem('kwabz_suspended', 'true');
                    localStorage.removeItem(KEYS.ADMIN_AUTH);
                    localStorage.removeItem('kwabz_login_time');
                    if (unsubscribers.userProfile) { unsubscribers.userProfile(); unsubscribers.userProfile = null; }
                    await firebase.auth().signOut();
                    alert('Your account has been deactivated/suspended by an administrator.');
                    window.location.href = 'index.html';
                    return;
                  } else {
                    localStorage.removeItem('kwabz_suspended');
                  }
                  
                  const dbRole = doc.data().role;
                  const freshRole = isUserMode ? null : (dbRole || (ADMIN_EMAILS.includes(user.email) ? 'admin' : null));
                  
                  if (freshRole !== localRole) {
                    localRole = freshRole;
                    if (localRole === 'admin') {
                      localStorage.setItem(KEYS.ADMIN_AUTH, 'true');
                      _startPresence(user.uid);
                      _setupOrdersListener();
                      emit('admin_ready', currentUser);
                    } else {
                      localStorage.removeItem(KEYS.ADMIN_AUTH);
                    }
                    emit('user_changed', currentUser);
                  }
                } else {
                  // Bootstrap super admin if document does not exist
                  if (ADMIN_EMAILS.includes(user.email)) {
                    await firebase.firestore().collection('users').doc(user.uid).set({
                      email: user.email,
                      role: 'admin',
                      displayName: user.displayName || 'Master Admin',
                      created_at: new Date().toISOString()
                    });
                    // The onSnapshot will re-fire with the new document, so we don't need to manually emit here.
                  }
                }
              } catch (e) {
                console.error('[KwabzStore] userProfile snapshot error:', e);
              }
            }, err => {
              console.error('[KwabzStore] userProfile listener error:', err);
            });
        };
        fetchUserRole();

        _setupCartListener();
        _setupWishlistListener();
        _setupUserOrdersListener(user.uid);
        if (localRole === 'admin') {
          _startPresence(user.uid);
          _setupOrdersListener();
        }
      } else {
        localStorage.removeItem('kwabz_auth_cache');
        localStorage.removeItem(KEYS.ADMIN_AUTH);
        localRole = null;
        _stopPresence();
        if (unsubscribers.cart) { unsubscribers.cart(); unsubscribers.cart = null; }
        if (unsubscribers.wishlist) { unsubscribers.wishlist(); unsubscribers.wishlist = null; }
        if (unsubscribers.orders) { unsubscribers.orders(); unsubscribers.orders = null; }
        if (unsubscribers.userOrders) { unsubscribers.userOrders(); unsubscribers.userOrders = null; }
        if (unsubscribers.userProfile) { unsubscribers.userProfile(); unsubscribers.userProfile = null; }
        localCart = [];
        localWishlist = [];
        localOrders = [];
        localStorage.removeItem(KEYS.CART);
        localStorage.removeItem(KEYS.WISHLIST);
        emit('cart_changed', []);
        emit('wishlist_changed', []);
        emit('orders_changed', []);
      }

      if (!isAuthResolved) {
        isAuthResolved = true;
        emit('user_changed', currentUser);
      }
      if (localRole === 'admin') emit('admin_ready', currentUser);
    });
  }

  function _startPresence(uid) {
    _stopPresence();
    const update = async () => {
      if (!uid) return;
      try {
        // Try to get freshest name from Auth or Firestore
        let name = currentUser?.displayName;
        if (!name) {
          const doc = await firebase.firestore().collection('users').doc(uid).get();
          name = doc.data()?.displayName;
        }

        await firebase.firestore().collection('presence').doc(uid).set({
          uid: uid,
          email: currentUser?.email,
          displayName: name || 'Admin',
          last_active: new Date().toISOString(),
          status: 'online'
        }, { merge: true });
      } catch (e) { }
    };
    update();
    presenceInterval = setInterval(update, 60000); // Heartbeat every 60s
  }

  function _stopPresence() {
    if (presenceInterval) clearInterval(presenceInterval);
    presenceInterval = null;
  }

  function refreshPresence() {
    if (currentUser && localRole === 'admin') {
      _startPresence(currentUser.uid);
    }
  }

  /**
   * trackVisitor()
   * Records a lightweight visitor document in the 'visitors' Firestore collection.
   * - Uses a persistent localStorage 'kwabz_vid' as the document ID (device fingerprint).
   * - Works for both registered users (uid linked) and guests.
   * - Uses { merge: true } so it's an efficient upsert, not a duplicate write.
   * - Skipped entirely on admin pages to avoid polluting the count.
   */
  async function trackVisitor() {
    try {
      if (window.location.pathname.includes('admin-')) return; // Never count admins

      let vid = localStorage.getItem('kwabz_vid');
      if (!vid) {
        vid = 'v_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('kwabz_vid', vid);
      }

      // OPTIMIZATION: Send heartbeat to Render server instead of writing to Firestore
      const url = (window.RENDER_API_BASE || '') + '/api/visitors/heartbeat';
      if (url) {
        fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId: vid }),
          timeout: 3000
        }).catch(() => { });
      }
    } catch (e) {
      // Silent — visitor tracking is non-critical
    }
  }

  /**
   * onVisitorCount(callback)
   * Polls the Render API for the live visitor count to avoid heavy Firestore reads.
   */
  function onVisitorCount(callback) {
    if (unsubscribers.visitors) clearInterval(unsubscribers.visitors);

    const fetchCount = async () => {
      try {
        const url = (window.RENDER_API_BASE || '') + '/api/visitor-count';
        if (!url) return;
        const res = await fetchWithTimeout(url, { timeout: 3000 });
        const data = await res.json();
        callback(data.count || 0);
      } catch (e) {
        // Fallback or silent failure
      }
    };

    fetchCount(); // Initial fetch
    unsubscribers.visitors = setInterval(fetchCount, 10000); // Poll every 10s

    return () => { if (unsubscribers.visitors) { clearInterval(unsubscribers.visitors); unsubscribers.visitors = null; } };
  }

  /**
   * deleteAdmin(uid)
   * Revokes admin access by setting role to 'user' in Firestore
   * and removing their presence document.
   * NOTE: Cannot delete the Firebase Auth account from client-side—that requires Admin SDK.
   * The user is demoted so they can no longer access the admin panel.
   */
  async function deleteAdmin(uid) {
    if (!uid) throw new Error('No UID provided');
    const db = firebase.firestore();
    try {
      await db.collection('users').doc(uid).update({ role: 'user' });
      await db.collection('presence').doc(uid).delete().catch(() => { });
      console.log('[KwabzStore] Admin demoted:', uid);
    } catch (err) {
      console.error('[KwabzStore] deleteAdmin error:', err);
      throw err;
    }
  }

  // Presence cache: throttle the inner .get() to once per 60s max
  let _presenceCache = null;
  let _presenceCacheTs = 0;
  const _PRESENCE_CACHE_TTL = 60 * 1000; // 60 seconds

  function onAdminsPresence(callback) {
    if (unsubscribers.presence) unsubscribers.presence();

    // Listen to ALL users with role 'admin'
    unsubscribers.presence = firebase.firestore().collection('users')
      .where('role', '==', 'admin')
      .onSnapshot(async snapshot => {
        const admins = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // THROTTLE: Only re-fetch presence docs if cache is stale (> 60s old).
        // The users onSnapshot fires frequently — presence barely changes that fast.
        const now = Date.now();
        if (!_presenceCache || (now - _presenceCacheTs) > _PRESENCE_CACHE_TTL) {
          try {
            const fifteenMinsAgoIso = new Date(now - 15 * 60 * 1000).toISOString();
            const presenceSnap = await firebase.firestore().collection('presence')
              .where('last_active', '>=', fifteenMinsAgoIso)
              .get();
            _presenceCache = {};
            presenceSnap.forEach(doc => { _presenceCache[doc.id] = doc.data(); });
            _presenceCacheTs = now;
          } catch (e) {
            console.warn('[KwabzStore] Presence fetch failed, using cached value:', e);
            _presenceCache = _presenceCache || {};
          }
        }

        // Merge cached presence into admin data
        const merged = admins.map(a => ({
          ...a,
          presence: _presenceCache[a.id] || null
        }));

        callback(merged);
      });
  }

  async function emailSignUp(email, password) {
    try {
      const res = await firebase.auth().createUserWithEmailAndPassword(email, password);
      if (res.user) {
        localStorage.setItem('kwabz_auth_cache', res.user.uid);
        localStorage.setItem('kwabz_login_time', Date.now().toString());
      }
      return res.user;
    } catch (err) {
      console.error('[KwabzStore] Sign up error:', err.message);
      throw err;
    }
  }

  async function googleSignIn(role = 'customer') {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const res = await firebase.auth().signInWithPopup(provider);
      const user = res.user;
      if (user) {
        localStorage.setItem('kwabz_auth_cache', user.uid);
        localStorage.setItem('kwabz_login_time', Date.now().toString());

        // Save user profile details in Firestore 'users' collection if not exists
        const userRef = firebase.firestore().collection('users').doc(user.uid);
        const doc = await userRef.get();
        if (!doc.exists) {
          await userRef.set({
            email: user.email,
            displayName: user.displayName || user.email.split('@')[0],
            phoneNumber: user.phoneNumber || '',
            deliveryAddress: '',
            role: role,
            created_at: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      }
      return user;
    } catch (err) {
      console.error('[KwabzStore] Google Sign In error:', err.message);
      throw err;
    }
  }

  async function adminLogin(email, pw) {
    try {
      const res = await firebase.auth().signInWithEmailAndPassword(email, pw);
      const user = res.user;

      const ADMIN_EMAILS = ['admin@kwabzstore.com', 'admin@kwabz.com', 'kelvin@kwabz.com'];
      const isDesignatedAdmin = ADMIN_EMAILS.includes(user.email);

      // Check Firestore for role
      const doc = await firebase.firestore().collection('users').doc(user.uid).get();
      if ((doc.exists && doc.data().role === 'admin') || isDesignatedAdmin) {
        if (doc.exists && doc.data().suspended === true) {
          await firebase.auth().signOut();
          localStorage.removeItem(KEYS.ADMIN_AUTH);
          localStorage.removeItem('kwabz_auth_cache');
          localStorage.removeItem('kwabz_login_time');
          throw new Error('This account has been suspended by an administrator.');
        }

        // Check if phone number is configured and 2FA is enabled
        const mfaEnabled = doc.exists && doc.data().mfaEnabled === true;
        const phoneNumber = doc.exists ? doc.data().phoneNumber : null;
        if (mfaEnabled && phoneNumber) {
          // Check for device trust
          let deviceId = localStorage.getItem('kwabz_device_id');
          if (!deviceId) {
            deviceId = 'dev_' + Math.random().toString(36).substring(2, 15);
            localStorage.setItem('kwabz_device_id', deviceId);
          }
          const trustedDevices = (doc.exists ? doc.data().trusted_devices : null) || [];
          if (!trustedDevices.includes(deviceId)) {
            // Foreign device detected! Trigger 6-pin 2FA
            const mfaCode = Math.floor(100000 + Math.random() * 900000).toString();
            await firebase.firestore().collection('users').doc(user.uid).update({
              mfa_code: mfaCode,
              mfa_expires: Date.now() + 5 * 60 * 1000 // 5 minutes validity
            });
            // Send automatically via WhatsApp
            await _sendTwilioMessage(phoneNumber, `⚠️ Security Alert: A new login was initiated on a foreign device. Your Kwabz Store verification code is: ${mfaCode}. This code is valid for 5 minutes.`);

            // Return indicating MFA is required
            return { mfaRequired: true, uid: user.uid, phoneNumber: phoneNumber };
          }
        }

        // Trusted device or no phone configured
        localRole = 'admin';
        localStorage.setItem(KEYS.ADMIN_AUTH, 'true');
        localStorage.setItem('kwabz_auth_cache', user.uid);
        localStorage.setItem('kwabz_login_time', Date.now().toString());

        // Make sure the user document has role: 'admin' if they are a designated admin
        if (isDesignatedAdmin && (!doc.exists || doc.data().role !== 'admin')) {
          await firebase.firestore().collection('users').doc(user.uid).set({
            email: user.email,
            role: 'admin',
            displayName: user.displayName || 'Master Admin'
          }, { merge: true });
        }

        return user;
      } else {
        await firebase.auth().signOut();
        localStorage.removeItem(KEYS.ADMIN_AUTH);
        localStorage.removeItem('kwabz_auth_cache');
        localStorage.removeItem('kwabz_login_time');
        throw new Error('Access denied. You do not have administrator privileges.');
      }
    } catch (err) {
      console.error('[KwabzStore] Admin login error:', err);
      throw err;
    }
  }

  async function verifyAdminMfa(uid, code) {
    if (!uid || !code) throw new Error('UID and code are required.');
    const doc = await firebase.firestore().collection('users').doc(uid).get();
    if (!doc.exists) throw new Error('User document not found.');

    const data = doc.data();
    if (!data.mfa_code || data.mfa_code !== code) {
      throw new Error('Invalid verification code.');
    }
    if (!data.mfa_expires || Date.now() > data.mfa_expires) {
      throw new Error('Verification code has expired. Please try again.');
    }

    // Trust this device
    let deviceId = localStorage.getItem('kwabz_device_id');
    if (!deviceId) {
      deviceId = 'dev_' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('kwabz_device_id', deviceId);
    }

    const trustedDevices = data.trusted_devices || [];
    if (!trustedDevices.includes(deviceId)) {
      trustedDevices.push(deviceId);
    }

    // Clean up code and save trusted device
    await firebase.firestore().collection('users').doc(uid).update({
      trusted_devices: trustedDevices,
      mfa_code: firebase.firestore.FieldValue.delete(),
      mfa_expires: firebase.firestore.FieldValue.delete()
    });

    // Authorize admin session locally
    localRole = 'admin';
    localStorage.setItem(KEYS.ADMIN_AUTH, 'true');
    localStorage.setItem('kwabz_auth_cache', uid);
    localStorage.setItem('kwabz_login_time', Date.now().toString());

    return true;
  }

  async function emailLogin(email, password) {
    try {
      const res = await firebase.auth().signInWithEmailAndPassword(email, password);
      if (res.user) {
        localStorage.setItem('kwabz_auth_cache', res.user.uid);
        localStorage.setItem('kwabz_login_time', Date.now().toString());
      }
      return res.user;
    } catch (err) {
      console.error('[KwabzStore] Login error:', err.message);
      throw err;
    }
  }

  async function logout() {
    try {
      localStorage.removeItem('kwabz_auth_cache');
      localStorage.removeItem('kwabz_user_mode');
      localStorage.removeItem('kwabz_login_time');
      await firebase.auth().signOut();
    } catch (err) {
      console.error('[KwabzStore] Logout error:', err);
      throw err;
    }
  }

  function getCurrentUser() {
    return currentUser;
  }

  function getUserRole() {
    return localRole;
  }

  function getIsAuthResolved() {
    return isAuthResolved;
  }

  // ─── Firestore Initialization ──────────────────────────────
  async function init() {
    if (isFirestoreInitialized || isInitializing) return;
    isInitializing = true;

    console.log('[KwabzStore] Initializing Offline-First Store v2...');

    // 1. Check if Firebase SDK is ready and initialize synchronously BEFORE yielding to await
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      console.warn('[KwabzStore] Firebase SDK not found... Waiting or staying offline.');
      syncStatus = 'offline';
      emit('sync_status', syncStatus);
      isInitializing = false;
      isFirestoreInitialized = true;
      setTimeout(() => emit('store_initialized', true), 0);
      return;
    }

    if (!firebase.apps.length) {
      try {
        firebase.initializeApp({
          apiKey: "AIzaSyAt6xHMVvJ82iJSb8XO_bYGfxLKncG8oUE",
          authDomain: "mr-rager.firebaseapp.com",
          projectId: "mr-rager",
          storageBucket: "mr-rager.firebasestorage.app",
          messagingSenderId: "731077938078",
          appId: "1:731077938078:web:878fc483d6e1921bcca48f"
        });
        try {
          firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(err => {
            console.warn('[KwabzStore] Firebase Persistence Error:', err);
          });
        } catch (e) {
          console.warn('[KwabzStore] Persistence setup failed:', e);
        }
        console.log('[KwabzStore] Firebase initialized inside store.js');
      } catch (e) {
        console.error('[KwabzStore] Firebase Init inside store.js Error:', e);
      }
    }

    // Now safe to yield to async cache loading
    await _loadFromDiskCache();

    // Network status handlers — Firestore SDK reconnects internally
    window.addEventListener('offline', () => {
      console.warn('[KwabzStore] Network lost.');
      if (syncStatus !== 'offline') {
        syncStatus = 'offline';
        emit('sync_status', syncStatus);
      }
    });

    window.addEventListener('online', () => {
      console.log('[KwabzStore] Network restored. Re-syncing with Firestore...');
      if (syncStatus !== 'syncing' && syncStatus !== 'online') {
        syncStatus = 'syncing';
        emit('sync_status', syncStatus);
      }
      refreshAll().catch(() => { });
    });

    try {
      const db = firebase.firestore();

      // Enable native Firebase offline persistence to dramatically reduce reads and bandwidth
      try {
        await db.enablePersistence({ synchronizeTabs: true });
        console.log('[KwabzStore] Firebase Offline Persistence successfully enabled.');
      } catch (err) {
        if (err.code === 'failed-precondition') {
          console.warn('[KwabzStore] Persistence failed: Multiple tabs open.');
        } else if (err.code === 'unimplemented') {
          console.warn('[KwabzStore] Persistence failed: Browser unsupported.');
        }
      }

      // 2. Setup public real-time listeners
      _setupProductsListener();
      _setupCategoriesListener();
      _setupSellersListener();
      _setupSettingsListener();
      _setupBlogPostsListener();
      _setupPromoCodesListener();
      _setupBroadcastsListener();
      _setupBundlesListener();

      // 3. Setup Auth listener
      setupAuthListener();

      // 4. Start watchdog to prevent permanently-stuck 'syncing' state
      _startSyncWatchdog();

      console.log('[KwabzStore] Initialized. Waiting for data...');

      await _migrateLocalStorageToFirestore();
    } catch (err) {
      console.error('[KwabzStore] Init Error:', err);
      syncStatus = 'offline';
      emit('sync_status', syncStatus, err.message);
    } finally {
      isFirestoreInitialized = true;
      isInitializing = false;
      // 6. Always signal pages to bind their listeners — even if an error occurred.
      // Use setTimeout(0) so Firestore's synchronous cache snapshots fire FIRST,
      // populating localProducts/localOrders etc., before the page renders.
      setTimeout(() => {
        emit('store_initialized', true);

        // Track page view
        const page = window.location.pathname.split('/').pop() || 'index.html';
        trackPageView(page).catch(() => { });

        // Re-emit current state so newly-registered page listeners get fresh data
        // without waiting for the next network snapshot cycle.
        emit('products_changed', localProducts);
        emit('categories_changed', localCategories);
        emit('orders_changed', localOrders);
        emit('sellers_changed', localSellers);
        emit('blog_posts_changed', localBlogPosts);
        emit('promo_codes_changed', localPromoCodes);
        emit('settings_changed', localSettings);
        emit('sync_status', syncStatus);
      }, 0);
    }

  }

  // Helper to extract safe numeric timestamp from Firestore Timestamp, Date strings, or numbers
  function _getSafeTime(val) {
    if (!val) return 0;
    if (typeof val.toDate === 'function') {
      try {
        return val.toDate().getTime();
      } catch (e) {
        return 0;
      }
    }
    if (typeof val === 'number') return val;
    if (val.seconds) return val.seconds * 1000;
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
  }

  // ─── Real-Time Listeners ───
  function _setupProductsListener() {
    const db = firebase.firestore();
    if (unsubscribers.products) unsubscribers.products();

    // OPTIMIZED: Only Admins and logged-in Sellers get real-time listeners.
    const isInternal = isAdminLoggedIn() || (typeof firebase !== 'undefined' && firebase.auth().currentUser);

    if (isInternal) {
      unsubscribers.products = db.collection('products')
        .onSnapshot(
          snapshot => {
            try {
              localProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
              localProducts.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));
              _saveToDiskCache();
              _syncCartPrices();
              emit('products_changed', localProducts);

              if (localProducts.length > 0 || !snapshot.metadata.fromCache) {
                unsubscribers.sync.products = true;
                _checkSyncFinished();
              }

              if (!snapshot.metadata.fromCache) {
                emit('firestore_read', snapshot.docs.length);
                if (syncStatus !== 'online') {
                  syncStatus = 'online';
                  emit('sync_status', syncStatus);
                }
              }
            } catch (err) {
              console.error('[KwabzStore] Products fetch processing error:', err);
            }
          },
          err => {
            unsubscribers.sync.products = false;
            _checkSyncFinished();
            _scheduleReconnect('products_listener_error');
          }
        );
      return;
    }

    // Public users: TTL-gated fetch from cache to completely avoid Firestore reads for repeat visitors.
    const cacheAge = Date.now() - parseInt(localStorage.getItem(KEYS.CACHE_TIMESTAMP) || '0', 10);
    if (cacheAge <= CACHE_TTL && localProducts.length > 0) {
      console.log('[KwabzStore] Products: fresh TTL cache — skipping network read.');
      unsubscribers.sync.products = true;
      _checkSyncFinished();
      return;
    }

    // OPTIMIZATION: Route public reads to the Render Node.js server (Redis cached)
    const apiUrl = (window.RENDER_API_BASE || '') + '/api/products';
    fetchWithTimeout(apiUrl, { timeout: 4000 })
      .then(res => {
        if (!res.ok) throw new Error('API fetch failed: ' + res.status);
        return res.json();
      })
      .then(data => {
        localProducts = Array.isArray(data) ? data : [];
        localProducts.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));
        _saveToDiskCache();
        _syncCartPrices();
        emit('products_changed', localProducts);

        console.log('[KwabzStore] Products fetched from Render API (0 Firestore reads!).');
        if (syncStatus !== 'online') { syncStatus = 'online'; emit('sync_status', syncStatus); }

        unsubscribers.sync.products = true;
        _checkSyncFinished();
      })
      .catch(err => {
        console.warn('[KwabzStore] Render API failed, falling back to Firestore for products...', err);
        // Fallback to native Firebase if Render is spinning up or offline
        db.collection('products').get()
          .then(snapshot => {
            localProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            localProducts.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));
            _saveToDiskCache();
            _syncCartPrices();
            emit('products_changed', localProducts);

            if (!snapshot.metadata.fromCache) {
              emit('firestore_read', snapshot.docs.length);
              if (syncStatus !== 'online') { syncStatus = 'online'; emit('sync_status', syncStatus); }
            }
            unsubscribers.sync.products = true;
            _checkSyncFinished();
          })
          .catch(fbErr => {
            unsubscribers.sync.products = true;
            _checkSyncFinished();
            _scheduleReconnect('products_fetch_error');
          });
      });
  }

  function _setupCategoriesListener() {
    const db = firebase.firestore();
    if (unsubscribers.categories) unsubscribers.categories();

    // ── Admin: real-time listener so edits appear instantly across tabs ──────
    if (isAdminLoggedIn()) {
      unsubscribers.categories = db.collection('categories')
        .onSnapshot(
          snapshot => {
            try {
              localCategories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
              _saveToDiskCache();
              emit('categories_changed', localCategories);
              if (localCategories.length > 0 || !snapshot.metadata.fromCache) {
                unsubscribers.sync.categories = true;
                _checkSyncFinished();
              }
              if (!snapshot.metadata.fromCache) {
                emit('firestore_read', snapshot.docs.length);
                if (syncStatus !== 'online') { syncStatus = 'online'; emit('sync_status', syncStatus); }
              }
            } catch (err) { console.error('[KwabzStore] Categories processing error:', err); }
          },
          err => {
            console.error('[KwabzStore] Categories snapshot failed:', err);
            unsubscribers.sync.categories = false;
            _checkSyncFinished();
            _scheduleReconnect('categories_listener_error');
          }
        );
      return;
    }

    // ── Public user: TTL-gated one-shot .get() ───────────────────────────────
    // If localStorage cache is still fresh, data is already in memory —
    // skip Firestore entirely. Only fetch when the TTL has expired.
    const cacheAge = Date.now() - parseInt(localStorage.getItem(KEYS.CACHE_TIMESTAMP) || '0', 10);
    if (cacheAge <= CACHE_TTL && localCategories.length > 0) {
      console.log('[KwabzStore] Categories: fresh cache — skipping network read.');
      unsubscribers.sync.categories = true;
      _checkSyncFinished();
      return;
    }

    // OPTIMIZATION: Route categories to Render API
    const catUrl = (window.RENDER_API_BASE || '') + '/api/categories';
    fetchWithTimeout(catUrl, { timeout: 4000 })
      .then(res => {
        if (!res.ok) throw new Error('API fetch failed: ' + res.status);
        return res.json();
      })
      .then(data => {
        localCategories = Array.isArray(data) ? data : [];
        _saveToDiskCache();
        emit('categories_changed', localCategories);

        console.log('[KwabzStore] Categories fetched from Render API (0 Firestore reads!).');
        if (syncStatus !== 'online') { syncStatus = 'online'; emit('sync_status', syncStatus); }
        unsubscribers.sync.categories = true;
        _checkSyncFinished();
      })
      .catch(apiErr => {
        console.warn('[KwabzStore] Render API failed for categories, falling back to Firestore...', apiErr);
        db.collection('categories').get()
          .then(snapshot => {
            localCategories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            _saveToDiskCache();
            emit('categories_changed', localCategories);
            if (!snapshot.metadata.fromCache) {
              emit('firestore_read', snapshot.docs.length);
              if (syncStatus !== 'online') { syncStatus = 'online'; emit('sync_status', syncStatus); }
            }
            unsubscribers.sync.categories = true;
            _checkSyncFinished();
          })
          .catch(err => {
            console.error('[KwabzStore] Categories fetch failed:', err);
            let errMsg = err.message || String(err);
            if (errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('resource-exhausted') || errMsg.toLowerCase().includes('limit')) {
              errMsg = 'Firebase daily read/write quota exceeded (Free Spark Tier limit reached). Please check Firebase Console.';
            }
            if (syncStatus !== 'offline') { syncStatus = 'offline'; emit('sync_status', 'offline', errMsg); }
            unsubscribers.sync.categories = true; // Don't block sync gate
            _checkSyncFinished();
            _scheduleReconnect('categories_fetch_error');
          });
      });
  }

  function _setupSellersListener() {
    if (unsubscribers.sellers) unsubscribers.sellers();

    const fetchSellers = () => {
      const apiUrl = (window.RENDER_API_BASE || 'https://nodejs-backend-1-ucbq.onrender.com') + '/api/sellers';
      fetchWithTimeout(apiUrl, { timeout: 4000 })
        .then(res => { if (!res.ok) throw new Error('API failed'); return res.json(); })
        .then(data => {
          localSellers = Array.isArray(data) ? data : [];
          _saveToDiskCache();
          emit('sellers_changed', localSellers);
          unsubscribers.sync.sellers = true;
          _checkSyncFinished();
          if (syncStatus !== 'online') { syncStatus = 'online'; emit('sync_status', syncStatus); }
        })
        .catch(err => {
          console.warn('[KwabzStore] Render API failed for sellers, falling back to Firestore...', err);
          const db = firebase.firestore();
          db.collection('sellers').get().then(snap => {
            localSellers = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            _saveToDiskCache();
            emit('sellers_changed', localSellers);
            if (!snap.metadata.fromCache) emit('firestore_read', snap.docs.length);
            unsubscribers.sync.sellers = true;
            _checkSyncFinished();
          }).catch(e => {
            unsubscribers.sync.sellers = false;
            _checkSyncFinished();
          });
        });
    };
    fetchSellers();
    const interval = setInterval(fetchSellers, 15000);
    unsubscribers.sellers = () => clearInterval(interval);
  }

  let lastLocalCartUpdate = 0;
  function _cartsMatch(cart1, cart2) {
    if (!cart1 || !cart2) return false;
    if (cart1.length !== cart2.length) return false;
    for (let i = 0; i < cart1.length; i++) {
      const item1 = cart1[i];
      const id1 = item1.cart_item_id || item1.product_id;
      const item2 = cart2.find(item => (item.cart_item_id || item.product_id) === id1);
      if (!item2) return false;
      if (item2.quantity !== item1.quantity) return false;
    }
    return true;
  }

  function _setupCartListener() {
    const db = firebase.firestore();
    if (!currentUser) return;
    if (unsubscribers.cart) unsubscribers.cart();

    unsubscribers.cart = db.collection('users').doc(currentUser.uid)
      .collection('cart').doc('items')
      .onSnapshot(
        doc => {
          try {
            const serverItems = doc.exists ? (doc.data().items || []) : [];
            const now = Date.now();

            // Stale protection: ignore snapshots that don't match our local cart
            // if we performed a write less than 2.5 seconds ago.
            if (now - lastLocalCartUpdate < 2500 && !_cartsMatch(localCart, serverItems)) {
              console.log('[KwabzStore] Stale cart update from Firestore ignored to prevent overwrite.');
              return;
            }

            localCart = serverItems;
            _safeSetItem(KEYS.CART, JSON.stringify(localCart));
            emit('cart_changed', localCart);
          } catch (err) {
            console.error('[KwabzStore] Cart listener error:', err);
          }
        },
        err => {
          console.error('[KwabzStore] Cart listener failed:', err);
        }
      );
  }

  function _setupWishlistListener() {
    const db = firebase.firestore();
    if (!currentUser) return;
    if (unsubscribers.wishlist) unsubscribers.wishlist();

    unsubscribers.wishlist = db.collection('users').doc(currentUser.uid)
      .collection('wishlist').doc('items')
      .onSnapshot(
        doc => {
          try {
            localWishlist = (doc.exists && Array.isArray(doc.data().items)) ? doc.data().items : [];
            _safeSetItem(KEYS.WISHLIST, JSON.stringify(localWishlist));
            emit('wishlist_changed', localWishlist);
          } catch (err) {
            console.error('[KwabzStore] Wishlist listener error:', err);
          }
        },
        err => {
          console.error('[KwabzStore] Wishlist listener failed:', err);
        }
      );
  }

  let hasAttemptedSettingsInit = false;
  let _lastSettingsJson = null;
  function _setupSettingsListener() {
    const db = firebase.firestore();
    if (unsubscribers.settings) unsubscribers.settings();

    // Shared onSnapshot handler logic
    const handleSettingsDoc = (doc, isAdmin) => {
      if (!doc.exists) {
        if (isAdmin && !hasAttemptedSettingsInit) {
          hasAttemptedSettingsInit = true;
          db.collection('settings').doc('global').set(localSettings)
            .catch(e => console.error('[KwabzStore] Settings init failed:', e));
        }
        return;
      }
      const incoming = doc.data();
      // Deduplicate: skip if data hasn't actually changed (prevents re-renders on no-op snapshots)
      const incomingJson = JSON.stringify(incoming);
      if (incomingJson === _lastSettingsJson) return;
      _lastSettingsJson = incomingJson;

      localSettings = { ...localSettings, ...incoming };
      _safeSetItem(KEYS.SETTINGS, JSON.stringify(_stripHeavyFields(localSettings)));
      emit('settings_changed', localSettings);
      if (!doc.metadata.fromCache) {
        if (!isAdmin) emit('firestore_read', 1);
        if (syncStatus !== 'online') { syncStatus = 'online'; emit('sync_status', syncStatus); }
      }
    };

    // ── Admin: real-time listener with error reporting ────────────────────────
    if (isAdminLoggedIn()) {
      unsubscribers.settings = db.collection('settings').doc('global')
        .onSnapshot(
          doc => {
            try { handleSettingsDoc(doc, true); }
            catch (err) { console.error('[KwabzStore] Settings listener error:', err); }
          },
          err => {
            console.error('[KwabzStore] Settings snapshot failed:', err);
            let errMsg = err.message || String(err);
            if (errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('resource-exhausted') || errMsg.toLowerCase().includes('limit')) {
              errMsg = 'Firebase daily read/write quota exceeded (Free Spark Tier limit reached). Please check Firebase Console.';
            }
            if (syncStatus !== 'offline') { syncStatus = 'offline'; emit('sync_status', 'offline', errMsg); }
            _scheduleReconnect('settings_listener_error');
          }
        );
      return;
    }

    // Public users: fetch from Render API to avoid all Firestore reads
    const apiUrl = (window.RENDER_API_BASE || '') + '/api/settings';
    fetchWithTimeout(apiUrl, { timeout: 4000 })
      .then(res => { if (!res.ok) throw new Error('API failed'); return res.json(); })
      .then(data => {
        if (data && typeof data === 'object') {
          localSettings = { ...localSettings, ...data };
          _safeSetItem(KEYS.SETTINGS, JSON.stringify(_stripHeavyFields(localSettings)));
          emit('settings_changed', localSettings);
          console.log('[KwabzStore] Settings fetched from Render API (0 Firestore reads!).');
        }
      })
      .catch(err => {
        console.warn('[KwabzStore] Render API failed for settings, falling back to Firestore onSnapshot...', err);
        unsubscribers.settings = db.collection('settings').doc('global')
          .onSnapshot(
            { includeMetadataChanges: false },
            doc => {
              try { handleSettingsDoc(doc, false); }
              catch (e) { console.warn('[KwabzStore] Settings fallback listener error:', e); }
            },
            err => {
              console.warn('[KwabzStore] Settings fallback listener failed:', err);
            }
          );
      });
  }

  function _safeParse(key, fallback) {
    try {
      const item = localStorage.getItem(key);
      if (!item) return fallback;
      const parsed = JSON.parse(item);
      return parsed !== null ? parsed : fallback;
    } catch (e) {
      console.warn(`[KwabzStore] Failed to parse key "${key}" from localStorage:`, e);
      return fallback;
    }
  }

  async function _loadFromDiskCache() {
    try {
      // ─── Stale-While-Revalidate ─────────────────────────────────────────────
      // ALWAYS serve every cache key to the UI instantly — even if the data is
      // older than CACHE_TTL. A slightly-stale category list is far better UX
      // than a blank/empty state while waiting for Firestore to respond.

      // Load small/user data from localStorage for instant synchronous-like feel
      localSettings = _safeParse(KEYS.SETTINGS, localSettings);
      userOrders = _safeParse(KEYS.USER_ORDERS, []);
      localCart = _safeParse(KEYS.CART, []);
      localWishlist = _safeParse(KEYS.WISHLIST, []);
      localSellers = _safeParse('kwabz_sellers_cache', []);

      // Load heavy data from IndexedDB
      const [prod, cat, ord, sel, blog, promo, bund] = await Promise.all([
        kwabz_idb.get(KEYS.CACHE_PRODUCTS),
        kwabz_idb.get(KEYS.CACHE_CATEGORIES),
        kwabz_idb.get(KEYS.CACHE_ORDERS),
        kwabz_idb.get(KEYS.CACHE_SELLERS),
        kwabz_idb.get(KEYS.CACHE_BLOG_POSTS),
        kwabz_idb.get(KEYS.CACHE_PROMO_CODES),
        kwabz_idb.get(KEYS.CACHE_BUNDLES)
      ]);

      if (prod) localProducts = prod;
      if (cat) localCategories = cat;
      if (ord) localOrders = ord;
      if (sel) {
        localSellers = sel;
        _safeSetItem('kwabz_sellers_cache', JSON.stringify(localSellers));
      }
      if (blog) localBlogPosts = blog;
      if (promo) localPromoCodes = promo;
      if (bund) {
        localBundles = bund;
        _safeSetItem('kwabz_bundles_cache', JSON.stringify(localBundles));
      }

      // Emit all available data immediately for zero-latency UI render
      if (localProducts.length > 0) emit('products_changed', localProducts);
      if (localCategories.length > 0) emit('categories_changed', localCategories);
      if (localSellers.length > 0) emit('sellers_changed', localSellers);
      if (localOrders.length > 0) emit('orders_changed', localOrders);
      if (localBlogPosts.length > 0) emit('blog_posts_changed', localBlogPosts);
      if (localPromoCodes.length > 0) emit('promo_codes_changed', localPromoCodes);
      if (localBundles.length > 0) emit('bundles_changed', localBundles);
      emit('settings_changed', localSettings);
      emit('cart_changed', localCart);
      emit('wishlist_changed', localWishlist);

      const cacheAge = Date.now() - parseInt(localStorage.getItem(KEYS.CACHE_TIMESTAMP) || '0', 10);
      if (cacheAge > CACHE_TTL) {
        console.log(`[KwabzStore] Cache is stale (${Math.round(cacheAge / 60000)} min old) — rendered from localStorage, background network refresh will follow.`);
      }

    } catch (e) {
      console.error('[KwabzStore] Cache Load Error:', e);
    }
  }

  async function refreshAll() {
    if (!firebase.firestore) return;
    const now = Date.now();
    if (now - lastRefreshTime < 2000) {
      console.log('[KwabzStore] Refresh throttled.');
      return;
    }
    lastRefreshTime = now;

    console.log('[KwabzStore] Forcing full sync...');
    if (syncStatus !== 'syncing') {
      syncStatus = 'syncing';
      emit('sync_status', syncStatus);
    }

    // Reset sync flags for fresh confirmation
    unsubscribers.sync.products = false;
    unsubscribers.sync.categories = false;
    unsubscribers.sync.sellers = false;

    _setupProductsListener();
    _setupCategoriesListener();
    _setupSellersListener();
    _setupSettingsListener();
    _setupPromoCodesListener();
    _setupBundlesListener();
    if (isAdminLoggedIn()) {
      _setupOrdersListener();
    }
  }

  let lastKnownOrdersCount = 0;
  function _setupOrdersListener() {
    if (unsubscribers.orders) unsubscribers.orders();
    let isInitial = true;
    let lastKnownLatestOrderId = null;

    const fetchOrders = () => {
      const apiUrl = (window.RENDER_API_BASE || 'https://nodejs-backend-1-ucbq.onrender.com') + '/api/orders?limit=200';
      fetchWithTimeout(apiUrl, { timeout: 4000 })
        .then(res => { if (!res.ok) throw new Error('API failed'); return res.json(); })
        .then(data => {
          localOrders = Array.isArray(data) ? data : [];
          localOrders.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));

          if (!isInitial && lastKnownLatestOrderId && localOrders.length > 0 && localOrders[0].id !== lastKnownLatestOrderId) {
            const newOrder = localOrders[0];
            if (Date.now() - _getSafeTime(newOrder.created_at) < 300000) {
              _showDesktopNotification('New Order Received', `Order #${newOrder.order_number || newOrder.id.substring(0, 8)}`);
              _playNotificationSound();
            }
          }
          isInitial = false;
          if (localOrders.length > 0) lastKnownLatestOrderId = localOrders[0].id;
          lastKnownOrdersCount = localOrders.length;

          _saveToDiskCache();
          emit('orders_changed', localOrders);
        })
        .catch(err => {
          console.warn('[KwabzStore] Render API orders failed, falling back to Firestore...', err);
          const db = firebase.firestore();
          db.collection('orders').orderBy('created_at', 'desc').limit(200).get()
            .then(snap => {
              localOrders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
              localOrders.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));
              
              if (!isInitial && lastKnownLatestOrderId && localOrders.length > 0 && localOrders[0].id !== lastKnownLatestOrderId) {
                const newOrder = localOrders[0];
                if (Date.now() - _getSafeTime(newOrder.created_at) < 300000) {
                  _showDesktopNotification('New Order Received', `Order #${newOrder.order_number || newOrder.id.substring(0, 8)}`);
                  _playNotificationSound();
                }
              }
              isInitial = false;
              if (localOrders.length > 0) lastKnownLatestOrderId = localOrders[0].id;
              lastKnownOrdersCount = localOrders.length;

              _saveToDiskCache();
              emit('orders_changed', localOrders);
              if (!snap.metadata.fromCache) emit('firestore_read', snap.docs.length);
            }).catch(e => console.error('Firestore orders fallback failed', e));
        });
    };

    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    unsubscribers.orders = () => clearInterval(interval);
  }

  // ─── User-Specific Real-Time Orders Listener ───────────────
  // Listens to Firestore for this user's orders and syncs status
  // updates (made by admin) into localStorage in real-time.
  function _setupUserOrdersListener(uid) {
    if (!uid) return;
    const db = firebase.firestore();
    if (unsubscribers.userOrders) unsubscribers.userOrders();

    unsubscribers.userOrders = db.collection('orders')
      .where('customer_uid', '==', uid)
      .onSnapshot(
        snapshot => {
          try {
            let freshOrders = snapshot.docs
              .map(doc => ({ id: doc.id, ...doc.data() }))
              .filter(o => !o.hidden_by_customer);

            // Client-side in-memory sort by created_at desc
            freshOrders.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));

            // Dynamically track and push status change updates to user
            if (previousUserOrderStatuses) {
              freshOrders.forEach(newOrder => {
                const oldStatus = previousUserOrderStatuses[newOrder.id];
                if (oldStatus && oldStatus !== newOrder.status) {
                  const orderNum = newOrder.order_label || newOrder.order_number || 'order';
                  const title = `📦 Order Status Updated!`;
                  const body = `Your order ${orderNum} is now ${newOrder.status.toUpperCase()}`;

                  console.log(`[PWA] Order status updated: ${orderNum} is now ${newOrder.status}`);

                  // 1. Play Native chiptune chime sound
                  if (typeof KwabzUtils !== 'undefined' && typeof KwabzUtils.playNotificationSound === 'function') {
                    KwabzUtils.playNotificationSound();
                  }

                  // 2. Trigger Custom interactive PWA toast banner
                  if (typeof KwabzUtils !== 'undefined' && typeof KwabzUtils.toast === 'function') {
                    KwabzUtils.toast(body, 'info');
                  }

                  // 3. Mount Native OS Push Notification (if allowed)
                  if (typeof KwabzUtils !== 'undefined' && typeof KwabzUtils.showNotification === 'function') {
                    KwabzUtils.showNotification(title, body);
                  }
                }
              });
            }

            // Track if driver starts sharing live location
            if (previousUserOrderLocations) {
              freshOrders.forEach(newOrder => {
                const oldHasLoc = previousUserOrderLocations[newOrder.id] || false;
                const newHasLoc = !!(newOrder.driver_location && typeof newOrder.driver_location.lat === 'number' && typeof newOrder.driver_location.lng === 'number');

                if (newHasLoc && !oldHasLoc) {
                  const orderNum = newOrder.order_label || newOrder.id.substring(0, 8);
                  const title = `🏍️ Rider is on the way!`;
                  const body = `Live tracking is now active for order ${orderNum}`;

                  console.log(`[PWA] Live GPS sharing detected for order ${newOrder.id}`);

                  if (typeof KwabzUtils !== 'undefined' && typeof KwabzUtils.playNotificationSound === 'function') {
                    KwabzUtils.playNotificationSound();
                  }

                  if (typeof KwabzUtils !== 'undefined' && typeof KwabzUtils.toast === 'function') {
                    KwabzUtils.toast(body, 'success', 6000);
                  }

                  if (typeof KwabzUtils !== 'undefined' && typeof KwabzUtils.showNotification === 'function') {
                    KwabzUtils.showNotification(title, body);
                  }
                }
              });
            }

            // Map and cache current statuses and locations to prevent redundant notifications
            const currentStatuses = {};
            const currentLocations = {};
            freshOrders.forEach(o => {
              currentStatuses[o.id] = o.status || 'pending';
              currentLocations[o.id] = !!(o.driver_location && typeof o.driver_location.lat === 'number' && typeof o.driver_location.lng === 'number');
            });
            previousUserOrderStatuses = currentStatuses;
            previousUserOrderLocations = currentLocations;

            userOrders = freshOrders;
            // Persist to localStorage so status is available offline
            _saveUserOrdersToLocal();
            emit('user_orders_changed', userOrders);
            console.log('[KwabzStore] User orders synced:', userOrders.length);
          } catch (err) {
            console.error('[KwabzStore] User orders listener error:', err);
          }
        },
        err => {
          // Not fatal — fall back to local copy
          console.warn('[KwabzStore] User orders listener unavailable:', err.message);
          userOrders = _loadUserOrdersFromLocal();
          emit('user_orders_changed', userOrders);
        }
      );
  }

  function _saveUserOrdersToLocal() {
    try {
      _safeSetItem(KEYS.USER_ORDERS, JSON.stringify(userOrders));
    } catch (e) {
      console.warn('[KwabzStore] Could not save user orders locally:', e);
    }
  }

  function _loadUserOrdersFromLocal() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.USER_ORDERS) || '[]');
    } catch (e) {
      return [];
    }
  }

  function getUserOrders() {
    // Return from memory if available, else from localStorage
    if (userOrders.length > 0) return userOrders;
    return _loadUserOrdersFromLocal();
  }

  function _checkSyncFinished() {
    // Only require products + categories to declare 'online'.
    // Sellers is optional — if that collection doesn't exist, we still work.
    const isReady = unsubscribers.sync.products && unsubscribers.sync.categories;

    if (isReady) {
      reconnectDelay = 3000; // Reset reconnection delay on successful sync!
      if (syncStatus !== 'online') {
        syncStatus = 'online';
        emit('sync_status', syncStatus);
        console.log('[KwabzStore] System functional (Online)');
        _saveToDiskCache();
      }
    }
    // NOTE: Never set 'offline' here — that is handled by Firestore error callbacks
    // and the window 'offline' event listener. Doing so here causes a flip-flop loop.
  }

  // ── Self-healing dynamic recovery engine with exponential backoff ──
  let reconnectTimeout = null;
  let reconnectDelay = 3000;

  function _scheduleReconnect(source) {
    if (reconnectTimeout) return;

    // Scale up reconnect delay if triggered by connection failures
    if (source && source.includes('error')) {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000); // Exponential backoff
    }

    console.log(`[KwabzStore] Scheduling sync recovery in ${reconnectDelay / 1000}s (triggered by ${source})...`);
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      if (navigator.onLine) {
        console.log('[KwabzStore] Retrying Firestore connection...');
        refreshAll()
          .then(() => {
            // refreshAll always resolves, so we do NOT reset delay here anymore.
            // Delay is only reset to 3000 on verified server-side live data updates.
          })
          .catch((err) => {
            console.warn('[KwabzStore] Sync retry failed, backing off:', err.message);
            reconnectDelay = Math.min(reconnectDelay * 2, 30000); // Exponential backoff
            _scheduleReconnect('retry_failed');
          });
      } else {
        console.warn('[KwabzStore] Postponing recovery retry: browser reports offline.');
        _scheduleReconnect('offline_retry_deferred');
      }
    }, reconnectDelay);
  }

  // ── Safety timeout: if sync hasn't resolved in 10s but we have data, force 'online' ──
  // This handles edge cases where a listener fires but _checkSyncFinished wasn't triggered
  // (e.g. a category collection that's empty still fires, but a race can prevent the flag from being set)
  function _startSyncWatchdog() {
    setTimeout(() => {
      if (syncStatus === 'syncing') {
        // Force sync flags for any collection that already has data or has at least tried
        if (localProducts.length > 0) unsubscribers.sync.products = true;
        if (localCategories.length >= 0) unsubscribers.sync.categories = true; // 0 is valid
        _checkSyncFinished();
        if (syncStatus === 'syncing') {
          // Still syncing? Network likely slow. Mark as online anyway to unblock UI.
          console.warn('[KwabzStore] Sync watchdog: forcing online after timeout.');
          syncStatus = 'online';
          emit('sync_status', syncStatus);
        }
      }
    }, 4000);
  }

  function getSyncStatus() { return syncStatus; }
  function isAuthReady() { return isAuthResolved; }

  // Helper to handle both string dates and Firestore Timestamps
  function _convertToDate(val) {
    if (!val) return new Date(0);
    if (val.toDate && typeof val.toDate === 'function') return val.toDate();
    if (val.seconds) return new Date(val.seconds * 1000);
    return new Date(val);
  }

  function _isMainStoreItem(p) {
    if (!p) return false;
    const sid = p.seller_id;
    return !sid || String(sid).trim().toLowerCase() === 'main';
  }

  async function _migrateLocalStorageToFirestore() {
    if (localStorage.getItem(KEYS.LOCAL_DATA_MIGRATED)) return;
    const db = firebase.firestore();
    const oldProducts = JSON.parse(localStorage.getItem('kwabz_products') || '[]');
    const oldCategories = JSON.parse(localStorage.getItem('kwabz_categories') || '[]');

    if ((oldProducts.length > 0 || oldCategories.length > 0) && isAdminLoggedIn()) {
      try {
        for (const cat of oldCategories) await db.collection('categories').doc(cat.id).set(cat);
        for (const prod of oldProducts) await db.collection('products').doc(prod.id).set(prod);
        localStorage.setItem(KEYS.LOCAL_DATA_MIGRATED, 'true');
        await refreshAll();
      } catch (err) {
        console.error('[KwabzStore] Migration error:', err);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC METHODS
  // ═══════════════════════════════════════════════════════════════

  function getProducts() {
    return localProducts.filter(_isMainStoreItem);
  }

  function getAllProducts() { return localProducts; }
  function getCategories() { return localCategories; }
  function getSellers() {
    return [...localSellers].sort((a, b) => {
      const orderA = typeof a.displayOrder === 'number' ? a.displayOrder : 9999;
      const orderB = typeof b.displayOrder === 'number' ? b.displayOrder : 9999;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return (a.name || '').localeCompare(b.name || '');
    });
  }
  function getOrders() { return localOrders; }

  function getProductById(id) { return localProducts.find(p => p.id === id) || null; }
  function getCategoryById(id) { return localCategories.find(c => c.id === id) || null; }
  function getSellerById(id) { return localSellers.find(s => s.id === id) || null; }

  function getProductsByCategory(categoryId, sellerId = 'main') {
    let baseProducts = (sellerId === 'all') ? localProducts :
      (sellerId === 'main' ? getProducts() : getProductsBySeller(sellerId));

    if (!categoryId || categoryId === 'all') return baseProducts;
    return baseProducts.filter(p => p.category_id === categoryId);
  }

  function getAllProductsByCategory(categoryId) {
    if (!categoryId || categoryId === 'all') return localProducts;
    return localProducts.filter(p => p.category_id === categoryId);
  }

  function getProductsBySeller(sellerId) {
    // Safety: if no sellerId given, fall back to main store items only
    if (!sellerId || sellerId === 'main') return getProducts();
    // Strict: only return products explicitly tagged to this seller.
    // Products with no seller_id, seller_id=null, or seller_id='main' are NEVER included.
    return localProducts.filter(p => {
      const sid = p.seller_id;
      if (!sid || String(sid).trim().toLowerCase() === 'main') return false; // Exclude main-store items
      return sid === sellerId;
    });
  }

  async function addProduct(product) {
    if (!product.name || !product.price) {
      throw new Error('Incomplete product data. Name and Price are required.');
    }

    // Ensure numeric values
    product.price = parseFloat(product.price);
    product.discount = parseFloat(product.discount || 0);
    product.stock = parseInt(product.stock || 0);

    try {
      if (!isAdminLoggedIn()) throw new Error("Admin access required");

      const db = firebase.firestore();
      const docRef = db.collection('products').doc(); // Instantly generate offline ID

      const newDoc = {
        ...product,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      };

      const productWithId = { id: docRef.id, ...newDoc };

      // 1. Optimistic Local Update
      localProducts.unshift(productWithId);
      _saveToDiskCache();
      emit('products_changed', localProducts);

      // 2. Fire and Forget to Server
      docRef.set(newDoc).then(() => {
        _broadcastNewProduct(newDoc, docRef.id);
      }).catch(err => console.error('[KwabzStore] Background add product failed:', err));

      return productWithId;
    } catch (err) {
      console.error('[KwabzStore] addProduct error:', err);
      throw err;
    }
  }

  async function addOrder(orderData) {
    // Fortification: Validate order structure
    if (!orderData.items || orderData.items.length === 0) {
      throw new Error('Cannot process an empty order.');
    }
    if (!orderData.customer?.phone) {
      throw new Error('Customer contact information is required for checkout.');
    }

    try {
      const seqId = 1000 + localOrders.length + 1;
      const generatedLabel = _generateOrderLabel(seqId);
      const refId = Math.floor(100000 + Math.random() * 900000);

      const docRef = await firebase.firestore().collection('orders').add({
        ...orderData,
        order_number: '#' + seqId,
        order_label: generatedLabel,
        ref_id: refId,
        status: 'pending',
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Local persistence for receipt generation
      const newOrder = { id: docRef.id, order_label: generatedLabel, order_number: '#' + seqId, ref_id: refId, ...orderData, status: 'pending', created_at: new Date().toISOString() };
      userOrders.unshift(newOrder);
      _safeSetItem(KEYS.USER_ORDERS, JSON.stringify(userOrders.slice(0, 20)));

      return { id: docRef.id, ref_id: refId, order_label: generatedLabel };
    } catch (err) {
      console.error('[KwabzStore] addOrder error:', err);
      throw err;
    }
  }

  async function updateProduct(id, updates) {
    try {
      if (!isAdminLoggedIn()) throw new Error("Admin access required");

      // 1. Optimistic Local Update
      const idx = localProducts.findIndex(p => p.id === id);
      if (idx !== -1) {
        localProducts[idx] = { ...localProducts[idx], ...updates };
        _saveToDiskCache();
        emit('products_changed', localProducts);
      }

      // 2. Await Server Synchronization
      await firebase.firestore().collection('products').doc(id).set(updates, { merge: true });

      return { id, ...updates };
    } catch (err) {
      console.error('[KwabzStore] Update product error:', err);
      throw err;
    }
  }

  async function deleteProduct(id) {
    try {
      if (!isAdminLoggedIn()) throw new Error("Admin access required");

      // 1. Optimistic Local Update
      localProducts = localProducts.filter(p => p.id !== id);
      _saveToDiskCache();
      emit('products_changed', localProducts);

      // 2. Fire and Forget to Server
      firebase.firestore().collection('products').doc(id).delete()
        .catch(err => console.error('[KwabzStore] Background delete product failed:', err));

      return true;
    } catch (err) {
      console.error('[KwabzStore] Delete product error:', err);
      throw err;
    }
  }

  async function toggleProductStock(id) {
    try {
      const p = getProductById(id);
      if (!p) return null;
      await updateProduct(id, { in_stock: !p.in_stock });
      return { ...p, in_stock: !p.in_stock };
    } catch (err) {
      console.error('[KwabzStore] Toggle stock error:', err);
      throw err;
    }
  }

  async function addCategory(data) {
    try {
      const newDoc = { ...data, created_at: new Date().toISOString() };
      const docRef = await firebase.firestore().collection('categories').add(newDoc);
      const categoryWithId = { id: docRef.id, ...newDoc };
      localCategories.push(categoryWithId);
      _saveToDiskCache();
      emit('categories_changed', localCategories);
      return categoryWithId;
    } catch (err) {
      console.error('[KwabzStore] Add category error:', err);
      throw err;
    }
  }
  async function updateCategory(id, updates) {
    try {
      await firebase.firestore().collection('categories').doc(id).update(updates);
      const idx = localCategories.findIndex(c => c.id === id);
      if (idx !== -1) {
        localCategories[idx] = { ...localCategories[idx], ...updates };
        _saveToDiskCache();
        emit('categories_changed', localCategories);
      }
      return true;
    } catch (err) {
      console.error('[KwabzStore] Update category error:', err);
      throw err;
    }
  }

  async function deleteCategory(id) {
    try {
      await firebase.firestore().collection('categories').doc(id).delete();
      localCategories = localCategories.filter(c => c.id !== id);
      _saveToDiskCache();
      emit('categories_changed', localCategories);
      return true;
    } catch (err) {
      console.error('[KwabzStore] Delete category error:', err);
      throw err;
    }
  }

  // ─── Blog Management ───
  function getBlogPosts() {
    return localBlogPosts;
  }

  function _setupBlogPostsListener() {
    const db = firebase.firestore();
    if (unsubscribers.blogPosts) unsubscribers.blogPosts();

    if (isAdminLoggedIn()) {
      unsubscribers.blogPosts = db.collection('blog_posts')
        .onSnapshot(
          snapshot => {
            try {
              localBlogPosts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
              localBlogPosts.sort((a, b) => _getSafeTime(b.created_at || b.date) - _getSafeTime(a.created_at || a.date));
              _saveToDiskCache();
              emit('blog_posts_changed', localBlogPosts);
            } catch (err) {
              console.error('[KwabzStore] Blog posts processing error:', err);
            }
          },
          err => {
            console.error('[KwabzStore] Blog posts snapshot failed:', err);
          }
        );
      return;
    }

    // Public users: TTL-gated fetch from cache or API
    const cacheAge = Date.now() - parseInt(localStorage.getItem(KEYS.CACHE_TIMESTAMP) || '0', 10);
    if (cacheAge <= CACHE_TTL && localBlogPosts.length > 0) {
      console.log('[KwabzStore] Blog posts: fresh cache — skipping network read.');
      return;
    }

    const apiUrl = (window.RENDER_API_BASE || '') + '/api/blog-posts';
    fetchWithTimeout(apiUrl, { timeout: 4000 })
      .then(res => { if (!res.ok) throw new Error('API failed'); return res.json(); })
      .then(data => {
        localBlogPosts = Array.isArray(data) ? data : [];
        localBlogPosts.sort((a, b) => _getSafeTime(b.created_at || b.date) - _getSafeTime(a.created_at || a.date));
        _saveToDiskCache();
        emit('blog_posts_changed', localBlogPosts);
        console.log('[KwabzStore] Blog posts fetched from Render API (0 Firestore reads!).');
      })
      .catch(err => {
        console.warn('[KwabzStore] Render API failed for blog posts, falling back to Firestore...', err);
        db.collection('blog_posts').get()
          .then(snapshot => {
            localBlogPosts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            localBlogPosts.sort((a, b) => _getSafeTime(b.created_at || b.date) - _getSafeTime(a.created_at || a.date));
            _saveToDiskCache();
            emit('blog_posts_changed', localBlogPosts);
          })
          .catch(e => console.error('[KwabzStore] Blog fallback get failed:', e));
      });
  }

  async function addBlogPost(data) {
    try {
      const newDoc = {
        ...data,
        created_at: new Date().toISOString(),
        date: data.date || new Date().toISOString().split('T')[0]
      };
      const docRef = await firebase.firestore().collection('blog_posts').add(newDoc);
      const blogWithId = { id: docRef.id, ...newDoc };
      localBlogPosts.push(blogWithId);
      localBlogPosts.sort((a, b) => _getSafeTime(b.created_at || b.date) - _getSafeTime(a.created_at || a.date));
      _saveToDiskCache();
      emit('blog_posts_changed', localBlogPosts);
      return blogWithId;
    } catch (err) {
      console.error('[KwabzStore] Add blog post error:', err);
      throw err;
    }
  }

  async function updateBlogPost(id, updates) {
    try {
      await firebase.firestore().collection('blog_posts').doc(id).update(updates);
      const idx = localBlogPosts.findIndex(b => b.id === id);
      if (idx !== -1) {
        localBlogPosts[idx] = { ...localBlogPosts[idx], ...updates };
        localBlogPosts.sort((a, b) => _getSafeTime(b.created_at || b.date) - _getSafeTime(a.created_at || a.date));
        _saveToDiskCache();
        emit('blog_posts_changed', localBlogPosts);
      }
      return true;
    } catch (err) {
      console.error('[KwabzStore] Update blog post error:', err);
      throw err;
    }
  }

  async function deleteBlogPost(id) {
    try {
      await firebase.firestore().collection('blog_posts').doc(id).delete();
      localBlogPosts = localBlogPosts.filter(b => b.id !== id);
      _saveToDiskCache();
      emit('blog_posts_changed', localBlogPosts);
      return true;
    } catch (err) {
      console.error('[KwabzStore] Delete blog post error:', err);
      throw err;
    }
  }

  // Fallback / Initial Blog Dataset to use when Firestore documents need to be created on interaction
  const defaultBlogPosts = [
    {
      id: "campus-lifestyle-balancing",
      title: "Navigating Campus Life: Balancing Studies, Socializing, and Self-Care",
      category: "lifestyle",
      categoryLabel: "Student Lifestyle",
      date: "June 12, 2026",
      readTime: "5 min read",
      author: "Kofi Mensah",
      excerpt: "University life is an exciting journey, but finding the equilibrium between assignments, social life, and mental well-being can be tricky. Here's a practical guide to mastering the balance.",
      image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&q=80&w=800",
      content: `<p>Entering university is one of the most transformative phases of your life. It brings unprecedented freedom, new friendships, and academic challenges that shape your future. However, this newfound independence can sometimes feel overwhelming. Balancing a heavy course load, social commitments, and personal health is a skill that takes time to master.</p><h3>1. Establish a High-Yield Routine</h3><p>Routine is the scaffolding of productivity and peace of mind. Without a structured schedule, days can slip away, leaving you scrambling to meet deadlines. Try mapping out your week, allocating dedicated blocks for studying, attending lectures, socializing, and recharging. Remember, a routine shouldn't be a prison; it should be a tool that grants you more free time by eliminating procrastination.</p><blockquote>"The secret of your future is hidden in your daily routine." — Mike Murdock</blockquote><h3>2. The Art of Prioritization</h3><p>Not all tasks are created equal. Learn to distinguish between urgent tasks and important tasks. Academic deadlines are non-negotiable, but your physical and mental health are equally critical. Using simple tools like the Eisenhower Matrix (categorizing tasks into urgent/important, not urgent/important, etc.) can help you figure out what to tackle first and what can wait.</p><h3>3. Incorporate Self-Care and Sleep</h3><p>Pulling all-nighters might seem like a student rite of passage, but sleep deprivation severely impairs cognitive function, memory consolidation, and mood regulation. Aim for 7-8 hours of sleep. Additionally, set aside time for self-care activities: whether that's working out at the gym, walking around campus, reading a book for pleasure, or meditating. Your brain needs downtime to process information and maintain resilience.</p>`
    },
    {
      id: "mastering-semester-study",
      title: "Mastering the Semester: High-Yield Study Techniques That Actually Work",
      category: "education",
      categoryLabel: "Education",
      date: "June 10, 2026",
      readTime: "6 min read",
      author: "Dr. Elizabeth Hanson",
      excerpt: "Ditch the passive reading and highlighting. Discover cognitive science-backed study methods like active recall and spaced repetition that will transform your academic results.",
      image: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&q=80&w=800",
      content: `<p>For decades, students have relied on reading textbooks repeatedly, underlining pages with colorful highlighters, and cramming the night before exams. While these methods feel productive, cognitive science shows they are highly inefficient. To excel academically without burning out, you must study smarter, not harder.</p><h3>1. Active Recall: Test Yourself</h3><p>Active recall involves actively retrieving information from your memory rather than passively looking at it. Instead of reading a chapter again, close the book and write down everything you remember. Alternatively, create flashcards or answer practice questions. By forcing your brain to retrieve the information, you strengthen neural pathways, ensuring long-term retention.</p><blockquote>"Do not just read. Ask yourself questions, test your memory, and explain concepts in your own words."</blockquote><h3>2. Spaced Repetition: Beat the Forgetting Curve</h3><p>The "Forgetting Curve" shows that we forget newly acquired information rapidly if we don't review it. Spaced repetition solves this by spacing out reviews over increasing intervals (e.g., reviewing after 1 day, then 3 days, then a week, then a month). Apps like Anki or simple flashcard boxes make implementing this technique effortless.</p><h3>3. The Pomodoro Technique for Focus</h3><p>Struggling with attention span? The Pomodoro Technique breaks your study time into bite-sized segments: 25 minutes of intense, focused studying, followed by a 5-minute break. After four "pomodoros," take a longer 15-30 minute break. This keeps your brain fresh and prevents the fatigue that leads to distracted scrolling.</p>`
    },
    {
      id: "student-budgeting-survive",
      title: "Student Budgeting 101: How to Save, Spend, and Survive in 2026",
      category: "finance",
      categoryLabel: "Finance",
      date: "June 08, 2026",
      readTime: "4 min read",
      author: "Emmanuel Tetteh",
      excerpt: "Managing your money as a student doesn't mean eating instant noodles every night. Learn how to track expenses, save money, and find student discounts.",
      image: "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&q=80&w=800",
      content: `<p>Finances are one of the leading sources of stress for university students. Between tuition, books, accommodation, food, and social activities, money can disappear fast. However, with basic financial literacy and smart habits, you can build a stable budget that allows you to enjoy campus life without constant stress.</p><h3>1. Understand Your Cashflow</h3><p>Before you can save, you need to know exactly how much money is coming in (allowances, side jobs, scholarships) and going out (rent, groceries, entertainment). Use a simple spreadsheet or budgeting apps to categorize your spending. You'll be surprised to see how much those small daily coffee purchases add up over a month.</p><blockquote>"A budget tells your money where to go instead of wondering where it went." — Dave Ramsey</blockquote><h3>2. Capitalize on Student Discounts</h3><p>Your student ID card is a powerful savings tool. Never pay full price without checking if a student discount is available. From software and streaming services to local eateries and transport, discounts are everywhere. Platforms like <strong>Kwabz Store</strong> are designed specifically to bring you high-quality gear at student-friendly prices.</p><h3>3. Cook in Batches and Shop Smart</h3><p>Eating out is one of the biggest budget killers. Instead, try meal prepping. Cooking large portions of versatile meals (like stews, rice dishes, or pasta) and freezing them saves both money and time during busy study weeks. When grocery shopping, stick to a list, buy store brands, and shop in bulk when possible.</p>`
    },
    {
      id: "essential-tech-gear-backpack",
      title: "Essential Tech & Gear Every Modern Student Needs in Their Backpack",
      category: "lifestyle",
      categoryLabel: "Student Lifestyle",
      date: "June 05, 2026",
      readTime: "5 min read",
      author: "Kofi Mensah",
      excerpt: "From noise-canceling headphones to portable power banks, here is the curated gear list to elevate your productivity and campus experience.",
      image: "https://images.unsplash.com/photo-1496181130204-755241524eab?auto=format&fit=crop&q=80&w=800",
      content: `<p>The gear you carry defines your student experience. When you're running between lectures, library study sessions, and group project meetings, you need a backpack that is organized and packed with reliable tools that keep you productive and connected.</p><h3>1. Noise-Canceling Headphones</h3><p>Campuses are noisy places. Whether you are studying in a bustling cafeteria, a coffee shop, or a dormitory common room, noise-canceling headphones are essential. They help you enter "deep focus" mode by blocking distractions and creating a calm auditory workspace.</p><h3>2. High-Capacity Power Bank</h3><p>There is nothing worse than your phone or tablet dying when you need to access your lecture notes or check public transit routes. A reliable, fast-charging power bank (at least 10,000mAh) ensures your devices remain powered throughout the longest school days.</p><blockquote>"The right tools eliminate friction, allowing you to focus 100% of your energy on learning and creating."</blockquote><h3>3. Cloud Storage and Note-taking Apps</h3><p>Don't risk losing your semester's work to a computer crash. Back up everything to cloud services like Google Drive, OneDrive, or Dropbox. Pair this with modern note-taking software like Notion or Obsidian to organize your syllabus, lecture notes, and study guides in one searchable location.</p>`
    },
    {
      id: "destressing-mental-wellness-finals",
      title: "De-stressing Before Finals: Mental Wellness Tips for Exam Season",
      category: "education",
      categoryLabel: "Education",
      date: "June 03, 2026",
      readTime: "4 min read",
      author: "Dr. Elizabeth Hanson",
      excerpt: "Exam stress is real, but it shouldn't consume you. Explore stress management techniques to stay calm and perform at your best during finals week.",
      image: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&q=80&w=800",
      content: `<p>As finals approach, campus libraries fill up and stress levels skyrocket. While a small amount of stress can motivate you to study, excessive stress harms your cognitive abilities and mental health. Balancing intensive study sessions with wellness checks is vital for exam success.</p><h3>1. Practice Mindfulness and Deep Breathing</h3><p>When you start to feel overwhelmed, your body enters a fight-or-flight state. Take five minutes to sit quietly, close your eyes, and focus on slow, deep breaths. This simple exercise triggers your parasympathetic nervous system, lowering your heart rate and bringing your mind back to a focused state.</p><blockquote>"Quiet the mind, and the soul will speak." — Ma Jaya Sati Bhagavati</blockquote><h3>2. Take Strategic Breaks</h3><p>Studying for six hours straight yields diminishing returns. Instead, implement structured breaks. For every hour of studying, take 10 minutes to walk around, stretch, drink water, or step outside. Fresh air and movement stimulate blood circulation, which helps keep your brain alert.</p><h3>3. Talk It Out</h3><p>Don't bottle up your anxiety. Share your thoughts with friends, family members, or campus counselors. Often, simply vocalizing your stress makes it feel manageable. Remember, you are not alone in this journey—your peers are facing similar challenges.</p>`
    },
    {
      id: "side-hustles-campus-income",
      title: "Side Hustles for Campus: Earn Money Without Ruining Your GPA",
      category: "finance",
      categoryLabel: "Finance",
      date: "May 28, 2026",
      readTime: "5 min read",
      author: "Emmanuel Tetteh",
      excerpt: "Want to boost your spending money without sacrificing study time? Check out these flexible, high-paying side hustles tailored for busy college students.",
      image: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&q=80&w=800",
      content: `<p>Earning an income while studying is a great way to reduce financial pressure and build valuable work experience. The challenge, however, is finding a job that fits around your changing class schedule and exam periods. Flexible side hustles are the perfect solution.</p><h3>1. Online Tutoring</h3><p>If you excel in a particular subject, why not teach it? Online tutoring platforms or local campus tutoring allow you to set your own hours and rates. It's a high-paying hustle that also helps reinforce your own understanding of the subject matter.</p><h3>2. Freelance Writing or Designing</h3><p>If you have skills in writing, editing, graphic design, or coding, freelance platforms like Upwork or Fiverr offer a marketplace for short-term projects. You can choose to accept work only when your academic workload is light, giving you absolute control over your schedule.</p><blockquote>"The best side hustle is one that utilizes your existing talents and offers total schedule flexibility."</blockquote><h3>3. Campus Employment</h3><p>University departments often hire students for roles in the library, student union, computer labs, or administrative offices. These jobs are highly convenient since they require no commute, and supervisors are usually very understanding of exam schedules and study needs.</p>`
    }
  ];

  async function incrementBlogPostViews(postId) {
    try {
      const db = firebase.firestore();
      const docRef = db.collection('blog_posts').doc(postId);

      try {
        await docRef.update({
          views: firebase.firestore.FieldValue.increment(1)
        });
      } catch (updateErr) {
        if (updateErr.code === 'not-found') {
          const fallbackPost = defaultBlogPosts.find(p => p.id === postId);
          if (fallbackPost) {
            const newDoc = {
              title: fallbackPost.title,
              category: fallbackPost.category,
              categoryLabel: fallbackPost.categoryLabel,
              date: fallbackPost.date,
              readTime: fallbackPost.readTime,
              author: fallbackPost.author,
              excerpt: fallbackPost.excerpt,
              image: fallbackPost.image,
              content: fallbackPost.content,
              views: 1,
              likes: 0,
              liked_by: [],
              created_at: new Date().toISOString()
            };
            await docRef.set(newDoc);
          }
        } else {
          throw updateErr;
        }
      }

      // Update locally
      const idx = localBlogPosts.findIndex(b => b.id === postId);
      if (idx !== -1) {
        localBlogPosts[idx].views = (localBlogPosts[idx].views || 0) + 1;
        emit('blog_posts_changed', localBlogPosts);
      }
    } catch (err) {
      console.warn('[KwabzStore] Failed to increment views:', err);
    }
  }

  async function toggleLikeBlogPost(postId) {
    try {
      const user = firebase.auth().currentUser;
      let likerId = user ? user.uid : localStorage.getItem('kwabz_vid');
      if (!likerId) {
        likerId = 'v_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('kwabz_vid', likerId);
      }

      const db = firebase.firestore();
      const docRef = db.collection('blog_posts').doc(postId);
      const doc = await docRef.get();
      let isLiked = false;

      if (!doc.exists) {
        const fallbackPost = defaultBlogPosts.find(p => p.id === postId);
        if (fallbackPost) {
          const newDoc = {
            title: fallbackPost.title,
            category: fallbackPost.category,
            categoryLabel: fallbackPost.categoryLabel,
            date: fallbackPost.date,
            readTime: fallbackPost.readTime,
            author: fallbackPost.author,
            excerpt: fallbackPost.excerpt,
            image: fallbackPost.image,
            content: fallbackPost.content,
            views: 0,
            likes: 1,
            liked_by: [likerId],
            created_at: new Date().toISOString()
          };
          await docRef.set(newDoc);
          isLiked = true;
        }
      } else {
        const data = doc.data();
        const likedBy = data.liked_by || [];
        const hasLiked = likedBy.includes(likerId);

        let newLikes = data.likes || 0;
        let newLikedBy = [...likedBy];

        if (hasLiked) {
          newLikes = Math.max(0, newLikes - 1);
          newLikedBy = newLikedBy.filter(id => id !== likerId);
          isLiked = false;
        } else {
          newLikes += 1;
          newLikedBy.push(likerId);
          isLiked = true;
        }

        await docRef.update({
          likes: newLikes,
          liked_by: newLikedBy
        });
      }

      // Update locally
      const idx = localBlogPosts.findIndex(b => b.id === postId);
      if (idx !== -1) {
        const post = localBlogPosts[idx];
        post.liked_by = post.liked_by || [];
        if (post.liked_by.includes(likerId)) {
          post.likes = Math.max(0, (post.likes || 0) - 1);
          post.liked_by = post.liked_by.filter(id => id !== likerId);
        } else {
          post.likes = (post.likes || 0) + 1;
          post.liked_by.push(likerId);
        }
        emit('blog_posts_changed', localBlogPosts);
      }

      return isLiked;
    } catch (err) {
      console.error('[KwabzStore] Failed to like blog post:', err);
      throw err;
    }
  }

  async function getBlogComments(postId) {
    try {
      const db = firebase.firestore();
      const snapshot = await db.collection('blog_comments')
        .where('post_id', '==', postId)
        .get();

      const comments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      comments.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));
      return comments;
    } catch (err) {
      console.error('[KwabzStore] Failed to fetch blog comments:', err);
      return [];
    }
  }

  async function addBlogComment(postId, commentText, authorName) {
    try {
      const user = firebase.auth().currentUser;
      const uid = user ? user.uid : 'guest';

      const commentData = {
        post_id: postId,
        user_id: uid,
        author_name: authorName || (user ? (user.displayName || user.email.split('@')[0]) : 'Guest'),
        comment: commentText,
        created_at: new Date().toISOString()
      };

      const db = firebase.firestore();
      const docRef = await db.collection('blog_comments').add(commentData);

      // Increment comment count on the post
      const postRef = db.collection('blog_posts').doc(postId);
      await postRef.update({
        comment_count: firebase.firestore.FieldValue.increment(1)
      }).catch(async (err) => {
        if (err.code === 'not-found') {
          const fallbackPost = defaultBlogPosts.find(p => p.id === postId);
          if (fallbackPost) {
            await postRef.set({
              title: fallbackPost.title,
              category: fallbackPost.category,
              categoryLabel: fallbackPost.categoryLabel,
              date: fallbackPost.date,
              readTime: fallbackPost.readTime,
              author: fallbackPost.author,
              excerpt: fallbackPost.excerpt,
              image: fallbackPost.image,
              content: fallbackPost.content,
              views: 0,
              likes: 0,
              liked_by: [],
              comment_count: 1,
              created_at: new Date().toISOString()
            });
          }
        }
      });

      // Update locally
      const idx = localBlogPosts.findIndex(b => b.id === postId);
      if (idx !== -1) {
        localBlogPosts[idx].comment_count = (localBlogPosts[idx].comment_count || 0) + 1;
        emit('blog_posts_changed', localBlogPosts);
      }

      return { id: docRef.id, ...commentData };
    } catch (err) {
      console.error('[KwabzStore] Failed to add blog comment:', err);
      throw err;
    }
  }

  async function trackPageView(pageName) {
    if (!pageName) return;
    try {
      if (pageName.includes('admin-') || pageName.includes('sellers')) return; // Ignore admin pages
      const db = firebase.firestore();

      const now = new Date();
      const dailyKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const monthlyKey = dailyKey.substring(0, 7); // YYYY-MM

      const updates = {
        page: pageName,
        views: firebase.firestore.FieldValue.increment(1),
        [`views_daily.${dailyKey}`]: firebase.firestore.FieldValue.increment(1),
        [`views_monthly.${monthlyKey}`]: firebase.firestore.FieldValue.increment(1),
        updated_at: now.toISOString()
      };

      await db.collection('page_views').doc(pageName).set(updates, { merge: true });
    } catch (e) {
      console.warn('[KwabzStore] Failed to track page view:', e);
    }
  }

  // ─── Seller Management ───
  async function addSeller(data) {
    try {
      const newDoc = { ...data, created_at: new Date().toISOString() };
      const docRef = await firebase.firestore().collection('sellers').add(newDoc);
      const sellerWithId = { id: docRef.id, ...newDoc };
      localSellers.push(sellerWithId);
      _saveToDiskCache();
      emit('sellers_changed', localSellers);
      return sellerWithId;
    } catch (err) {
      console.error('[KwabzStore] Add seller error:', err);
      throw err;
    }
  }

  async function updateSeller(id, updates) {
    try {
      await firebase.firestore().collection('sellers').doc(id).update(updates);
      const idx = localSellers.findIndex(s => s.id === id);
      if (idx !== -1) {
        localSellers[idx] = { ...localSellers[idx], ...updates };
        _saveToDiskCache();
        emit('sellers_changed', localSellers);
      }
      return true;
    } catch (err) {
      console.error('[KwabzStore] Update seller error:', err);
      throw err;
    }
  }

  async function deleteSeller(id) {
    try {
      await firebase.firestore().collection('sellers').doc(id).delete();
      localSellers = localSellers.filter(s => s.id !== id);
      _saveToDiskCache();
      emit('sellers_changed', localSellers);
      return true;
    } catch (err) {
      console.error('[KwabzStore] Delete seller error:', err);
      throw err;
    }
  }

  // ─── Wishlist (Firestore-backed when logged in) ───────────
  async function _syncWishlistToFirestore() {
    if (!currentUser) return; // Only sync if user is logged in
    try {
      const db = firebase.firestore();
      await db.collection('users').doc(currentUser.uid)
        .collection('wishlist').doc('items')
        .set({ items: localWishlist, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('[KwabzStore] Wishlist sync error:', err);
    }
  }

  function _getWishlist() {
    if (!Array.isArray(localWishlist)) {
      localWishlist = [];
    }
    return localWishlist;
  }

  function _setWishlist(wishlist) {
    localWishlist = Array.isArray(wishlist) ? wishlist : [];
    _safeSetItem(KEYS.WISHLIST, JSON.stringify(localWishlist));
    if (currentUser) {
      _syncWishlistToFirestore();
    }
  }

  function getWishlist() { return _getWishlist(); }

  function clearWishlist() {
    _setWishlist([]);
    emit('wishlist_changed', []);
  }

  function addToWishlist(product) {
    const wishlist = _getWishlist();
    if (!product) {
      console.warn('[KwabzStore] Cannot add undefined product to wishlist');
      return wishlist;
    }
    const pid = product.id || product.product_id || product._id || product.uid;
    if (!pid) {
      console.warn('[KwabzStore] Cannot add product to wishlist because ID is missing:', product);
      return wishlist;
    }
    const existing = wishlist.find(i => i.product_id === pid);
    if (!existing) {
      wishlist.push({
        product_id: pid,
        name: product.name || '',
        price: product.price || 0,
        image_url: product.image_url || product.imageUrl || product.image || '',
        seller_id: product.seller_id || 'main'
      });
      _setWishlist(wishlist);
      emit('wishlist_changed', wishlist);
    }
    return wishlist;
  }

  function removeFromWishlist(id) {
    if (!id) return _getWishlist();
    const wishlist = _getWishlist().filter(i => i.product_id !== id);
    _setWishlist(wishlist);
    emit('wishlist_changed', wishlist);
    return wishlist;
  }

  function toggleWishlist(product) {
    if (!product) return _getWishlist();
    const pid = product.id || product.product_id || product._id || product.uid;
    if (!pid) return _getWishlist();

    const wishlist = _getWishlist();
    const existing = wishlist.find(i => i.product_id === pid);
    if (existing) {
      removeFromWishlist(pid);
    } else {
      addToWishlist(product);
    }
    return _getWishlist();
  }

  function isInWishlist(id) {
    if (!id) return false;
    return _getWishlist().some(i => i.product_id === id);
  }

  // ─── Cart (Firestore-backed when logged in) ───────────
  async function _syncCartToFirestore() {
    if (!currentUser) return; // Only sync if user is logged in

    try {
      const db = firebase.firestore();
      await db.collection('users').doc(currentUser.uid)
        .collection('cart').doc('items')
        .set({ items: localCart, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('[KwabzStore] Cart sync error:', err);
    }
  }

  function _getCart() {
    return localCart;
  }

  function _syncCartPrices() {
    let cartModified = false;
    localCart.forEach(item => {
      const liveProduct = localProducts.find(p => p.id === (item.product_id || item.id));
      if (liveProduct) {
        if (item.price !== liveProduct.price || item.original_price !== liveProduct.price) {
          item.price = KwabzUtils.getEffectivePrice ? KwabzUtils.getEffectivePrice(liveProduct) : liveProduct.price;
          item.original_price = liveProduct.price;
          item.discount = KwabzUtils.getEffectiveDiscount ? KwabzUtils.getEffectiveDiscount(liveProduct) : 0;
          cartModified = true;
        }
      }
    });
    if (cartModified) {
      _setCart(localCart);
      emit('cart_changed', localCart);
    }
  }

  function _setCart(cart) {
    localCart = cart;
    lastLocalCartUpdate = Date.now();
    _safeSetItem(KEYS.CART, JSON.stringify(cart));
    if (currentUser) {
      _syncCartToFirestore();
    }
  }

  function getCart() { return _getCart(); }

  function clearCart() {
    _setCart([]);
    emit('cart_changed', []);
  }

  function getCartTotal() {
    return _getCart().reduce((s, i) => s + (i.price * i.quantity), 0);
  }

  function getCartItemCount() {
    return _getCart().reduce((s, i) => s + i.quantity, 0);
  }

  function addToCart(product, quantity = 1, variant = null) {
    const cart = _getCart();
    const sid = product.seller_id || 'main';

    if (cart.length > 0) {
      const existingSid = cart[0].seller_id || 'main';
      if (existingSid !== sid) {
        const storeName = (sid === 'main') ? 'the Kwabz Main Store' : (getSellerById(sid)?.name || 'another mini-store');
        const currentStore = (existingSid === 'main') ? 'Kwabz Main Store' : (getSellerById(existingSid)?.name || 'a mini-store');

        const confirm = window.confirm(
          `Your cart already contains items from "${currentStore}".\n\nAdding this item will clear your current cart because items from different stores must be ordered separately. \n\nDo you want to clear your cart and add this item instead?`
        );

        if (confirm) {
          cart.length = 0; // Clear it
        } else {
          return cart; // Cancel
        }
      }
    }

    const cartItemId = variant ? `${product.id}-${variant}` : product.id;
    const existing = cart.find(i => (i.cart_item_id || i.product_id) === cartItemId || (!i.cart_item_id && i.product_id === product.id && i.variant === variant));

    // STOCK PROTECTION: Block cart overfilling
    const maxStock = (product.stock !== undefined && product.stock !== null && product.stock !== '') ? parseInt(product.stock) : Infinity;
    const currentQty = existing ? existing.quantity : 0;
    const requestedQty = currentQty + quantity;

    if (requestedQty > maxStock) {
      if (typeof KwabzUtils !== 'undefined' && KwabzUtils.toast) {
        KwabzUtils.toast(`Only ${maxStock} left in stock!`, 'error');
      } else {
        alert(`Only ${maxStock} left in stock!`);
      }
      return cart;
    }

    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.push({
        cart_item_id: cartItemId,
        product_id: product.id,
        variant: variant,
        name: product.name,
        original_price: product.price,
        discount: KwabzUtils.getEffectiveDiscount ? KwabzUtils.getEffectiveDiscount(product) : 0,
        price: KwabzUtils.getEffectiveDiscount ? KwabzUtils.calcDiscountedPrice(product.price, KwabzUtils.getEffectiveDiscount(product)) : product.price,
        quantity,
        image_url: product.image_url || '',
        seller_id: sid,
        delivery_cost: parseFloat(product.delivery_cost || 0)
      });
    }
    _setCart(cart);
    emit('cart_changed', cart);
    return cart;
  }

  function removeFromCart(id) {
    const cart = _getCart().filter(i => (i.cart_item_id || i.product_id) !== id);
    _setCart(cart);
    emit('cart_changed', cart);
    return cart;
  }

  function updateCartQuantity(id, qty) {
    const cart = _getCart();
    const item = cart.find(i => (i.cart_item_id || i.product_id) === id);
    if (!item) return cart;
    if (qty <= 0) return removeFromCart(id);

    // STOCK PROTECTION: Block manual quantity increments past available stock
    const product = getProductById(item.product_id || item.id);
    if (product) {
      const maxStock = parseInt(product.stock || 0);
      if (qty > maxStock) {
        if (typeof KwabzUtils !== 'undefined' && KwabzUtils.toast) {
          KwabzUtils.toast(`Only ${maxStock} left in stock!`, 'error');
        } else {
          alert(`Only ${maxStock} left in stock!`);
        }
        return cart;
      }
    }

    item.quantity = qty;
    _setCart(cart);
    emit('cart_changed', cart);
    return cart;
  }

  // ─── Orders ────────────────
  function _generateOrderLabel(sequenceId = null) {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    // Generate 4 random characters (A-Z, 0-9) excluding confusing ones
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let randomStr = '';
    for (let i = 0; i < 4; i++) {
      randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    if (sequenceId !== null) {
      const seqStr = String(sequenceId).slice(-4).padStart(4, '0');
      return `KBZ-${yy}${mm}${dd}-${seqStr}-${randomStr}`;
    }
    return `KBZ-${yy}${mm}${dd}-${randomStr}`;
  }

  async function createOrder(customerInfo, orderMethod = 'local', promoCodeData = null) {
    try {
      const cart = _getCart();
      if (cart.length === 0) return null;

      // STOCK PROTECTION: Pre-Checkout Live Validation
      for (const item of cart) {
        const product = getProductById(item.product_id || item.id);
        if (!product || !product.in_stock || item.quantity > parseInt(product.stock || 0)) {
          if (typeof KwabzUtils !== 'undefined' && KwabzUtils.toast) {
            KwabzUtils.toast(`Sorry, ${item.name} is out of stock or requested quantity exceeds available stock!`, 'error');
          } else {
            alert(`Sorry, ${item.name} is out of stock or requested quantity exceeds available stock!`);
          }
          return null;
        }
      }

      const user = firebase.auth().currentUser;
      const seqId = 1000 + localOrders.length + 1;
      const generatedLabel = _generateOrderLabel(seqId);

      // Compute Admin Commission dynamically with decimal rate flexibility
      let totalCommission = 0;
      let usedRate = 10;
      const hasMiniStoreItem = cart.some(item => item.seller_id && item.seller_id !== 'main');
      if (hasMiniStoreItem) {
        cart.forEach(item => {
          if (item.seller_id && item.seller_id !== 'main') {
            const seller = getSellerById(item.seller_id);
            const rate = (seller && typeof seller.commission === 'number') ? seller.commission : 10;
            usedRate = rate;
            const itemTotal = (item.price || 0) * (item.quantity || 1);
            totalCommission += itemTotal * (rate / 100);
          }
        });
      }

      // Identify primary seller for backwards compatibility
      let orderSellerId = 'main';
      let orderSellerName = 'Kwabz Main Store';
      if (cart.length > 0) {
        const firstSellerId = cart[0].seller_id || 'main';
        const allSameSeller = cart.every(item => (item.seller_id || 'main') === firstSellerId);
        if (allSameSeller && firstSellerId !== 'main') {
          const seller = getSellerById(firstSellerId);
          if (seller) {
            orderSellerId = seller.id;
            orderSellerName = seller.name;
          }
        }
      }

      // Compute delivery fee
      let deliveryFee = 0;
      cart.forEach(item => {
        deliveryFee += (parseFloat(item.delivery_cost) || 0) * item.quantity;
      });

      // Compute promo discount
      let promoDiscount = 0;
      if (promoCodeData) {
        // Double-check cash limit & active status
        const isLimitReached = promoCodeData.cash_limit && (parseFloat(promoCodeData.total_discounted || 0) >= parseFloat(promoCodeData.cash_limit));
        if (promoCodeData.active === false || isLimitReached) {
          promoCodeData = null; // Do not apply
        }
      }
      if (promoCodeData) {
        let eligibleSubtotal = 0;
        const appProds = promoCodeData.applicable_products;
        if (appProds && Array.isArray(appProds) && appProds.length > 0) {
          cart.forEach(item => {
            const productId = item.product_id || item.id;
            if (appProds.includes(productId)) {
              eligibleSubtotal += (parseFloat(item.price) || 0) * (item.quantity || 1);
            }
          });
        } else {
          eligibleSubtotal = getCartTotal();
        }

        const minOrder = parseFloat(promoCodeData.min_order_value || 0);
        if (eligibleSubtotal >= minOrder && eligibleSubtotal > 0) {
          if (promoCodeData.discount_type === 'percent') {
            promoDiscount = eligibleSubtotal * (promoCodeData.discount_value / 100);
          } else if (promoCodeData.discount_type === 'flat') {
            promoDiscount = Math.min(eligibleSubtotal, promoCodeData.discount_value);
          }

          // Cap the discount so it does not exceed the remaining cash limit
          if (promoCodeData.cash_limit) {
            const remainingLimit = Math.max(0, parseFloat(promoCodeData.cash_limit) - parseFloat(promoCodeData.total_discounted || 0));
            if (promoDiscount > remainingLimit) {
              promoDiscount = remainingLimit;
            }
          }
        }
      }

      const rawOrder = {
        order_number: '#' + seqId, // Maintained for backwards compatibility
        order_label: generatedLabel, // MODULE 1: ENTERPRISE ORDER ID ENGINE
        customer: customerInfo,
        customer_uid: user ? user.uid : null, // Link to user account
        order_method: orderMethod,
        items: cart,
        delivery_fee: parseFloat(deliveryFee.toFixed(2)),
        total_price: parseFloat((getCartTotal() - promoDiscount + deliveryFee).toFixed(2)),
        promo_code: promoCodeData ? promoCodeData.code : null,
        promo_discount: parseFloat(promoDiscount.toFixed(2)),
        admin_commission: hasMiniStoreItem ? parseFloat(totalCommission.toFixed(2)) : 0,
        commission_rate: hasMiniStoreItem ? usedRate : 0,
        seller_id: orderSellerId,
        seller_name: orderSellerName,
        status: 'pending',
        created_at: new Date().toISOString()
      };
      const order = JSON.parse(JSON.stringify(rawOrder));
      const db = firebase.firestore();
      const docRef = db.collection('orders').doc(); // Instantly generate offline ID
      const orderWithId = { id: docRef.id, ...order };
      localOrders.unshift(orderWithId);
      _saveToDiskCache();
      emit('orders_changed', localOrders);

      // ── Always save this order locally so user can track it ──
      // For logged-in users, the real-time listener will keep this up to date.
      // For guests, this serves as a permanent offline receipt.
      userOrders.unshift(orderWithId);
      _saveUserOrdersToLocal();
      emit('user_orders_changed', userOrders);

      clearCart();

      // Fire and forget to Firestore
      docRef.set(order).catch(err => {
        console.error('[KwabzStore] Background save order failed:', err);
      });

      // Decrement product stock in Firestore
      if (cart && cart.length > 0) {
        cart.forEach(item => {
          const productId = item.product_id || item.id;
          if (productId) {
            const productRef = db.collection('products').doc(productId);
            // We use a transaction to safely decrement and check if it hit 0 to toggle in_stock
            db.runTransaction(async (t) => {
              const doc = await t.get(productRef);
              if (doc.exists) {
                const currentStock = parseInt(doc.data().stock || 0);
                const newStock = Math.max(0, currentStock - (item.quantity || 1));
                const updates = { stock: newStock };
                if (newStock === 0) {
                  updates.in_stock = false;
                }
                t.update(productRef, updates);
              }
            }).catch(err => {
              console.warn(`[KwabzStore] Failed to update stock for ${productId}:`, err);
              // Fallback to simple increment
              productRef.update({
                stock: firebase.firestore.FieldValue.increment(-(item.quantity || 1))
              }).catch(e => console.warn(e));
            });

            // Optimistic local update
            const pIdx = localProducts.findIndex(p => p.id === productId);
            if (pIdx !== -1) {
              localProducts[pIdx].stock = Math.max(0, (localProducts[pIdx].stock || 0) - (item.quantity || 1));
              if (localProducts[pIdx].stock === 0) localProducts[pIdx].in_stock = false;
            }
          }
        });
        _saveToDiskCache();
        emit('products_changed', localProducts);
      }

      // Update promo code usage metrics in Firestore if promo was applied
      if (promoCodeData && promoCodeData.id && promoDiscount > 0) {
        const promoDocRef = db.collection('promo_codes').doc(promoCodeData.id);

        // ── Optimistic local cache update ───────────────────────────────────────
        // Update localPromoCodes immediately so the admin promo bar (Used / Remaining)
        // reflects the new total_discounted without waiting for Firestore's onSnapshot
        // to re-fire (which can be slow or missed when the promo page is open).
        const promoIdx = localPromoCodes.findIndex(p => p.id === promoCodeData.id);
        if (promoIdx !== -1) {
          const prev = localPromoCodes[promoIdx];
          const newTotal = parseFloat(prev.total_discounted || 0) + promoDiscount;
          localPromoCodes[promoIdx] = { ...prev, total_discounted: newTotal };
          const limit = parseFloat(prev.cash_limit || 0);
          if (limit > 0 && newTotal >= limit) {
            localPromoCodes[promoIdx].active = false;
          }
          _saveToDiskCache();
          emit('promo_codes_changed', localPromoCodes);
        }

        db.runTransaction(async (transaction) => {
          const promoDoc = await transaction.get(promoDocRef);
          if (promoDoc.exists) {
            const currentDiscounted = parseFloat(promoDoc.data().total_discounted || 0);
            const newDiscounted = currentDiscounted + promoDiscount;
            const updates = { total_discounted: newDiscounted };

            const limit = parseFloat(promoDoc.data().cash_limit || 0);
            if (limit > 0 && newDiscounted >= limit) {
              updates.active = false;
            }
            transaction.update(promoDocRef, updates);
          }
        }).catch(err => {
          console.error('[KwabzStore] Transaction failed to update promo code metrics:', err);
          // Fallback to direct update if transaction fails
          const newTotal = (parseFloat(promoCodeData.total_discounted || 0)) + promoDiscount;
          const updates = {
            total_discounted: firebase.firestore.FieldValue.increment(promoDiscount)
          };
          if (promoCodeData.cash_limit && newTotal >= parseFloat(promoCodeData.cash_limit)) {
            updates.active = false;
          }
          promoDocRef.update(updates).catch(e => {
            console.error('[KwabzStore] Direct update fallback failed:', e);
          });
        });
      }

      // Trigger Admin Alert
      _alertAdminNewOrder(orderWithId);

      return orderWithId;
    } catch (err) {
      console.error('[KwabzStore] Create order error:', err);
      throw err;
    }
  }

  async function updateOrderStatus(id, status) {
    try {
      await firebase.firestore().collection('orders').doc(id).update({ status });
      const idx = localOrders.findIndex(o => o.id === id);
      if (idx !== -1) {
        localOrders[idx].status = status;
        _saveToDiskCache();
        emit('orders_changed', localOrders);
      }
      return true;
    } catch (err) {
      console.error('[KwabzStore] Update order status error:', err);
      throw err;
    }
  }

  // Admin: permanently delete an order from Firestore
  async function deleteOrder(id) {
    if (!isAdminLoggedIn()) throw new Error('Admin access required to delete orders.');
    try {
      await firebase.firestore().collection('orders').doc(id).delete();
      localOrders = localOrders.filter(o => o.id !== id);
      _saveToDiskCache();
      emit('orders_changed', localOrders);
      console.log('[KwabzStore] Order deleted:', id);
      return true;
    } catch (err) {
      console.error('[KwabzStore] Delete order error:', err);
      throw err;
    }
  }

  function sendCancelNotificationViaWhatsApp(order, phone = '233553866329') {
    try {
      const customerName = order.customer?.name || 'Customer';
      const orderNum = order.order_label || order.order_number || '#NEW';
      const items = order.items || [];
      const totalAmount = order.total_price || 0;

      let message = `*🚫 ORDER CANCELLATION REQUEST*\n`;
      message += `----------------------------------------\n`;
      message += `*Customer:* ${customerName}\n`;
      message += `*Ref ID:* ${orderNum}\n`;
      message += `*Items:* ${items.map(i => `${i.name} (x${i.quantity})`).join(', ')}\n`;
      message += `*Total Price:* GH₵ ${totalAmount.toFixed(2)}\n`;
      message += `----------------------------------------\n`;
      message += `_This customer has cancelled their order on the website._`;

      const cleanPhone = phone.replace(/\D/g, '');
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
    } catch (e) {
      console.error('[KwabzStore] Failed to send WhatsApp cancellation message:', e);
    }
  }

  // User: cancel their own order (sets status = cancelled)
  // Only allowed if the order hasn't shipped yet
  async function cancelOrder(id) {
    const order = localOrders.find(o => o.id === id) ||
      userOrders.find(o => o.id === id);

    if (!order) throw new Error('Order not found.');

    // Verify ownership (only check if both currentUser and order.customer_uid exist)
    if (currentUser && order.customer_uid && order.customer_uid !== currentUser.uid) {
      throw new Error('You can only cancel your own orders.');
    }

    const blockedStatuses = ['shipped', 'delivered', 'cancelled'];
    if (blockedStatuses.includes(order.status)) {
      throw new Error(`Cannot cancel an order that is already ${order.status}.`);
    }

    try {
      // 1. Try updating Firestore if ownership matches and user is logged in
      if (currentUser && order.customer_uid === currentUser.uid) {
        await firebase.firestore().collection('orders').doc(id).update({ status: 'cancelled' });
      }

      // 2. Update local user orders cache immediately
      const uIdx = userOrders.findIndex(o => o.id === id);
      if (uIdx !== -1) {
        userOrders[uIdx].status = 'cancelled';
        _saveUserOrdersToLocal();
        emit('user_orders_changed', userOrders);
      }

      // 3. Open WhatsApp notification for the admin
      sendCancelNotificationViaWhatsApp(order);
      return true;
    } catch (err) {
      console.warn('[KwabzStore] Firestore cancel order failed, falling back to local cancel + WhatsApp:', err);
      const uIdx = userOrders.findIndex(o => o.id === id);
      if (uIdx !== -1) {
        userOrders[uIdx].status = 'cancelled';
        _saveUserOrdersToLocal();
        emit('user_orders_changed', userOrders);
      }
      sendCancelNotificationViaWhatsApp(order);
      return true;
    }
  }


  // User: remove an order from their personal history (for cancelled or delivered items)
  async function removeOrderFromHistory(id) {
    const user = firebase.auth().currentUser;
    try {
      if (user) {
        // Only update Firestore if the user actually owns the order document
        const order = userOrders.find(o => o.id === id);
        if (order && order.customer_uid === user.uid) {
          await firebase.firestore().collection('orders').doc(id).update({
            hidden_by_customer: true
          });
        }
      }
    } catch (err) {
      console.warn('[KwabzStore] Failed to update hidden status in Firestore, hiding locally:', err);
    }

    // Always hide locally!
    userOrders = userOrders.filter(o => o.id !== id);
    _saveUserOrdersToLocal();
    emit('user_orders_changed', userOrders);
    return true;
  }

  async function getOrderById(id) {
    try {
      // 1. Check admin local cache first
      let local = localOrders.find(o => o.id === id);
      if (local) return local;

      // 2. Check user's personal local cache
      // Ensure we have loaded from disk if memory is empty (e.g. page refresh)
      if (userOrders.length === 0) {
        userOrders = _loadUserOrdersFromLocal();
      }
      local = userOrders.find(o => o.id === id);
      if (local) return local;

      // 3. Fallback to Firestore (may fail for guests due to security rules)
      if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        const doc = await firebase.firestore().collection('orders').doc(id).get();
        if (doc.exists) {
          const data = { id: doc.id, ...doc.data() };
          return data;
        }
      }

      return null;
    } catch (err) {
      console.warn('[KwabzStore] Get order error:', err.message);
      return null;
    }
  }

  // ─── Admin Auth (Secure Firebase Auth) ──────────────────────────
  // (Admin Login consolidated above)

  async function adminLogout() {
    try {
      localStorage.removeItem('kwabz_login_time');
      await firebase.auth().signOut();
      localStorage.removeItem(KEYS.ADMIN_AUTH);
      localStorage.removeItem('kwabz_user_mode');
    } catch (err) {
      console.error('[KwabzStore] Admin logout error:', err);
    }
  }

  async function registerAdmin(email, password, name) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('You must be logged in to register new admins.');

    // ── Aggressive Verification ──
    if (!isAdminLoggedIn()) {
      try {
        const doc = await firebase.firestore().collection('users').doc(user.uid).get();
        if (doc.exists && doc.data().role === 'admin') {
          localRole = 'admin';
          localStorage.setItem(KEYS.ADMIN_AUTH, 'true');
        }
      } catch (e) {
        console.error('[KwabzStore] Deep verification failed:', e);
      }
    }

    if (!isAdminLoggedIn()) {
      console.warn('[KwabzStore] Registration blocked. Current role:', localRole);
      throw new Error('Only existing admins can register new admins. (Verification failed)');
    }

    let secondaryApp;
    try {
      secondaryApp = firebase.app('Secondary');
    } catch (e) {
      secondaryApp = firebase.initializeApp(firebase.app().options, 'Secondary');
    }

    // Wrap the entire process in a timeout to prevent hanging UI
    const registrationTask = (async () => {
      try {
        console.log('[KwabzStore] Creating new admin account...');
        try {
          const res = await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
          const uid = res.user.uid;

          console.log('[KwabzStore] New UID created:', uid, '. Syncing identity...');

          // 1. Update Auth Profile
          await res.user.updateProfile({ displayName: name });

          // 2. Set Firestore User Document
          await firebase.firestore().collection('users').doc(uid).set({
            email: email,
            displayName: name,
            role: 'admin',
            created_at: new Date().toISOString()
          });

          console.log('[KwabzStore] Admin registration complete.');
          return true;
        } catch (err) {
          if (err.code === 'auth/email-already-in-use') {
            console.log('[KwabzStore] Email already registered. Attempting to promote to admin...');
            // Find existing user document in Firestore by email
            const querySnapshot = await firebase.firestore().collection('users')
              .where('email', '==', email)
              .get();

            if (!querySnapshot.empty) {
              const userDoc = querySnapshot.docs[0];
              await firebase.firestore().collection('users').doc(userDoc.id).update({
                role: 'admin',
                displayName: name || userDoc.data().displayName || 'Admin'
              });
              console.log('[KwabzStore] Successfully promoted existing user to admin:', userDoc.id);
              return true;
            } else {
              throw new Error('This email is already in use, but no user profile exists in Firestore to promote.');
            }
          }
          throw err;
        }
      } finally {
        // Always try to clean up the secondary app
        try { await secondaryApp.delete(); } catch (e) { }
      }
    })();

    // 15 second timeout
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Registration timed out. Please check your network and Firebase Rules.')), 15000)
    );

    try {
      return await Promise.race([registrationTask, timeout]);
    } catch (err) {
      console.error('[KwabzStore] Registration error:', err);
      throw err;
    }
  }

  // ─── WhatsApp ──────────────
  /**
   * 2. "Order Inquiry" (User → Admin)
   * High-end, automated WhatsApp messaging with business-grade copywriting.
   */
  function sendOrderViaWhatsApp(order, phone = '233553866329') {
    const customerName = order.customer?.name || 'Customer';
    const customerPhone = order.customer?.phone || '';
    const customerAddress = order.customer?.address || '';
    const items = order.items || [];

    // Generate a unique Ref ID for professional tracking
    const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();
    const refId = `KBZ-${randomSuffix}`;

    const firstItem = items[0]?.name || 'Item';
    const isMiniStore = items[0]?.seller_id && items[0].seller_id !== 'main';

    let message = '';

    if (items.length > 1 || (customerPhone && customerAddress)) {
      // Standardize beautiful order manifest for cart checkouts
      const storeName = isMiniStore ? (getSellerById(items[0].seller_id)?.name || 'Mini Store') : 'Kwabz Main Store';

      message = `*🛒 NEW ORDER FROM ${storeName.toUpperCase()}*\n`;
      message += `----------------------------------------\n`;
      message += `*Customer Details:*\n`;
      message += `👤 *Name:* ${customerName}\n`;
      if (customerPhone) message += `📞 *Phone:* ${customerPhone}\n`;
      if (customerAddress) message += `📍 *Address:* ${customerAddress}\n\n`;

      message += `*Order Items:*\n`;
      let subTotal = 0;
      let deliveryFee = 0;
      items.forEach((item, idx) => {
        const itemTotal = (item.price || 0) * (item.quantity || 1);
        subTotal += itemTotal;
        const itemDelivery = (parseFloat(item.delivery_cost) || 0) * (item.quantity || 1);
        deliveryFee += itemDelivery;
        message += `${idx + 1}. 🛍️ *${item.name}*\n`;
        message += `   Quantity: ${item.quantity || 1} | Price: GH₵ ${itemTotal.toFixed(2)}`;
        if (itemDelivery > 0) {
          message += ` (Delivery: GH₵ ${itemDelivery.toFixed(2)})`;
        }
        message += `\n\n`;
      });

      message += `----------------------------------------\n`;
      message += `Subtotal: GH₵ ${subTotal.toFixed(2)}\n`;
      if (order.promo_code && order.promo_discount > 0) {
        message += `Promo Code (${order.promo_code}): -GH₵ ${parseFloat(order.promo_discount).toFixed(2)}\n`;
      }
      if (deliveryFee > 0) {
        message += `Delivery Fee: GH₵ ${deliveryFee.toFixed(2)}\n`;
      }
      const grandTotal = subTotal - (parseFloat(order.promo_discount) || 0) + deliveryFee;
      message += `💰 *TOTAL AMOUNT:* GH₵ ${grandTotal.toFixed(2)}\n`;
      message += `📝 *Ref ID:* ${refId}\n`;
      message += `----------------------------------------\n`;
      message += `_Please confirm receipt and share payment methods to proceed!_`;

    } else {
      // Fallback/Single product detail quick checkout
      if (isMiniStore) {
        message = `Hello! I saw your product "${firstItem}" listed on Kwabz Store and would love to place an order. Could you please share your payment methods so I can complete my payment?\n\n*Product:* ${firstItem}\n*Customer:* ${customerName}\n*Ref ID:* ${refId}`;
      } else {
        message = `Hello Kwabz Admin, I would like to inquire about this item:\n\n*Product:* ${firstItem}\n\n*Customer:* ${customerName}\n*Ref ID:* ${refId}\n\n_Please provide payment details to proceed._`;
      }
    }

    const formatted = KwabzUtils.formatWhatsAppPhone(phone);
    const cleanPhone = formatted ? formatted.replace(/\D/g, '') : '233553866329';
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
  }

  function sendStatusUpdateViaWhatsApp(order) {
    const status = order.status || 'pending';
    const name = order.customer.name.split(' ')[0];
    const orderNum = order.order_label || order.order_number;
    const phone = order.customer.phone.replace(/\D/g, '');
    let msg = `Hi ${name}, your order *${orderNum}* status has been updated to: *${status}*.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function getSettings() { return localSettings; }

  async function updateSettings(updates) {
    try {
      if (!isAdminLoggedIn()) {
        throw new Error('Unauthorized: Only the system admin can update global theme settings.');
      }

      const db = firebase.firestore();
      console.log('[KwabzStore] Updating global settings...', updates);

      // 1. Optimistic Local Update
      localSettings = { ...localSettings, ...updates };
      _safeSetItem(KEYS.SETTINGS, JSON.stringify(_stripHeavyFields(localSettings)));
      emit('settings_changed', localSettings);

      db.collection('settings').doc('global').set(updates, { merge: true })
        .catch(err => {
          console.error('[KwabzStore] Background update settings failed:', err);
          emit('settings_write_failed', err);
        });

      return true;
    } catch (err) {
      console.error('[KwabzStore] Update settings error:', err);
      throw err;
    }
  }

  function searchProducts(query, sellerId = 'main') {
    let baseProducts = (sellerId === 'all') ? localProducts :
      (sellerId === 'main' ? getProducts() : getProductsBySeller(sellerId));

    if (!query) return baseProducts;

    const q = query.toLowerCase();
    return baseProducts.filter(p => {
      const nameMatch = p.name.toLowerCase().includes(q);
      const descMatch = (p.description || '').toLowerCase().includes(q);
      const cat = getCategoryById(p.category_id);
      const catMatch = (cat && cat.name.toLowerCase().includes(q));
      return nameMatch || descMatch || catMatch;
    });
  }

  /**
   * Helper to strip massive base64 strings before caching to localStorage.
   * This prevents QuotaExceededError while allowing Firestore to keep the full data.
   */
  function _stripHeavyFields(data) {
    if (!data) return data;

    const heavyFields = [
      'image', 'imageUrl', 'image_url', 'thumbnail', 'heroImage', 'logo', 'banner', 'bgImage',
      'heroImage1', 'heroImage2', 'heroImage3', 'logoImageUrl', 'shopHeroImage', 'shopHeroImage2',
      'authLoginImage', 'authSignupImage', 'sellersBgImage', 'splashBgImage', 'splashFavicon'
    ];

    const _cleanItem = (item) => {
      if (!item || typeof item !== 'object') return item;
      const cleaned = { ...item };

      // Clean heavy matching fields if they are base64 strings
      heavyFields.forEach(field => {
        if (cleaned[field] && typeof cleaned[field] === 'string' && cleaned[field].startsWith('data:')) {
          delete cleaned[field];
        }
      });

      // Recursively clean child properties
      for (const key in cleaned) {
        if (cleaned[key] && typeof cleaned[key] === 'object') {
          cleaned[key] = _stripHeavyFields(cleaned[key]);
        }
      }
      return cleaned;
    };

    if (Array.isArray(data)) return data.map(_cleanItem);
    return _cleanItem(data);
  }

  // ─── Automated WhatsApp Notifications (Client-Side) ───
  /**
   * Helper to send a WhatsApp message via Twilio REST API
   */
  async function _sendTwilioMessage(to, body) {
    const config = window.TWILIO_CONFIG;
    if (!config || config.sid.includes('xxx')) {
      console.warn('[Twilio] Config missing or using placeholders. Skipping message.');
      return;
    }

    try {
      const auth = btoa(`${config.sid}:${config.token}`);
      const url = `https://api.twilio.com/2010-04-01/Accounts/${config.sid}/Messages.json`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          From: `whatsapp:${config.from}`,
          To: `whatsapp:${to}`,
          Body: body
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message);
      }
      console.log(`[Twilio] Message sent to ${to}`);
    } catch (err) {
      console.error(`[Twilio] Failed to send to ${to}:`, err);
    }
  }

  /**
   * Broadcast a new product to all users with phone numbers (Twilio)
   * AND writes a Firestore notification doc so online browsers receive push.
   */
  async function _broadcastNewProduct(product, productId) {
    const message = `*Kwabz Store Update:* A new essential has arrived: *${product.name}*.\nPrice: *GH₵ ${product.price}*. View the drop: https://kwabz-store-v2.vercel.app/product-detail.html?id=${productId}`;

    // ── 1. Write Firestore notification doc (browser push trigger) ──
    try {
      await firebase.firestore().collection('product_notifications').add({
        product_id: productId,
        name: product.name,
        price: product.price,
        discount: product.discount || 0,
        image_url: (product.image_url || '').startsWith('data:') ? '' : (product.image_url || ''),
        seller_id: product.seller_id || 'main',
        created_at: new Date().toISOString()
      });
      console.log('[KwabzStore] Browser push notification written to Firestore.');
    } catch (err) {
      console.warn('[KwabzStore] Failed to write push notification doc:', err);
    }

    // ── 2. WhatsApp broadcast (Moved to Backend) ──
    // SECURITY FIX: Removed the massive db.collection('users').get() query here.
    // The backend server should listen to the 'product_notifications' collection
    // and execute the Twilio broadcast securely without leaking user data to the client.
    console.log('[KwabzStore] Broadcast request queued to product_notifications.');
  }

  /**
   * Alert Admin about a new order inquiry
   */
  async function _alertAdminNewOrder(order) {
    const config = window.TWILIO_CONFIG;
    if (!config || !config.adminPhone) return;

    const customerName = order.customer?.name || 'Customer';
    const firstItem = order.items?.[0]?.name || 'Item';
    const customerPhone = KwabzUtils.formatWhatsAppPhone(order.customer?.phone || '0000000000');
    const orderNum = order.order_label || order.order_number || '#NEW';

    const message = `*Hello Kwabz Admin, I would like to inquire about an item.*\n\n*Product:* ${firstItem}\n*Customer:* ${customerName}\n*Ref ID:* ${orderNum}\n\n_Please provide payment details to proceed._\n\nChat with Customer: https://wa.me/${customerPhone.replace('+', '')}`;

    await _sendTwilioMessage(config.adminPhone, message);
  }

  async function _saveToDiskCache() {
    _safeSetItem(KEYS.CACHE_TIMESTAMP, String(Date.now())); // Stamp write time for TTL enforcement

    // Broadcast a lightweight ping for cross-tab sync since we moved away from localStorage events
    if (window.BroadcastChannel) {
      try { new BroadcastChannel('kwabz_store_sync').postMessage('cache_updated'); } catch (e) { }
    }

    // Await IDB sets
    await kwabz_idb.set(KEYS.CACHE_PRODUCTS, _stripHeavyFields(localProducts));
    await kwabz_idb.set(KEYS.CACHE_CATEGORIES, localCategories);
    await kwabz_idb.set(KEYS.CACHE_SELLERS, localSellers);
    _safeSetItem('kwabz_sellers_cache', JSON.stringify(localSellers));
    await kwabz_idb.set(KEYS.CACHE_BLOG_POSTS, localBlogPosts);
    await kwabz_idb.set(KEYS.CACHE_PROMO_CODES, localPromoCodes);
    await kwabz_idb.set(KEYS.CACHE_BUNDLES, localBundles);
    _safeSetItem('kwabz_bundles_cache', JSON.stringify(localBundles));

    if (localOrders.length > 0) {
      await kwabz_idb.set(KEYS.CACHE_ORDERS, localOrders.slice(0, 50));
    }
  }

  // ─── Cross-Tab Real-Time Sync ───
  // When admin saves settings in one tab, all other open tabs receive the update instantly.
  window.addEventListener('storage', (e) => {
    if (e.key === KEYS.SETTINGS && e.newValue) {
      try {
        localSettings = JSON.parse(e.newValue);
        emit('settings_changed', localSettings);
      } catch (err) { }
    }
    if (e.key === KEYS.CACHE_PRODUCTS && e.newValue) {
      try {
        localProducts = JSON.parse(e.newValue);
        emit('products_changed', localProducts);
      } catch (err) { }
    }
    if (e.key === KEYS.CACHE_CATEGORIES && e.newValue) {
      try {
        localCategories = JSON.parse(e.newValue);
        emit('categories_changed', localCategories);
      } catch (err) { }
    }
    if (e.key === KEYS.CACHE_SELLERS && e.newValue) {
      try {
        localSellers = JSON.parse(e.newValue);
        emit('sellers_changed', localSellers);
      } catch (err) { }
    }
    if (e.key === KEYS.CACHE_BLOG_POSTS && e.newValue) {
      try {
        localBlogPosts = JSON.parse(e.newValue);
        emit('blog_posts_changed', localBlogPosts);
      } catch (err) { }
    }
    if (e.key === KEYS.CACHE_PROMO_CODES && e.newValue) {
      try {
        localPromoCodes = JSON.parse(e.newValue);
        emit('promo_codes_changed', localPromoCodes);
      } catch (err) { }
    }
  });


  // ─── Mini-Store WhatsApp Inquiry Logger ─────────────────────
  /**
   * Called when a customer taps "Order on WhatsApp" on a mini-store product.
   * Creates a Firestore order record so the admin sees it, and 10% commission
   * is captured in the dashboard stats — without changing the customer UX at all.
   */
  async function logWhatsAppInquiry(product, seller) {
    try {
      const user = firebase.auth().currentUser;
      const discountPct = product.discount || 0;
      const finalPrice = discountPct > 0
        ? product.price * (1 - discountPct / 100)
        : product.price;

      // Use the seller's configured commission rate (decimal flexible, e.g. 7.5%), default 10%
      const commissionRate = (typeof seller.commission === 'number' ? seller.commission : 10) / 100;

      const generatedLabel = _generateOrderLabel();
      const orderData = {
        order_label: generatedLabel,
        order_number: '#WA-' + Math.floor(1000 + Math.random() * 9000), // Maintained for backwards compatibility
        order_method: 'whatsapp',
        status: 'pending',
        customer_uid: user ? user.uid : null,
        customer: {
          name: user ? (user.displayName || user.email.split('@')[0]) : 'WhatsApp Customer',
          phone: user ? (user.phoneNumber || '') : '',
          address: 'Via WhatsApp'
        },
        items: [{
          product_id: product.id,
          name: product.name,
          original_price: product.price,
          discount: discountPct,
          price: finalPrice,
          quantity: 1,
          image_url: (product.image_url || '').startsWith('data:') ? '' : (product.image_url || ''),
          seller_id: seller.id
        }],
        total_price: finalPrice,
        admin_commission: parseFloat((finalPrice * commissionRate).toFixed(2)),
        commission_rate: seller.commission ?? 10, // Store the rate used (%) for display in admin
        seller_id: seller.id,
        seller_name: seller.name,
        created_at: new Date().toISOString()
      };

      const docRef = await firebase.firestore().collection('orders').add(orderData);
      const orderWithId = { id: docRef.id, ...orderData };

      // Push into local cache so admin sees it without refresh
      localOrders.unshift(orderWithId);
      _saveToDiskCache();
      emit('orders_changed', localOrders);

      console.log('[KwabzStore] WhatsApp inquiry logged:', docRef.id);
      return orderWithId;
    } catch (err) {
      // Non-blocking — still open WhatsApp even if logging fails
      console.warn('[KwabzStore] Could not log WhatsApp inquiry:', err);
      return null;
    }
  }

  // ─── Review System ─────────────────────────────────────────
  // Per-product review cache: { [productId]: { data: [], ts: timestamp } }
  const _reviewCache = {};
  const _REVIEW_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async function getReviews(productId) {
    try {
      const now = Date.now();
      const cached = _reviewCache[productId];
      // Return from cache if still fresh
      if (cached && (now - cached.ts) < _REVIEW_CACHE_TTL) {
        return cached.data;
      }

      // Cache miss or stale — fetch from Firestore
      const snapshot = await firebase.firestore().collection('reviews')
        .where('product_id', '==', productId)
        .get();
      const reviews = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort in-memory to prevent requiring composite indices in Firebase console
      reviews.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));

      // Store in cache
      _reviewCache[productId] = { data: reviews, ts: now };
      return reviews;
    } catch (err) {
      console.error('[KwabzStore] Failed to fetch reviews:', err);
      return [];
    }
  }

  // Admin-only: fetch ALL reviews across every product.
  // Uses a single collection-level .get() and populates the per-product cache
  // so subsequent getReviews(productId) calls are served from memory.
  let _allReviewsCache = null;
  let _allReviewsCacheTs = 0;
  const _ALL_REVIEWS_TTL = 3 * 60 * 1000; // 3 minutes for admin panel

  async function getReviewsAll() {
    try {
      const now = Date.now();
      if (_allReviewsCache && (now - _allReviewsCacheTs) < _ALL_REVIEWS_TTL) {
        return _allReviewsCache;
      }

      const snapshot = await firebase.firestore().collection('reviews').get();
      const reviews = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      reviews.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));

      // Seed per-product cache while we have all the data
      const byProduct = {};
      reviews.forEach(r => {
        if (!byProduct[r.product_id]) byProduct[r.product_id] = [];
        byProduct[r.product_id].push(r);
      });
      Object.entries(byProduct).forEach(([pid, list]) => {
        _reviewCache[pid] = { data: list, ts: now };
      });

      _allReviewsCache = reviews;
      _allReviewsCacheTs = now;
      return reviews;
    } catch (err) {
      console.error('[KwabzStore] Failed to fetch all reviews:', err);
      return [];
    }
  }


  async function addReview(productId, rating, comment, photos = [], customerName = 'Anonymous') {
    try {
      const user = firebase.auth().currentUser;
      const uid = user ? user.uid : 'guest';

      // Check if user has purchased this product (Verified Purchase)
      // OPTIMIZATION: Check local userOrders cache first — zero Firestore reads.
      // Only fall back to a Firestore query if local cache is empty (e.g. first session).
      let verifiedPurchase = false;
      if (user) {
        try {
          const localCheck = userOrders.length > 0 ? userOrders : _loadUserOrdersFromLocal();
          verifiedPurchase = localCheck.some(order =>
            order.customer_uid === uid &&
            Array.isArray(order.items) &&
            order.items.some(item => (item.product_id || item.id) === productId)
          );

          // Fallback to Firestore ONLY if local cache is completely empty
          if (!verifiedPurchase && localCheck.length === 0) {
            const ordersSnapshot = await firebase.firestore().collection('orders')
              .where('customer_uid', '==', uid)
              .get();
            ordersSnapshot.forEach(doc => {
              const order = doc.data();
              if (Array.isArray(order.items)) {
                if (order.items.some(item => (item.product_id || item.id) === productId)) {
                  verifiedPurchase = true;
                }
              }
            });
          }
        } catch (e) {
          console.warn('[KwabzStore] Verified purchase lookup failed:', e);
        }
      }

      // Upload photos to Cloudinary if they are base64 strings
      const uploadedPhotos = [];
      if (Array.isArray(photos)) {
        for (const photo of photos) {
          if (photo && photo.startsWith('data:image/')) {
            try {
              const url = await KwabzUtils.uploadToCloudinary(photo);
              uploadedPhotos.push(url);
            } catch (uploadErr) {
              console.error('[Store] Failed to upload review photo to Cloudinary:', uploadErr);
              uploadedPhotos.push(photo);
            }
          } else {
            uploadedPhotos.push(photo);
          }
        }
      }

      const reviewData = {
        product_id: productId,
        user_id: uid,
        customer_name: customerName,
        rating: rating,
        comment: comment,
        photos: uploadedPhotos,
        likes: 0,
        liked_by: [], // List of user IDs who liked it
        verified_purchase: verifiedPurchase,
        created_at: new Date().toISOString()
      };

      const docRef = await firebase.firestore().collection('reviews').add(reviewData);
      const newReview = { id: docRef.id, ...reviewData };

      // Bust review cache so the product page and admin panel reflect the new review immediately
      delete _reviewCache[productId];
      _allReviewsCache = null;

      return newReview;
    } catch (err) {
      console.error('[KwabzStore] Failed to add review:', err);
      throw err;
    }
  }

  async function updateReview(reviewId, updates) {
    try {
      await firebase.firestore().collection('reviews').doc(reviewId).update(updates);
      // Bust cache
      _allReviewsCache = null;
      _reviewCache = {};
    } catch (err) {
      console.error('[KwabzStore] Failed to update review:', err);
      throw err;
    }
  }

  async function deleteReview(reviewId) {
    try {
      await firebase.firestore().collection('reviews').doc(reviewId).delete();
      // Bust cache
      _allReviewsCache = null;
      _reviewCache = {};
    } catch (err) {
      console.error('[KwabzStore] Failed to delete review:', err);
      throw err;
    }
  }

  async function toggleLikeReview(reviewId) {
    try {
      const user = firebase.auth().currentUser;
      if (!user) throw new Error('You must be signed in to like reviews.');
      const uid = user.uid;

      const docRef = firebase.firestore().collection('reviews').doc(reviewId);
      const doc = await docRef.get();
      if (!doc.exists) throw new Error('Review not found.');

      const data = doc.data();
      const likedBy = data.liked_by || [];
      const hasLiked = likedBy.includes(uid);

      let newLikes = data.likes || 0;
      let newLikedBy = [...likedBy];

      if (hasLiked) {
        newLikes = Math.max(0, newLikes - 1);
        newLikedBy = newLikedBy.filter(id => id !== uid);
      } else {
        newLikes += 1;
        newLikedBy.push(uid);
      }

      await docRef.update({
        likes: newLikes,
        liked_by: newLikedBy
      });

      return { likes: newLikes, hasLiked: !hasLiked };
    } catch (err) {
      console.error('[KwabzStore] Failed to like review:', err);
      throw err;
    }
  }

  function _setupPromoCodesListener() {
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    const db = firebase.firestore();
    if (unsubscribers.promoCodes) unsubscribers.promoCodes();

    if (isAdminLoggedIn()) {
      unsubscribers.promoCodes = db.collection('promo_codes')
        .onSnapshot(
          snapshot => {
            try {
              localPromoCodes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
              localPromoCodes.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));
              _saveToDiskCache();
              emit('promo_codes_changed', localPromoCodes);
              unsubscribers.sync.promoCodes = true;
            } catch (err) {
              console.error('[KwabzStore] Promo codes processing error:', err);
            }
          },
          err => {
            console.error('[KwabzStore] Promo codes snapshot failed:', err);
          }
        );
      return;
    }

    // Public users: TTL-gated fetch from cache or API
    const cacheAge = Date.now() - parseInt(localStorage.getItem(KEYS.CACHE_TIMESTAMP) || '0', 10);
    if (cacheAge <= CACHE_TTL && localPromoCodes.length > 0) {
      console.log('[KwabzStore] Promo codes: fresh cache — skipping network read.');
      unsubscribers.sync.promoCodes = true;
      return;
    }

    const apiUrl = (window.RENDER_API_BASE || '') + '/api/promo-codes';
    fetchWithTimeout(apiUrl, { timeout: 4000 })
      .then(res => { if (!res.ok) throw new Error('API failed'); return res.json(); })
      .then(data => {
        localPromoCodes = Array.isArray(data) ? data : [];
        localPromoCodes.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));
        _saveToDiskCache();
        emit('promo_codes_changed', localPromoCodes);
        unsubscribers.sync.promoCodes = true;
        console.log('[KwabzStore] Promo codes fetched from Render API (0 Firestore reads!).');
      })
      .catch(err => {
        console.warn('[KwabzStore] Render API failed for promo codes, falling back to Firestore...', err);
        db.collection('promo_codes').get()
          .then(snapshot => {
            localPromoCodes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            localPromoCodes.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));
            _saveToDiskCache();
            emit('promo_codes_changed', localPromoCodes);
            unsubscribers.sync.promoCodes = true;
          })
          .catch(e => {
            console.error('[KwabzStore] Promo fallback get failed:', e);
            unsubscribers.sync.promoCodes = true;
          });
      });
  }

  function getPromoCodes() {
    return localPromoCodes;
  }

  async function addPromoCode(promoData) {
    if (!promoData.code || !promoData.discount_value) {
      throw new Error('Code and discount value are required.');
    }
    const codeUpper = promoData.code.trim().toUpperCase();

    // Check duplicates locally
    const existing = localPromoCodes.find(p => p.code === codeUpper);
    if (existing) {
      throw new Error(`Promo code "${codeUpper}" already exists.`);
    }

    try {
      if (!isAdminLoggedIn()) throw new Error("Admin access required");

      const db = firebase.firestore();
      const docRef = db.collection('promo_codes').doc();

      const newDoc = {
        code: codeUpper,
        discount_type: promoData.discount_type || 'percent',
        discount_value: parseFloat(promoData.discount_value),
        min_order_value: parseFloat(promoData.min_order_value || 0),
        applicable_products: promoData.applicable_products || [],
        cash_limit: promoData.cash_limit ? parseFloat(promoData.cash_limit) : null,
        total_discounted: 0,
        active: promoData.active !== false,
        created_at: new Date().toISOString()
      };

      const promoWithId = { id: docRef.id, ...newDoc };

      localPromoCodes.unshift(promoWithId);
      _saveToDiskCache();
      emit('promo_codes_changed', localPromoCodes);

      await docRef.set(newDoc);
      return promoWithId;
    } catch (err) {
      console.error('[KwabzStore] addPromoCode error:', err);
      throw err;
    }
  }

  async function deletePromoCode(id) {
    if (!isAdminLoggedIn()) throw new Error('Admin access required to delete promo codes.');
    try {
      await firebase.firestore().collection('promo_codes').doc(id).delete();
      localPromoCodes = localPromoCodes.filter(p => p.id !== id);
      _saveToDiskCache();
      emit('promo_codes_changed', localPromoCodes);
      return true;
    } catch (err) {
      console.error('[KwabzStore] Delete promo code error:', err);
      throw err;
    }
  }

  async function updatePromoCode(id, promoData) {
    if (!isAdminLoggedIn()) throw new Error('Admin access required to update promo codes.');
    if (!id || !promoData.code || !promoData.discount_value) {
      throw new Error('ID, Code and discount value are required.');
    }
    const codeUpper = promoData.code.trim().toUpperCase();

    // Check duplicates locally (excluding ourselves)
    const existing = localPromoCodes.find(p => p.code === codeUpper && p.id !== id);
    if (existing) {
      throw new Error(`Promo code "${codeUpper}" already exists.`);
    }

    try {
      const db = firebase.firestore();
      const docRef = db.collection('promo_codes').doc(id);

      const updates = {
        code: codeUpper,
        discount_type: promoData.discount_type || 'percent',
        discount_value: parseFloat(promoData.discount_value),
        min_order_value: parseFloat(promoData.min_order_value || 0),
        applicable_products: promoData.applicable_products || [],
        cash_limit: promoData.cash_limit ? parseFloat(promoData.cash_limit) : null,
        active: promoData.active !== false
      };

      await docRef.update(updates);

      // Update local state
      const idx = localPromoCodes.findIndex(p => p.id === id);
      if (idx !== -1) {
        localPromoCodes[idx] = { ...localPromoCodes[idx], ...updates };
        _saveToDiskCache();
        emit('promo_codes_changed', localPromoCodes);
      }
      return localPromoCodes[idx];
    } catch (err) {
      console.error('[KwabzStore] updatePromoCode error:', err);
      throw err;
    }
  }

  // ─── Data Bundles Management ───
  const DEFAULT_BUNDLES = [
    { network: 'mtn', name: '1.5 GB', price: 10.00, validity: '30 Days' },
    { network: 'mtn', name: '3 GB', price: 20.00, validity: '30 Days' },
    { network: 'mtn', name: '10 GB', price: 50.00, validity: 'No Expiry' },
    { network: 'mtn', name: '25 GB', price: 100.00, validity: 'No Expiry' },
    { network: 'mtn', name: '60 GB', price: 200.00, validity: 'No Expiry' },
    { network: 'telecel', name: '2 GB', price: 10.00, validity: '30 Days' },
    { network: 'telecel', name: '5 GB', price: 20.00, validity: '30 Days' },
    { network: 'telecel', name: '15 GB', price: 50.00, validity: 'No Expiry' },
    { network: 'telecel', name: '35 GB', price: 100.00, validity: 'No Expiry' },
    { network: 'telecel', name: '80 GB', price: 200.00, validity: 'No Expiry' }
  ];

  function _setupBundlesListener() {
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    const db = firebase.firestore();
    if (unsubscribers.bundles) unsubscribers.bundles();

    unsubscribers.bundles = db.collection('bundles')
      .onSnapshot(
        async snapshot => {
          try {
            if (snapshot.empty) {
              if (isAdminLoggedIn()) {
                console.log('[KwabzStore] Bundles collection empty. Seeding defaults...');
                const batch = db.batch();
                DEFAULT_BUNDLES.forEach(b => {
                  const docRef = db.collection('bundles').doc();
                  batch.set(docRef, { ...b, created_at: new Date().toISOString() });
                });
                await batch.commit();
              }
              return;
            }
            localBundles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            localBundles.sort((a, b) => {
              if (a.network !== b.network) return a.network.localeCompare(b.network);
              return a.price - b.price;
            });
            _saveToDiskCache();
            emit('bundles_changed', localBundles);
          } catch (err) {
            console.error('[KwabzStore] Bundles processing error:', err);
          }
        },
        err => {
          console.error('[KwabzStore] Bundles snapshot failed:', err);
        }
      );
  }

  function getBundles() {
    return localBundles;
  }

  async function addBundle(data) {
    if (!data.network || !data.name || !data.price || !data.validity) {
      throw new Error('All bundle fields are required.');
    }
    try {
      if (!isAdminLoggedIn()) throw new Error("Admin access required");
      const db = firebase.firestore();
      const newDoc = {
        network: data.network.trim().toLowerCase(),
        name: data.name.trim(),
        price: parseFloat(data.price),
        validity: data.validity.trim(),
        created_at: new Date().toISOString()
      };
      const docRef = await db.collection('bundles').add(newDoc);
      const bundleWithId = { id: docRef.id, ...newDoc };
      localBundles.push(bundleWithId);
      localBundles.sort((a, b) => {
        if (a.network !== b.network) return a.network.localeCompare(b.network);
        return a.price - b.price;
      });
      _saveToDiskCache();
      emit('bundles_changed', localBundles);
      return bundleWithId;
    } catch (err) {
      console.error('[KwabzStore] Add bundle error:', err);
      throw err;
    }
  }

  async function updateBundle(id, updates) {
    try {
      if (!isAdminLoggedIn()) throw new Error("Admin access required");
      const db = firebase.firestore();
      if (updates.price) updates.price = parseFloat(updates.price);
      await db.collection('bundles').doc(id).update(updates);
      const idx = localBundles.findIndex(b => b.id === id);
      if (idx !== -1) {
        localBundles[idx] = { ...localBundles[idx], ...updates };
        localBundles.sort((a, b) => {
          if (a.network !== b.network) return a.network.localeCompare(b.network);
          return a.price - b.price;
        });
        _saveToDiskCache();
        emit('bundles_changed', localBundles);
      }
      return true;
    } catch (err) {
      console.error('[KwabzStore] Update bundle error:', err);
      throw err;
    }
  }

  async function deleteBundle(id) {
    try {
      if (!isAdminLoggedIn()) throw new Error("Admin access required");
      const db = firebase.firestore();
      await db.collection('bundles').doc(id).delete();
      localBundles = localBundles.filter(b => b.id !== id);
      _saveToDiskCache();
      emit('bundles_changed', localBundles);
      return true;
    } catch (err) {
      console.error('[KwabzStore] Delete bundle error:', err);
      throw err;
    }
  }

  // ─── Broadcasts ─────────────────────────────────────────────
  let localBroadcasts = [];

  function _setupBroadcastsListener() {
    if (typeof firebase === 'undefined' || !firebase.firestore) return;
    const db = firebase.firestore();
    if (unsubscribers.broadcasts) unsubscribers.broadcasts();

    if (isAdminLoggedIn()) {
      unsubscribers.broadcasts = db.collection('broadcasts')
        .onSnapshot(
          snapshot => {
            try {
              localBroadcasts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
              localBroadcasts.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));
              emit('broadcasts_changed', localBroadcasts);
            } catch (err) {
              console.error('[KwabzStore] Broadcasts processing error:', err);
            }
          },
          err => {
            console.error('[KwabzStore] Broadcasts snapshot failed:', err);
          }
        );
      return;
    }

    // Public users: fetch from API
    const apiUrl = (window.RENDER_API_BASE || '') + '/api/broadcasts';
    fetchWithTimeout(apiUrl, { timeout: 4000 })
      .then(res => { if (!res.ok) throw new Error('API failed'); return res.json(); })
      .then(data => {
        localBroadcasts = Array.isArray(data) ? data : [];
        localBroadcasts.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));
        emit('broadcasts_changed', localBroadcasts);
        console.log('[KwabzStore] Broadcasts fetched from Render API (0 Firestore reads!).');
      })
      .catch(err => {
        console.warn('[KwabzStore] Render API failed for broadcasts, falling back to Firestore...', err);
        db.collection('broadcasts').get()
          .then(snapshot => {
            localBroadcasts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            localBroadcasts.sort((a, b) => _getSafeTime(b.created_at) - _getSafeTime(a.created_at));
            emit('broadcasts_changed', localBroadcasts);
          })
          .catch(e => console.error('[KwabzStore] Broadcasts fallback get failed:', e));
      });
  }

  function getBroadcasts() {
    return localBroadcasts;
  }

  async function addBroadcast(message, promoCode = null) {
    if (!message) throw new Error('Message is required.');
    try {
      if (!isAdminLoggedIn()) throw new Error("Admin access required");
      const db = firebase.firestore();
      const docRef = db.collection('broadcasts').doc();
      const newDoc = {
        message: message,
        promo_code: promoCode || null,
        created_at: new Date().toISOString()
      };
      await docRef.set(newDoc);
      return { id: docRef.id, ...newDoc };
    } catch (err) {
      console.error('[KwabzStore] addBroadcast error:', err);
      throw err;
    }
  }

  async function updateBroadcast(id, message, promoCode = null) {
    try {
      if (!isAdminLoggedIn()) throw new Error("Admin access required");
      const db = firebase.firestore();
      await db.collection('broadcasts').doc(id).update({
        message: message,
        promo_code: promoCode || null,
        updated_at: new Date().toISOString()
      });
      return true;
    } catch (err) {
      console.error('[KwabzStore] updateBroadcast error:', err);
      throw err;
    }
  }

  async function deleteBroadcast(id) {
    try {
      if (!isAdminLoggedIn()) throw new Error("Admin access required");
      await firebase.firestore().collection('broadcasts').doc(id).delete();
      return true;
    } catch (err) {
      console.error('[KwabzStore] deleteBroadcast error:', err);
      throw err;
    }
  }

  // ─── Chat ───────────────────────────────────────────────────
  function onUserChats(userId, callback) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return () => { };
    const db = firebase.firestore();
    return db.collection('user_chats')
      .where('user_id', '==', userId)
      .onSnapshot(
        snapshot => {
          const chats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          chats.sort((a, b) => _getSafeTime(a.created_at) - _getSafeTime(b.created_at));
          callback(chats);
        },
        err => {
          console.error('[KwabzStore] onUserChats failed:', err);
        }
      );
  }

  function onAllUserChats(callback) {
    if (typeof firebase === 'undefined' || !firebase.firestore) return () => { };
    const db = firebase.firestore();
    return db.collection('user_chats')
      .onSnapshot(
        snapshot => {
          const chats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          chats.sort((a, b) => _getSafeTime(a.created_at) - _getSafeTime(b.created_at));
          callback(chats);
        },
        err => {
          console.error('[KwabzStore] onAllUserChats failed:', err);
        }
      );
  }

  async function sendChatMessage(userId, sender, senderName, message, promoCode = null, imageUrl = null) {
    if (!message && !imageUrl) throw new Error('Message or image is required.');
    try {
      let finalImageUrl = imageUrl;
      if (imageUrl && imageUrl.startsWith('data:image/')) {
        try {
          finalImageUrl = await KwabzUtils.uploadToCloudinary(imageUrl);
        } catch (uploadErr) {
          console.error('[Store] Failed to upload chat image to Cloudinary:', uploadErr);
        }
      }
      const db = firebase.firestore();
      const docRef = db.collection('user_chats').doc();
      const newDoc = {
        user_id: userId,
        sender: sender, // 'user' or 'admin'
        sender_name: senderName,
        message: message || '',
        promo_code: promoCode || null,
        image_url: finalImageUrl || null,
        created_at: new Date().toISOString()
      };
      await docRef.set(newDoc);
      return { id: docRef.id, ...newDoc };
    } catch (err) {
      console.error('[KwabzStore] sendChatMessage error:', err);
      throw err;
    }
  }

  async function updateChatMessage(id, message, promoCode = null) {
    try {
      const db = firebase.firestore();
      await db.collection('user_chats').doc(id).update({
        message: message,
        promo_code: promoCode || null,
        updated_at: new Date().toISOString()
      });
      return true;
    } catch (err) {
      console.error('[KwabzStore] updateChatMessage error:', err);
      throw err;
    }
  }

  async function deleteChatMessage(id) {
    try {
      const db = firebase.firestore();
      await db.collection('user_chats').doc(id).delete();
      return true;
    } catch (err) {
      console.error('[KwabzStore] deleteChatMessage error:', err);
      throw err;
    }
  }


  return {
    // Core
    init, on, off, emit, refreshAll, getSyncStatus, generateId, isInitialized: () => isFirestoreInitialized,

    // Real-time Data
    getProducts, getAllProducts, getCategories, getOrders,
    getProductById, getCategoryById, getSellerById, getProductsByCategory,
    getAllProductsByCategory,

    // Product Management
    addProduct, updateProduct, deleteProduct, toggleProductStock,

    // Category Management
    addCategory, updateCategory, deleteCategory,

    // Promo Code Management
    getPromoCodes, addPromoCode, updatePromoCode, deletePromoCode,
    getBroadcasts, addBroadcast, updateBroadcast, deleteBroadcast,
    onUserChats, onAllUserChats, sendChatMessage, updateChatMessage, deleteChatMessage,

    // Data Bundles Management
    getBundles, addBundle, updateBundle, deleteBundle,

    // Blog Management
    getBlogPosts, addBlogPost, updateBlogPost, deleteBlogPost,
    incrementBlogPostViews, toggleLikeBlogPost, getBlogComments, addBlogComment,
    trackPageView,

    // Seller Management
    getSellers, addSeller, updateSeller, deleteSeller,
    getProductsBySeller,

    // Cart (Firestore-backed when logged in)
    getCart, addToCart, removeFromCart, updateCartQuantity,
    clearCart, getCartTotal, getCartItemCount,
    getWishlist, addToWishlist, removeFromWishlist, toggleWishlist, isInWishlist, clearWishlist,

    // Admin Orders
    createOrder, addOrder, updateOrderStatus, getOrderById,
    deleteOrder, cancelOrder,

    // User Order History (local + real-time)
    getUserOrders, removeOrderFromHistory,

    // Firebase Auth
    emailSignUp, googleSignIn, emailLogin, logout, getCurrentUser, getUserRole,

    // Legacy Admin Auth
    adminLogin, verifyAdminMfa, adminLogout, isAdminLoggedIn,

    // Social
    sendOrderViaWhatsApp, sendStatusUpdateViaWhatsApp,
    searchProducts, logWhatsAppInquiry,

    // Settings
    getSettings, updateSettings,

    // Sync Status
    getSyncStatus, isAuthReady,

    // Admin & Presence
    onAdminsPresence, registerAdmin, refreshPresence, deleteAdmin,

    // Visitor Tracking
    trackVisitor, onVisitorCount,

    // Reviews
    getReviews, getReviewsAll, addReview, updateReview, deleteReview, toggleLikeReview
  };
})();

// Load Cache Immediately upon Script Load for zero-latency UI access, and auto-initialize if Firebase is loaded
if (typeof KwabzStore !== 'undefined') {
  if (typeof firebase !== 'undefined' && firebase.firestore) {
    KwabzStore.init();
  } else {
    // Retry initializing every 250ms until Firebase SDK is fully loaded from network
    const _initInterval = setInterval(() => {
      if (typeof firebase !== 'undefined' && firebase.firestore) {
        console.log('[KwabzStore] Firebase SDK resolved. Initializing store now...');
        KwabzStore.init();
        clearInterval(_initInterval);
      }
    }, 250);
    // Safety timeout: stop trying after 10 seconds
    setTimeout(() => clearInterval(_initInterval), 10000);
  }
}
