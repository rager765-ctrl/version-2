const puppeteer = require('puppeteer');

(async () => {
  let browser;
  try {
    console.log("Launching browser...");
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();

    // Capture console logs from the browser
    page.on('console', msg => {
      console.log(`BROWSER LOG [${msg.type().toUpperCase()}]:`, msg.text());
    });
    page.on('pageerror', err => {
      console.log('BROWSER ERROR:', err.toString());
    });

    console.log("Navigating to shop...");
    await page.goto("http://localhost:8000/shop.html", { waitUntil: 'networkidle2' });
    
    // Run script to set a mock item in cart so we don't have to navigate via clicks
    await page.evaluate(() => {
      localStorage.setItem('kwabz_cart', JSON.stringify([{
        product_id: 'test_product',
        name: 'Test Product',
        price: 100,
        quantity: 1,
        image_url: 'test.png',
        seller_id: 'main'
      }]));
    });
    
    console.log("Navigating to checkout...");
    await page.goto("http://localhost:8000/checkout.html", { waitUntil: 'networkidle2' });
    
    // Fill form
    await page.evaluate(() => {
      document.getElementById('customerName').value = 'John Doe';
      document.getElementById('customerPhone').value = '+233 24 123 4567';
      document.getElementById('customerAddress').value = '123 Main St';
    });
    
    // Click place order
    console.log("Clicking place order...");
    await page.evaluate(() => {
      // Assuming placeOrder is available globally
      if (typeof placeOrder === 'function') {
        placeOrder();
      } else {
        console.error("placeOrder function not found!");
      }
    });
    
    // Wait for a few seconds to let async operations finish
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log("Test completed successfully.");
  } catch (error) {
    console.error("ERROR during test:", error);
  } finally {
    if (browser) {
      console.log("Closing browser...");
      await browser.close();
    }
  }
})();
