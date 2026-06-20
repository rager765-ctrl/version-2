const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const html = fs.readFileSync('c:/Users/kelvin/Desktop/version-2-main/seller-dashboard.html', 'utf8');
const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/seller-dashboard.html" });
dom.window.document.addEventListener('DOMContentLoaded', () => {
  try {
    const navProducts = dom.window.document.getElementById('nav-products');
    navProducts.click();
    const activeTab = dom.window.document.querySelector('.tab-content.active');
    console.log('Active tab id after click:', activeTab ? activeTab.id : 'none');
    
    // Catch errors
    if (dom.window.onerror) {
      console.log('Window Error:', dom.window.onerror);
    }
  } catch (err) {
    console.log('Error during click:', err);
  }
});
