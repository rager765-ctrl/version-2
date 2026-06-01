import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT || './firebase-service-account.json';

console.log('\n=== STARTING BOT DIAGNOSTICS ===');
console.log('• CWD:', process.cwd());
console.log('• Service Account Path:', SERVICE_ACCOUNT_PATH);

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ Service Account file not found!');
  process.exit(1);
}

try {
  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  const db = admin.firestore();
  console.log('✅ Firebase initialized successfully.');

  console.log('⏳ Attempting to read/write whatsapp_bot_accounts/main...');
  const doc = await db.collection('whatsapp_bot_accounts').doc('main').get();
  if (doc.exists) {
    console.log('✅ Document exists. Data:', doc.data());
  } else {
    console.log('ℹ️ Document does not exist. Seeding...');
    await db.collection('whatsapp_bot_accounts').doc('main').set({
      id: 'main',
      status: 'offline',
      action: 'idle',
      name: 'Primary Bot Account',
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ Seeding complete.');
  }

  console.log('⏳ Attempting to read settings/whatsapp_bot_config...');
  const configDoc = await db.collection('settings').doc('whatsapp_bot_config').get();
  console.log('✅ Config read success. Mode:', configDoc.data()?.mode);

  console.log('=== DIAGNOSTICS COMPLETE: NO ERRORS FOUND ===\n');
} catch (err) {
  console.error('❌ Diagnostic failed with error:', err.message);
  console.error(err);
}
process.exit(0);
