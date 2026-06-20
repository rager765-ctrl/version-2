const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const html = fs.readFileSync('c:/Users/kelvin/Desktop/version-2-main/seller-dashboard.html', 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;
const overview = doc.getElementById('tab-overview');
const products = doc.getElementById('tab-products');
const orders = doc.getElementById('tab-orders');
const settings = doc.getElementById('tab-settings');

console.log('overview parent:', overview ? overview.parentElement.tagName : 'null');
console.log('products parent:', products ? products.parentElement.tagName : 'null');
console.log('orders parent:', orders ? orders.parentElement.tagName : 'null');
console.log('settings parent:', settings ? settings.parentElement.tagName : 'null');

if (overview && products) {
  console.log('Is products inside overview?', overview.contains(products));
}
if (overview && orders) {
  console.log('Is orders inside overview?', overview.contains(orders));
}
