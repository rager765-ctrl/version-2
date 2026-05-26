# 🤖 Kwabz Store - WhatsApp Automation Bot

An offline-first, production-ready WhatsApp Automation Bot designed for **Kwabz Store**. It allows customers to browse products, view categories, and track order status directly from WhatsApp. Additionally, it listens to your Firebase Firestore database in real-time, instantly notifying the Admin's phone number when a new order is received!

---

## 🌟 Key Features

1. **Auto-Responding Menu:** Welcomes customers and guides them with clear options (`1` to `4`):
   - `1` 🛍️ **Browse Products:** Fetches top products (with prices, descriptions, and storefront links).
   - `2` 📂 **Browse Categories:** Lists available store categories.
   - `3` 📦 **Track Order Status:** Resolves real-time order states (Pending, Processing, Completed) by asking the customer for their unique Ref ID (e.g., `KBZ-ABC`).
   - `4` 📞 **Contact Support:** Instantly routes customers to direct support channels.
2. **Real-time Order Alerts:** Connects to your Firestore database. Whenever a customer completes checking out on your PWA, the bot instantly detects it and sends a detailed order breakdown to your WhatsApp!
3. **No-Crash Fallback (Mock Mode):** Runs flawlessly in mock mode if Firebase credentials aren't supplied yet, allowing you to test conversational flows instantly.
4. **Offline Terminal Simulator:** Includes a built-in command-line chat simulator to test the bot's logic without needing WhatsApp Web or Chrome drivers active!

---

## 🚀 Quick Start (Local Setup)

### 1. Install Node.js
If you don't have Node.js installed, download and install it:
👉 **[Download Node.js](https://nodejs.org/en)** (Select the LTS version).

### 2. Install Dependencies
Open your terminal (PowerShell, Command Prompt, or VS Code Terminal), navigate to this folder, and run:
```bash
cd kwabz-whatsapp-bot
npm install
```

### 3. Configure Credentials
1. Copy `.env.example` and rename it to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and configure your settings:
   - **`ADMIN_PHONE`**: Set this to your WhatsApp phone number (include your country code, e.g. `23354XXXXXXX`, with NO `+` sign or spaces).
   - **`STORE_URL`**: Your Vercel storefront URL.

---

## 📦 How to Connect Your Firestore Database

To enable real-time order tracking and admin alerts, you need to connect the bot to your Firebase Project:

1. Go to the **[Firebase Console](https://console.firebase.google.com/)**.
2. Click on the gear icon next to "Project Overview" and choose **Project Settings**.
3. Navigate to the **Service Accounts** tab.
4. Click **Generate New Private Key**.
5. Save the downloaded `.json` file inside the `kwabz-whatsapp-bot` folder.
6. Rename this downloaded file to `firebase-service-account.json`.
7. Start your bot, and it will automatically connect!

---

## 🎮 How to Run

### Option A: Run the Terminal Simulator (Highly Recommended for Testing!)
Test the exact chatbot conversation flow instantly inside your command prompt, without opening Chrome or connecting WhatsApp:
```bash
npm run test-flow
```

### Option B: Run the Real WhatsApp Bot
Launch the live bot, which will spin up a Chromium browser in the background:
```bash
npm start
```
1. A QR code will display directly in your console.
2. Open WhatsApp on your phone -> tap **Linked Devices** -> tap **Link a Device**.
3. Scan the terminal's QR code.
4. **Done!** The bot is now online and active on your number. You can close your terminal at any time (or press `Ctrl+C`) to turn it off.

---

## 🛠️ Deploying to Production

To keep the bot running 24/7 in the cloud:
1. Deploy to a VPS (Virtual Private Server) like DigitalOcean, Linode, or AWS EC2.
2. Use **PM2** (Process Manager) to keep the script running continuously in the background:
   ```bash
   npm install -g pm2
   pm2 start bot.js --name "kwabz-bot"
   pm2 startup
   pm2 save
   ```
3. Since `LocalAuth` stores session states in `./.wwebjs_auth`, the bot will automatically log back in even if the server reboots!
