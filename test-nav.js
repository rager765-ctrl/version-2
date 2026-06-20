const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  try {
    console.log('Navigating to seller-dashboard...');
    await page.goto('http://localhost:8000/seller-dashboard.html', { waitUntil: 'networkidle2' });
    console.log('Waiting 6 seconds for any initialization/splash...');
    await new Promise(r => setTimeout(r, 6000));
    console.log('Checking active tab...');
    const activeTab = await page.evaluate(() => {
      const el = document.querySelector('.tab-content.active');
      return el ? el.id : 'none';
    });
    console.log('Active tab initially:', activeTab);
    
    console.log('Clicking on nav-products...');
    await page.click('#nav-products');
    await new Promise(r => setTimeout(r, 1000));
    
    const activeTabAfter = await page.evaluate(() => {
      const el = document.querySelector('.tab-content.active');
      return el ? el.id : 'none';
    });
    console.log('Active tab after click:', activeTabAfter);
  } catch (err) {
    console.error('Puppeteer Script Error:', err);
  } finally {
    await browser.close();
  }
})();
