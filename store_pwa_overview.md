# 🛍️ Kwabz Store Progressive Web App (PWA) — Complete Overview

Welcome to the technical overview of the **Kwabz Store PWA** ecosystem. This document details the application's hybrid architecture, caching models, file organization, backend integrations, and companion subsystems.

---

## 🗺️ 1. High-Level System Architecture
The Kwabz Store PWA operates on a **Hybrid Dual-Channel** model, designed to optimize load times (sub-1ms initial render), support offline operation, and minimize Firestore database read costs by **99.9%**.

```mermaid
graph TD
    %% Styling
    classDef client fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff;
    classDef server fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff;
    classDef db fill:#f59e0b,stroke:#b45309,stroke-width:2px,color:#fff;
    classDef sw fill:#8b5cf6,stroke:#6d28d9,stroke-width:2px,color:#fff;

    %% Client Tier
    subgraph Client Tier (PWA Web)
        A["Browser UI (Storefront / Admin)"]:::client
        B["Store Logic (store.js)"]:::client
        C["Service Worker (sw.js v22)"]:::sw
        D["Disk Cache (LocalStorage / IndexedDB)"]:::client
    end

    %% Backend Tier
    subgraph Optimization & Integration Tier
        E["Node.js / Express Server (Render)"]:::server
        F["Socket.io Engine (WebSockets)"]:::server
        G["Redis Cache (Optional RAM Store)"]:::server
    end

    %% Database Tier
    subgraph Database Tier (Google Cloud)
        H["Cloud Firestore"]:::db
        I["Firebase Auth Engine"]:::db
    end

    %% Connections
    A <-->|"Reads/Writes UI State"| B
    B <-->|"1. Sync Init (Stale-While-Revalidate)"| D
    B <-->|"2. Stale-While-Revalidate Assets"| C
    B ===|"3. Real-Time WS (Socket.io) Primary Push"| F
    B ===|"4. REST Cache Proxy (API)"| E
    B -.->|"5. Direct Firestore Sync (Fallback Mode)"| H
    A -->|"6. Authentication"| I
    E <-->|"In-Memory Cache"| G
    E ===|"7. Single Live-Sync Connection"| H
```

---

## ⚡ 2. Caching Strategy & Caching Models
To ensure speed and offline-first responsiveness, the app implements two main layers of caching:

### A. Progressive Web App Caching (`sw.js`)
* **Service Worker Caching**: Intercepts requests and caches resources using the browser's Cache Storage API.
* **Network-First (Stale-While-Revalidate) for Code Files**: Applies to `.html`, `.js`, `.css`, and `.json`. The app instantly loads cached resources (in <1ms) and fetches updates in the background, applying them on the next load.
* **Cache-First for Media Assets**: Applies to images, icons, and logos (`STATIC_ASSETS`). These rarely change and are served immediately from cache.

### B. Client-Side SWR Memory Caching (`store.js`)
* **Disk Persistence**: Storefront data (catalogs, categories, settings) is written to local storage using a secure wrapper called `_safeSetItem`.
* **Quota Safeguard**: If browser disk limits (`QuotaExceededError`) are met, the system cleans up heavy cached assets (like product images/lists) to prevent cart data loss or page crashes, running gracefully from RAM.

---

## 📉 3. Cost Optimization & Backend Multiplexing
If every client accessed Cloud Firestore directly, high traffic volumes would quickly exhaust the Firebase Spark Tier free allowance (50,000 reads/day).

```
Daily Firestore Reads (Native Direct) = N × (Products + Categories + Sellers + Orders)
Daily Firestore Reads (Kwabz Proxy)  = 1 × (Products + Categories + Sellers + Orders)
```
* **Multiplexing**: The Node.js Express server (`server.js`) maintains **exactly one** live listener (`onSnapshot`) to Firestore.
* **WebSockets Routing**: When database changes occur, the backend broadcasts them to all connected clients via **Socket.io** in real time.
* **Cost Difference Example (1,500 daily page loads, 175 documents):**
  * **Direct Firebase Setup**: 262,500 reads/day (Exceeds free tier limit)
  * **Kwabz Backend Proxy**: 175 reads/day (**100% FREE** Spark Tier operations)

> [!NOTE]
> **Automatic Failover Loop**: If the Express server goes offline or experiences a cold start (due to Render's free tier sleep mode), `store.js` automatically bypasses the proxy and registers direct `onSnapshot` listeners to Firestore to keep the checkout experience seamless.

---

## 🛡️ 4. Multi-Layer Security Architecture
* **Write Access Guards**: Direct Firestore write rules (`firestore.rules`) permit writes to products/categories collections only from verified Admin credentials.
* **User & Guest Checkout**: Registered users can write and edit their own orders and reviews. Anonymous guest users are permitted to create guest orders only.
* **Data Encryption**: All data transport occurs over TLS 1.3 / SSL encrypted tunnels, protecting cart transactions and user info.

---

## 📂 5. Project Directory & File Mappings

Below is the directory map of the codebase and its key file roles:

### Core Web & PWA Files (Root Directory)
| File | Role |
| :--- | :--- |
| `index.html` | Primary storefront landing and product display grid. |
| `shop.html` | Product collection catalog page. |
| `product-detail.html` | High-fidelity details page with reviews, sizing, and media. |
| `cart.html` & `checkout.html` | Cart state drawer, calculations, and checkout triggers. |
| `admin-*.html` | Admin pages (dashboard, products, billing, diagnostics). |
| `manifest.json` | Web App Manifest defining standalone window overlay, icons, and shortcuts. |
| `sw.js` | Service Worker handling offline caching and background FCM notifications. |
| `store.js` | Core storefront logic, state management, SWR cache, and socket listeners. |
| `config.js` | Public configuration (Firebase credentials, version tags). |
| `utils.js` | Helper modules (notifications, DOM handlers, math, theme engines). |
| `server.js` | Duplicate copy of the backend Express server code. |

### Subsystems & Companion Projects
1. **`backend/`**
   * Contains the Node.js Express server (`server.js`) and database configurations.
   * Handles visitor heartbeats (sending client pings every 25s) and keeps the Render container warm (self-pings every 8m).
2. **`kwabz-whatsapp-bot/`**
   * An automated node app (`bot.js`) using `whatsapp-web.js` to run a conversational bot client.
   * Allows customer queries and alerts to be routed directly to the admin's phone.
3. **`kwabz_store_flutter/`**
   * The Flutter mobile application migration.
   * Mirroring web PWA functionalities into compiled Android/iOS code, keeping Firestore schema and security rule parity.

---

## 🛠️ 6. Key Operations Commands

### Local Development & Server Warming
To warm up the Render backend or run local server tests:
```powershell
# In the backend directory
npm install
npm run dev
```

### Git Deployments
To push adjustments live to production:
```powershell
git add .
git commit -m "Your descriptive commit message"
git push origin main        # Updates backend Render server
git push vercel main --force # Redeploys frontend PWA CDN
```
