import readline from 'readline';
import dotenv from 'dotenv';
import fs from 'fs';
import admin from 'firebase-admin';

dotenv.config();

const STORE_URL = process.env.STORE_URL || 'https://kwabz-store-v2.vercel.app';
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT || './firebase-service-account.json';

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
    console.log('✅ Firebase Admin connected successfully.');
  }
} catch (e) {}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('===================================================');
console.log('    KWABZ WHATSAPP BOT - OFFLINE FLOW SIMULATOR     ');
console.log('===================================================');
console.log('This simulation allows you to chat with the bot in');
console.log('your console to test the conversational logic.\n');
console.log('Type your message and press ENTER. Type "exit" to quit.');
console.log('---------------------------------------------------\n');

let currentState = null;

function sendMenu() {
  let menu = `👋 *Welcome to the Kwabz Store Automation Hub!* \n\n`;
  menu += `How can I serve you today? Reply with a number (1-4):\n\n`;
  menu += `1️⃣  🛍️ *Browse Products* (Explore the latest arrivals)\n`;
  menu += `2️⃣  📂 *View Categories* (Shop by department)\n`;
  menu += `3️⃣  📦 *Track Order Status* (Real-time tracking)\n`;
  menu += `4️⃣  📞 *Contact Support* (Chat with our agent)\n\n`;
  menu += `🌐 Or visit our online shop: ${STORE_URL}`;
  console.log('\n[BOT REPLY]:\n' + menu + '\n');
}

async function handleMessage(input) {
  const body = input.trim().toLowerCase();
  
  if (body === 'exit') {
    rl.close();
    return;
  }

  if (currentState === 'AWAITING_REF_ID') {
    currentState = null;
    console.log('\n[BOT REPLY]:\n⏳ *Searching Firestore database...*\n');
    
    let order = null;
    const cleanId = input.trim().toUpperCase();
    
    if (isFirebaseOnline && db) {
      try {
        let snap = await db.collection('orders').doc(cleanId).get();
        if (snap.exists) order = snap.data();
      } catch (e) {}
    }
    if (!order) {
      order = mockDB.orders[cleanId];
    }

    if (order) {
      const statusIcon = order.status === 'completed' ? '✅' : order.status === 'shipped' ? '🚚' : '⏳';
      let reply = `📦 *Order Found!*\n\n`;
      reply += `*Order Ref:* ${input.toUpperCase()}\n`;
      reply += `*Status:* ${statusIcon} _${order.status.toUpperCase()}_\n`;
      reply += `*Customer:* ${order.customer?.name || 'Guest'}\n`;
      reply += `*Total Amount:* GH₵ ${parseFloat(order.total_price || 0).toFixed(2)}\n\n`;
      reply += `*Items Ordered:*\n`;
      order.items?.forEach(item => {
        reply += `- ${item.name} x${item.quantity}\n`;
      });
      reply += `\nThank you for shopping with us! If you need any assistance, reply *4*.`;
      console.log('[BOT REPLY]:\n' + reply + '\n');
    } else {
      console.log(`[BOT REPLY]:\n❌ *Order Not Found!*\n\nWe couldn't find any order matching *"${input.toUpperCase()}"*. Make sure the reference ID is exact (e.g., *KBZ-XYZ*).\n\nReply *3* to try again or *menu* to go back.\n`);
    }
    promptUser();
    return;
  }

  if (body === 'menu' || body === 'hi' || body === 'hello' || body === 'hey' || body === 'kwabz') {
    sendMenu();
  } else if (body === '1') {
    let products = mockDB.products;
    if (isFirebaseOnline && db) {
      try {
        const snap = await db.collection('products').limit(10).get();
        if (!snap.empty) products = snap.docs.map(doc => doc.data());
      } catch(e) {}
    }
    let reply = `🛍️ *Kwabz Store - Fresh Catalog* 🛍️\n\n`;
    products.forEach((p, idx) => {
      reply += `*${idx + 1}. ${p.name}*\n`;
      reply += `Price: GH₵ ${parseFloat(p.price).toFixed(2)}\n`;
      if (p.description) reply += `_${p.description}_\n`;
      reply += `🛒 Shop now: ${STORE_URL}/product-detail.html?id=${p.id || idx}\n\n`;
    });
    reply += `👉 To view categories, reply *2*\n👉 To order now, visit: ${STORE_URL}`;
    console.log('\n[BOT REPLY]:\n' + reply + '\n');
  } else if (body === '2') {
    let categories = mockDB.categories;
    if (isFirebaseOnline && db) {
      try {
        const snap = await db.collection('categories').get();
        if (!snap.empty) categories = snap.docs.map(doc => doc.data());
      } catch(e) {}
    }
    let reply = `📂 *Kwabz Store Categories* 📂\n\n`;
    categories.forEach(c => {
      reply += `- *${c.name}*\n`;
    });
    reply += `\nBrowse full shelves online: ${STORE_URL}`;
    console.log('\n[BOT REPLY]:\n' + reply + '\n');
  } else if (body === '3') {
    currentState = 'AWAITING_REF_ID';
    console.log(`\n[BOT REPLY]:\n📦 *Order Tracking System*\n\nPlease enter your *Order Reference ID* (e.g., *KBZ-ABC*):`);
  } else if (body === '4') {
    let reply = `📞 *Kwabz Customer Care* 📞\n\n`;
    reply += `Need direct help? We've got you covered!\n\n`;
    reply += `💬 *Chat with Admin:* wa.me/233509663058\n`;
    reply += `🌐 *Visit Website:* ${STORE_URL}\n`;
    reply += `⏰ *Working Hours:* Mon - Sat (8:00 AM - 9:00 PM)\n\n`;
    reply += `Reply *menu* to return to the options.`;
    console.log('\n[BOT REPLY]:\n' + reply + '\n');
  } else {
    console.log(`\n[BOT REPLY]:\n👋 *Hello! Welcome to Kwabz Store PWA Bot!* \n\nI didn't quite understand that. Please reply with *menu* to view our options or choose a number from 1 to 4.\n`);
  }
  promptUser();
}

function promptUser() {
  rl.question('You: ', handleMessage);
}

sendMenu();
promptUser();
