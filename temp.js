
    window.addEventListener('DOMContentLoaded', () => {
      if (typeof KwabzUtils !== 'undefined') {
        KwabzUtils.requireAdmin();
      }
      
      populateCategories();
      populateSellers();
      loadProductForEdit();
      updatePreview();
    });
    // Seed data is now handled by Firestore initialization
    if (!KwabzUtils.requireAdmin()) { /* redirects */ }

    let imageDataUrl = '';
    let galleryImages = []; // Array of gallery image URLs
    let editingProductId = KwabzUtils.getParam('edit');
    let latchedSellerId = KwabzUtils.getParam('seller_id') || null;

    // ─── Gallery Management ───────────────────────────────────
    async function handleGalleryUpload(input) {
      const files = Array.from(input.files);
      if (files.length === 0) return;

      for (const file of files) {
        if (file.size > 25 * 1024 * 1024) {
          KwabzUtils.toast(`Skipping ${file.name}: Image must be under 25MB`, 'error');
          continue;
        }

        try {
          const result = await compressImageLocally(file, compressionQuality, maxDimensionBoundary);
          galleryImages.push(result.dataUrl);
        } catch (err) {
          KwabzUtils.toast(`Failed to compress ${file.name}`, 'error');
        }
      }
      
      renderGallery();
      input.value = ''; // clear for next upload
    }

    function addGalleryItem() {
      // (URL-based adding is now deprecated but keeping the function body empty if needed)
    }

    function removeGalleryItem(index) {
      galleryImages.splice(index, 1);
      renderGallery();
    }

    function renderGallery() {
      const container = document.getElementById('galleryList');
      if (!container) return;
      
      container.innerHTML = galleryImages.map((src, i) => `
        <div style="position:relative;aspect-ratio:1;border-radius:var(--radius-lg);overflow:hidden;background:var(--surface-container-high);border:1px solid var(--outline-variant);">
          <img src="${src}" style="width:100%;height:100%;object-fit:cover;" />
          <button type="button" onclick="removeGalleryItem(${i})" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.6);color:white;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;">
            <span class="material-symbols-outlined" style="font-size:14px;">close</span>
          </button>
        </div>
      `).join('');
    }

    // ─── Populate Categories ──────────────────────────────────
    function populateCategories() {
      const select = document.getElementById('productCategory');
      const categories = KwabzStore.getCategories();
      const currentVal = select.value;
      select.innerHTML = '<option value="">Select a category</option>' +
        categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      if (currentVal) select.value = currentVal;
    }

    function populateSellers() {
      const select = document.getElementById('productSeller');
      const sellers = KwabzStore.getSellers();
      const currentVal = select.value;
      
      select.innerHTML = '<option value="main">Kwabz Store (Primary)</option>' +
        sellers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      
      if (latchedSellerId) {
        // Seller was passed via URL: force-select it so the product is always tagged correctly.
        // Also visually lock the dropdown if the seller is found in the list.
        const sellerExists = sellers.some(s => s.id === latchedSellerId);
        if (sellerExists) {
          select.value = latchedSellerId;
          // Dim the main option so it's clear this product belongs to a mini-store
          const mainOption = select.querySelector('option[value="main"]');
          if (mainOption) mainOption.style.color = 'var(--outline)';
        } else {
          // Sellers haven't synced yet — lock the select until they do
          select.value = 'main'; // temporary safe default
          select.dataset.pendingSellerId = latchedSellerId;
        }
      } else if (currentVal) {
        select.value = currentVal;
      }
    }

    // ─── Image Compressor State & Functions ───────────────────
    let originalFile = null;
    let maxDimensionBoundary = 1200;
    let compressionQuality = 0.8;
    let compressedBlob = null;

    function updateQualityDisplay(val) {
      compressionQuality = parseFloat(val);
      const pct = Math.round(compressionQuality * 100);
      document.getElementById('qualityVal').textContent = `${pct}% (${compressionQuality.toFixed(2)})`;
    }

    function setDimensionBoundary(dim) {
      maxDimensionBoundary = dim;
      
      const btn800 = document.getElementById('dim_800');
      const btn1200 = document.getElementById('dim_1200');
      const btn1920 = document.getElementById('dim_1920');
      
      btn800.className = dim === 800 ? 'btn-primary' : 'btn-secondary';
      btn1200.className = dim === 1200 ? 'btn-primary' : 'btn-secondary';
      btn1920.className = dim === 1920 ? 'btn-primary' : 'btn-secondary';
      
      triggerCompression();
    }

    async function triggerCompression() {
      if (!originalFile) return;
      
      document.getElementById('compressedSizeVal').textContent = 'Optimizing...';
      
      try {
        const result = await compressImageLocally(originalFile, compressionQuality, maxDimensionBoundary);
        compressedBlob = result.blob;
        imageDataUrl = result.dataUrl;
        
        const origSizeKB = originalFile.size / 1024;
        const compSizeKB = compressedBlob.size / 1024;
        
        document.getElementById('originalSizeVal').textContent = origSizeKB > 1024 
          ? `${(origSizeKB / 1024).toFixed(2)} MB` 
          : `${origSizeKB.toFixed(1)} KB`;
          
        document.getElementById('compressedSizeVal').textContent = compSizeKB > 1024 
          ? `${(compSizeKB / 1024).toFixed(2)} MB` 
          : `${compSizeKB.toFixed(1)} KB`;
          
        const savedPct = Math.round(((originalFile.size - compressedBlob.size) / originalFile.size) * 100);
        const badge = document.getElementById('savedBadge');
        if (savedPct > 0) {
          badge.textContent = `-${savedPct}% SAVED`;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
        
        showPreview(imageDataUrl);
        
      } catch (err) {
        console.error('[Compressor] Error compressing image:', err);
        KwabzUtils.toast('Compression failed: ' + err.message, 'error');
      }
    }

    function compressImageLocally(file, quality, maxDim) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(event) {
          const img = new Image();
          img.onload = function() {
            let width = img.width;
            let height = img.height;
            
            if (width > maxDim || height > maxDim) {
              if (width > height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            
            ctx.drawImage(img, 0, 0, width, height);
            
            canvas.toBlob((blob) => {
              if (!blob) {
                reject(new Error('Canvas toBlob returned null'));
                return;
              }
              
              const reader2 = new FileReader();
              reader2.onloadend = function() {
                resolve({
                  blob: blob,
                  dataUrl: reader2.result
                });
              };
              reader2.onerror = reject;
              reader2.readAsDataURL(blob);
              
            }, 'image/jpeg', quality);
          };
          
          img.onerror = function() {
            reject(new Error('Failed to load image element'));
          };
          img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // ─── Image Upload (file → data URL) ──────────────────────
    async function handleImageUpload(input) {
      const file = input.files[0];
      if (!file) return;

      if (file.size > 25 * 1024 * 1024) {
        KwabzUtils.toast('Image must be under 25MB', 'error');
        return;
      }

      originalFile = file;
      document.getElementById('compressionPanel').style.display = 'flex';
      
      triggerCompression();
    }

    function handleImageUrl(url) {
      if (url.trim()) {
        imageDataUrl = url.trim();
        showPreview(url.trim());
        document.getElementById('compressionPanel').style.display = 'none';
        originalFile = null;
      }
    }

    function showPreview(src) {
      const preview = document.getElementById('imagePreview');
      preview.src = src;
      preview.style.display = 'block';
      document.getElementById('uploadIcon').style.display = 'none';
      document.getElementById('uploadText').style.display = 'none';
      updatePreview(); // refresh card preview
    }

    // ─── Edit Mode ────────────────────────────────────────────
    function loadProductForEdit() {
      // Check for seller_id pre-selection first
      const preSellerId = KwabzUtils.getParam('seller_id');
      if (preSellerId && !editingProductId) {
        document.getElementById('productSeller').value = preSellerId;
      }
      
      if (!editingProductId) return;

      const product = KwabzStore.getProductById(editingProductId);
      if (!product) return; 

      document.getElementById('pageTitle').textContent = 'Edit Product';
      document.getElementById('formHeading').textContent = 'Edit Item';
      document.getElementById('submitBtn').textContent = 'Update Product';

      document.getElementById('productName').value = product.name;
      document.getElementById('productCategory').value = product.category_id;
      document.getElementById('productPrice').value = product.price;
      document.getElementById('productDiscount').value = product.discount || '';
      document.getElementById('productDeliveryCost').value = product.delivery_cost || '';
      document.getElementById('productStock').value = product.stock;
      document.getElementById('productDescription').value = product.description || '';
      document.getElementById('productAvailability').value = product.availability || 'in_stock';
      document.getElementById('productSeller').value = product.seller_id || 'main';

      if (product.image_url) {
        imageDataUrl = product.image_url;
        showPreview(product.image_url);
        document.getElementById('imageUrlInput').value = product.image_url;
      }

      if (product.gallery && Array.isArray(product.gallery)) {
        galleryImages = [...product.gallery];
        renderGallery();
      }

      const toggle = document.getElementById('visibilityToggle');
      if (!product.in_stock) toggle.classList.remove('active');
    }

    // ─── Submit ───────────────────────────────────────────────
    async function handleSubmit(e) {
      e.preventDefault();

      const btn = document.getElementById('submitBtn');
      if (btn.disabled) return;
      const originalText = btn.textContent;

      const productData = {
        name: document.getElementById('productName').value.trim(),
        category_id: document.getElementById('productCategory').value,
        price: parseFloat(document.getElementById('productPrice').value),
        discount: parseInt(document.getElementById('productDiscount').value) || 0,
        delivery_cost: parseFloat(document.getElementById('productDeliveryCost').value) || 0,
        stock: parseInt(document.getElementById('productStock').value) || 0,
        description: document.getElementById('productDescription').value.trim(),
        image_url: imageDataUrl || '',
        gallery: galleryImages,
        in_stock: document.getElementById('visibilityToggle').classList.contains('active'),
        availability: document.getElementById('productAvailability').value,
        seller_id: document.getElementById('productSeller').value,
        variants: getSelectedVariants()
      };

      if (!productData.name) { KwabzUtils.toast('Product name is required', 'error'); return; }
      if (!productData.category_id) { KwabzUtils.toast('Please select a category', 'error'); return; }
      if (productData.price <= 0) { KwabzUtils.toast('Price must be greater than 0', 'error'); return; }

      // ─── Seller-Latch Safety Check ───
      // If admin arrived from a seller's page (latchedSellerId set), auto-correct
      // the seller_id to the right seller even if the dropdown hadn't fully synced.
      if (latchedSellerId) {
        const sellers = KwabzStore.getSellers();
        const sellerExists = sellers.some(s => s.id === latchedSellerId);
        if (sellerExists) {
          // Force the correct seller ID regardless of current dropdown state
          productData.seller_id = latchedSellerId;
        } else {
          // Sellers truly not loaded — block with a clear message
          KwabzUtils.toast('Seller list is still loading. Please wait a moment and try again.', 'warning');
          return;
        }
      }

      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        if (editingProductId) {
          await KwabzStore.updateProduct(editingProductId, productData);
          KwabzUtils.toast('Product updated successfully');
        } else {
          await KwabzStore.addProduct(productData);
          KwabzUtils.toast('Product added successfully');
        }

        setTimeout(() => {
          window.location.href = 'admin-products.html';
        }, 800);
      } catch (err) {
        KwabzUtils.toast('Failed to save product: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    // ─── Live Preview ─────────────────────────────────────────
    function updatePreview() {
      const name     = document.getElementById('productName').value.trim();
      const price    = parseFloat(document.getElementById('productPrice').value) || 0;
      const disc     = parseInt(document.getElementById('productDiscount').value) || 0;
      const stock    = document.getElementById('productStock').value;
      const avail    = document.getElementById('productAvailability').value;
      const catSel   = document.getElementById('productCategory');
      const selSel   = document.getElementById('productSeller');
      const visible  = document.getElementById('visibilityToggle').classList.contains('active');
      const catName  = catSel.options[catSel.selectedIndex]?.text || '—';
      const selName  = selSel.options[selSel.selectedIndex]?.text || 'Kwabz Store';
      const delCost  = parseFloat(document.getElementById('productDeliveryCost').value) || 0;

      // Image
      const img = document.getElementById('pv_img');
      const ph  = document.getElementById('pv_placeholder');
      if (imageDataUrl) {
        img.src = imageDataUrl;
        img.style.display = 'block';
        ph.style.display  = 'none';
      } else {
        img.style.display = 'none';
        ph.style.display  = 'flex';
      }

      // Badge
      const badge = document.getElementById('pv_badge');
      if (disc > 0) {
        badge.textContent = `-${disc}%`;
        badge.style.cssText = 'display:inline-block;background:#fff;color:#000;';
      } else {
        badge.style.display = 'none';
      }

      // Name
      const pvName = document.getElementById('pv_name');
      pvName.textContent = name || 'Product name...';
      pvName.style.color = name ? 'var(--on-surface)' : 'var(--outline)';

      // Price
      const discountedPrice = disc > 0 ? price * (1 - disc / 100) : price;
      document.getElementById('pv_price').textContent = `GH₵ ${discountedPrice.toFixed(2)}`;
      const orig = document.getElementById('pv_original');
      if (disc > 0 && price > 0) {
        orig.textContent = `GH₵ ${price.toFixed(2)}`;
        orig.style.display = 'inline';
      } else {
        orig.style.display = 'none';
      }

      // Availability
      const dot   = document.getElementById('pv_stock_dot');
      const availEl = document.getElementById('pv_avail');
      if (avail === 'pre_order') {
        dot.style.background = '#f59e0b';
        availEl.textContent = 'Pre-order';
      } else {
        dot.style.background = '#10b981';
        availEl.textContent = 'In Stock';
      }

      // Info rows
      document.getElementById('pv_cat').textContent    = catName !== 'Select a category' ? catName : '—';
      document.getElementById('pv_seller').textContent = selName;
      document.getElementById('pv_disc').textContent   = disc > 0 ? `${disc}%` : 'None';
      document.getElementById('pv_delivery_cost').textContent = delCost > 0 ? `GH₵ ${delCost.toFixed(2)}` : 'Free';
      document.getElementById('pv_qty').textContent    = stock || '—';
      const visEl = document.getElementById('pv_vis');
      visEl.textContent   = visible ? 'Public' : 'Hidden';
      visEl.style.color   = visible ? '#10b981' : 'var(--outline)';
    }

    // ─── Data listeners ───────────────────────────────────────
    KwabzStore.on('categories_changed', () => {
      populateCategories();
      if (editingProductId) loadProductForEdit();
      updatePreview();
    });
    KwabzStore.on('products_changed', () => {
      if (editingProductId) loadProductForEdit();
    });
    KwabzStore.on('sellers_changed', () => {
      populateSellers();
      loadProductForEdit();
      updatePreview();
    });

    // ─── Init ─────────────────────────────────────────────────
    // Init is now handled by the DOMContentLoaded wrapper above

    // ══════════════════════════════════════════════════════════
    //  GOOGLE DRIVE–STYLE PiP IMAGE PICKER
    // ══════════════════════════════════════════════════════════
    let pipCurrentTab = 'upload';
    let pipSelectedUrl = null;
    let pipRecentLoaded = false;
    let pipCompressionQuality = 0.8;
    let pipOriginalFile = null;

    function openImagePip() {
      const overlay = document.getElementById('imagePipOverlay');
      overlay.classList.add('open');
      pipSelectedUrl = null;
      document.getElementById('pipApplyBtn').disabled = true;
      // Reset compression panel
      document.getElementById('pipCompressionPanel').style.display = 'none';
      document.getElementById('pipSavedBadge').style.display = 'none';
      if (pipCurrentTab === 'recent' && !pipRecentLoaded) loadPipRecentImages();
    }

    function closeImagePip() {
      document.getElementById('imagePipOverlay').classList.remove('open');
    }

    function handlePipOverlayClick(e) {
      if (e.target === document.getElementById('imagePipOverlay')) closeImagePip();
    }

    function switchPipTab(tab) {
      pipCurrentTab = tab;
      ['upload','url','library'].forEach(function(t) {
        const pane = document.getElementById('pipPane-' + t);
        const btn = document.getElementById('pipTab-' + t);
        if (pane) pane.style.display = t === tab ? 'block' : 'none';
        if (btn) btn.classList.toggle('active', t === tab);
      });
      if (tab === 'library') loadCloudLibrary();
    }

    // ── Upload / Drop ─────────────────────────────────────────
    function handlePipFileSelect(input) {
      const file = input.files[0];
      if (file) processPipFile(file);
    }

    function handlePipDrop(e) {
      e.preventDefault();
      document.getElementById('pipDropZone').classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) processPipFile(file);
    }

    async function processPipFile(file) {
      if (file.size > 25 * 1024 * 1024) {
        KwabzUtils.toast('Image must be under 25MB', 'error');
        return;
      }
      pipOriginalFile = file;
      document.getElementById('pipCompressionPanel').style.display = 'block';
      document.getElementById('pipCompSize').textContent = 'Compressing...';

      const result = await compressImageLocally(file, pipCompressionQuality, 1200);

      const origKB = file.size / 1024;
      const compKB = result.blob.size / 1024;
      document.getElementById('pipOrigSize').textContent = origKB > 1024
        ? (origKB / 1024).toFixed(2) + ' MB'
        : origKB.toFixed(0) + ' KB';
      document.getElementById('pipCompSize').textContent = compKB > 1024
        ? (compKB / 1024).toFixed(2) + ' MB'
        : compKB.toFixed(0) + ' KB';

      const savedPct = Math.round(((file.size - result.blob.size) / file.size) * 100);
      const badge = document.getElementById('pipSavedBadge');
      if (savedPct > 0) {
        badge.textContent = '-' + savedPct + '% SAVED';
        badge.style.display = 'inline-block';
      }

      pipSelectedUrl = result.dataUrl;
      document.getElementById('pipApplyBtn').disabled = false;
      document.getElementById('pipSaveToLibraryRow').style.display = 'block';
    }

    function pipUpdateQuality(val) {
      pipCompressionQuality = parseFloat(val);
      document.getElementById('pipQualityVal').textContent = Math.round(pipCompressionQuality * 100) + '%';
      if (pipOriginalFile) processPipFile(pipOriginalFile);
    }

    // ── URL Tab ───────────────────────────────────────────────
    function previewPipUrl() {
      const url = document.getElementById('pipUrlInput').value.trim();
      if (!url) return;
      const previewDiv = document.getElementById('pipUrlPreview');
      const previewImg = document.getElementById('pipUrlPreviewImg');
      previewImg.onload = function() {
        previewDiv.style.display = 'block';
        pipSelectedUrl = url;
        document.getElementById('pipApplyBtn').disabled = false;
      };
      previewImg.onerror = function() {
        KwabzUtils.toast('Could not load image from that URL', 'error');
      };
      previewImg.src = url;
    }

    // ── Recent Images ─────────────────────────────────────────
    async function loadPipRecentImages() {
      const grid = document.getElementById('pipRecentGrid');
      try {
        const snap = await firebase.firestore().collection('products')
          .where('image_url', '!=', '')
          .limit(30)
          .get();

        const allUrls = snap.docs.map(function(d) { return d.data().image_url; });
        const urls = allUrls.filter(function(u, i) {
          return u && u.length > 5 && allUrls.indexOf(u) === i;
        }).slice(0, 24);

        if (urls.length === 0) {
          grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--outline);font-size:0.8125rem;"><span class="material-symbols-outlined" style="font-size:2rem;display:block;margin-bottom:0.5rem;">image_not_supported</span>No images found in catalog yet.</div>';
          return;
        }

        grid.innerHTML = urls.map(function(url, i) {
          const safeUrl = url.replace(/"/g, '&quot;');
          return '<div class="pip-recent-item" id="pipRecent-' + i + '" onclick="selectPipRecent(\'' + safeUrl.replace(/'/g, "\\'") + '\',' + i + ')" title="Select image">' +
            '<img src="' + safeUrl + '" loading="lazy" onerror="this.parentElement.style.display=\'none\'" />' +
            '<span class="pip-check material-symbols-outlined" style="font-size:0.875rem;">check</span>' +
            '</div>';
        }).join('');

        pipRecentLoaded = true;
      } catch (err) {
        console.warn('PiP recent images error:', err);
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--outline);">Could not load recent images.</div>';
      }
    }

    function selectPipRecent(url, index) {
      document.querySelectorAll('.pip-recent-item').forEach(function(el) {
        el.classList.remove('selected');
      });
      const item = document.getElementById('pipRecent-' + index);
      if (item) item.classList.add('selected');
      pipSelectedUrl = url;
      document.getElementById('pipApplyBtn').disabled = false;
    }

    // ── Apply Selection ───────────────────────────────────────
    function applyPipSelection() {
      if (!pipSelectedUrl) return;

      imageDataUrl = pipSelectedUrl;

      // Update the trigger button preview
      const preview = document.getElementById('imagePreview');
      preview.src = pipSelectedUrl;
      preview.style.display = 'block';
      document.getElementById('uploadIcon').style.display = 'none';
      document.getElementById('uploadText').style.display = 'none';
      document.getElementById('pipTriggerOverlay').style.display = 'flex';

      updatePreview();
      closeImagePip();
      KwabzUtils.toast('Image inserted!', 'success');
    }

    // ══════════════════════════════════════════════════════════
    //  CLOUD IMAGE LIBRARY (Firestore: media_library)
    // ══════════════════════════════════════════════════════════
    let libraryLoaded = false;
    let libraryItems = [];
    let librarySelectedId = null;

    async function loadCloudLibrary() {
      const grid = document.getElementById('pipLibraryGrid');
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--outline);"><span class="material-symbols-outlined" style="font-size:2rem;display:block;">cloud_sync</span>Loading...</div>';
      try {
        const snap = await firebase.firestore().collection('media_library').orderBy('created_at', 'desc').limit(40).get();
        libraryItems = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
        renderLibraryGrid();
        libraryLoaded = true;
      } catch (err) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--outline);">Could not load library.</div>';
      }
    }

    function renderLibraryGrid() {
      const grid = document.getElementById('pipLibraryGrid');
      if (libraryItems.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--outline);font-size:0.8125rem;"><span class="material-symbols-outlined" style="font-size:2rem;display:block;margin-bottom:0.5rem;">add_photo_alternate</span>Library is empty. Upload images and save them to your library.</div>';
        return;
      }
      grid.innerHTML = libraryItems.map(function(item, i) {
        const isSelected = item.id === librarySelectedId;
        return '<div class="pip-recent-item' + (isSelected ? ' selected' : '') + '" id="libItem-' + item.id + '" style="position:relative;">' +
          '<img src="' + item.image_url + '" loading="lazy" onerror="this.parentElement.style.display=\'none\'" />' +
          '<span class="pip-check material-symbols-outlined" style="font-size:0.875rem;">check</span>' +
          '<button onclick="deleteLibraryItem(\'' + item.id + '\',event)" style="position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.6);color:white;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:10px;" title="Delete from library">' +
          '<span class="material-symbols-outlined" style="font-size:11px;">delete</span></button>' +
          '<div onclick="selectLibraryItem(\'' + item.id + '\',\'' + item.image_url.replace(/'/g, "\\'"  ) + '\')" style="position:absolute;inset:0;z-index:1;"></div>' +
          '</div>';
      }).join('');
    }

    function selectLibraryItem(id, url) {
      librarySelectedId = id;
      pipSelectedUrl = url;
      document.getElementById('pipApplyBtn').disabled = false;
      document.querySelectorAll('#pipLibraryGrid .pip-recent-item').forEach(function(el) { el.classList.remove('selected'); });
      const item = document.getElementById('libItem-' + id);
      if (item) item.classList.add('selected');
    }

    async function deleteLibraryItem(id, e) {
      e.stopPropagation();
      if (!confirm('Remove this image from your library?')) return;
      try {
        await firebase.firestore().collection('media_library').doc(id).delete();
        libraryItems = libraryItems.filter(function(i) { return i.id !== id; });
        if (librarySelectedId === id) { librarySelectedId = null; pipSelectedUrl = null; document.getElementById('pipApplyBtn').disabled = true; }
        renderLibraryGrid();
        KwabzUtils.toast('Image removed from library', 'success');
      } catch (err) {
        KwabzUtils.toast('Could not delete: ' + err.message, 'error');
      }
    }

    async function saveCurrentToLibrary() {
      if (!pipSelectedUrl) return;
      const btn = document.querySelector('[onclick="saveCurrentToLibrary()"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
      try {
        const ref = await firebase.firestore().collection('media_library').add({
          image_url: pipSelectedUrl,
          created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        KwabzUtils.toast('Image saved to Cloud Library!', 'success');
        libraryItems.unshift({ id: ref.id, image_url: pipSelectedUrl });
      } catch (err) {
        KwabzUtils.toast('Save failed: ' + err.message, 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem;">cloud_upload</span> Save to Cloud Library'; }
      }
    }

    function refreshLibrary() {
      libraryLoaded = false;
      loadCloudLibrary();
    }

    // ══════════════════════════════════════════════════════════
    //  PRODUCT VARIANTS / DIMENSIONS
    // ══════════════════════════════════════════════════════════
    // Default presets per category name keywords
    const DEFAULT_VARIANT_PRESETS = {
      clothing:   ['XS','S','M','L','XL','2XL','3XL'],
      shirts:     ['XS','S','M','L','XL','2XL'],
      shoes:      ['36','37','38','39','40','41','42','43','44','45'],
      food:       ['Small','Medium','Large','Family'],
      beverages:  ['250ml','500ml','750ml','1L'],
      electronics:['Standard','Premium'],
      default:    ['S','M','L','XL']
    };

    let currentVariants = [];    // all chips shown (preset + custom)
    let selectedVariants = [];   // only the ticked ones
    let vmWorkingPresets = [];   // variant manager working copy

    function getSelectedVariants() { return selectedVariants.slice(); }

    async function loadVariantPresets(categoryId) {
      if (!categoryId) return;
      const container = document.getElementById('variantChipsContainer');
      container.innerHTML = '<span style="font-size:0.8125rem;color:var(--outline);">Loading variants...</span>';
      selectedVariants = [];

      try {
        const doc = await firebase.firestore().collection('category_variants').doc(categoryId).get();
        if (doc.exists && doc.data().presets && doc.data().presets.length > 0) {
          currentVariants = doc.data().presets;
        } else {
          // Fallback: match category name to a keyword
          const cats = KwabzStore.getCategories();
          const cat = cats.find(function(c) { return c.id === categoryId; });
          const name = cat ? cat.name.toLowerCase() : '';
          let matched = DEFAULT_VARIANT_PRESETS.default;
          Object.keys(DEFAULT_VARIANT_PRESETS).forEach(function(key) {
            if (name.includes(key)) matched = DEFAULT_VARIANT_PRESETS[key];
          });
          currentVariants = matched.slice();
        }
        renderVariantChips();
      } catch (err) {
        currentVariants = DEFAULT_VARIANT_PRESETS.default.slice();
        renderVariantChips();
      }
    }

    function renderVariantChips() {
      const container = document.getElementById('variantChipsContainer');
      if (currentVariants.length === 0) {
        container.innerHTML = '<span style="font-size:0.8125rem;color:var(--outline);">No presets. Add custom variants below.</span>';
        return;
      }
      container.innerHTML = currentVariants.map(function(v) {
        const isSelected = selectedVariants.includes(v);
        return '<button type="button" class="variant-chip' + (isSelected ? ' selected' : '') + '" onclick="toggleVariant(\'' + v + '\')">'
          + v + '</button>';
      }).join('');
    }

    function toggleVariant(v) {
      const idx = selectedVariants.indexOf(v);
      if (idx === -1) selectedVariants.push(v);
      else selectedVariants.splice(idx, 1);
      renderVariantChips();
    }

    function addCustomVariant() {
      const input = document.getElementById('customVariantInput');
      const val = input.value.trim().toUpperCase();
      if (!val) return;
      if (!currentVariants.includes(val)) {
        currentVariants.push(val);
        selectedVariants.push(val);
        renderVariantChips();
      } else {
        if (!selectedVariants.includes(val)) { selectedVariants.push(val); renderVariantChips(); }
      }
      input.value = '';
    }

    // ── Variant Manager Modal ─────────────────────────────────
    function openVariantManager() {
      const modal = document.getElementById('variantManagerModal');
      modal.classList.add('open');
      const vmSel = document.getElementById('vmCategorySelect');
      const cats = KwabzStore.getCategories();
      vmSel.innerHTML = '<option value="">-- Select Category --</option>' +
        cats.map(function(c) { return '<option value="' + c.id + '">' + c.name + '</option>'; }).join('');
      // Pre-select current category if set
      const curCat = document.getElementById('productCategory').value;
      if (curCat) { vmSel.value = curCat; loadVmPresets(); }
    }

    function closeVariantManager() {
      document.getElementById('variantManagerModal').classList.remove('open');
    }

    async function loadVmPresets() {
      const catId = document.getElementById('vmCategorySelect').value;
      if (!catId) return;
      const container = document.getElementById('vmCurrentPresets');
      container.innerHTML = '<span style="font-size:0.8125rem;color:var(--outline);">Loading...</span>';

      try {
        const doc = await firebase.firestore().collection('category_variants').doc(catId).get();
        if (doc.exists && doc.data().presets) {
          vmWorkingPresets = doc.data().presets.slice();
        } else {
          const cats = KwabzStore.getCategories();
          const cat = cats.find(function(c) { return c.id === catId; });
          const name = cat ? cat.name.toLowerCase() : '';
          let matched = DEFAULT_VARIANT_PRESETS.default;
          Object.keys(DEFAULT_VARIANT_PRESETS).forEach(function(key) {
            if (name.includes(key)) matched = DEFAULT_VARIANT_PRESETS[key];
          });
          vmWorkingPresets = matched.slice();
        }
        renderVmPresets();
      } catch (err) {
        vmWorkingPresets = [];
        renderVmPresets();
      }
    }

    function renderVmPresets() {
      const container = document.getElementById('vmCurrentPresets');
      if (vmWorkingPresets.length === 0) {
        container.innerHTML = '<span style="font-size:0.8125rem;color:var(--outline);">No presets yet. Add below.</span>';
        return;
      }
      container.innerHTML = vmWorkingPresets.map(function(v) {
        return '<button type="button" class="variant-chip remove-chip" onclick="removeVmPreset(\'' + v + '\')" title="Remove">'
          + v + ' ✕</button>';
      }).join('');
    }

    function addVmPreset() {
      const input = document.getElementById('vmNewVariant');
      const val = input.value.trim().toUpperCase();
      if (!val || vmWorkingPresets.includes(val)) { input.value = ''; return; }
      vmWorkingPresets.push(val);
      renderVmPresets();
      input.value = '';
    }

    function removeVmPreset(v) {
      vmWorkingPresets = vmWorkingPresets.filter(function(x) { return x !== v; });
      renderVmPresets();
    }

    async function saveVmPresets() {
      const catId = document.getElementById('vmCategorySelect').value;
      if (!catId) { KwabzUtils.toast('Select a category first', 'error'); return; }
      try {
        await firebase.firestore().collection('category_variants').doc(catId).set({
          presets: vmWorkingPresets,
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        KwabzUtils.toast('Variant presets saved!', 'success');
        closeVariantManager();
        // Reload for product form if same category
        const curCat = document.getElementById('productCategory').value;
        if (curCat === catId) loadVariantPresets(catId);
      } catch (err) {
        KwabzUtils.toast('Save failed: ' + err.message, 'error');
      }
    }
  