const fs = require('fs');
const path = require('path');

const adminPath = path.join(__dirname, 'admin-add-product.html');
const sellerPath = path.join(__dirname, 'seller-dashboard.html');
const rulesPath = path.join(__dirname, 'firestore.rules');

let adminHtml = fs.readFileSync(adminPath, 'utf8');
let sellerHtml = fs.readFileSync(sellerPath, 'utf8');
let rules = fs.readFileSync(rulesPath, 'utf8');

// Update firestore.rules
rules = rules.replace(
  /match \/media_library\/{imageId} {\s*allow read, write: if isAdmin\(\);\s*}/g,
  "match /media_library/{imageId} {\\n      allow read, write: if isAdmin() || (\\n        request.auth != null && (\\n          (resource == null || resource.data.seller_id == request.auth.uid) &&\\n          (request.resource == null || request.resource.data.seller_id == request.auth.uid)\\n        )\\n      );\\n    }"
);
fs.writeFileSync(rulesPath, rules);

// Extract CSS
const cssMatch = adminHtml.match(/\/\* Google Drive Style Image Picker \(PiP\) \*\/[\s\S]*?\.pip-trigger-btn:hover \.pip-trigger-overlay \{ display: flex !important; \}/);
const pipCss = cssMatch ? cssMatch[0] : '';

// Extract HTML
const pipHtmlStart = adminHtml.indexOf('<!-- ════ Google Drive–Style PiP Image Picker ════ -->');
const pipHtmlEnd = adminHtml.indexOf('<!-- ════ Variant Manager Modal ════ -->');
const pipHtml = adminHtml.substring(pipHtmlStart, pipHtmlEnd);

const pipJsStart = adminHtml.indexOf("let pipTarget = 'main';");
const pipJsEndMatch = adminHtml.indexOf("window.refreshLibrary = refreshLibrary;");
const pipJsEnd = adminHtml.indexOf("}", pipJsEndMatch) + 1;
let pipJs = adminHtml.substring(pipJsStart, pipJsEndMatch + "window.refreshLibrary = refreshLibrary;".length);

pipJs = pipJs.replace(
  /const ref = await firebase\.firestore\(\)\.collection\('media_library'\)\.add\(\{/g,
  "const ref = await firebase.firestore().collection('media_library').add({\\n          seller_id: window.currentSellerData ? window.currentSellerData.id : currentSellerId,"
);
pipJs = pipJs.replace(
  /snap = await firebase\.firestore\(\)\.collection\('media_library'\)\.orderBy\('created_at', 'desc'\)\.limit\(40\)\.get\(\);/g,
  "snap = await firebase.firestore().collection('media_library').where('seller_id', '==', window.currentSellerData ? window.currentSellerData.id : currentSellerId).orderBy('created_at', 'desc').limit(40).get();"
);
pipJs = pipJs.replace(
  /snap = await firebase\.firestore\(\)\.collection\('media_library'\)\.limit\(40\)\.get\(\);/g,
  "snap = await firebase.firestore().collection('media_library').where('seller_id', '==', window.currentSellerData ? window.currentSellerData.id : currentSellerId).limit(40).get();"
);
pipJs = pipJs.replace(
  /const snap = await firebase\.firestore\(\)\.collection\('products'\)\.where\('image_url', '!=', ''\)\.limit\(30\)\.get\(\);/g,
  "const snap = await firebase.firestore().collection('products').where('seller_id', '==', window.currentSellerData ? window.currentSellerData.id : currentSellerId).where('image_url', '!=', '').limit(30).get();"
);

sellerHtml = sellerHtml.replace('</style>', '\\n' + pipCss + '\\n</style>');
sellerHtml = sellerHtml.replace('<!-- ═══ Bottom Tabs Navigation ═══ -->', pipHtml + '\\n  <!-- ═══ Bottom Tabs Navigation ═══ -->');

sellerHtml = sellerHtml.replace(
  /onclick="document\.getElementById\('dimensionUploadInput'\)\.click\(\)"([^>]*)>\s*<span class="material-symbols-outlined"[^>]*>cloud<\/span>/g,
  "onclick=\"openImagePip('gallery')\"$1>\\n              <span class=\"material-symbols-outlined\" style=\"color:var(--outline);font-size:1.5rem;margin-bottom:0.5rem;\">cloud</span>"
);

sellerHtml = sellerHtml.replace(
  /<div class="upload-zone-seller" style="padding:1\.5rem; min-height:160px;">[\s\S]*?<\/div>/g,
  "<button type=\"button\" class=\"pip-trigger-btn\" id=\"pipTriggerBtn\" onclick=\"openImagePip('main')\" style=\"width:100%; border-radius:var(--radius-lg); aspect-ratio:16/9; border:2px dashed var(--outline-variant); background:var(--surface-container-high); cursor:pointer; position:relative; overflow:hidden; display:flex; flex-direction:column; align-items:center; justify-content:center; transition:all 0.2s;\">\\n            <img id=\"imagePreview\" class=\"pip-trigger-preview\" alt=\"Hero image preview\" style=\"display:none; position:absolute; inset:0; width:100%; height:100%; object-fit:cover;\" />\\n            <div class=\"pip-trigger-overlay\" id=\"pipTriggerOverlay\" style=\"display:none; position:absolute; inset:0; background:rgba(0,0,0,0.45); color:white; align-items:center; justify-content:center; font-weight:700; gap:0.5rem; z-index:2;\">\\n              <span class=\"material-symbols-outlined\">edit</span> Change Image\\n            </div>\\n            <span class=\"material-symbols-outlined pip-drop-zone-icon\" id=\"uploadIcon\" style=\"font-size:2rem; color:var(--outline); margin-bottom:0.5rem;\">add_photo_alternate</span>\\n            <span id=\"uploadText\" style=\"font-size:0.875rem; font-weight:700; color:var(--on-surface);\">Select Hero Image</span>\\n            <span id=\"uploadSubText\" style=\"font-size:0.7rem; color:var(--outline); margin-top:0.25rem;\">Click to open picker</span>\\n          </button>"
);

const newApplyPipSelection = `function applyPipSelection() {
      if (pipTarget === 'gallery') {
        if (pipSelectedUrls.length > 0) {
          pipSelectedUrls.forEach(url => {
            if(base64DimensionImages.length < 50) {
               base64DimensionImages.push(url);
            }
          });
          renderDimensionImages();
          closeImagePip();
          KwabzUtils.toast('Images added to gallery!', 'success');
        }
        return;
      }

      if (!pipSelectedUrl) return;

      base64ProductImage = pipSelectedUrl;

      const preview = document.getElementById('imagePreview');
      preview.src = pipSelectedUrl;
      preview.style.display = 'block';
      const uploadIcon = document.getElementById('uploadIcon');
      if(uploadIcon) uploadIcon.style.display = 'none';
      const uploadText = document.getElementById('uploadText');
      if(uploadText) uploadText.style.display = 'none';
      const uploadSubText = document.getElementById('uploadSubText');
      if(uploadSubText) uploadSubText.style.display = 'none';
      const overlay = document.getElementById('pipTriggerOverlay');
      if(overlay) overlay.style.display = 'flex';

      closeImagePip();
      KwabzUtils.toast('Image inserted!', 'success');
    }`;

pipJs = pipJs.replace(
  /function applyPipSelection\(\) \{[\s\S]*?KwabzUtils\.toast\('Image inserted!', 'success'\);\s*\}/,
  newApplyPipSelection
);

const missingVars = "let pipSelectedUrl = null;\\nlet pipSelectedUrls = [];\\nlet pipCompressionQuality = 0.8;\\nlet pipOriginalFile = null;\\nlet pipRecentLoaded = false;\\n";
sellerHtml = sellerHtml.replace('</script>\\n</body>', missingVars + "\\n" + pipJs + '\\n  </script>\\n</body>');

sellerHtml = sellerHtml.replace(/document\.getElementById\('productImagePreview'\)\.style\.display = 'none';/g, "document.getElementById('imagePreview').style.display = 'none';\\n      document.getElementById('uploadIcon').style.display = 'block';\\n      document.getElementById('uploadText').style.display = 'block';\\n      document.getElementById('uploadSubText').style.display = 'block';\\n      document.getElementById('pipTriggerOverlay').style.display = 'none';");

sellerHtml = sellerHtml.replace(/const preview = document\.getElementById\('productImagePreview'\);[\s\S]*?base64ProductImage = "";\s*\}/g, "const preview = document.getElementById('imagePreview');\\n      if (p.image_url || p.image) {\\n        preview.src = p.image_url || p.image;\\n        preview.style.display = 'block';\\n        base64ProductImage = p.image_url || p.image || \"\";\\n        document.getElementById('uploadIcon').style.display = 'none';\\n        document.getElementById('uploadText').style.display = 'none';\\n        document.getElementById('uploadSubText').style.display = 'none';\\n        document.getElementById('pipTriggerOverlay').style.display = 'flex';\\n      } else {\\n        preview.style.display = 'none';\\n        base64ProductImage = \"\";\\n        document.getElementById('uploadIcon').style.display = 'block';\\n        document.getElementById('uploadText').style.display = 'block';\\n        document.getElementById('uploadSubText').style.display = 'block';\\n        document.getElementById('pipTriggerOverlay').style.display = 'none';\\n      }");

fs.writeFileSync(sellerPath, sellerHtml);
console.log('Successfully injected PIP into seller-dashboard');
