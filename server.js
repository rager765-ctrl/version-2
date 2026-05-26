import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { createClient } from 'redis';

// Load Config
dotenv.config();

const PORT = process.env.PORT || 5000;
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT || './firebase-service-account.json';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ─── Initialize Firebase Admin SDK ─────────────────────────
let db = null;
let isFirebaseOnline = false;

try {
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    isFirebaseOnline = true;
    console.log('✅ Firebase Admin connected successfully in backend.');
  } else {
    console.warn('⚠️  firebase-service-account.json not found! Running in Mock fallback mode.');
    console.warn('👉 Place your Firebase Service Account JSON in the path specified by FIREBASE_SERVICE_ACCOUNT.');
  }
} catch (err) {
  console.error('❌ Firebase connection error in backend:', err.message);
  console.warn('⚠️  Falling back to Mock/Preview mode.');
}

// ─── Mock Fallbacks (Prevent server crashes if offline) ──────
const mockData = {
  products: [],
  categories: [],
  sellers: [],
  settings: { theme: { primary: '#6200ee' } }
};

// ─── In-Memory Server Cache ──────────────────────────────────
const cache = {
  products: [],
  categories: [],
  sellers: [],
  settings: {},
  reviews: {} // productId -> reviews array
};

// ─── Initialize Redis client (Optional cache backend) ─────────
const REDIS_URL = process.env.REDIS_URL;
let redisClient = null;
let isRedisOnline = false;

if (REDIS_URL) {
  try {
    console.log('📡 Attempting to connect to Redis cache backend...');
    redisClient = createClient({ url: REDIS_URL });
    
    redisClient.on('error', (err) => {
      console.warn('⚠️  Redis Client Error:', err.message);
      isRedisOnline = false;
    });
    
    redisClient.on('connect', () => {
      console.log('✅ Connected to Redis cache backend successfully.');
      isRedisOnline = true;
    });

    await redisClient.connect();
  } catch (err) {
    console.warn('⚠️  Redis connection failed. Falling back to local memory cache.', err.message);
    isRedisOnline = false;
  }
} else {
  console.log('ℹ️  No REDIS_URL configured. Using local in-memory store.');
}

// ─── Redis & local Cache Helpers ──────────────────────────────
const cacheKeys = {
  products: 'kwabz:products',
  categories: 'kwabz:categories',
  sellers: 'kwabz:sellers',
  settings: 'kwabz:settings',
  reviews: (productId) => `kwabz:reviews:${productId}`
};

async function setCacheValue(key, value, ttlSeconds = null) {
  // Always update our local memory cache as local fallback
  if (key === cacheKeys.products) cache.products = value;
  else if (key === cacheKeys.categories) cache.categories = value;
  else if (key === cacheKeys.sellers) cache.sellers = value;
  else if (key === cacheKeys.settings) cache.settings = value;
  else if (key.startsWith('kwabz:reviews:')) {
    const prodId = key.replace('kwabz:reviews:', '');
    cache.reviews[prodId] = { data: value, ts: Date.now() };
  }

  // Update Redis if online
  if (isRedisOnline && redisClient) {
    try {
      const dataStr = JSON.stringify(value);
      if (ttlSeconds) {
        await redisClient.set(key, dataStr, { EX: ttlSeconds });
      } else {
        await redisClient.set(key, dataStr);
      }
    } catch (err) {
      console.warn(`[Redis Cache] Write failed for key: ${key}`, err.message);
    }
  }
}

async function getCacheValue(key, fallbackLocalValue) {
  if (isRedisOnline && redisClient) {
    try {
      const data = await redisClient.get(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch (err) {
      console.warn(`[Redis Cache] Read failed for key: ${key}`, err.message);
    }
  }
  return fallbackLocalValue;
}

// ─── Visitor Registry (Managed 100% in server memory!) ───────
// Key: visitorId, Value: { uid, page, lastActive, displayName }
const activeVisitors = new Map();

// Helper to get safe numeric timestamp
function getSafeTime(val) {
  if (!val) return 0;
  if (typeof val.toDate === 'function') {
    try { return val.toDate().getTime(); } catch (e) { return 0; }
  }
  if (typeof val === 'number') return val;
  if (val.seconds) return val.seconds * 1000;
  const t = new Date(val).getTime();
  return isNaN(t) ? 0 : t;
}

// ─── background live-sync listeners (exactly 1 read path per server process) ───
let unsubscribers = {
  products: null,
  categories: null,
  sellers: null,
  settings: null
};

function setupBackgroundSync() {
  if (!isFirebaseOnline || !db) {
    console.warn('⚠️  Mock data fallback enabled (Database offline).');
    return;
  }

  console.log('🔄 Setting up background Firestore Live-Sync listeners...');

  // 1. Live Products Listener
  unsubscribers.products = db.collection('products')
    .onSnapshot(async snapshot => {
      console.log(`[Firestore Sync] products collection updated. Syncing ${snapshot.size} items.`);
      const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // In-memory sort by created_at desc
      products.sort((a, b) => getSafeTime(b.created_at) - getSafeTime(a.created_at));
      await setCacheValue(cacheKeys.products, products);
      // Broadcast real-time change to all connected socket clients (0 Firestore read cost!)
      io.emit('products_changed', cache.products);
    }, err => {
      console.error('[Firestore Sync] Products snapshot failed:', err.message);
    });

  // 2. Live Categories Listener
  unsubscribers.categories = db.collection('categories')
    .onSnapshot(async snapshot => {
      console.log(`[Firestore Sync] categories collection updated. Syncing ${snapshot.size} items.`);
      const categories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      await setCacheValue(cacheKeys.categories, categories);
      io.emit('categories_changed', cache.categories);
    }, err => {
      console.error('[Firestore Sync] Categories snapshot failed:', err.message);
    });

  // 3. Live Sellers Listener
  unsubscribers.sellers = db.collection('sellers')
    .onSnapshot(async snapshot => {
      console.log(`[Firestore Sync] sellers collection updated. Syncing ${snapshot.size} items.`);
      const sellers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      await setCacheValue(cacheKeys.sellers, sellers);
      io.emit('sellers_changed', cache.sellers);
    }, err => {
      console.error('[Firestore Sync] Sellers snapshot failed:', err.message);
    });

  // 4. Live Settings Document Listener
  unsubscribers.settings = db.collection('settings').doc('global')
    .onSnapshot(async doc => {
      if (doc.exists) {
        console.log('[Firestore Sync] Global Settings document updated.');
        await setCacheValue(cacheKeys.settings, doc.data());
        io.emit('settings_changed', cache.settings);
      }
    }, err => {
      console.error('[Firestore Sync] Settings snapshot failed:', err.message);
    });
}

// ─── Memory Visitor Heartbeat Sweep Task ─────────────────────
// Sweeps the visitor registry every 30 seconds and removes any inactive past 15 minutes.
setInterval(() => {
  const now = Date.now();
  const threshold = 15 * 60 * 1000; // 15 mins
  let changed = false;

  for (const [key, value] of activeVisitors.entries()) {
    if (now - value.lastActive > threshold) {
      activeVisitors.delete(key);
      changed = true;
      console.log(`🧹 Visitor timed out: ${key}`);
    }
  }

  if (changed) {
    // Notify all connected dashboard clients of updated visitor count in real time
    io.emit('visitor_count_updated', activeVisitors.size);
  }
}, 30000);

// ─── REST API Routes ──────────────────────────────────────────

// 0. Professional Status Landing Page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Kwabz Store API — Online</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background: #0f172a;
          color: #f8fafc;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          text-align: center;
        }
        .container {
          background: #1e293b;
          padding: 2.5rem;
          border-radius: 16px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.3);
          max-width: 480px;
          border: 1px solid #334155;
        }
        .icon {
          font-size: 3rem;
          margin-bottom: 1rem;
          display: inline-block;
          animation: pulse 2s infinite ease-in-out;
        }
        h1 {
          font-size: 1.5rem;
          margin: 0 0 0.5rem 0;
          color: #38bdf8;
        }
        p {
          color: #94a3b8;
          font-size: 0.875rem;
          line-height: 1.5;
          margin: 0 0 1.5rem 0;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: #166534;
          color: #4ade80;
          font-weight: bold;
          font-size: 0.75rem;
          padding: 0.35rem 0.75rem;
          border-radius: 9999px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .pulse-dot {
          width: 8px;
          height: 8px;
          background: #4ade80;
          border-radius: 50%;
          display: inline-block;
          box-shadow: 0 0 8px #4ade80;
          animation: blink 1.5s infinite;
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        @keyframes blink {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">🚀</div>
        <h1>Kwabz Store API</h1>
        <p>Your custom high-performance Node.js caching & optimization server is fully operational and syncing with Cloud Firestore in the background.</p>
        <span class="badge"><span class="pulse-dot"></span> Server Online</span>
      </div>
    </body>
    </html>
  `);
});

// 1. Healthcheck
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    firebase: isFirebaseOnline ? 'connected' : 'fallback_mock',
    cacheSizes: {
      products: cache.products.length,
      categories: cache.categories.length,
      sellers: cache.sellers.length
    },
    activeVisitors: activeVisitors.size
  });
});

// 2. Fetch Products (Serves instantly from memory cache!)
app.get('/api/products', (req, res) => {
  res.json(cache.products.length > 0 ? cache.products : mockData.products);
});

// 3. Fetch Categories
app.get('/api/categories', (req, res) => {
  res.json(cache.categories.length > 0 ? cache.categories : mockData.categories);
});

// 4. Fetch Sellers
app.get('/api/sellers', (req, res) => {
  res.json(cache.sellers.length > 0 ? cache.sellers : mockData.sellers);
});

// 5. Fetch Settings
app.get('/api/settings', (req, res) => {
  res.json(Object.keys(cache.settings).length > 0 ? cache.settings : mockData.settings);
});

// 6. Visitor Heartbeat Endpoint (COMPLETELY replaces Firestore visitor database writes!)
app.post('/api/visitors/heartbeat', (req, res) => {
  const { visitorId, uid, page, displayName } = req.body;
  if (!visitorId) {
    return res.status(400).json({ error: 'visitorId is required' });
  }

  const prevSize = activeVisitors.size;
  activeVisitors.set(visitorId, {
    uid: uid || null,
    page: page || 'index.html',
    displayName: displayName || null,
    lastActive: Date.now()
  });

  // If visitor count changed, notify sockets
  if (activeVisitors.size !== prevSize) {
    io.emit('visitor_count_updated', activeVisitors.size);
  }

  res.json({ success: true, activeCount: activeVisitors.size });
});

// 7. Get Active Visitor Count
app.get('/api/visitor-count', (req, res) => {
  res.json({ count: activeVisitors.size });
});

// 8. Order Placement Proxy
app.post('/api/orders', async (req, res) => {
  if (!isFirebaseOnline || !db) {
    return res.status(503).json({ error: 'Database service is unavailable' });
  }
  try {
    const orderData = req.body;
    orderData.created_at = orderData.created_at || new Date().toISOString();
    const docRef = await db.collection('orders').add(orderData);
    res.status(201).json({ id: docRef.id, ...orderData });
  } catch (err) {
    console.error('Failed to create order:', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. Admin Fetch Orders (Capped to 100 to prevent read explosion!)
app.get('/api/orders', async (req, res) => {
  if (!isFirebaseOnline || !db) {
    return res.status(503).json({ error: 'Database service is unavailable' });
  }
  try {
    const limit = parseInt(req.query.limit) || 100;
    const snap = await db.collection('orders')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get();
    const orders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(orders);
  } catch (err) {
    console.error('Failed to fetch orders:', err);
    res.status(500).json({ error: err.message });
  }
});

// 10. Fetch Product Reviews (With in-memory/Redis caching)
app.get('/api/reviews/:productId', async (req, res) => {
  const { productId } = req.params;
  const key = cacheKeys.reviews(productId);

  // Try fetching from cache (Redis or local memory fallback)
  const cachedData = await getCacheValue(key, null);
  if (cachedData) {
    return res.json(cachedData);
  }

  // Serve from local memory as secondary fallback check
  const now = Date.now();
  const cachedLocal = cache.reviews[productId];
  if (cachedLocal && (now - cachedLocal.ts) < 5 * 60 * 1000) {
    return res.json(cachedLocal.data);
  }

  if (!isFirebaseOnline || !db) {
    return res.json([]);
  }

  try {
    const snap = await db.collection('reviews')
      .where('product_id', '==', productId)
      .get();
    const reviews = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    reviews.sort((a, b) => getSafeTime(b.created_at) - getSafeTime(a.created_at));
    
    // Store in cache (with 5-minute TTL)
    await setCacheValue(key, reviews, 5 * 60);
    res.json(reviews);
  } catch (err) {
    console.error('Failed to fetch reviews:', err);
    res.status(500).json({ error: err.message });
  }
});

// 11. Add Review
app.post('/api/reviews', async (req, res) => {
  if (!isFirebaseOnline || !db) {
    return res.status(503).json({ error: 'Database service is unavailable' });
  }
  try {
    const reviewData = req.body;
    reviewData.created_at = reviewData.created_at || new Date().toISOString();
    const docRef = await db.collection('reviews').add(reviewData);
    
    // Invalidate product reviews cache in local RAM and Redis
    delete cache.reviews[reviewData.product_id];
    if (isRedisOnline && redisClient) {
      try {
        await redisClient.del(cacheKeys.reviews(reviewData.product_id));
      } catch (err) {
        console.warn('[Redis Cache] Failed to invalidate reviews key:', err.message);
      }
    }
    
    res.status(201).json({ id: docRef.id, ...reviewData });
  } catch (err) {
    console.error('Failed to add review:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── WebSocket Event Handling ─────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Client connected to Socket.IO: ${socket.id}`);
  
  // Send active visitor count immediately to new dashboards
  socket.emit('visitor_count_updated', activeVisitors.size);

  // Send caches immediately so they don't wait for a background tick
  if (cache.products.length > 0) socket.emit('products_changed', cache.products);
  if (cache.categories.length > 0) socket.emit('categories_changed', cache.categories);
  if (cache.sellers.length > 0) socket.emit('sellers_changed', cache.sellers);
  if (Object.keys(cache.settings).length > 0) socket.emit('settings_changed', cache.settings);

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected from Socket.IO: ${socket.id}`);
  });
});

// ─── Render 24/7 Keep-Alive Self-Ping ─────────────────────────
// Free Render instances spin down after 15 minutes of inactivity.
// We ping our own public URL every 10 minutes to keep the instance active and warm!
const SELF_URL = process.env.SELF_URL || `https://kwabz-store-backend.onrender.com`;
if (SELF_URL) {
  console.log(`📡 Keep-Alive configured. Warming self-pings enabled for: ${SELF_URL}`);
  setInterval(async () => {
    try {
      const res = await fetch(`${SELF_URL}/api/health`);
      console.log(`[Keep-Alive] Sent warming ping to self. Status: ${res.status}`);
    } catch (err) {
      console.warn(`[Keep-Alive] Self-ping failed:`, err.message);
    }
  }, 10 * 60 * 1000); // Every 10 minutes
}

// Start Server
httpServer.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 Kwabz Store Optimization API Server Online!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🛡️  Live-Sync Engine listening to Firestore...`);
  console.log(`===================================================`);
  setupBackgroundSync();
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('Gracefully shutting down...');
  if (unsubscribers.products) unsubscribers.products();
  if (unsubscribers.categories) unsubscribers.categories();
  if (unsubscribers.sellers) unsubscribers.sellers();
  if (unsubscribers.settings) unsubscribers.settings();
  httpServer.close(() => {
    console.log('Server process terminated.');
    process.exit(0);
  });
});
