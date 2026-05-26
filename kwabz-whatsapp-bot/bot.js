import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import { exec } from 'child_process';

// Load Environment Config
dotenv.config();

const ADMIN_PHONE = process.env.ADMIN_PHONE || '233509663058';
const STORE_URL = process.env.STORE_URL || 'https://kwabz-store-v2.vercel.app';
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT || './firebase-service-account.json';

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
    console.warn('⚠️  firebase-service-account.json not found! Running in MOCK/PREVIEW mode.');
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

// ─── Find Local Chrome Installation ───
function getChromePath() {
  const paths = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
    process.env.PROGRAMFILES + '/Google/Chrome/Application/chrome.exe',
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
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

// ─── Initialize WhatsApp Bot ───
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './.wwebjs_auth' // Stores session locally so you don't scan QR every run
  }),
  puppeteer: {
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// Render QR Code — save as image file AND open it automatically
client.on('qr', async (qr) => {
  console.log('\n📱 Generating QR code image...');
  qrcode.generate(qr, { small: true }); // Fallback: also print to terminal

  const qrPath = './SCAN_ME_QR.png';
  try {
    await QRCode.toFile(qrPath, qr, { width: 512, margin: 2 });
    console.log(`\n✅ QR code saved! Opening image now...`);
    console.log(`📂 File location: ${process.cwd()}\\SCAN_ME_QR.png`);
    console.log('   👉 Scan this QR code with WhatsApp to connect the bot!\n');
    // Auto-open the PNG file on Windows
    exec(`start "" "${qrPath}"`, (err) => {
      if (err) console.log('   Could not auto-open file. Please open SCAN_ME_QR.png manually.');
    });
  } catch (e) {
    console.error('Could not save QR image:', e.message);
  }
});

// Debug: Loading state
client.on('loading_screen', (percent, message) => {
  console.log(`⏳ Loading WhatsApp: ${percent}% — ${message}`);
});

// Debug: Authenticated
client.on('authenticated', () => {
  console.log('🔐 WhatsApp session authenticated! Waiting for ready...');
});

// Debug: Auth failure
client.on('auth_failure', (msg) => {
  console.error('❌ Authentication failed:', msg);
  console.log('💡 Deleting old session and restarting. Please wait...');
  // Delete session so fresh QR is shown next time
  const sessionPath = './.wwebjs_auth';
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  }
});

// Bot Connected Successfully
client.on('ready', () => {
  console.log('\n🚀 KWABZ WHATSAPP BOT IS ONLINE & READY!');
  console.log(`🤖 Listening for commands...`);
  console.log(`📱 Configured Admin Phone: ${ADMIN_PHONE}`);
  console.log(`🌐 Store URL: ${STORE_URL}\n`);
  
  // Delete the QR image now that we're connected
  if (fs.existsSync('./SCAN_ME_QR.png')) {
    fs.unlinkSync('./SCAN_ME_QR.png');
  }
  
  if (isFirebaseOnline) {
    setupRealtimeOrderWatcher();
  }
});

// Debug: Disconnected
client.on('disconnected', (reason) => {
  console.warn('⚠️  Bot disconnected:', reason);
  console.log('🔄 Restart the bot to reconnect.');
});

// Active States for Users (to handle multi-turn conversations)
const userStates = new Map();

// Process Incoming Chat Messages
client.on('message', async (msg) => {
  const from = msg.from;
  // Normalize: strip emoji variants of numbers (1️⃣→1, 2️⃣→2, etc.) and trim
  const rawBody = msg.body.trim();
  const body = rawBody
    .replace(/1️⃣/g, '1').replace(/2️⃣/g, '2')
    .replace(/3️⃣/g, '3').replace(/4️⃣/g, '4')
    .toLowerCase()
    .trim();
  
  // Ignore group messages and messages sent BY the bot itself
  if (from.includes('@g.us')) return;
  if (msg.fromMe) return;

  console.log(`📩 Message from [${from}]: "${rawBody}" → normalized: "${body}"`);

  // Handle Multi-Turn "Tracking Order" input
  if (userStates.get(from) === 'AWAITING_REF_ID') {
    userStates.delete(from); // Clear state
    
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
      client.sendMessage(from, `❌ *Order Not Found!*\n\nWe couldn't find any order matching *"${msg.body.toUpperCase()}"*. Make sure the reference ID is exact (e.g., *KBZ-XYZ*).\n\nReply *3* to try again or *menu* to go back.`);
    }
    return;
  }

  // Main Command Routing
  if (body === 'menu' || body === 'hi' || body === 'hello' || body === 'hey' || body === 'kwabz') {
    sendMainMenu(from);
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
    userStates.set(from, 'AWAITING_REF_ID');
    client.sendMessage(from, `📦 *Order Tracking System*\n\nPlease enter your *Order Reference ID* (e.g., *KBZ-ABC* or *#1001*):`);
  } else if (body === '4' || body === 'support') {
    let reply = `📞 *Kwabz Customer Care* 📞\n\n`;
    reply += `Need direct help? We've got you covered!\n\n`;
    reply += `💬 *Chat with Admin:* wa.me/${ADMIN_PHONE}\n`;
    reply += `🌐 *Visit Website:* ${STORE_URL}\n`;
    reply += `⏰ *Working Hours:* Mon - Sat (8:00 AM - 9:00 PM)\n\n`;
    reply += `Reply *menu* to return to the options.`;
    client.sendMessage(from, reply);
  } else {
    // Graceful fallback helper
    client.sendMessage(from, `👋 *Hello! Welcome to Kwabz Store PWA Bot!* \n\nI didn't quite understand that. Please reply with *menu* to view our options or choose a number from 1 to 4.`);
  }
});

function sendMainMenu(to) {
  let menu = `👋 *Welcome to the Kwabz Store Automation Hub!* \n\n`;
  menu += `How can I serve you today? Reply with a number (1-4):\n\n`;
  menu += `1️⃣  🛍️ *Browse Products* (Explore the latest arrivals)\n`;
  menu += `2️⃣  📂 *View Categories* (Shop by department)\n`;
  menu += `3️⃣  📦 *Track Order Status* (Real-time tracking)\n`;
  menu += `4️⃣  📞 *Contact Support* (Chat with our agent)\n\n`;
  menu += `🌐 Or visit our online shop: ${STORE_URL}`;
  client.sendMessage(to, menu);
}

// ─── Real-Time Order Watcher (Admin Push Notifications) ───
function setupRealtimeOrderWatcher() {
  console.log('🔔 Order Real-time Watcher Active - Waiting for new purchases...');
  
  // Track seen order IDs to avoid duplicate notifications on startup
  const seenOrderIds = new Set();
  let isInitialLoad = true;

  // OPTIMIZATION: Only listen to the top 50 most recent orders.
  // This guarantees startup reads are capped at a maximum of 50, even with thousands of database orders!
  db.collection('orders').orderBy('created_at', 'desc').limit(50).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added') {
        const orderId = change.doc.id;

        // On first snapshot load, just record existing IDs, don't alert
        if (isInitialLoad) {
          seenOrderIds.add(orderId);
          return;
        }

        // If we've already seen this order, skip
        if (seenOrderIds.has(orderId)) return;
        seenOrderIds.add(orderId);

        const order = change.doc.data();
        console.log(`🔥 [NEW ORDER ALERT] ID: ${orderId} | Customer: ${order.customer?.name || 'Guest'} | Total: GH₵ ${order.total_price}`);
        await sendAdminNewOrderAlert(order, orderId);
      }
    });

    if (isInitialLoad) {
      isInitialLoad = false;
      console.log(`✅ Watcher initialized. Tracking the ${seenOrderIds.size} most recent orders. Listening for NEW ones...`);
    }
  }, err => {
    console.error('🚨 Watcher Error:', err.message);
  });
}

async function sendAdminNewOrderAlert(order, orderId) {
  const adminJid = `${ADMIN_PHONE}@c.us`;
  const customerName = order.customer?.name || 'Customer';
  const customerPhone = order.customer?.phone || 'Not provided';
  const orderNum = order.order_number || '#NEW';
  
  let alertMsg = `🛎️ *KWABZ STORE ALERT: New Order!* 🛎️\n\n`;
  alertMsg += `*Order Ref:* ${orderNum}\n`;
  alertMsg += `*Customer:* ${customerName}\n`;
  alertMsg += `*Phone:* ${customerPhone}\n`;
  alertMsg += `*Total:* GH₵ ${parseFloat(order.total_price || 0).toFixed(2)}\n`;
  alertMsg += `*Method:* ${order.order_method || 'WhatsApp'}\n\n`;
  
  alertMsg += `🛒 *Items:*\n`;
  order.items?.forEach(item => {
    alertMsg += `  - ${item.name} x${item.quantity}\n`;
  });
  
  const cleanPhone = String(customerPhone).replace(/[^0-9]/g, '');
  alertMsg += `\n💬 Chat customer: https://wa.me/${cleanPhone}\n`;
  alertMsg += `⚙️ Dashboard: ${STORE_URL}/admin-dashboard.html`;
  
  try {
    await client.sendMessage(adminJid, alertMsg);
    console.log(`📤 Order alert sent to admin: ${adminJid}`);
  } catch(e) {
    console.error('❌ Failed to notify admin:', e.message);
  }
}

// Handle exit cleanly
process.on('SIGINT', async () => {
  console.log('\nStopping bot...');
  await client.destroy();
  process.exit(0);
});

// Run client
client.initialize();
