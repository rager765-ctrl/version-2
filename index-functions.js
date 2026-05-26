const functions = require('firebase-functions');
const admin = require('firebase-admin');
const twilio = require('twilio');

admin.initializeApp();

// Config (Set via: firebase functions:config:set twilio.sid="..." twilio.token="..." twilio.number="..." admin.phone="+233...")
const twilioSid = functions.config().twilio?.sid || 'ACxxxxxxxxxxxxxxxxxxxxxxxx';
const twilioToken = functions.config().twilio?.token || 'xxxxxxxxxxxxxxxxxxxxxxxx';
const twilioNumber = functions.config().twilio?.number || '+14155238886';
const adminPhone = functions.config().twilio?.admin_phone || '+233000000000';

const client = new twilio(twilioSid, twilioToken);

/**
 * Robust +233 formatting logic for Ghana
 */
function formatWhatsAppPhone(phone) {
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
}

/**
 * 1. "New Collection" Broadcast (Admin → Users)
 * Trigger: Firestore onCreate on products collection
 */
exports.onProductBroadcast = functions.firestore
  .document('products/{productId}')
  .onCreate(async (snap, context) => {
    const product = snap.data();
    const storeLink = `https://kwabz-store-v2.vercel.app/product-detail.html?id=${context.params.productId}`;
    
    // Professionally structured WhatsApp message for New Drops
    const message = `*Kwabz Store Update:* A new essential has arrived: *${product.name}*.\nPrice: *GH₵ ${product.price}*. View the drop: ${storeLink}`;

    try {
      const usersSnap = await admin.firestore().collection('users')
        .where('phoneNumber', '!=', null)
        .get();

      const promises = usersSnap.docs.map(doc => {
        const phone = formatWhatsAppPhone(doc.data().phoneNumber);
        if (!phone) return null;

        return client.messages.create({
          from: `whatsapp:${twilioNumber}`,
          to: `whatsapp:${phone}`,
          body: message
        }).catch(err => console.error(`Error sending to ${phone}:`, err));
      });

      await Promise.all(promises);
      console.log(`[Broadcast] Notified ${usersSnap.size} users about ${product.name}.`);
    } catch (err) {
      console.error('[Broadcast Failed]', err);
    }
  });

/**
 * 2. Automated Order Inquiry Alert (Firestore Trigger)
 * This acts as the "server-side call" for order inquiries.
 */
exports.onOrderInquiry = functions.firestore
  .document('orders/{orderId}')
  .onCreate(async (snap) => {
    const order = snap.data();
    const customerName = order.customer?.name || 'Customer';
    const productName = order.items?.[0]?.name || 'Item';
    const refId = order.ref_id || Math.floor(100000 + Math.random() * 900000);
    const customerPhone = formatWhatsAppPhone(order.customer?.phone || '0000000000');

    // Structured Business Copywriting
    const message = `*Hello Kwabz Admin, I would like to inquire about an item.*\n\n*Product:* ${productName}\n*Customer:* ${customerName}\n*Ref ID:* #${refId}\n\n_Please provide payment details to proceed._\n\nChat with Customer: https://wa.me/${customerPhone.replace('+', '')}`;

    return client.messages.create({
      from: `whatsapp:${twilioNumber}`,
      to: `whatsapp:${adminPhone}`,
      body: message
    });
  });
