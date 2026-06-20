const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const html = fs.readFileSync('c:/Users/kelvin/Desktop/version-2-main/seller-dashboard.html', 'utf8');
const virtualConsole = new jsdom.VirtualConsole();
virtualConsole.on("jsdomError", (error) => {
  console.error("JSDOM Error:", error.message);
});
virtualConsole.on("error", (error) => {
  console.error("Virtual Console Error:", error);
});
const dom = new JSDOM(html, { runScripts: "dangerously", virtualConsole });
