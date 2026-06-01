import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import http from 'http';
import https from 'https';

// Get script file directory to resolve relative files consistently
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Environment Config explicitly from bot directory
dotenv.config({ path: path.join(__dirname, '.env') });

const ADMIN_PHONE = process.env.ADMIN_PHONE || '233509663058';
const STORE_URL = process.env.STORE_URL || 'https://kwabz-store-v2.vercel.app';
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT || path.join(__dirname, 'firebase-service-account.json');

console.log('===================================================');
console.log('      KWABZ STORE AUTOMATION WHATSAPP BOT          ');
console.log('===================================================');

// ─── Initialize Firebase Firestore ───
let db = null;
let isFirebaseOnline = false;

// Mock database to fallback gracefully so the bot NEVER crashes if Firebase JSON is missing
const mockDB = {
  products: [
    { id: '1', name: 'Kwabz Special Rice', price: 45.00, category_id: 'food', description: 'Our signature hot-and-spicy rice platter.' },
    { id: '2', name: 'Premium Hoodie', price: 120.00, category_id: 'clothing', description: '100% thick premium cotton hoodie.' },
    { id: '3', name: 'Ice Cold Lemonade', price: 15.00, category_id: 'drinks', description: 'Freshly squeezed lemonade with mint.' }
  ],
  categories: [
    { id: 'food', name: 'Foods & Platter' },
    { id: 'clothing', name: 'Apparels & Wear' },
    { id: 'drinks', name: 'Beverages' }
  ],
  orders: {
    'KBZ-ABC': { order_number: '#1001', customer: { name: 'Kelvin' }, total_price: 180.00, status: 'pending', items: [{ name: 'Premium Hoodie', quantity: 1 }] },
    'KBZ-XYZ': { order_number: '#1002', customer: { name: 'Ama' }, total_price: 45.00, status: 'completed', items: [{ name: 'Kwabz Special Rice', quantity: 1 }] }
  }
};

try {
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    isFirebaseOnline = true;
    console.log('✅ Firebase Admin connected successfully.');
  } else {
    console.warn(`⚠️  firebase-service-account.json not found at ${SERVICE_ACCOUNT_PATH}! Running in MOCK/PREVIEW mode.`);
    console.warn('👉 Place your Firebase Service Account JSON file in this directory to connect real-time data.');
  }
} catch (err) {
  console.error('❌ Firebase connection error:', err.message);
  console.warn('⚠️  Falling back to MOCK/PREVIEW mode.');
}

// ─── Helper Functions ───
async function getProducts() {
  if (isFirebaseOnline && db) {
    try {
      const snap = await db.collection('products').limit(10).get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch(e) {
      console.error('Firestore getProducts error, using mock:', e.message);
    }
  }
  return mockDB.products;
}

async function getCategories() {
  if (isFirebaseOnline && db) {
    try {
      const snap = await db.collection('categories').get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch(e) {
      console.error('Firestore getCategories error, using mock:', e.message);
    }
  }
  return mockDB.categories;
}

async function trackOrder(refId) {
  const cleanId = refId.trim();
  const cleanIdUpper = cleanId.toUpperCase();
  if (isFirebaseOnline && db) {
    try {
      // 1. Try checking by document ID directly (case sensitive/exact)
      let snap = await db.collection('orders').doc(cleanId).get();
      if (snap.exists) return snap.data();

      // 2. Try querying by order_label (e.g. KBZ-202605-1002)
      let querySnap = await db.collection('orders').where('order_label', '==', cleanIdUpper).limit(1).get();
      if (!querySnap.empty) return querySnap.docs[0].data();

      // 3. Try querying by order_number (e.g. #1002 or 1002)
      let hashNum = cleanIdUpper.startsWith('#') ? cleanIdUpper : '#' + cleanIdUpper;
      querySnap = await db.collection('orders').where('order_number', '==', hashNum).limit(1).get();
      if (!querySnap.empty) return querySnap.docs[0].data();

      // 4. Try querying by ref_id (numeric, e.g. 123456)
      const numRef = parseInt(cleanId, 10);
      if (!isNaN(numRef)) {
        querySnap = await db.collection('orders').where('ref_id', '==', numRef).limit(1).get();
        if (!querySnap.empty) return querySnap.docs[0].data();
      }

      // No match found in Firestore
      return null;
    } catch (e) {
      console.error('Firestore trackOrder error, using mock:', e.message);
    }
  }
  return mockDB.orders[cleanIdUpper] || null;
}

// ─── Post Product to WhatsApp Status ───
async function postProductToStatus(client, product, captionOverride = null) {
  const name = product.name || 'Premium Product';
  const price = parseFloat(product.price || 0).toFixed(2);
  const desc = product.description || 'Get yours now!';

  // If caller supplied a custom caption, use it verbatim; else build the default one
  let caption = captionOverride || (
    `🛍️ *NEW ARRIVAL ON KWABZ STORE!* 🛍️\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `✨ *${name}*\n` +
    `💰 *Price: GH₵ ${price}*\n\n` +
    `📝 _${desc}_\n\n` +
    `🛒 *Shop instantly here:*\n` +
    `👉 ${STORE_URL}/product-detail.html?id=${product.id}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔥 _Check out our full catalog at ${STORE_URL}!_`
  );

  let media = null;
  if (product.image_url && product.image_url.trim() !== '') {
    try {
      const imgUrl = product.image_url.trim();
      if (imgUrl.startsWith('data:image/')) {
        const mime = imgUrl.split(';')[0].split(':')[1];
        const data = imgUrl.split(',')[1];
        media = new MessageMedia(mime, data, 'product.jpg');
      } else {
        const response = await fetch(imgUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const base64Data = Buffer.from(arrayBuffer).toString('base64');
          const mimeType = response.headers.get('content-type') || 'image/jpeg';
          media = new MessageMedia(mimeType, base64Data, 'product.jpg');
        } else {
          console.warn(`[Status Post] Failed to fetch image: HTTP ${response.status}`);
        }
      }
    } catch (e) {
      console.error('[Status Post] Error downloading product image:', e.message);
    }
  }

  if (media) {
    await client.sendMessage('status@broadcast', media, { caption });
  } else {
    await client.sendMessage('status@broadcast', caption);
  }
  console.log(`✅ [Status Post] Published product status: "${name}"`);
}

// ─── Post Fully Custom Content to WhatsApp Status ───
async function postCustomToStatus(client, request) {
  const caption = request.custom_caption || '✨ Check this out!';
  let media = null;

  if (request.image_url && request.image_url.trim() !== '') {
    try {
      const imgUrl = request.image_url.trim();
      if (imgUrl.startsWith('data:image/')) {
        const mime = imgUrl.split(';')[0].split(':')[1];
        const data = imgUrl.split(',')[1];
        media = new MessageMedia(mime, data, 'custom.jpg');
      } else {
        const response = await fetch(imgUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const base64Data = Buffer.from(arrayBuffer).toString('base64');
          const mimeType = response.headers.get('content-type') || 'image/jpeg';
          media = new MessageMedia(mimeType, base64Data, 'custom.jpg');
        } else {
          console.warn(`[Custom Status] Image fetch failed: HTTP ${response.status}`);
        }
      }
    } catch (e) {
      console.error('[Custom Status] Error downloading image:', e.message);
    }
  }

  if (media) {
    await client.sendMessage('status@broadcast', media, { caption });
  } else {
    await client.sendMessage('status@broadcast', caption);
  }
  console.log(`✅ [Custom Status] Published custom status.`);
}

// ─── Find Local Chrome Installation ───
function getChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  
  if (process.platform === 'win32') {
    const paths = [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
      process.env.PROGRAMFILES + '/Google/Chrome/Application/chrome.exe',
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  } else {
    const paths = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/opt/google/chrome/chrome'
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const chromePath = getChromePath();
if (!chromePath) {
  console.error('❌ Google Chrome not found on this system!');
  console.error('   Please install Google Chrome and run again: https://www.google.com/chrome/');
  process.exit(1);
}
console.log(`🌐 Using Chrome: ${chromePath}`);

// ─── Bot Configuration (Firestore-driven, live-updated) ───
const DEFAULT_CONFIG = {
  mode: 'business',          // 'business' | 'personal'
  store_name: 'Kwabz Store',
  working_hours: 'Mon - Sat (8:00 AM - 9:00 PM)',
  welcome_message: 'Welcome to the Kwabz Store Automation Hub!',
  support_message: "Need direct help? We've got you covered!",
  personal_mode_message: "👋 Hello! Our automated assistant is currently offline. Please leave your message here, and the admin will respond to you personally very soon!",
  seller_assignments: []     // [{ seller_id, phone, name }]
};
let botConfig = { ...DEFAULT_CONFIG };

function setupConfigListener() {
  if (!isFirebaseOnline || !db) return;
  console.log('⚙️  Listening for bot configuration changes...');
  db.collection('settings').doc('whatsapp_bot_config').onSnapshot(snap => {
    if (!snap.exists) {
      botConfig = { ...DEFAULT_CONFIG };
      console.log('ℹ️  No bot config in Firestore — using defaults.');
      return;
    }
    const d = snap.data();
    botConfig = {
      mode:                  d.mode                  || DEFAULT_CONFIG.mode,
      store_name:            d.store_name            || DEFAULT_CONFIG.store_name,
      working_hours:         d.working_hours         || DEFAULT_CONFIG.working_hours,
      welcome_message:       d.welcome_message       || DEFAULT_CONFIG.welcome_message,
      support_message:       d.support_message       || DEFAULT_CONFIG.support_message,
      personal_mode_message: d.personal_mode_message || DEFAULT_CONFIG.personal_mode_message,
      seller_assignments:    d.seller_assignments    || []
    };
    console.log(`⚙️  Config updated — mode: "${botConfig.mode}", store: "${botConfig.store_name}"`);
  }, err => console.error('❌ Config listener error:', err.message));
}

// ─── Real-Time Firestore Status Sync (Multi-Account Enabled) ───
async function updateBotInstanceStatus(accountId, status, details = {}) {
  if (isFirebaseOnline && db) {
    try {
      const updateData = {
        status: status,
        qr: details.qr || null,
        info: details.info || null,
        error: details.error || null,
        percent: details.percent || null,
        message: details.message || null,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      };
      
      // Update account-specific document
      await db.collection('whatsapp_bot_accounts').doc(accountId).set(updateData, { merge: true });
      console.log(`🤖 [Firestore Status: ${accountId}] Updated status to: "${status}"`);
      
      // Maintain backward compatibility for the 'main' account in settings/whatsapp_bot_status
      if (accountId === 'main') {
        await db.collection('settings').doc('whatsapp_bot_status').set(updateData, { merge: true });
      }
    } catch (e) {
      console.error(`❌ Failed to update bot status for [${accountId}] in Firestore:`, e.message);
    }
  }
}

// ─── Initialize WhatsApp Bot Lifecycle (Multi-Account Enabled) ───
// Map of accountId -> { client, isStarting, isBotReady }
const botInstances = new Map();

async function startBotInstance(accountId) {
  let instance = botInstances.get(accountId);
  if (!instance) {
    instance = { client: null, isStarting: false, isBotReady: false };
    botInstances.set(accountId, instance);
  }

  if (instance.client) {
    console.log(`⚠️  WhatsApp Bot [${accountId}] is already running.`);
    return;
  }
  if (instance.isStarting) return;
  instance.isStarting = true;

  console.log(`🚀 Starting WhatsApp Bot instance [${accountId}]...`);
  await updateBotInstanceStatus(accountId, 'starting', { percent: 0, message: 'Initializing Chrome...' });

  const clientInstance = new Client({
    authStrategy: new LocalAuth({
      clientId: accountId, // Key change: Resolates sessions for multiple accounts
      dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
      executablePath: chromePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  instance.client = clientInstance;

  // Render QR Code
  clientInstance.on('qr', async (qr) => {
    console.log(`\n📱 [Account: ${accountId}] Generating QR code...`);
    qrcode.generate(qr, { small: true });

    const qrPath = path.join(__dirname, `SCAN_ME_QR_${accountId}.png`);
    try {
      await QRCode.toFile(qrPath, qr, { width: 512, margin: 2 });
      console.log(`✅ QR code image saved locally for [${accountId}].`);
      
      const qrBase64 = await QRCode.toDataURL(qr);
      await updateBotInstanceStatus(accountId, 'scanning', { qr: qrBase64 });
    } catch (e) {
      console.error(`Could not process QR code for [${accountId}]:`, e.message);
    }
  });

  clientInstance.on('loading_screen', async (percent, message) => {
    console.log(`⏳ [Account: ${accountId}] Loading WhatsApp: ${percent}% — ${message}`);
    if (!instance.isBotReady) {
      await updateBotInstanceStatus(accountId, 'starting', { percent, message });
    }
  });

  clientInstance.on('authenticated', async () => {
    console.log(`🔐 [Account: ${accountId}] WhatsApp session authenticated! Waiting for ready...`);
    await updateBotInstanceStatus(accountId, 'authenticated');
  });

  clientInstance.on('auth_failure', async (msg) => {
    console.error(`❌ [Account: ${accountId}] Authentication failed:`, msg);
    await updateBotInstanceStatus(accountId, 'error', { error: 'Authentication failed. Resetting...' });
    
    // Delete specific session so fresh QR is shown next time
    const sessionPath = path.join(__dirname, `.wwebjs_auth/session-${accountId}`);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
  });

  clientInstance.on('ready', async () => {
    instance.isBotReady = true;
    console.log(`\n🚀 KWABZ WHATSAPP BOT [${accountId}] IS ONLINE & READY!`);
    console.log(`🤖 Listening for commands on [${accountId}]...`);
    
    const qrPath = path.join(__dirname, `SCAN_ME_QR_${accountId}.png`);
    if (fs.existsSync(qrPath)) {
      fs.unlinkSync(qrPath);
    }
    
    await updateBotInstanceStatus(accountId, 'online', {
      info: {
        pushname: clientInstance.info.pushname || 'Admin Account',
        wid: clientInstance.info.wid.user
      }
    });

    if (isFirebaseOnline && !_orderWatcherUnsubscribe) {
      setupRealtimeOrderWatcher();
    }
  });

  clientInstance.on('disconnected', async (reason) => {
    console.warn(`⚠️  [Account: ${accountId}] Bot disconnected:`, reason);
    await stopBotInstance(accountId);
  });

  clientInstance.on('message', async (msg) => {
    try {
      await handleIncomingMessage(clientInstance, accountId, msg);
    } catch (err) {
      console.error(`❌ Error in message handler for account [${accountId}]:`, err);
    }
  });

  try {
    await clientInstance.initialize();
  } catch (err) {
    console.error(`❌ Failed to initialize WhatsApp client [${accountId}]:`, err.message);
    await updateBotInstanceStatus(accountId, 'error', { error: err.message });
    instance.client = null;
  } finally {
    instance.isStarting = false;
  }
}

async function stopBotInstance(accountId) {
  const instance = botInstances.get(accountId);
  if (!instance || !instance.client) {
    console.log(`⚠️  WhatsApp Bot [${accountId}] is not running.`);
    return;
  }

  instance.isBotReady = false;
  console.log(`⏹️  Stopping WhatsApp Bot [${accountId}]...`);
  await updateBotInstanceStatus(accountId, 'stopping');

  try {
    await instance.client.destroy();
    console.log(`✅ Bot [${accountId}] stopped and client destroyed.`);
  } catch (e) {
    console.error(`❌ Error during client destruction for [${accountId}]:`, e.message);
  }

  instance.client = null;
  await updateBotInstanceStatus(accountId, 'offline');

  // If all instances are offline, stop the order watcher
  let anyOnline = false;
  for (const inst of botInstances.values()) {
    if (inst.client && inst.isBotReady) {
      anyOnline = true;
    }
  }
  if (!anyOnline && _orderWatcherUnsubscribe) {
    _orderWatcherUnsubscribe();
    _orderWatcherUnsubscribe = null;
  }
}

// Active States & Session Management for Users
const userStates = new Map();

// ── Session Config & Trigger Rules ──
const SESSION_TTL = 5 * 60 * 1000; // 5-minute inactivity timeout
const BOT_TRIGGERS = [
  'menu', 
  'kwabz', 
  'kwabz store', 
  'order', 
  'track', 
  'track order', 
  'catalogue', 
  'shop', 
  'support', 
  'bot', 
  'help',
  'hi',
  'hello',
  'hey',
  'boss',
  'odowgu',
  'chief',
  'yo',
  'guy',
  'kiddi',
  'waguan',
  'smoke',
  'rager',
  'mr rager',
  'jabari'
];

// Thread-safe Message Queueing and Locking per User Session
const messageQueues = new Map();

async function processSessionQueue(sessionKey) {
  const queue = messageQueues.get(sessionKey);
  if (!queue || queue.processing) return;

  queue.processing = true;
  while (queue.messages.length > 0) {
    const { client, accountId, msg } = queue.messages[0];
    try {
      await handleIncomingMessageInternal(client, accountId, msg);
    } catch (err) {
      console.error(`❌ Error in serial queue runner for [${sessionKey}]:`, err);
    }
    queue.messages.shift();
  }
  messageQueues.delete(sessionKey);
}

async function handleIncomingMessage(client, accountId, msg) {
  const from = msg.from;
  if (from.includes('@g.us') || from === 'status@broadcast') return;

  const sessionKey = `${accountId}_${from}`;
  if (!messageQueues.has(sessionKey)) {
    messageQueues.set(sessionKey, { messages: [], processing: false });
  }

  messageQueues.get(sessionKey).messages.push({ client, accountId, msg });
  await processSessionQueue(sessionKey);
}

// Process Incoming Chat Messages (Internal Handler)
async function handleIncomingMessageInternal(client, accountId, msg) {
  const from = msg.from;
  const sessionKey = `${accountId}_${from}`; // Isolated session key per account
  
  // Ignore group messages and status broadcasts
  if (from.includes('@g.us')) return;
  if (from === 'status@broadcast') return;

  // Robust check to completely ignore messages sent BY the bot (from any device/session)
  if (msg.fromMe || (msg.id && msg.id.fromMe)) return;
  if (client.info && client.info.wid && (from === client.info.wid._serialized || from === client.info.wid.user)) return;

  // Extract pure sender phone number/id
  const senderNumber = from.split('@')[0];

  // 1. Cross-Bot Loop Protection: Ignore messages from other bot accounts managed by this server
  for (const [id, inst] of botInstances.entries()) {
    if (inst.client && inst.client.info && inst.client.info.wid) {
      const botNumber = inst.client.info.wid.user;
      if (senderNumber === botNumber) {
        console.log(`🚫 [Account: ${accountId}] Ignored message from another bot account [${id}] (${from}).`);
        return;
      }
    }
  }

  // 1.5 Admin-Only WhatsApp Status Posting Commands
  const cleanAdminPhone = String(ADMIN_PHONE).replace(/[^0-9]/g, '');
  if (senderNumber === cleanAdminPhone) {
    const rawBody = (msg.body || '').trim();
    const cleanCmd = rawBody.toLowerCase().trim();

    if (cleanCmd === '/products') {
      try {
        const productsList = await getProducts();
        let reply = `🛍️ *Kwabz Store - Active Catalog for Status* 🛍️\n\n`;
        productsList.forEach(p => {
          reply += `• *${p.name}*\n  ID: \`${p.id}\` | Price: GH₵ ${parseFloat(p.price).toFixed(2)}\n\n`;
        });
        reply += `👉 To post to your status, copy the ID above and reply:\n\`/status [ID]\``;
        await client.sendMessage(from, reply);
      } catch (err) {
        await client.sendMessage(from, `❌ Error fetching products: ${err.message}`);
      }
      return;
    }

    if (cleanCmd.startsWith('/status ') || cleanCmd.startsWith('/poststatus ')) {
      const parts = rawBody.split(' ');
      const productId = parts[1]?.trim();
      if (!productId) {
        await client.sendMessage(from, '❌ *Format Error!*\n\nPlease use: `/status [product_id]`');
        return;
      }

      await client.sendMessage(from, `⏳ *Fetching details and download link for product ID "${productId}"...*`);
      try {
        let product = null;
        if (isFirebaseOnline && db) {
          const productSnap = await db.collection('products').doc(productId).get();
          if (productSnap.exists) {
            product = { id: productSnap.id, ...productSnap.data() };
          }
        }
        if (!product) {
          product = mockDB.products.find(p => p.id === productId);
        }

        if (!product) {
          await client.sendMessage(from, `❌ *Product Not Found!*\n\nCould not find any product matching ID *"${productId}"* in the database.`);
          return;
        }

        await client.sendMessage(from, `📸 *Uploading media & publishing to WhatsApp Status for "${product.name}"...*`);
        await postProductToStatus(client, product);
        await client.sendMessage(from, `✅ *Successfully posted "${product.name}" (GH₵ ${parseFloat(product.price).toFixed(2)}) to your WhatsApp Status!*`);
      } catch (err) {
        await client.sendMessage(from, `❌ *Status Post Failed!*\n\nError: ${err.message}`);
      }
    }
  }
  // Normalize message body: strip emoji variants of numbers (1️⃣→1, 2️⃣→2, etc.) and trim
  const rawBody = (msg.body || '').trim();
  const body = rawBody
    .replace(/1️⃣/g, '1').replace(/2️⃣/g, '2')
    .replace(/3️⃣/g, '3').replace(/4️⃣/g, '4')
    .toLowerCase()
    .trim();

  // 1.8 Restrict Customer Auto-Replies to the Main Bot Account, but allow secondary bots
  // (e.g. Jabari) to activate if explicitly summoned or if matching any bot trigger word (e.g. hi, hello, menu)
  if (accountId !== 'main') {
    const pushname = (client.info && client.info.pushname) ? client.info.pushname.toLowerCase() : '';
    const widUser = (client.info && client.info.wid) ? client.info.wid.user : '';
    
    const isSpecificTrigger = body.includes(accountId.toLowerCase()) || 
                              body.includes('jabari') || 
                              (pushname && body.includes(pushname)) ||
                              (widUser && body.includes(widUser)) ||
                              BOT_TRIGGERS.some(trigger => body.includes(trigger));
                              
    const hasActiveSession = userStates.has(sessionKey);
    
    if (!hasActiveSession && !isSpecificTrigger) {
      return;
    }
  }

  // 2. Self-Defending Heuristic: If message contains bot menu signatures or bot error responses, ignore it
  if (
    body.includes('kwabz assistant') || 
    body.includes("didn't quite understand") || 
    body.includes('welcome to the kwabz') ||
    body.includes('how can i serve you today') ||
    body.includes('reply with a number (1-4)')
  ) {
    console.log(`🚫 [Account: ${accountId}] Ignored message containing bot signature text from (${from}).`);
    return;
  }

  // Personal mode auto-reply greeting (once per session)
  if (botConfig.mode === 'personal') {
    const isTrigger = BOT_TRIGGERS.some(trigger => body.includes(trigger));
    const now = Date.now();
    let session = userStates.get(sessionKey);
    
    // Clean up session if it has timed out
    if (session && (now - session.lastActive >= SESSION_TTL)) {
      userStates.delete(sessionKey);
      session = null;
    }
    
    // Send auto-reply on new trigger, or if session exists but hasn't received the personal mode message yet
    if (isTrigger && (!session || !session.isPersonalAutoReplied)) {
      userStates.set(sessionKey, {
        ...(session || {}),
        lastActive: now,
        isPersonalAutoReplied: true
      });
      
      const customMsg = botConfig.personal_mode_message || 
        "👋 Hello! Our automated assistant is currently offline. Please leave your message here, and the admin will respond to you personally very soon!";
      
      client.sendMessage(from, customMsg);
      console.log(`👤 [Account: ${accountId}] [Personal Mode Auto-reply] Sent greeting to ${from}`);
    }
    return;
  }

  const now = Date.now();
  let session = userStates.get(sessionKey);
  
  // Clean up session if it has timed out
  if (session && (now - session.lastActive >= SESSION_TTL)) {
    userStates.delete(sessionKey);
    session = null;
  }
  
  const hasActiveSession = !!session;

  // Case 1: No active session exists
  if (!hasActiveSession) {
    const isTrigger = BOT_TRIGGERS.some(trigger => body.includes(trigger));
    if (!isTrigger) return;
    
    console.log(`🤖 [Account: ${accountId}] [Bot Activation] Matched trigger word "${body}" from [${from}].`);
    userStates.set(sessionKey, { state: 'ACTIVE', lastActive: now });
    sendMainMenu(client, from);
    return;
  }

  // Case 2: Session is active -> Refresh interaction timer
  session.lastActive = now;
  console.log(`📩 [Account: ${accountId}] Message from [${from}] (Active): "${rawBody}"`);

  // User requests manual exit/disconnect from bot
  if (body === 'exit' || body === 'stop' || body === 'close') {
    userStates.delete(sessionKey);
    client.sendMessage(from, `👋 *Bot Assistant Deactivated.*\n\nYou can chat normally now! Send "menu" or "bot" at any time to reactivate.`);
    return;
  }

  // Handle Multi-Turn "Tracking Order" input
  if (session.state === 'AWAITING_REF_ID') {
    session.state = 'ACTIVE';
    
    msg.reply('⏳ *Searching Firestore database...*');
    const order = await trackOrder(msg.body);
    
    if (order) {
      const statusIcon = order.status === 'completed' ? '✅' : order.status === 'shipped' ? '🚚' : '⏳';
      let reply = `📦 *Order Found!*\n\n`;
      reply += `*Order Ref:* ${msg.body.toUpperCase()}\n`;
      reply += `*Status:* ${statusIcon} _${order.status.toUpperCase()}_\n`;
      reply += `*Customer:* ${order.customer?.name || 'Guest'}\n`;
      reply += `*Total Amount:* GH₵ ${parseFloat(order.total_price || 0).toFixed(2)}\n\n`;
      reply += `*Items Ordered:*\n`;
      order.items?.forEach(item => {
        reply += `- ${item.name} x${item.quantity}\n`;
      });
      reply += `\nThank you for shopping with us! If you need any assistance, reply *4*.`;
      
      client.sendMessage(from, reply);
    } else {
      client.sendMessage(from, `❌ *Order Not Found!*\n\nWe couldn't find any order matching *"${msg.body.toUpperCase()}"*.\n\nReply *3* to try again or *menu* to go back.`);
    }
    return;
  }

  // Main Command Routing (Menu Selection)
  if (body === 'menu' || body === 'hi' || body === 'hello' || body === 'hey' || body === 'kwabz') {
    sendMainMenu(client, from);
  } else if (body === '1' || body === 'browse products') {
    const products = await getProducts();
    let reply = `🛍️ *Kwabz Store - Fresh Catalog* 🛍️\n\n`;
    products.forEach((p, idx) => {
      reply += `*${idx + 1}. ${p.name}*\n`;
      reply += `Price: GH₵ ${parseFloat(p.price).toFixed(2)}\n`;
      if (p.description) reply += `_${p.description}_\n`;
      reply += `🛒 Shop now: ${STORE_URL}/product-detail.html?id=${p.id}\n\n`;
    });
    reply += `👉 To view categories, reply *2*\n👉 To order now, visit: ${STORE_URL}`;
    client.sendMessage(from, reply);
  } else if (body === '2' || body === 'categories') {
    const categories = await getCategories();
    let reply = `📂 *Kwabz Store Categories* 📂\n\n`;
    categories.forEach(c => {
      reply += `- *${c.name}*\n`;
    });
    reply += `\nBrowse full shelves online: ${STORE_URL}`;
    client.sendMessage(from, reply);
  } else if (body === '3' || body === 'track order') {
    session.state = 'AWAITING_REF_ID';
    client.sendMessage(from, `📦 *Order Tracking System*\n\nPlease enter your *Order Reference ID* (e.g., *KBZ-ABC* or *#1001*):`);
  } else if (body === '4' || body === 'support') {
    let reply = `📞 *${botConfig.store_name} Customer Care* 📞\n\n`;
    reply += `${botConfig.support_message}\n\n`;
    reply += `💬 *Chat with Admin:* wa.me/${ADMIN_PHONE}\n`;
    reply += `🌐 *Visit Website:* ${STORE_URL}\n`;
    reply += `⏰ *Working Hours:* ${botConfig.working_hours}\n\n`;
    reply += `Reply *menu* to return to the options.`;
    client.sendMessage(from, reply);
  } else {
    client.sendMessage(from, `👋 *Kwabz Assistant*\n\nI didn't quite understand that selection. Please reply with a number (*1 to 4*) or choose *menu* to view our categories.\n\n_Type *exit* to close the assistant._`);
  }
}

function sendMainMenu(client, to) {
  let menu = `👋 *${botConfig.welcome_message}* \n\n`;
  menu += `How can I serve you today? Reply with a number (1-4):\n\n`;
  menu += `1️⃣  🛍️ *Browse Products* (Explore the latest arrivals)\n`;
  menu += `2️⃣  📂 *View Categories* (Shop by department)\n`;
  menu += `3️⃣  📦 *Track Order Status* (Real-time tracking)\n`;
  menu += `4️⃣  📞 *Contact Support* (Chat with our agent)\n\n`;
  menu += `🌐 Or visit our online shop: ${STORE_URL}\n\n`;
  menu += `👉 _Not interested? Reply *exit* at any time to return to normal chat._`;
  client.sendMessage(to, menu);
}

// ─── Real-Time Order Watcher (Admin Push Notifications) ───
let _orderWatcherUnsubscribe = null;

function getOnlineClient() {
  const mainInstance = botInstances.get('main');
  if (mainInstance && mainInstance.client && mainInstance.isBotReady) {
    return mainInstance.client;
  }
  for (const inst of botInstances.values()) {
    if (inst.client && inst.isBotReady) {
      return inst.client;
    }
  }
  return null;
}

function setupRealtimeOrderWatcher() {
  console.log('🔔 Setting up Real-Time Order Watcher...');
  const botStartTime = Date.now();
  const seenOrderIds = new Set();

  console.log(`⏱️  Startup timestamp (ms): ${botStartTime} (${new Date(botStartTime).toISOString()})`);
  console.log('   Only orders placed AFTER this time will trigger WhatsApp alerts.');

  function startWatcher() {
    if (_orderWatcherUnsubscribe) {
      _orderWatcherUnsubscribe();
      _orderWatcherUnsubscribe = null;
    }

    _orderWatcherUnsubscribe = db.collection('orders')
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async (change) => {
          try {
            if (change.type !== 'added') return;

            const orderId = change.doc.id;
            const order = change.doc.data();

            if (seenOrderIds.has(orderId)) return;
            seenOrderIds.add(orderId);

            // Robust Firestore Timestamp or date parsing
            let orderTimeMs = 0;
            if (order.created_at) {
              if (typeof order.created_at.toDate === 'function') {
                orderTimeMs = order.created_at.toDate().getTime();
              } else if (typeof order.created_at.toMillis === 'function') {
                orderTimeMs = order.created_at.toMillis();
              } else if (order.created_at.seconds) {
                orderTimeMs = order.created_at.seconds * 1000;
              } else {
                const parsedDate = new Date(order.created_at);
                if (!isNaN(parsedDate.getTime())) {
                  orderTimeMs = parsedDate.getTime();
                }
              }
            }

            if (orderTimeMs && orderTimeMs < botStartTime) return;

            console.log(`\n🔥 ════════════════════════════════════════`);
            console.log(`🔥  NEW ORDER RECEIVED! ID: ${orderId}`);
            console.log(`🔥 ════════════════════════════════════════\n`);

            await sendAdminNewOrderAlert(order, orderId);
          } catch (error) {
            console.error(`❌ Error processing order change for document ID ${change.doc.id}:`, error);
          }
        });
      }, err => {
        console.error('🚨 Order Watcher Error:', err.message);
        console.log('🔄 Attempting to restart watcher in 10 seconds...');
        setTimeout(() => {
          if (isFirebaseOnline && db) {
            console.log('🔄 Restarting Order Watcher...');
            startWatcher();
          }
        }, 10000);
      });

    console.log('✅ Order Watcher active. Listening for NEW orders in real-time...');
  }

  startWatcher();
}

async function sendAdminNewOrderAlert(order, orderId) {
  const activeClient = getOnlineClient();
  if (!activeClient) {
    console.warn('⚠️ No online WhatsApp bot instance available to send order alert.');
    return;
  }

  const customerName    = order.customer?.name    || 'Unknown Customer';
  const customerPhone   = order.customer?.phone   || 'Not provided';
  const customerAddress = order.customer?.address || 'Not provided';
  const orderLabel      = order.order_label || order.order_number || `#${orderId.slice(0, 6).toUpperCase()}`;
  const orderTotal      = parseFloat(order.total_price || 0).toFixed(2);
  const deliveryFee     = parseFloat(order.delivery_fee || 0).toFixed(2);
  const subtotal        = (parseFloat(order.total_price || 0) - parseFloat(order.delivery_fee || 0)).toFixed(2);
  const orderMethod     = order.order_method || 'online';
  const sellerName      = order.seller_name && order.seller_name !== 'Kwabz Main Store'
                            ? order.seller_name : null;
  const orderStatus     = (order.status || 'pending').toUpperCase();
  
  // Safe date formatting
  let orderDate = null;
  if (order.created_at) {
    if (typeof order.created_at.toDate === 'function') {
      orderDate = order.created_at.toDate();
    } else if (order.created_at.seconds) {
      orderDate = new Date(order.created_at.seconds * 1000);
    } else {
      orderDate = new Date(order.created_at);
    }
  }
  const orderTime       = orderDate && !isNaN(orderDate.getTime())
                            ? orderDate.toLocaleString('en-GH', { timeZone: 'Africa/Accra' })
                            : 'Just now';

  let alertMsg = `🛎️ *NEW ORDER RECEIVED!* 🛎️\n`;
  alertMsg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  alertMsg += `📋 *ORDER DETAILS*\n`;
  alertMsg += `• *Ref:*    ${orderLabel}\n`;
  alertMsg += `• *Status:* ${orderStatus}\n`;
  alertMsg += `• *Time:*   ${orderTime}\n`;
  alertMsg += `• *Method:* ${orderMethod.charAt(0).toUpperCase() + orderMethod.slice(1)}\n`;
  if (sellerName) {
    alertMsg += `• *Seller:* ${sellerName}\n`;
  }

  alertMsg += `\n👤 *CUSTOMER INFO*\n`;
  alertMsg += `• *Name:*    ${customerName}\n`;
  alertMsg += `• *Phone:*   ${customerPhone}\n`;
  alertMsg += `• *Address:* ${customerAddress}\n`;

  alertMsg += `\n🛒 *ITEMS ORDERED*\n`;
  if (order.items && order.items.length > 0) {
    order.items.forEach((item, i) => {
      const itemTotal = (parseFloat(item.price || 0) * parseInt(item.quantity || 1)).toFixed(2);
      alertMsg += `${i + 1}. *${item.name}*\n`;
      alertMsg += `   Qty: ${item.quantity} × GH₵${parseFloat(item.price || 0).toFixed(2)} = GH₵${itemTotal}\n`;
    });
  } else {
    alertMsg += `  (No item details available)\n`;
  }

  alertMsg += `\n💰 *PAYMENT SUMMARY*\n`;
  alertMsg += `• Subtotal:     GH₵ ${subtotal}\n`;
  if (parseFloat(deliveryFee) > 0) {
    alertMsg += `• Delivery Fee: GH₵ ${deliveryFee}\n`;
  }
  alertMsg += `• *TOTAL PAID:  GH₵ ${orderTotal}*\n`;

  const cleanPhone = String(customerPhone).replace(/[^0-9]/g, '');
  alertMsg += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  if (cleanPhone.length >= 9) {
    alertMsg += `💬 *Chat Customer:* https://wa.me/${cleanPhone}\n`;
  }
  alertMsg += `⚙️ *Admin Dashboard:* ${STORE_URL}/admin-dashboard.html\n`;
  alertMsg += `📦 *Orders Panel:* ${STORE_URL}/admin-orders.html`;

  const recipients = [];

  // 1. Add Admin
  const cleanAdminPhone = String(ADMIN_PHONE).replace(/[^0-9]/g, '');
  if (cleanAdminPhone.length >= 9) {
    recipients.push({ jid: `${cleanAdminPhone}@c.us`, label: 'Admin' });
  }

  // 2. Add Seller
  if (order.seller_id && botConfig.seller_assignments && botConfig.seller_assignments.length > 0) {
    const assignment = botConfig.seller_assignments.find(
      a => a.seller_id === order.seller_id || a.seller_id === 'all'
    );
    if (assignment && assignment.phone) {
      const cleanSellerPhone = String(assignment.phone).replace(/[^0-9]/g, '');
      if (cleanSellerPhone.length >= 9 && cleanSellerPhone !== cleanAdminPhone) {
        recipients.push({ jid: `${cleanSellerPhone}@c.us`, label: assignment.name || 'Seller' });
      }
    }
  }

  // 3. Add Online Bot Accounts (Self-Push DMs)
  for (const [accId, inst] of botInstances.entries()) {
    if (inst.client && inst.isBotReady && inst.client.info && inst.client.info.wid) {
      const botJid = inst.client.info.wid._serialized;
      const isAlreadyRecipient = recipients.some(r => r.jid === botJid);
      if (!isAlreadyRecipient) {
        recipients.push({ jid: botJid, label: inst.client.info.pushname || `Bot Account (${accId})` });
      }
    }
  }

  for (const recipient of recipients) {
    const jid = recipient.jid;
    const sendWithRetry = async (attempt = 1) => {
      try {
        await activeClient.sendMessage(jid, alertMsg);
        console.log(`📤 [Attempt ${attempt}] Order alert sent to ${recipient.label} (${jid})`);
      } catch (e) {
        console.error(`❌ [Attempt ${attempt}] Failed to send to ${recipient.label}:`, e.message);
        if (attempt < 2) {
          console.log('🔄 Retrying in 5 seconds...');
          await new Promise(r => setTimeout(r, 5000));
          await sendWithRetry(2);
        } else {
          console.error(`❌ Alert to ${recipient.label} failed after 2 attempts.`);
        }
      }
    };
    await sendWithRetry();
  }
}

// Handle exit cleanly
process.on('SIGINT', async () => {
  console.log('\nStopping all bot instances...');
  for (const accountId of botInstances.keys()) {
    await stopBotInstance(accountId);
  }
  process.exit(0);
});

// ─── Real-Time Firestore Control Hub (Multi-Account Accounts Listener) ───
let accountsListener = null;

function setupAccountsListener() {
  if (!isFirebaseOnline || !db) {
    console.warn('⚠️ Running in Mock/Preview mode. Starting single main bot.');
    startBotInstance('main');
    return;
  }

  console.log('📡 Listening for bot accounts in "whatsapp_bot_accounts"...');
  
  // Seed main account if it doesn't exist
  db.collection('whatsapp_bot_accounts').doc('main').get().then(doc => {
    if (!doc.exists) {
      db.collection('whatsapp_bot_accounts').doc('main').set({
        id: 'main',
        status: 'offline',
        action: 'idle',
        name: 'Primary Bot Account',
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  });

  accountsListener = db.collection('whatsapp_bot_accounts').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
      const accountId = change.doc.id;
      const data = change.doc.data();
      
      if (change.type === 'removed') {
        console.log(`🗑️ Account [${accountId}] removed from Firestore. Stopping bot instance...`);
        await stopBotInstance(accountId);
        return;
      }
      
      if (data.action === 'start') {
        console.log(`📬 [Firestore Control] Account [${accountId}] received START command.`);
        await db.collection('whatsapp_bot_accounts').doc(accountId).set({ action: 'idle' }, { merge: true });
        await startBotInstance(accountId);
      } else if (data.action === 'stop') {
        console.log(`📬 [Firestore Control] Account [${accountId}] received STOP command.`);
        await db.collection('whatsapp_bot_accounts').doc(accountId).set({ action: 'idle' }, { merge: true });
        await stopBotInstance(accountId);
      } else if (change.type === 'added') {
        // Only auto-start on boot if the account was previously active/online.
        // Otherwise, leave it offline until the user clicks "Connect" in the dashboard.
        if (data.status === 'online') {
          console.log(`🚀 [Startup] Auto-connecting previously active account: ${accountId}`);
          await startBotInstance(accountId);
        } else {
          console.log(`ℹ️ [Startup] Account ${accountId} is offline. Waiting for manual connection.`);
          await updateBotInstanceStatus(accountId, 'offline');
        }
      }
    });
  }, err => {
    console.error('❌ Accounts listener error:', err.message);
  });
}

// ─── Real-Time Status Broadcast Request Queue Listener ───
let statusRequestsListener = null;

function setupStatusRequestsListener() {
  if (!isFirebaseOnline || !db) return;
  console.log('📡 Listening for status post requests in "status_requests"...');

  statusRequestsListener = db.collection('status_requests')
    .where('status', '==', 'pending')
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== 'added') return;
        const requestId = change.doc.id;
        const request = change.doc.data();

        // Supports both product-based and fully custom requests
        const isCustom = request.type === 'custom';
        console.log(`📸 [Status Request] ${isCustom ? 'CUSTOM' : 'PRODUCT'} request [${requestId}]`);

        try {
          let product = null;

          if (!isCustom) {
            // Standard product-based post
            const productSnap = await db.collection('products').doc(request.product_id).get();
            if (!productSnap.exists) throw new Error(`Product ${request.product_id} not found.`);
            product = { id: productSnap.id, ...productSnap.data() };
          }

          // ── Target Account Filtering ──────────────────────────────────
          // If request has target_accounts array, only use those specific bot instances.
          // Otherwise, broadcast to ALL online instances (legacy behaviour).
          const targetIds = Array.isArray(request.target_accounts) && request.target_accounts.length > 0
            ? new Set(request.target_accounts)
            : null;

          const activeClients = [];
          for (const [accountId, inst] of botInstances.entries()) {
            if (!inst.client || !inst.isBotReady) continue;
            if (targetIds && !targetIds.has(accountId)) continue;
            activeClients.push({ client: inst.client, accountId });
          }

          if (activeClients.length === 0) {
            throw new Error('No matching online WhatsApp bot instances available.');
          }

          console.log(`📸 [Status Request] Posting to ${activeClients.length} account(s):`, activeClients.map(c => c.accountId));
          const postErrors = [];

          for (const { client, accountId } of activeClients) {
            try {
              if (isCustom) {
                // Custom post: use image_url + custom caption directly
                await postCustomToStatus(client, request);
              } else {
                // Product post: use product data, optionally override caption
                await postProductToStatus(client, product, request.custom_caption || null);
              }
              console.log(`✅ [Status Request] Posted on [${accountId}]`);
            } catch (err) {
              console.error(`❌ [Status Request] Failed for [${accountId}]:`, err.message);
              postErrors.push(`${accountId}: ${err.message}`);
            }
          }

          if (postErrors.length === activeClients.length) {
            throw new Error('All accounts failed: ' + postErrors.join('; '));
          }

          // ── Direct Reach: Target non-bot connected numbers ──
          let directReachCount = 0;
          if (Array.isArray(request.target_numbers) && request.target_numbers.length > 0) {
            const senderClient = activeClients[0]?.client;
            if (senderClient) {
              console.log(`📤 [Direct Reach] Target numbers identified: ${request.target_numbers.length}. Initiating direct broadcast...`);
              const isPromoterDm = !!request.is_promoter_dm;
              const baseCaption = request.custom_caption || (product ? `🛍️ *${product.name}*\n💰 Price: GH₵ ${parseFloat(product.price).toFixed(2)}\n\n${product.description || ''}` : '');
              let media = null;
              
              const imageUrl = isCustom ? request.image_url : product?.image_url;
              if (imageUrl && imageUrl.trim() !== '') {
                try {
                  const imgUrl = imageUrl.trim();
                  if (imgUrl.startsWith('data:image/')) {
                    const mime = imgUrl.split(';')[0].split(':')[1];
                    const data = imgUrl.split(',')[1];
                    media = new MessageMedia(mime, data, 'promo.jpg');
                  } else {
                    const response = await fetch(imgUrl);
                    if (response.ok) {
                      const arrayBuffer = await response.arrayBuffer();
                      const base64Data = Buffer.from(arrayBuffer).toString('base64');
                      const mimeType = response.headers.get('content-type') || 'image/jpeg';
                      media = new MessageMedia(mimeType, base64Data, 'promo.jpg');
                    }
                  }
                } catch (e) {
                  console.error('[Direct Reach] Error downloading image:', e.message);
                }
              }

              for (const phone of request.target_numbers) {
                const cleanPhone = String(phone).replace(/[^0-9]/g, '');
                if (cleanPhone.length >= 9) {
                  const jid = `${cleanPhone}@c.us`;
                  
                  // Dynamically build caption with promoter details if requested
                  let caption = baseCaption;
                  if (isPromoterDm) {
                    // Prepend sharing instructions
                    const instructions = `📢 *EARN BY SHARING TO STATUS!* 📢\n` +
                                         `👋 Long-press this image & tap *Share to Status*, then copy-paste the text below as your status caption to track your referrals! 🚀\n` +
                                         `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                                         
                    // Append ref tracking parameter dynamically to any web links in the caption
                    caption = baseCaption.replace(/(https?:\/\/[^\s]+)/g, (url) => {
                      const connector = url.includes('?') ? '&' : '?';
                      return `${url}${connector}ref=${cleanPhone}`;
                    });
                    
                    caption = instructions + caption;
                  }

                  try {
                    if (media) {
                      await senderClient.sendMessage(jid, media, { caption });
                    } else {
                      await senderClient.sendMessage(jid, caption);
                    }
                    directReachCount++;
                    console.log(`✅ [Direct Reach] Sent direct promo (Promoter Mode: ${isPromoterDm}) to ${cleanPhone}`);
                  } catch (dmErr) {
                    console.error(`❌ [Direct Reach] Failed to send direct promo to ${cleanPhone}:`, dmErr.message);
                  }
                  // Small rate-limit delay between messages to stay safe
                  await new Promise(resolve => setTimeout(resolve, 1500));
                }
              }
            }
          }

          await db.collection('status_requests').doc(requestId).update({
            status: 'completed',
            posted_at: admin.firestore.FieldValue.serverTimestamp(),
            instances_posted: activeClients.length - postErrors.length,
            errors: postErrors.length > 0 ? postErrors : null,
            direct_reach_sent: directReachCount
          });
          console.log(`✅ [Status Request] Done — Status posted: ${activeClients.length - postErrors.length}/${activeClients.length}, Direct reach: ${directReachCount}/${request.target_numbers?.length || 0}`);

        } catch (err) {
          console.error(`❌ [Status Request] Failed [${requestId}]:`, err.message);
          await db.collection('status_requests').doc(requestId).update({
            status: 'failed',
            error: err.message,
            updated_at: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      });
    }, err => {
      console.error('❌ Status requests listener error:', err.message);
    });
}

// ─── Legacy Control Listener for Backward Compatibility ───
async function setupLegacyControlListener() {
  if (isFirebaseOnline && db) {
    db.collection('settings').doc('whatsapp_bot_controls').onSnapshot(async (snap) => {
      if (!snap.exists) return;
      const data = snap.data();
      if (data.action === 'start') {
        await db.collection('settings').doc('whatsapp_bot_controls').set({ action: 'idle' }, { merge: true });
        await db.collection('whatsapp_bot_accounts').doc('main').set({ action: 'start' }, { merge: true });
      } else if (data.action === 'stop') {
        await db.collection('settings').doc('whatsapp_bot_controls').set({ action: 'idle' }, { merge: true });
        await db.collection('whatsapp_bot_accounts').doc('main').set({ action: 'stop' }, { merge: true });
      }
    });
  }
}

// ─── Keep-Alive HTTP Server & Self-Pinger for Render / PaaS ───
function startKeepAliveServer() {
  const PORT = process.env.PORT || 10000;
  
  // Create a minimal HTTP server to satisfy Render's port binding health check
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'online', 
        timestamp: new Date().toISOString(),
        instances: Array.from(botInstances.keys())
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Keep-alive web server is listening on port ${PORT}`);
  });

  // Self-pinging routine to prevent sleeping on Free tier PaaS (like Render)
  const selfUrl = process.env.RENDER_EXTERNAL_URL; // Render automatically provides this URL (e.g., https://your-app.onrender.com)
  if (selfUrl) {
    console.log(`⏱️  Keep-alive: Self-pinging configured for ${selfUrl} every 10 minutes.`);
    setInterval(() => {
      console.log(`⏳ Keep-alive: Sending self-ping to ${selfUrl}/health ...`);
      const getModule = selfUrl.startsWith('https') ? https : http;
      getModule.get(`${selfUrl}/health`, (res) => {
        console.log(`🟢 Keep-alive: Self-ping response status: ${res.statusCode}`);
      }).on('error', (err) => {
        console.error('❌ Keep-alive: Self-ping failed:', err.message);
      });
    }, 10 * 60 * 1000); // 10 minutes (Render sleeps at 15 minutes)
  } else {
    console.log('ℹ️  Keep-alive: RENDER_EXTERNAL_URL not set. Self-pinging is disabled. (This is normal when running locally.)');
  }
}

// ─── Startup Hook ───
async function run() {
  setupConfigListener();           // Live-sync bot config
  await setupLegacyControlListener(); // Backwards compatibility controls
  setupAccountsListener();         // Multi-account dynamic control listener
  setupStatusRequestsListener();   // Real-time status request listener
  startKeepAliveServer();          // Expose HTTP server & enable self-ping
}

run();
