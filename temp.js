
    let currentSellerId = null;
    let sellerProducts = [];
    let sellerOrders = [];

    // Tab switcher — defined immediately so nav works before auth resolves
    window.switchTab = function (tabName) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.bottom-nav-admin__item').forEach(el => el.classList.remove('active'));

      const tabEl = document.getElementById('tab-' + tabName);
      const navEl = document.getElementById('nav-' + tabName);
      if (tabEl) tabEl.classList.add('active');
      if (navEl) navEl.classList.add('active');

      // Scroll content area back to top on tab switch
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.querySelector('.page-content')?.scrollTo({ top: 0, behavior: 'instant' });

      if (typeof selectMode !== 'undefined' && selectMode && typeof toggleSelectMode === 'function') {
        toggleSelectMode();
      }
      if (typeof productSelectMode !== 'undefined' && productSelectMode && typeof toggleProductSelectMode === 'function') {
        toggleProductSelectMode();
      }
    };
    let deleteTargetId = null;
    let base64ProductImage = "";
    let base64StoreLogo = "";
    let base64AboutCover = "";
    let sellerCustomCategories = {};
    let base64CustomCatImage = "";
    let categoriesList = [];
    let selectMode = false;
    let selectedOrderIds = new Set();
    let productSelectMode = false;
    let selectedProductIds = new Set();
    let selectedColors = [];

    // ─── Color Variant Helpers ───────────────────────────────────
    const COLOR_PRESETS = [
      '#000000', '#FFFFFF', '#FF0000', '#FF6B00', '#FFD700',
      '#00C853', '#2979FF', '#AA00FF', '#FF4081', '#795548',
      '#607D8B', '#F5F5F5', '#BDBDBD', '#FF8F00', '#00BCD4'
    ];

    function initColorPresets() {
      const row = document.getElementById('colorPresetRow');
      if (!row) return;
      row.innerHTML = COLOR_PRESETS.map(c => `
        <div onclick="quickAddColor('${c}')"
             title="${c}"
             style="width:1.75rem; height:1.75rem; border-radius:50%; background:${c}; border:2px solid ${c === '#FFFFFF' || c === '#F5F5F5' ? '#ccc' : c}; cursor:pointer; flex-shrink:0; transition:transform 0.15s; box-shadow:0 1px 3px rgba(0,0,0,0.2);"
             onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'"></div>
      `).join('');
    }

    function quickAddColor(hex) {
      if (!selectedColors.includes(hex)) selectedColors.push(hex);
      renderSelectedColors();
    }

    window.addColorVariant = function () {
      const hexInput = document.getElementById('prodColorHex');
      let val = (hexInput.value || document.getElementById('prodColorPicker').value || '').trim();
      if (!val) return;
      if (!val.startsWith('#')) val = val; // allow color names too
      if (!selectedColors.includes(val)) selectedColors.push(val);
      hexInput.value = '';
      renderSelectedColors();
    };

    window.removeColorVariant = function (idx) {
      selectedColors.splice(idx, 1);
      renderSelectedColors();
    };

    function renderSelectedColors() {
      const row = document.getElementById('selectedColorsRow');
      if (!row) return;
      if (selectedColors.length === 0) {
        row.innerHTML = '<span style="font-size:0.7rem; color:var(--outline); font-style:italic;">No colors added yet</span>';
        return;
      }
      row.innerHTML = selectedColors.map((c, i) => `
        <div style="display:flex; align-items:center; gap:0.3rem; background:var(--surface-container-high); border-radius:100px; padding:0.25rem 0.5rem 0.25rem 0.35rem; border:1px solid var(--outline-variant);">
          <div style="width:1.1rem; height:1.1rem; border-radius:50%; background:${c}; border:1px solid rgba(0,0,0,0.15); flex-shrink:0;"></div>
          <span style="font-size:0.65rem; font-weight:700; font-family:monospace; color:var(--on-surface-variant);">${KwabzUtils.getColorName(c)}</span>
          <button type="button" onclick="removeColorVariant(${i})" style="background:none; border:none; cursor:pointer; color:var(--outline); font-size:0.7rem; padding:0; line-height:1; display:flex; align-items:center;">✕</button>
        </div>
      `).join('');
    }

    document.addEventListener('DOMContentLoaded', () => {
      KwabzUtils.requireAuth();

      // Implement Splash Greeting Animation
      const greeting = document.getElementById('greetingWrapper');
      const cards = document.getElementById('dashboardCardsWrapper');
      const header = document.querySelector('.top-app-bar');

      if (greeting && cards) {
        // Create an overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.3); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); z-index:9998; transition:opacity 0.8s ease;';
        document.body.appendChild(overlay);

        greeting.classList.add('splash-active');
        cards.classList.add('body-blurred');
        if (header) header.classList.add('body-blurred');

        setTimeout(() => {
          greeting.classList.add('splash-fade-out');
          cards.classList.remove('body-blurred');
          if (header) header.classList.remove('body-blurred');
          overlay.style.opacity = '0';

          setTimeout(() => {
            greeting.style.display = 'none';
            overlay.remove();
          }, 800);
        }, 5000); // 5 seconds display
      }
    });

    // Route guard and initialization
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        window.location.replace('login.html?redirect=seller-dashboard.html');
        return;
      }
      currentSellerId = user.uid;
      // Greet immediately with auth display name (Firestore will update it with store name)
      document.getElementById('welcomeUser').textContent = user.displayName || 'Store Owner';

      // Show empty states immediately (before Firebase data arrives) so UI isn't blank
      renderProductsTab();
      renderOrdersTab();
      renderOverviewActivity();

      // Check role
      try {
        const doc = await firebase.firestore().collection('users').doc(user.uid).get();
        if (!doc.exists || doc.data().role !== 'seller') {
          const isAdmin = ['admin@kwabzstore.com', 'admin@kwabz.com', 'kelvin@kwabz.com'].includes(user.email) || (doc.exists && doc.data().role === 'admin');
          if (!isAdmin) {
            alert('Access denied. You must be registered as a seller to access this dashboard.');
            window.location.replace('index.html');
            return;
          }
        }

        // Initialize Store Settings view & data listeners
        await initSellerDashboard();
      } catch (err) {
        console.error('Error during role checks:', err);
      }
    });

    async function initSellerDashboard() {
      // 1. Fetch Categories
      try {
        const categoriesSnap = await firebase.firestore().collection('categories').get();
        categoriesList = categoriesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const catSelect = document.getElementById('prodCategory');
        if (catSelect) {
          catSelect.innerHTML = categoriesList.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
        const customCatSelect = document.getElementById('settingCustomCatSelect');
        if (customCatSelect) {
          customCatSelect.innerHTML = '<option value="">-- Select a Category --</option>' +
            categoriesList.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
      } catch (catErr) {
        console.warn('Failed to load categories, proceeding with dashboard initialization:', catErr);
      }

      // 2. Fetch/Listen Seller Profile
      firebase.firestore().collection('sellers').doc(currentSellerId).onSnapshot(doc => {
        if (doc.exists) {
          const seller = doc.data();
          window.currentSellerData = seller;

          const storeUrl = window.location.origin + '/seller-store.html?id=' + currentSellerId;
          const linkDisplay = document.getElementById('settingStoreLinkDisplay');
          if (linkDisplay) linkDisplay.value = storeUrl;

          document.getElementById('storeTitle').textContent = seller.name || 'Seller Dashboard';
          document.getElementById('welcomeUser').textContent = firebase.auth().currentUser?.displayName || 'Store Owner';

          if (seller.profile_image) {
            const dp = document.getElementById('dashboardProfileImage');
            if (dp) dp.src = seller.profile_image;
          }

          const badge = document.getElementById('planBadge');
          if (badge) { badge.textContent = (seller.plan || 'free').toUpperCase() + ' PLAN'; badge.style.display = 'inline-block'; }
          document.getElementById('settingStoreName').value = seller.name || '';
          document.getElementById('settingStorePhone').value = seller.phone || '';
          document.getElementById('settingDeliveryCost').value = seller.deliveryCost || 0;
          document.getElementById('statCommission').textContent = (seller.commission || 10) + '%';

          if (seller.logo || seller.image_url) {
            base64StoreLogo = seller.logo || seller.image_url;
            const preview = document.getElementById('storeLogoPreview');
            preview.src = base64StoreLogo;
            preview.style.display = 'block';
          }

          // Populate About / Journal fields
          document.getElementById('settingAboutTitle').value = seller.about_title || '';
          document.getElementById('settingAboutSubtitle').value = seller.about_subtitle || '';
          document.getElementById('settingAboutStory').value = seller.about_story || '';
          document.getElementById('settingAboutInstagram').value = seller.about_instagram || '';

          // Populate storefront custom category overrides
          sellerCustomCategories = seller.custom_categories || {};
          renderCategoryOverridesList();
          if (seller.about_cover) {
            base64AboutCover = seller.about_cover;
            const preview = document.getElementById('aboutCoverPreview');
            if (preview) {
              preview.src = base64AboutCover;
              preview.style.display = 'block';
            }
          } else {
            base64AboutCover = '';
            const preview = document.getElementById('aboutCoverPreview');
            if (preview) preview.style.display = 'none';
          }

          // Update Account Plan UI
          const currentPlan = (seller.plan || 'free').toLowerCase();
          const limitValue = seller.listing_limit || (currentPlan === 'basic' ? 15 : currentPlan === 'premium' ? 25 : 5);
          const limitDisplay = limitValue >= 999999 ? 'Unlimited' : limitValue;

          const planTextEl = document.getElementById('currentPlanText');
          const planLimitEl = document.getElementById('planLimitText');
          if (planTextEl) planTextEl.textContent = currentPlan.toUpperCase() + ' TIER';
          if (planLimitEl) {
            let baseText = `Up to ${limitDisplay} listings`;
            if (currentPlan === 'premium') {
              baseText += ' + Dimension Images, Variants & 50 Cloud Uploads';
            } else if (currentPlan === 'basic') {
              baseText += ' + Product Dimensions & Variants';
            } else {
              baseText += ' only';
            }
            planLimitEl.textContent = baseText;
          }

          // Lockout and Renewal Logic
          const settings = KwabzStore.getSettings() || {};
          const trialDays = parseInt(settings.sellerTrialDuration) || 0;

          if (seller.created_at) {
            const created = new Date(seller.created_at);
            const trialEnd = new Date(created.getTime() + trialDays * 24 * 60 * 60 * 1000);
            const now = new Date();
            const totalPaidMonths = seller.months_paid || 0;
            const msPerMonth = 30 * 24 * 60 * 60 * 1000;
            const expirationDate = new Date(trialEnd.getTime() + (totalPaidMonths * msPerMonth));

            if (trialDays > 0 && now < trialEnd && !sessionStorage.getItem('trialToastShown')) {
              const daysLeftInTrial = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
              setTimeout(() => {
                KwabzUtils.toast(`✨ Enjoying your free trial! You have ${daysLeftInTrial} days left.`, 'success');
              }, 1000);
              sessionStorage.setItem('trialToastShown', 'true');
            }

            const realDaysLeft = Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24));

            const lockoutEl = document.getElementById('sellerLockoutOverlay');
            const noticeEl = document.getElementById('sellerRenewalNotice');

            if (realDaysLeft <= 0) {
              // LOCKED OUT
              if (lockoutEl) lockoutEl.style.display = 'flex';
              if (noticeEl) noticeEl.style.display = 'none';
              document.body.style.overflow = 'hidden';
            } else {
              // ACTIVE
              if (lockoutEl) lockoutEl.style.display = 'none';
              document.body.style.overflow = 'auto';

              if (realDaysLeft <= 3 && !sessionStorage.getItem('dismissedRenewalNotice')) {
                if (noticeEl) {
                  document.getElementById('renewalDaysLeft').textContent = realDaysLeft;
                  noticeEl.style.display = 'block';
                }
              } else {
                if (noticeEl) noticeEl.style.display = 'none';
              }
            }
          }
        }
      });

      // 3. Listen to Products (Filter by seller_id == currentSellerId)
      firebase.firestore().collection('products')
        .where('seller_id', '==', currentSellerId)
        .onSnapshot(snapshot => {
          sellerProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          document.getElementById('statProducts').textContent = sellerProducts.length;
          renderProductsTab();
        }, err => {
          console.error('[Seller] Products listener restricted:', err);
        });

      // 4. Listen to Orders (Filter by seller_id == currentSellerId)
      let isInitialOrders = true;
      firebase.firestore().collection('orders')
        .where('seller_id', '==', currentSellerId)
        .onSnapshot(snapshot => {
          sellerOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          document.getElementById('statOrders').textContent = sellerOrders.length;

          // Calculate Earnings (Delivered only)
          const deliveredOrders = sellerOrders.filter(o => o.status === 'delivered');
          let totalEarnings = 0;
          let totalAdminFee = 0;
          deliveredOrders.forEach(o => {
            const price = parseFloat(o.total_price) || 0;
            const comm = parseFloat(o.admin_commission) || 0;
            totalEarnings += (price - comm);
            totalAdminFee += comm;
          });

          document.getElementById('statEarnings').textContent = `GH₵${totalEarnings.toFixed(2)}`;
          const adminFeeEl = document.getElementById('statAdminAmount');
          if (adminFeeEl) adminFeeEl.textContent = `GH₵${totalAdminFee.toFixed(2)}`;

          if (!isInitialOrders) {
            snapshot.docChanges().forEach(change => {
              if (change.type === 'added') {
                const order = change.doc.data();
                // Play notification sound
                if (typeof KwabzUtils !== 'undefined' && typeof KwabzUtils.playNotificationSound === 'function') {
                  KwabzUtils.playNotificationSound();
                }
                // Show toast
                if (typeof KwabzUtils !== 'undefined' && typeof KwabzUtils.toast === 'function') {
                  KwabzUtils.toast(`New Order Received! 🛒`, 'success', 5000);
                }
                // Show browser push notification
                if (Notification.permission === 'granted') {
                  const title = '🛒 New Order Received!';
                  const body = `Order ${order.order_label || order.order_number || ''} placed by ${order.customer?.name || 'Guest'} for GH₵ ${(order.total_price || 0).toFixed(2)}`;

                  if (typeof KwabzUtils !== 'undefined' && typeof KwabzUtils.showNotification === 'function') {
                    KwabzUtils.showNotification(title, body);
                  } else {
                    new Notification(title, { body });
                  }
                }
              }
            });
          }
          isInitialOrders = false;

          renderOrdersTab();
          renderOverviewActivity();
        }, err => {
          console.error('[Seller] Orders listener restricted:', err);
        });

      updatePushNotifUI();
      initSupportChat();
    }

    // Tab switcher is defined early at the top of this script block (before onAuthStateChanged)

    window.copyStoreLinkToClipboard = function () {
      const linkDisplay = document.getElementById('settingStoreLinkDisplay');
      if (linkDisplay && linkDisplay.value) {
        navigator.clipboard.writeText(linkDisplay.value)
          .then(() => {
            KwabzUtils.toast('📋 Store link copied!', 'success');
          })
          .catch(err => {
            console.error('Failed to copy: ', err);
          });
      }
    };

    window.shareStoreWhatsApp = function () {
      const linkDisplay = document.getElementById('settingStoreLinkDisplay');
      if (linkDisplay && linkDisplay.value) {
        const storeName = (window.currentSellerData && window.currentSellerData.name) || 'My Store';
        const msg = `Checkout my store "${storeName}" on Kwabz Store! 🛍️✨\nView my latest products and place your orders here:\n\n${linkDisplay.value}`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
      }
    };

    window.shareStoreNative = function () {
      const linkDisplay = document.getElementById('settingStoreLinkDisplay');
      if (linkDisplay && linkDisplay.value) {
        const storeName = (window.currentSellerData && window.currentSellerData.name) || 'My Store';
        if (navigator.share) {
          navigator.share({
            title: storeName + ' — Kwabz Store',
            text: `Explore products and place orders at "${storeName}" on Kwabz Store!`,
            url: linkDisplay.value
          }).catch(err => {
            console.log('Native share canceled or failed:', err);
          });
        } else {
          window.copyStoreLinkToClipboard();
        }
      }
    };

    // Compress helper for client-side uploads (Vercel/Apple SaaS quality style)
    function compressImage(file, maxDimension, quality, callback) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxDimension) {
              height *= maxDimension / width;
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width *= maxDimension / height;
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          callback(dataUrl);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    // ─── Profile Image Crop Logic ───
    let cropImg = null;
    let startDragX = 0;
    let startDragY = 0;
    let cropX = 130;  // Canvas center
    let cropY = 130;
    let cropScale = 1.0;
    let isDraggingCrop = false;
    let cropperListenersAttached = false;

    function drawCropCanvas() {
      const canvas = document.getElementById('cropCanvas');
      if (!canvas || !cropImg) return;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const baseScale = Math.min(canvas.width / cropImg.width, canvas.height / cropImg.height);
      const w = cropImg.width * baseScale * cropScale;
      const h = cropImg.height * baseScale * cropScale;

      ctx.drawImage(cropImg, cropX - w / 2, cropY - h / 2, w, h);
    }

    function setupCropCanvasListeners() {
      const canvas = document.getElementById('cropCanvas');
      const getEventCoords = (e) => {
        if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return { x: e.clientX, y: e.clientY };
      };

      const startDrag = (e) => {
        if (!cropImg) return;
        isDraggingCrop = true;
        const coords = getEventCoords(e);
        startDragX = coords.x;
        startDragY = coords.y;
      };

      const drag = (e) => {
        if (!isDraggingCrop || !cropImg) return;
        const coords = getEventCoords(e);
        cropX += (coords.x - startDragX);
        cropY += (coords.y - startDragY);
        startDragX = coords.x;
        startDragY = coords.y;
        drawCropCanvas();
      };

      const stopDrag = () => { isDraggingCrop = false; };

      canvas.addEventListener('mousedown', startDrag);
      window.addEventListener('mousemove', drag);
      window.addEventListener('mouseup', stopDrag);

      canvas.addEventListener('touchstart', startDrag, { passive: true });
      window.addEventListener('touchmove', drag, { passive: true });
      window.addEventListener('touchend', stopDrag);

      const slider = document.getElementById('cropZoomSlider');
      if (slider) {
        slider.addEventListener('input', (e) => {
          cropScale = parseFloat(e.target.value);
          const zoomValEl = document.getElementById('zoomVal');
          if (zoomValEl) zoomValEl.textContent = `${cropScale.toFixed(1)}x`;
          drawCropCanvas();
        });
      }
    }

    function ensureCropperListeners() {
      if (cropperListenersAttached) return;
      cropperListenersAttached = true;
      setupCropCanvasListeners();
    }

    // Profile Image Action Menu Logic
    window.handleProfileImageClick = function () {
      if (window.currentSellerData && window.currentSellerData.profile_image) {
        const menu = document.getElementById('profileImageActionMenu');
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
      } else {
        document.getElementById('profileImageUpload').click();
      }
    };

    // Close menu when clicking outside
    document.addEventListener('click', function (e) {
      const menu = document.getElementById('profileImageActionMenu');
      const profileImg = document.getElementById('dashboardProfileImage');
      if (menu && menu.style.display === 'block') {
        if (!menu.contains(e.target) && e.target !== profileImg) {
          menu.style.display = 'none';
        }
      }
    });

    window.handleImageSelect = function (input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      if (file.size > 5 * 1024 * 1024) {
        KwabzUtils.toast('Image must be less than 5MB', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = function (e) {
        cropImg = new Image();
        cropImg.onload = function () {
          cropX = 130;
          cropY = 130;
          cropScale = 1.0;

          const slider = document.getElementById('cropZoomSlider');
          if (slider) slider.value = '1.0';
          const zoomValEl = document.getElementById('zoomVal');
          if (zoomValEl) zoomValEl.textContent = '1.0x';

          document.getElementById('cropModal').style.display = 'flex';
          ensureCropperListeners();
          drawCropCanvas();
        };
        cropImg.src = e.target.result;
      };
      reader.readAsDataURL(file);
      input.value = '';
    };

    window.confirmCrop = async function () {
      const canvas = document.getElementById('cropCanvas');
      if (!canvas || !cropImg) return;

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = 400;
      outputCanvas.height = 400;
      const oCtx = outputCanvas.getContext('2d');

      oCtx.fillStyle = '#ffffff';
      oCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
      oCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, outputCanvas.width, outputCanvas.height);

      const base64 = outputCanvas.toDataURL('image/jpeg', 0.8);
      document.getElementById('dashboardProfileImage').src = base64;

      try {
        const payload = { profile_image: base64, updated_at: new Date().toISOString() };
        if (!window.currentSellerData) payload.commission = 10;
        await firebase.firestore().collection('sellers').doc(currentSellerId).set(payload, { merge: true });
        KwabzUtils.toast('Profile photo updated successfully!', 'success');
      } catch (err) {
        console.error(err);
        KwabzUtils.toast('Failed to save profile photo: ' + err.message, 'error');
      }
      closeCropModal();
    };

    window.closeCropModal = function () {
      document.getElementById('cropModal').style.display = 'none';
    };

    // Delete Profile Image
    window.deleteProfileImage = async function () {
      if (!confirm('Are you sure you want to remove your profile photo?')) return;
      try {
        const payload = { profile_image: firebase.firestore.FieldValue.delete(), updated_at: new Date().toISOString() };
        if (!window.currentSellerData) payload.commission = 10;
        await firebase.firestore().collection('sellers').doc(currentSellerId).set(payload, { merge: true });
        document.getElementById('dashboardProfileImage').src = "https://ui-avatars.com/api/?name=Store&background=random";
        KwabzUtils.toast('Profile photo removed', 'success');
        closeCropModal();
      } catch (err) {
        console.error(err);
        KwabzUtils.toast('Failed to remove photo: ' + err.message, 'error');
      }
    };

    // Brand Logo Upload handler
    window.handleStoreLogoUpload = function (input) {
      if (input.files && input.files[0]) {
        compressImage(input.files[0], 600, 0.75, async (base64) => {
          const preview = document.getElementById('storeLogoPreview');
          if (preview) {
            preview.src = base64;
            preview.style.display = 'block';
            preview.style.opacity = '0.5';
          }
          try {
            KwabzUtils.toast('Uploading logo to Cloudinary...', 'info');
            const url = await KwabzUtils.uploadToCloudinary(base64);
            base64StoreLogo = url;
            if (preview) {
              preview.src = url;
              preview.style.opacity = '1';
            }
            KwabzUtils.toast('Logo uploaded successfully!', 'success');
          } catch (err) {
            console.error(err);
            KwabzUtils.toast('Cloudinary upload failed: ' + err.message, 'error');
            if (preview) preview.style.display = 'none';
            base64StoreLogo = '';
          }
        });
      }
    };

    // About Page Cover Upload handler
    window.handleAboutCoverUpload = function (input) {
      if (input.files && input.files[0]) {
        compressImage(input.files[0], 800, 0.75, async (base64) => {
          const preview = document.getElementById('aboutCoverPreview');
          if (preview) {
            preview.src = base64;
            preview.style.display = 'block';
            preview.style.opacity = '0.5';
          }
          try {
            KwabzUtils.toast('Uploading cover to Cloudinary...', 'info');
            const url = await KwabzUtils.uploadToCloudinary(base64);
            base64AboutCover = url;
            if (preview) {
              preview.src = url;
              preview.style.opacity = '1';
            }
            KwabzUtils.toast('Cover uploaded successfully!', 'success');
          } catch (err) {
            console.error(err);
            KwabzUtils.toast('Cloudinary upload failed: ' + err.message, 'error');
            if (preview) preview.style.display = 'none';
            base64AboutCover = '';
          }
        });
      }
    };

    // Custom Category Image Upload handler
    window.handleCustomCatImageUpload = function (input) {
      if (input.files && input.files[0]) {
        compressImage(input.files[0], 600, 0.75, async (base64) => {
          const preview = document.getElementById('customCatImagePreview');
          if (preview) {
            preview.src = base64;
            preview.style.display = 'block';
            preview.style.opacity = '0.5';
          }
          try {
            KwabzUtils.toast('Uploading category photo to Cloudinary...', 'info');
            const url = await KwabzUtils.uploadToCloudinary(base64);
            base64CustomCatImage = url;
            if (preview) {
              preview.src = url;
              preview.style.opacity = '1';
            }
            KwabzUtils.toast('Category photo uploaded successfully!', 'success');
          } catch (err) {
            console.error(err);
            KwabzUtils.toast('Cloudinary upload failed: ' + err.message, 'error');
            if (preview) preview.style.display = 'none';
            base64CustomCatImage = '';
          }
        });
      }
    };

    // --- Storefront Category Overrides ---
    window.loadCategoryOverrideForm = function () {
      const select = document.getElementById('settingCustomCatSelect');
      const fields = document.getElementById('categoryOverrideFields');
      const catId = select.value;

      if (!catId) {
        fields.style.display = 'none';
        return;
      }

      fields.style.display = 'block';
      const override = sellerCustomCategories[catId] || {};

      document.getElementById('settingCustomCatName').value = override.name || '';
      document.getElementById('settingCustomCatDesc').value = override.description || '';

      const preview = document.getElementById('customCatImagePreview');
      if (override.image_url) {
        base64CustomCatImage = override.image_url;
        preview.src = override.image_url;
        preview.style.display = 'block';
        preview.style.opacity = '1';
      } else {
        base64CustomCatImage = '';
        preview.style.display = 'none';
      }
    };

    window.applyCategoryOverride = function () {
      const select = document.getElementById('settingCustomCatSelect');
      const catId = select.value;
      if (!catId) return;

      const name = document.getElementById('settingCustomCatName').value.trim();
      const desc = document.getElementById('settingCustomCatDesc').value.trim();
      const image_url = base64CustomCatImage;

      if (!name && !desc && !image_url) {
        // If everything is empty, clean it up / delete override
        delete sellerCustomCategories[catId];
      } else {
        const override = {};
        if (name) override.name = name;
        if (desc) override.description = desc;
        if (image_url) override.image_url = image_url;
        sellerCustomCategories[catId] = override;
      }

      // Reset form and select dropdown
      select.value = '';
      document.getElementById('categoryOverrideFields').style.display = 'none';
      base64CustomCatImage = '';

      renderCategoryOverridesList();
      KwabzUtils.toast('Category override applied locally. Save changes to make it live.', 'info');
    };

    window.removeCategoryOverride = function (catId) {
      if (confirm('Are you sure you want to remove this category override?')) {
        delete sellerCustomCategories[catId];
        renderCategoryOverridesList();
        KwabzUtils.toast('Category override removed. Save changes to make it live.', 'info');
      }
    };

    window.renderCategoryOverridesList = function () {
      const container = document.getElementById('categoryOverridesList');
      if (!container) return;

      const keys = Object.keys(sellerCustomCategories);
      if (keys.length === 0) {
        container.innerHTML = `<p style="font-size:0.75rem; color:var(--outline); margin:0; text-align:center;">No custom category overrides set yet.</p>`;
        return;
      }

      container.innerHTML = keys.map(catId => {
        const cat = categoriesList.find(c => c.id === catId);
        const globalName = cat ? cat.name : 'Unknown';
        const override = sellerCustomCategories[catId];
        const displayImg = override.image_url || (cat ? cat.image_url : '');

        const imgHtml = displayImg
          ? `<img src="${displayImg}" style="width:2rem; height:2rem; object-fit:cover; border-radius:0.25rem; border:1px solid var(--outline-variant);" />`
          : `<span class="material-symbols-outlined" style="font-size:1.5rem; color:var(--outline);">category</span>`;

        return `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:0.75rem; background:var(--surface-container-high); border-radius:var(--radius-lg); border:1px solid var(--outline-variant);">
            <div style="display:flex; align-items:center; gap:0.75rem; min-width:0; flex:1;">
              ${imgHtml}
              <div style="min-width:0; flex:1;">
                <p style="font-size:0.8125rem; font-weight:800; margin:0; color:var(--on-surface); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${override.name || globalName}
                  ${override.name ? `<span style="font-size:0.65rem; font-weight:400; color:var(--outline); margin-left:0.25rem;">(originally: ${globalName})</span>` : ''}
                </p>
                ${override.description ? `<p style="font-size:0.7rem; color:var(--outline); margin:0.15rem 0 0 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${override.description}</p>` : ''}
              </div>
            </div>
            <div style="display:flex; gap:0.25rem; flex-shrink:0;">
              <button type="button" class="btn-icon" style="width:2rem; height:2rem;" onclick="document.getElementById('settingCustomCatSelect').value='${catId}'; loadCategoryOverrideForm();">
                <span class="material-symbols-outlined" style="font-size:1rem;">edit</span>
              </button>
              <button type="button" class="btn-icon" style="width:2rem; height:2rem;" onclick="removeCategoryOverride('${catId}')">
                <span class="material-symbols-outlined" style="font-size:1rem; color:var(--error);">delete</span>
              </button>
            </div>
          </div>
        `;
      }).join('');
    };

    // Product Image Upload handler
    let base64DimensionImages = [];

    window.handleDimensionImagesUpload = function (input) {
      if (base64DimensionImages.length >= 50) {
        KwabzUtils.toast('Cloud storage limit reached (50 uploads).', 'error');
        return;
      }
      Array.from(input.files).forEach(file => {
        if (base64DimensionImages.length >= 50) return;
        compressImage(file, 600, 0.75, async (base64) => {
          const tempIndex = base64DimensionImages.length;
          base64DimensionImages.push(base64);
          renderDimensionImages();

          try {
            const dimPreview = document.getElementById('dimensionImagesPreview');
            const imgEls = dimPreview ? dimPreview.querySelectorAll('img') : [];
            if (imgEls[tempIndex]) imgEls[tempIndex].style.opacity = '0.5';

            const url = await KwabzUtils.uploadToCloudinary(base64);
            base64DimensionImages[tempIndex] = url;
            renderDimensionImages();
          } catch (err) {
            console.error(err);
            KwabzUtils.toast('Failed to upload variant image: ' + err.message, 'error');
            base64DimensionImages.splice(tempIndex, 1);
            renderDimensionImages();
          }
        });
      });
      input.value = '';
    };

    window.removeDimensionImage = function (index) {
      base64DimensionImages.splice(index, 1);
      renderDimensionImages();
    };

    window.renderDimensionImages = function () {
      const dimPreview = document.getElementById('dimensionImagesPreview');
      dimPreview.innerHTML = '';
      base64DimensionImages.forEach((img, i) => {
        dimPreview.innerHTML += `<div style="position:relative; width:3rem; height:3rem; flex-shrink:0;">
          <img src="${img}" style="width:100%; height:100%; object-fit:cover; border-radius:0.5rem;" />
          <button type="button" onclick="removeDimensionImage(${i})" style="position:absolute; top:-0.25rem; right:-0.25rem; background:var(--error); color:white; border:none; border-radius:50%; width:1rem; height:1rem; font-size:0.5rem; display:flex; align-items:center; justify-content:center; cursor:pointer;">X</button>
        </div>`;
      });
      const countEl = document.getElementById('cloudUploadCount');
      if (countEl) countEl.textContent = base64DimensionImages.length;
    };

    window.handleProductImageUpload = function (input) {
      if (input.files && input.files[0]) {
        compressImage(input.files[0], 600, 0.75, async (base64) => {
          const preview = document.getElementById('productImagePreview');
          if (preview) {
            preview.src = base64;
            preview.style.display = 'block';
            preview.style.opacity = '0.5';
          }
          try {
            KwabzUtils.toast('Uploading product photo...', 'info');
            const url = await KwabzUtils.uploadToCloudinary(base64);
            base64ProductImage = url;
            if (preview) {
              preview.src = url;
              preview.style.opacity = '1';
            }
            KwabzUtils.toast('Product photo uploaded successfully!', 'success');
          } catch (err) {
            console.error(err);
            KwabzUtils.toast('Cloudinary upload failed: ' + err.message, 'error');
            if (preview) preview.style.display = 'none';
            base64ProductImage = '';
          }
        });
      }
    };

    // Save Store Settings
    window.saveStoreSettings = async function (event) {
      event.preventDefault();
      const name = document.getElementById('settingStoreName').value;
      const phone = document.getElementById('settingStorePhone').value;
      const deliveryCost = parseFloat(document.getElementById('settingDeliveryCost').value) || 0;

      const aboutTitle = document.getElementById('settingAboutTitle').value.trim();
      const aboutSubtitle = document.getElementById('settingAboutSubtitle').value.trim();
      const aboutStory = document.getElementById('settingAboutStory').value.trim();
      const aboutInstagram = document.getElementById('settingAboutInstagram').value.trim();

      try {
        const payload = {
          id: currentSellerId,
          name,
          phone,
          deliveryCost,
          logo: base64StoreLogo,
          image_url: base64StoreLogo, // Global compatibility
          about_title: aboutTitle,
          about_subtitle: aboutSubtitle,
          about_story: aboutStory,
          about_cover: base64AboutCover,
          about_instagram: aboutInstagram,
          custom_categories: sellerCustomCategories,
          updated_at: new Date().toISOString()
        };
        if (!window.currentSellerData) {
          payload.commission = 10;
        }

        await firebase.firestore().collection('sellers').doc(currentSellerId).set(payload, { merge: true });

        // Update user doc as well
        await firebase.firestore().collection('users').doc(currentSellerId).update({
          displayName: name,
          phoneNumber: phone
        });

        alert('Store profile updated successfully!');
      } catch (err) {
        console.error(err);
        alert('Failed to update store settings: ' + err.message);
      }
    };

    // Render Products Grid Card Helper
    function getProductCardHtml(p) {
      const cat = categoriesList.find(c => c.id === p.category_id);
      const finalPrice = p.discount > 0 ? (p.price * (1 - p.discount / 100)) : p.price;
      const isChecked = selectedProductIds.has(p.id);

      const checkboxHtml = productSelectMode
        ? `<div style="padding-right:0.25rem; display:flex; align-items:center;" onclick="event.stopPropagation()">
             <input type="checkbox" class="product-checkbox" data-id="${p.id}" ${isChecked ? 'checked' : ''} 
               onchange="toggleProductSelection('${p.id}')" 
               style="width:1.35rem; height:1.35rem; accent-color:var(--primary); cursor:pointer; border-radius:4px;" />
           </div>`
        : '';

      return `
        <div class="data-list__item" 
             onclick="handleProductCardClick(event, '${p.id}')"
             style="display:flex; align-items:center; gap:0.75rem; padding:0.75rem; background:var(--surface-container-lowest); border-radius:var(--radius-xl); border: 1px solid ${isChecked ? 'var(--primary)' : 'var(--outline-variant)'}; box-shadow:var(--shadow-ambient); cursor:${productSelectMode ? 'pointer' : 'default'}; transition: border-color 0.2s, transform 0.2s;">
          ${checkboxHtml}
          <img class="data-list__image" src="${p.image_url || p.image || ''}" alt="${p.name}" loading="lazy" decoding="async" style="width:4.5rem; height:4.5rem; object-fit:cover; border-radius:var(--radius-lg); flex-shrink:0; background:var(--surface-container-high);" onerror="this.src=''" />
          
          <div class="data-list__info" style="flex:1; min-width:0;">
            <p class="font-headline" style="font-weight:800;font-size:0.9rem;margin:0 0 0.15rem 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name}</p>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
              <span style="font-weight:900; font-size:0.875rem; color:var(--primary);">GH₵${finalPrice.toFixed(2)}</span>
              ${p.discount > 0 ? `<span style="font-size:0.65rem; text-decoration:line-through; color:var(--outline);">GH₵${p.price.toFixed(2)}</span>` : ''}
            </div>
            <p style="font-size:0.65rem; color:var(--outline); margin:0; display:flex; justify-content:space-between; align-items:center;">
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:0.5rem;">${cat ? cat.name : 'General'}</span>
              <span style="font-weight:700; color:${p.in_stock ? '#10b981' : 'var(--error)'}; flex-shrink:0;">${p.in_stock ? 'In Stock' : 'Out'}</span>
            </p>
          </div>

          <div class="data-list__actions" style="display:${productSelectMode ? 'none' : 'flex'}; flex-direction:column; gap:0.35rem; border-left:1px solid var(--outline-variant); padding-left:0.5rem; justify-content:center;">
            <button class="btn-icon" onclick="toggleProductStock('${p.id}', ${p.in_stock})" title="Toggle Stock" style="width:2rem; height:2rem; background:${p.in_stock ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color:${p.in_stock ? '#10b981' : 'var(--error)'}; border:none;">
              <span class="material-symbols-outlined" style="font-size:1.1rem;">${p.in_stock ? 'check_circle' : 'block'}</span>
            </button>
            <button class="btn-icon" onclick="openEditProductModal('${p.id}')" title="Edit" style="width:2rem; height:2rem; background:var(--surface-container-high); border:none;">
              <span class="material-symbols-outlined" style="font-size:1.1rem;">edit</span>
            </button>
            <button class="btn-icon" onclick="confirmDeleteProduct('${p.id}')" title="Delete" style="width:2rem; height:2rem; background:rgba(239, 68, 68, 0.1); color:var(--error); border:none;">
              <span class="material-symbols-outlined" style="font-size:1.1rem;">delete</span>
            </button>
          </div>
        </div>
      `;
    }

    // Render Products Grid
    function renderProductsTab() {
      const grid = document.getElementById('sellerProductsGrid');
      const empty = document.getElementById('productsEmptyState');

      if (sellerProducts.length === 0) {
        grid.innerHTML = '';
        empty.style.display = 'flex';
        return;
      }
      empty.style.display = 'none';

      grid.innerHTML = sellerProducts.map(getProductCardHtml).join('');
    }

    // Toggle Product Stock Availability
    window.toggleProductStock = async function (id, currentStatus) {
      try {
        await firebase.firestore().collection('products').doc(id).update({
          in_stock: !currentStatus
        });
      } catch (err) {
        console.error(err);
      }
    };

    // Filter Products
    window.filterProductsList = function () {
      const q = document.getElementById('productSearchInput').value.toLowerCase();
      const grid = document.getElementById('sellerProductsGrid');
      const filtered = sellerProducts.filter(p => p.name.toLowerCase().includes(q));

      if (filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:2rem; color:var(--outline);">No matching products found.</div>`;
        return;
      }

      grid.innerHTML = filtered.map(getProductCardHtml).join('');
    };

    // Toggle Product Select Mode
    window.toggleProductSelectMode = function () {
      productSelectMode = !productSelectMode;
      const btn = document.getElementById('toggleProductSelectModeBtn');
      const toolbar = document.getElementById('productBulkToolbar');
      const fab = document.getElementById('sellerMobileFabContainer');

      if (productSelectMode) {
        btn.textContent = 'Exit Bulk';
        btn.style.background = 'var(--outline)';
        toolbar.style.display = 'flex';
        if (fab) {
          fab.style.bottom = window.innerWidth <= 600 ? '13rem' : '11rem';
        }
      } else {
        btn.textContent = 'Bulk Actions';
        btn.style.background = 'var(--primary)';
        toolbar.style.display = 'none';
        selectedProductIds.clear();
        document.getElementById('selectAllProductsCheckbox').checked = false;
        updateSelectedProductsCount();
        if (fab) {
          fab.style.bottom = '6.5rem';
        }
      }
      filterProductsList();
    };

    // Toggle Product Selection
    window.toggleProductSelection = function (productId) {
      if (selectedProductIds.has(productId)) {
        selectedProductIds.delete(productId);
      } else {
        selectedProductIds.add(productId);
      }
      updateSelectedProductsCount();
      filterProductsList();
    };

    // Handle Product Card Click
    window.handleProductCardClick = function (event, productId) {
      if (event.target.closest('button') || event.target.closest('input')) {
        return;
      }
      if (productSelectMode) {
        toggleProductSelection(productId);
      }
    };

    // Toggle Select All Products
    window.toggleSelectAllProducts = function () {
      const isChecked = document.getElementById('selectAllProductsCheckbox').checked;
      const q = document.getElementById('productSearchInput').value.toLowerCase();
      const filtered = sellerProducts.filter(p => p.name.toLowerCase().includes(q));

      if (isChecked) {
        filtered.forEach(p => selectedProductIds.add(p.id));
      } else {
        filtered.forEach(p => selectedProductIds.delete(p.id));
      }
      updateSelectedProductsCount();
      filterProductsList();
    };

    // Update Selected Products Count
    function updateSelectedProductsCount() {
      const count = selectedProductIds.size;
      document.getElementById('selectedProductsCountText').textContent = `${count} selected`;
      const selectAllCheck = document.getElementById('selectAllProductsCheckbox');
      if (selectAllCheck) {
        const q = document.getElementById('productSearchInput').value.toLowerCase();
        const filtered = sellerProducts.filter(p => p.name.toLowerCase().includes(q));
        selectAllCheck.checked = count === filtered.length && filtered.length > 0;
      }
    }

    // Bulk Delete Products
    window.bulkDeleteProducts = async function () {
      if (selectedProductIds.size === 0) {
        KwabzUtils.toast('No products selected.', 'error');
        return;
      }
      if (!confirm(`Are you sure you want to delete the ${selectedProductIds.size} selected products? This action cannot be undone.`)) {
        return;
      }
      const db = firebase.firestore();
      const batch = db.batch();
      selectedProductIds.forEach(id => {
        batch.delete(db.collection('products').doc(id));
      });
      try {
        await batch.commit();
        KwabzUtils.toast(`Successfully deleted ${selectedProductIds.size} products.`, 'success');
        toggleProductSelectMode();
      } catch (err) {
        console.error(err);
        alert('Failed to bulk delete products: ' + err.message);
      }
    };

    // Bulk Share to WhatsApp
    window.bulkShareToWhatsApp = async function () {
      if (selectedProductIds.size === 0) {
        KwabzUtils.toast('No products selected.', 'error');
        return;
      }

      const btn = document.getElementById('bulkShareBtn');
      const originalText = btn.innerHTML;
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px; animation:spin 1s linear infinite;">sync</span> Preparing...`;
      btn.disabled = true;

      let text = `*🔥 check out these amazing products on our store!* 🛍️\n\n`;
      let fallbackText = text;
      let index = 1;

      const filesToShare = [];
      const fetchPromises = [];

      selectedProductIds.forEach(id => {
        const p = sellerProducts.find(prod => prod.id === id);
        if (p) {
          const finalPrice = p.discount > 0 ? (p.price * (1 - p.discount / 100)) : p.price;
          const detailUrl = `${window.location.origin}/product-detail.html?id=${p.id}`;

          const itemText = `*${index}. ${p.name}*\n💰 Price: GH₵${finalPrice.toFixed(2)}\n🔗 View Item: ${detailUrl}\n\n`;
          text += itemText;

          const imgUrl = p.image_url || p.image;
          fallbackText += `*${index}. ${p.name}*\n💰 Price: GH₵${finalPrice.toFixed(2)}\n${imgUrl ? `🖼️ Image: ${imgUrl}\n` : ''}🔗 View Item: ${detailUrl}\n\n`;

          if (imgUrl) {
            fetchPromises.push(
              fetch(imgUrl)
                .then(res => {
                  if (!res.ok) throw new Error('Network response was not ok');
                  return res.blob();
                })
                .then(blob => {
                  const ext = imgUrl.split('?')[0].split('.').pop() || 'jpg';
                  const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext.toLowerCase()) ? ext : 'jpg';
                  const file = new File([blob], `product_${p.id}.${safeExt}`, { type: blob.type });
                  filesToShare.push(file);
                })
                .catch(err => console.warn('Failed to fetch image for sharing:', err))
            );
          }
          index++;
        }
      });

      text += `⚡ _Powered by Kwabz Store_`;
      fallbackText += `⚡ _Powered by Kwabz Store_`;

      if (fetchPromises.length > 0) {
        await Promise.allSettled(fetchPromises);
      }

      btn.innerHTML = originalText;
      btn.disabled = false;

      // Try native share with actual files (e.g., Mobile OS native WhatsApp sharing)
      if (navigator.share && navigator.canShare && filesToShare.length > 0) {
        const shareData = {
          title: 'Store Products',
          text: text,
          files: filesToShare
        };
        if (navigator.canShare(shareData)) {
          try {
            await navigator.share(shareData);
            return; // Success
          } catch (err) {
            console.log('Native share failed or cancelled:', err);
            if (err.name !== 'AbortError') {
              window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(fallbackText)}`, '_blank');
            }
            return;
          }
        }
      }

      // Fallback: standard WhatsApp URL intent
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(fallbackText)}`, '_blank');
    };

    // Product Modal Helpers
    window.openAddProductModal = function () {
      if (window.currentSellerData && window.currentSellerData.listing_limit > 0) {
        if (sellerProducts.length >= window.currentSellerData.listing_limit) {
          KwabzUtils.toast(`Listing limit reached (${window.currentSellerData.listing_limit} products). Please upgrade your account to add more.`, 'error');
          switchTab('settings');
          return;
        }
      }

      const currentLimit = window.currentSellerData ? (window.currentSellerData.listing_limit || 999999) : 999999;
      const limitDisplay = currentLimit >= 999999 ? 'Unlimited' : currentLimit;
      document.getElementById('modalProductTitle').textContent = `Add Product (${sellerProducts.length}/${limitDisplay})`;
      document.getElementById('editProductId').value = '';
      document.getElementById('prodName').value = '';
      document.getElementById('prodPrice').value = '';
      document.getElementById('prodDiscount').value = '0';
      document.getElementById('prodQuantity').value = '';
      document.getElementById('prodDescription').value = '';
      document.getElementById('productImagePreview').style.display = 'none';
      base64ProductImage = "";

      // Setup Features based on Plan
      const plan = (window.currentSellerData && window.currentSellerData.plan) ? window.currentSellerData.plan.toLowerCase() : 'free';
      const basicSec = document.getElementById('basicFeaturesSection');
      const premSec = document.getElementById('premiumFeaturesSection');
      document.getElementById('prodVariants').value = '';
      document.getElementById('prodDimensions').value = '';
      document.getElementById('dimensionImagesPreview').innerHTML = '';
      base64DimensionImages = [];
      selectedColors = [];
      renderSelectedColors();

      if (plan === 'premium') {
        basicSec.style.display = 'block';
        premSec.style.display = 'block';
        document.getElementById('cloudUploadCount').textContent = '0';
      } else if (plan === 'basic') {
        basicSec.style.display = 'block';
        premSec.style.display = 'none';
      } else {
        basicSec.style.display = 'none';
        premSec.style.display = 'none';
      }

      initColorPresets();
      renderSelectedColors();
      document.getElementById('productModal').classList.add('open');
    };

    window.openEditProductModal = function (id) {
      const p = sellerProducts.find(prod => prod.id === id);
      if (!p) return;

      document.getElementById('modalProductTitle').textContent = 'Edit Product';
      document.getElementById('editProductId').value = p.id;
      document.getElementById('prodName').value = p.name;
      document.getElementById('prodPrice').value = p.price;
      document.getElementById('prodDiscount').value = p.discount || 0;
      document.getElementById('prodQuantity').value = p.stock_quantity !== undefined && p.stock_quantity !== null ? p.stock_quantity : '';
      document.getElementById('prodDescription').value = p.description || '';
      document.getElementById('prodCategory').value = p.category_id;

      const preview = document.getElementById('productImagePreview');
      if (p.image_url || p.image) {
        preview.src = p.image_url || p.image;
        preview.style.display = 'block';
        base64ProductImage = p.image || "";
      } else {
        preview.style.display = 'none';
        base64ProductImage = "";
      }

      // Setup Features based on Plan
      const plan = (window.currentSellerData && window.currentSellerData.plan) ? window.currentSellerData.plan.toLowerCase() : 'free';
      const basicSec = document.getElementById('basicFeaturesSection');
      const premSec = document.getElementById('premiumFeaturesSection');
      document.getElementById('prodVariants').value = p.variants || '';
      document.getElementById('prodDimensions').value = p.dimensions || '';

      base64DimensionImages = p.dimension_images || [];
      renderDimensionImages();
      selectedColors = Array.isArray(p.colors) ? [...p.colors] : [];
      renderSelectedColors();

      if (plan === 'premium') {
        basicSec.style.display = 'block';
        premSec.style.display = 'block';
      } else if (plan === 'basic') {
        basicSec.style.display = 'block';
        premSec.style.display = 'none';
      } else {
        basicSec.style.display = 'none';
        premSec.style.display = 'none';
      }

      initColorPresets();
      renderSelectedColors();
      document.getElementById('productModal').classList.add('open');
    };

    window.closeProductModal = function () {
      document.getElementById('productModal').classList.remove('open');
    };

    // Product form submission
    window.handleProductSubmit = async function (e) {
      e.preventDefault();
      const saveBtn = document.getElementById('saveProductBtn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const id = document.getElementById('editProductId').value;
      const name = document.getElementById('prodName').value.trim();
      const category_id = document.getElementById('prodCategory').value;
      const price = parseFloat(document.getElementById('prodPrice').value);
      const discount = parseInt(document.getElementById('prodDiscount').value) || 0;
      const quantityVal = document.getElementById('prodQuantity').value;
      const description = document.getElementById('prodDescription').value.trim();

      // ─── Robust Validation ───
      if (!name) { KwabzUtils.toast('Product name is required', 'error'); saveBtn.disabled = false; saveBtn.textContent = 'Save Product'; return; }
      if (!category_id) { KwabzUtils.toast('Please select a category', 'error'); saveBtn.disabled = false; saveBtn.textContent = 'Save Product'; return; }
      if (isNaN(price) || price <= 0) { KwabzUtils.toast('Price must be greater than 0', 'error'); saveBtn.disabled = false; saveBtn.textContent = 'Save Product'; return; }
      if (discount < 0) { KwabzUtils.toast('Discount cannot be negative', 'error'); saveBtn.disabled = false; saveBtn.textContent = 'Save Product'; return; }

      if (!id && window.currentSellerData && window.currentSellerData.listing_limit > 0) {
        if (sellerProducts.length >= window.currentSellerData.listing_limit) {
          KwabzUtils.toast(`Listing limit reached (${window.currentSellerData.listing_limit} products). Please upgrade your account.`, 'error');
          switchTab('settings');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Product';
          return;
        }
      }

      const storeDoc = await firebase.firestore().collection('sellers').doc(currentSellerId).get();
      const seller_name = storeDoc.exists ? storeDoc.data().name : 'Store Front';

      const payload = {
        name,
        category_id,
        price,
        discount,
        description,
        stock_quantity: quantityVal === '' ? null : parseInt(quantityVal),
        variants: document.getElementById('prodVariants').value.trim(),
        colors: selectedColors,
        dimensions: document.getElementById('prodDimensions').value.trim(),
        dimension_images: base64DimensionImages,
        seller_id: currentSellerId,
        seller_name,
        in_stock: true,
        availability: 'instant',
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (base64ProductImage !== undefined) {
        payload.image = base64ProductImage;
        payload.image_url = base64ProductImage; // store compatibility
      }

      try {
        if (id) {
          // Edit
          await firebase.firestore().collection('products').doc(id).set(payload, { merge: true });
        } else {
          // Create
          const newDocRef = firebase.firestore().collection('products').doc();
          payload.id = newDocRef.id;
          payload.created_at = new Date().toISOString();
          await newDocRef.set(payload);

          // Write to product_notifications for PWA push notification trigger
          try {
            await firebase.firestore().collection('product_notifications').add({
              product_id: newDocRef.id,
              name: payload.name,
              price: payload.price,
              discount: payload.discount || 0,
              image_url: (payload.image_url || payload.image || '').startsWith('data:') ? '' : (payload.image_url || payload.image || ''),
              seller_id: currentSellerId,
              created_at: new Date().toISOString()
            });
            console.log('[SellerDashboard] Browser push notification written to Firestore.');
          } catch (err) {
            console.warn('[SellerDashboard] Failed to write product notification:', err);
          }
        }
        closeProductModal();
      } catch (err) {
        console.error(err);
        alert('Failed to save product: ' + err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Product';
      }
    };

    // Delete Product
    window.confirmDeleteProduct = function (id) {
      deleteTargetId = id;
      document.getElementById('deleteModal').classList.add('open');
    };

    document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
      if (!deleteTargetId) return;
      const btn = document.getElementById('confirmDeleteBtn');
      btn.disabled = true;
      btn.textContent = 'Deleting...';

      try {
        await firebase.firestore().collection('products').doc(deleteTargetId).delete();
        document.getElementById('deleteModal').classList.remove('open');
      } catch (err) {
        console.error(err);
        alert('Failed to delete product: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Delete';
        deleteTargetId = null;
      }
    });

    const STATUS_CONFIG = {
      pending: { label: 'Pending', icon: 'schedule', chipClass: 'chip--warning', next: 'confirmed' },
      confirmed: { label: 'Confirmed', icon: 'check_circle', chipClass: 'chip--primary', next: 'shipped' },
      shipped: { label: 'Shipped', icon: 'local_shipping', chipClass: 'chip--surface', next: 'delivered' },
      delivered: { label: 'Delivered', icon: 'done_all', chipClass: 'chip--success', next: null },
      cancelled: { label: 'Cancelled', icon: 'cancel', chipClass: 'chip--error', next: null },
    };

    function getNextStatus(order) {
      const status = order.status || 'pending';
      if (status === 'pending') return 'confirmed';
      if (status === 'confirmed') {
        // If order has pre-order items, it requires "shipped" first
        const requiresShipped = (order.items || []).some(item => {
          if (item.availability === 'pre_order') return true;
          const prod = KwabzStore.getProductById(item.product_id);
          return prod && prod.availability === 'pre_order';
        });
        return requiresShipped ? 'shipped' : 'delivered';
      }
      if (status === 'shipped') return 'delivered';
      return null;
    }

    // Toggle Select Mode
    window.toggleSelectMode = function () {
      selectMode = !selectMode;
      const btn = document.getElementById('toggleSelectModeBtn');
      const toolbar = document.getElementById('bulkToolbar');
      const fab = document.getElementById('sellerMobileFabContainer');

      if (selectMode) {
        btn.textContent = 'Exit Bulk';
        btn.style.background = 'var(--outline)';
        toolbar.style.display = 'flex';
        if (fab) {
          fab.style.bottom = window.innerWidth <= 600 ? '13rem' : '11rem';
        }
      } else {
        btn.textContent = 'Bulk Actions';
        btn.style.background = 'var(--primary)';
        toolbar.style.display = 'none';
        selectedOrderIds.clear();
        document.getElementById('selectAllCheckbox').checked = false;
        updateSelectedCount();
        if (fab) {
          fab.style.bottom = '6.5rem';
        }
      }
      renderOrdersTab();
    };

    // Toggle Order Selection
    window.toggleOrderSelection = function (orderId) {
      if (selectedOrderIds.has(orderId)) {
        selectedOrderIds.delete(orderId);
      } else {
        selectedOrderIds.add(orderId);
      }
      updateSelectedCount();
    };

    // Handle Card Click
    window.handleOrderCardClick = function (event, orderId) {
      if (selectMode) {
        toggleOrderSelection(orderId);
        renderOrdersTab();
      } else {
        showOrderDetail(orderId);
      }
    };

    // Toggle Select All
    window.toggleSelectAll = function () {
      const isChecked = document.getElementById('selectAllCheckbox').checked;
      if (isChecked) {
        sellerOrders.forEach(o => selectedOrderIds.add(o.id));
      } else {
        selectedOrderIds.clear();
      }
      updateSelectedCount();
      renderOrdersTab();
    };

    // Update Selected Count
    function updateSelectedCount() {
      const count = selectedOrderIds.size;
      document.getElementById('selectedCountText').textContent = `${count} selected`;
      const selectAllCheck = document.getElementById('selectAllCheckbox');
      if (selectAllCheck) {
        selectAllCheck.checked = count === sellerOrders.length && sellerOrders.length > 0;
      }
    }

    // Bulk Update Status
    window.bulkUpdateStatus = async function () {
      const newStatus = document.getElementById('bulkStatusSelect').value;
      if (!newStatus) {
        KwabzUtils.toast('Please select a status to apply.', 'error');
        return;
      }
      if (selectedOrderIds.size === 0) {
        KwabzUtils.toast('No orders selected.', 'error');
        return;
      }

      const db = firebase.firestore();
      const batch = db.batch();
      selectedOrderIds.forEach(id => {
        batch.update(db.collection('orders').doc(id), { status: newStatus });
      });

      try {
        await batch.commit();
        KwabzUtils.toast(`Successfully updated ${selectedOrderIds.size} orders to ${STATUS_CONFIG[newStatus].label}.`, 'success');
        toggleSelectMode();
      } catch (err) {
        console.error(err);
        alert('Failed to bulk update status: ' + err.message);
      }
    };

    // Bulk Notify
    window.bulkNotify = function () {
      if (selectedOrderIds.size === 0) {
        KwabzUtils.toast('No orders selected.', 'error');
        return;
      }
      selectedOrderIds.forEach(id => {
        const order = sellerOrders.find(o => o.id === id);
        if (order) {
          KwabzStore.sendStatusUpdateViaWhatsApp(order);
        }
      });
      KwabzUtils.toast(`Fired notification prompt for ${selectedOrderIds.size} orders.`, 'success');
    };

    // Render Orders Tab (Admin Style)
    function renderOrdersTab() {
      const container = document.getElementById('sellerOrdersList');
      const empty = document.getElementById('ordersEmptyState');

      if (sellerOrders.length === 0) {
        container.innerHTML = '';
        empty.style.display = 'flex';
        return;
      }
      empty.style.display = 'none';

      // Sort by date desc
      sellerOrders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      container.innerHTML = sellerOrders.map(order => {
        const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
        const itemCount = (order.items || []).reduce((sum, i) => sum + i.quantity, 0);
        const adminComm = parseFloat(order.admin_commission) || 0;
        const sellerRevenue = (parseFloat(order.total_price) || 0) - adminComm;
        const isChecked = selectedOrderIds.has(order.id);

        const checkboxHtml = selectMode
          ? `<div style="padding-right:0.75rem;display:flex;align-items:center;" onclick="event.stopPropagation()">
               <input type="checkbox" class="order-checkbox" data-id="${order.id}" ${isChecked ? 'checked' : ''} 
                 onchange="toggleOrderSelection('${order.id}')" 
                 style="width:1.35rem;height:1.35rem;accent-color:var(--primary);cursor:pointer;border-radius:4px;" />
             </div>`
          : '';

        return `
          <div style="display:flex;align-items:stretch;background:var(--surface-container-lowest);border-radius:var(--radius-xl);padding:1.25rem;box-shadow:var(--shadow-soft);cursor:pointer;margin-bottom:1rem;transition:transform 0.2s;"
            onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'"
            onclick="handleOrderCardClick(event, '${order.id}')">
            ${checkboxHtml}
            <div style="flex:1;min-width:0;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem;">
                <div>
                  <p class="font-headline" style="font-weight:700;font-size:1rem;margin:0;">${order.order_label || order.order_number || 'Order'}</p>
                  <p style="font-size:0.6875rem;color:var(--outline);margin-top:0.25rem;">${KwabzUtils.formatDate(order.created_at)} • ${KwabzUtils.timeAgo(order.created_at)}</p>
                </div>
                <div style="display:flex;flex-direction:column;gap:0.35rem;align-items:flex-end;">
                  <span class="chip ${config.chipClass}">
                    <span class="material-symbols-outlined" style="font-size:0.75rem;">${config.icon}</span>
                    ${config.label}
                  </span>
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <p style="font-size:0.8125rem;font-weight:600;">${order.customer?.name || 'Guest'}</p>
                  <p style="font-size:0.6875rem;color:var(--outline);">${itemCount} item${itemCount !== 1 ? 's' : ''}</p>
                </div>
                <div style="text-align:right;">
                  <span class="font-headline" style="font-weight:800;font-size:1.125rem;display:block;color:var(--primary);">${KwabzUtils.formatPrice(sellerRevenue)}</span>
                  <span style="font-size:0.6875rem;color:var(--outline);">Fee: ${KwabzUtils.formatPrice(adminComm)}</span>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Live GPS Sharing state
    let activeWatchId = null;
    let activeWatchOrderId = null;

    window.toggleGpsShare = function (orderId) {
      if (activeWatchOrderId === orderId) {
        stopGpsShare();
      } else {
        startGpsShare(orderId);
      }
    };

    function startGpsShare(orderId) {
      if (activeWatchId) {
        navigator.geolocation.clearWatch(activeWatchId);
      }
      if (!navigator.geolocation) {
        alert("Geolocation is not supported by your device/browser.");
        return;
      }
      activeWatchOrderId = orderId;
      activeWatchId = navigator.geolocation.watchPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          try {
            await firebase.firestore().collection('orders').doc(orderId).update({
              driver_location: {
                lat: lat,
                lng: lng,
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
              }
            });
            console.log(`[GPS Share] Location updated: ${lat}, ${lng}`);
          } catch (err) {
            console.error('[GPS Share] Firestore error:', err);
          }
        },
        (err) => {
          console.error('[GPS Share] Geolocation watcher error:', err);
          KwabzUtils.toast('GPS tracker failed: ' + err.message, 'error');
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
      );
      KwabzUtils.toast('Live GPS sharing started!', 'success');
      showOrderDetail(orderId);
    }

    function stopGpsShare() {
      if (activeWatchId) {
        navigator.geolocation.clearWatch(activeWatchId);
        activeWatchId = null;
      }
      const prevId = activeWatchOrderId;
      activeWatchOrderId = null;
      KwabzUtils.toast('Live GPS sharing stopped.', 'info');
      if (prevId) showOrderDetail(prevId);
    }

    // Order Detail Modal for Sellers
    window.showOrderDetail = function (orderId) {
      const order = sellerOrders.find(o => o.id === orderId);
      if (!order) return;
      const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
      const nextStatus = getNextStatus(order);
      const content = document.getElementById('orderDetailContent');
      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;">
          <div>
            <h3 class="font-headline text-headline-md">${order.order_label || order.order_number}</h3>
            <p class="text-body-sm" style="color:var(--outline);">${KwabzUtils.formatDate(order.created_at)}</p>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.35rem;align-items:flex-end;">
            <span class="chip ${config.chipClass}">
              <span class="material-symbols-outlined" style="font-size:0.75rem;">${config.icon}</span>
              ${config.label}
            </span>
          </div>
        </div>
        <div style="background:var(--surface-container-low);border-radius:var(--radius-lg);padding:1rem;margin-bottom:1.5rem;">
          <p class="text-label-sm" style="color:var(--outline);margin-bottom:0.75rem;">CUSTOMER</p>
          <p style="font-weight:600;font-size:0.9375rem;margin-bottom:0.25rem;">${order.customer?.name || 'Guest'}</p>
          <p style="font-size:0.8125rem;color:var(--on-surface-variant);">📞 ${order.customer?.phone || 'N/A'}</p>
          <p style="font-size:0.8125rem;color:var(--on-surface-variant);">📍 ${order.customer?.address || 'N/A'}</p>
        </div>
        <div style="margin-bottom:1.5rem;">
          <p class="text-label-sm" style="color:var(--outline);margin-bottom:0.75rem;">ITEMS</p>
          ${(order.items || []).map(item => {
        const hasDiscount = item.discount > 0 || (item.original_price && item.original_price > item.price);
        const origPrice = item.original_price || item.price;
        const discPrice = item.price;
        const savings = hasDiscount ? ((origPrice - discPrice) * item.quantity) : 0;
        const discPct = hasDiscount ? (item.discount || Math.round((1 - discPrice / origPrice) * 100)) : 0;
        return `
            <div style="display:flex;align-items:center;gap:0.75rem;padding:0.625rem 0;border-bottom:1px solid var(--outline-variant);">
              <img src="${item.image_url}" alt="${item.name}" loading="lazy" decoding="async" style="width:2.5rem;height:2.5rem;border-radius:var(--radius-md);object-fit:cover;flex-shrink:0;" onerror="this.style.background='var(--outline-variant)';this.src='';" />
              <div style="flex:1;min-width:0;">
                <p style="font-weight:600;font-size:0.8125rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</p>
                <div style="display:flex;align-items:center;gap:0.4rem;margin-top:0.15rem;flex-wrap:wrap;">
                  <p style="font-size:0.6875rem;color:var(--outline);">Qty: ${item.quantity}</p>
                  ${hasDiscount ? `<span style="font-size:0.6rem;font-weight:800;background:#dcfce7;color:#166534;padding:0.1rem 0.4rem;border-radius:100px;">-${discPct}%</span>` : ''}
                </div>
                ${hasDiscount ? `<p style="font-size:0.6875rem;color:var(--outline);text-decoration:line-through;">${KwabzUtils.formatPrice(origPrice)} each</p>` : ''}
              </div>
              <div style="text-align:right;flex-shrink:0;">
                <span style="font-weight:700;font-size:0.8125rem;display:block;">${KwabzUtils.formatPrice(discPrice * item.quantity)}</span>
                ${hasDiscount ? `<span style="font-size:0.625rem;color:#10b981;font-weight:700;">saved ${KwabzUtils.formatPrice(savings)}</span>` : ''}
              </div>
            </div>`;
      }).join('')}
        </div>
        <div style="background:var(--surface-container-low);border-radius:var(--radius-lg);padding:1rem;margin-bottom:1.5rem;display:flex;flex-direction:column;gap:0.4rem;">
          ${(() => {
          const total = order.total_price || 0;
          const deliveryFee = order.delivery_fee || 0;
          const promoDiscount = order.promo_discount || 0;
          const subtotal = total - deliveryFee + promoDiscount;

          let rowsHtml = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.8125rem;color:var(--outline);font-weight:600;">Subtotal</span>
              <span style="font-size:0.8125rem;font-weight:700;color:var(--on-surface);">${KwabzUtils.formatPrice(subtotal)}</span>
            </div>`;

          if (order.promo_code && promoDiscount > 0) {
            rowsHtml += `
              <div style="display:flex;justify-content:space-between;align-items:center;color:#166534;">
                <span style="font-size:0.8125rem;font-weight:600;">Promo Code (${order.promo_code})</span>
                <span style="font-size:0.8125rem;font-weight:700;">- ${KwabzUtils.formatPrice(promoDiscount)}</span>
              </div>`;
          }

          if (deliveryFee > 0) {
            rowsHtml += `
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:0.8125rem;color:var(--outline);font-weight:600;">Delivery Fee</span>
                <span style="font-size:0.8125rem;font-weight:700;color:var(--on-surface);">${KwabzUtils.formatPrice(deliveryFee)}</span>
              </div>`;
          }

          const adminComm = parseFloat(order.admin_commission) || 0;
          const sellerRev = total - adminComm;

          rowsHtml += `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.5rem;padding-top:0.5rem;border-top:1px dashed var(--outline-variant);">
                <span style="font-size:0.8125rem;color:var(--outline);font-weight:600;">Platform Fee</span>
                <span style="font-size:0.8125rem;font-weight:700;color:var(--error);">- ${KwabzUtils.formatPrice(adminComm)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.25rem;">
                <span style="font-size:0.8125rem;color:var(--primary);font-weight:700;">Your Revenue</span>
                <span style="font-size:0.8125rem;font-weight:800;color:var(--primary);">${KwabzUtils.formatPrice(sellerRev)}</span>
              </div>
            `;

          return rowsHtml;
        })()}
          <div style="display:flex;justify-content:space-between;align-items:center;padding-top:0.5rem;border-top:1px solid var(--outline-variant);margin-top:0.25rem;">
            <span class="font-headline" style="font-weight:700;">Total Paid</span>
            <span class="font-headline" style="font-weight:800;font-size:1.375rem;">${KwabzUtils.formatPrice(order.total_price)}</span>
          </div>
        </div>

        <!-- GPS Sharing Section for Sellers -->
        ${order.status !== 'delivered' && order.status !== 'cancelled' ? `
          <div style="background:var(--surface-container-low);border-radius:var(--radius-lg);padding:1rem;margin-bottom:1.5rem;border:1px solid var(--outline-variant);">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
              <div>
                <p style="font-weight:700; font-size:0.8125rem; margin:0; display:flex; align-items:center; gap:0.35rem;">
                  <span class="material-symbols-outlined" style="font-size:1.1rem; color:var(--primary);">share_location</span>
                  Live GPS Rider Tracker
                </p>
                <p style="font-size:0.6875rem; color:var(--outline); margin:0.15rem 0 0 0;">
                  ${activeWatchOrderId === order.id ? 'Active: sharing your coordinates' : 'Share your live ride coordinates with the customer'}
                </p>
              </div>
              <button class="${activeWatchOrderId === order.id ? 'btn-secondary' : 'btn-primary'}" onclick="toggleGpsShare('${order.id}')" style="width:auto; height:2.25rem; padding:0 1rem; border-radius:100px; font-size:0.75rem; font-weight:700; border:none; display:flex; align-items:center; gap:0.35rem;">
                ${activeWatchOrderId === order.id ? `
                  <span class="material-symbols-outlined" style="font-size:1rem; color:var(--error); animation: pulseGently 1.5s infinite;">radio_button_checked</span> Stop Sharing
                ` : `
                  <span class="material-symbols-outlined" style="font-size:1rem;">my_location</span> Start Sharing
                `}
              </button>
            </div>
          </div>
        ` : ''}

        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          ${nextStatus ? `
            <button class="btn-primary" onclick="updateOrderStatus('${order.id}', '${nextStatus}')">
              <span class="material-symbols-outlined" style="font-size:1.125rem;">${STATUS_CONFIG[nextStatus].icon}</span>
              Mark as ${STATUS_CONFIG[nextStatus].label}
            </button>
          ` : order.status !== 'cancelled' ? `
            <div style="text-align:center;padding:1rem;background:var(--surface-container-low);border-radius:var(--radius-lg);">
              <span class="material-symbols-outlined" style="color:#166534;font-size:2rem;">task_alt</span>
              <p class="font-headline" style="font-weight:700;">Order Complete</p>
            </div>
          ` : `
            <div style="text-align:center;padding:1rem;background:var(--error-container);border-radius:var(--radius-lg);">
              <span class="material-symbols-outlined" style="color:#410002;font-size:2rem;">cancel</span>
              <p class="font-headline" style="font-weight:700;color:#410002;">Cancelled</p>
            </div>
          `}
        </div>
      `;
      document.getElementById('orderDetailModal').classList.add('open');
    };

    // Update Order Status
    window.updateOrderStatus = async function (orderId, newStatus) {
      try {
        await firebase.firestore().collection('orders').doc(orderId).update({
          status: newStatus
        });
        KwabzUtils.toast(`Order marked as ${STATUS_CONFIG[newStatus].label}`);
        document.getElementById('orderDetailModal').classList.remove('open');
      } catch (err) {
        console.error(err);
        alert('Failed to update status: ' + err.message);
      }
    };

    // Render Overview Activity (Admin Style)
    function renderOverviewActivity() {
      const container = document.getElementById('recentOrdersOverviewList');
      if (sellerOrders.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--outline); font-size:0.75rem;">No recent orders.</div>`;
        return;
      }

      // Slice top 5 recent orders
      const recent = sellerOrders.slice(0, 5);
      container.innerHTML = recent.map(order => {
        const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
        return `
        <div class="activity-row" style="cursor:pointer;" onclick="showOrderDetail('${order.id}')">
          <div style="display:flex;align-items:center;gap:1.5rem;">
            <div class="activity-row__icon">
              <span class="material-symbols-outlined" style="color:var(--primary);">${config.icon}</span>
            </div>
            <div>
              <p class="font-headline" style="font-weight:700;font-size:0.875rem;">${order.order_label || order.order_number || 'Order'}</p>
              <p style="font-size:0.75rem;color:var(--outline);font-weight:500;display:flex;align-items:center;gap:0.25rem;flex-wrap:wrap;">
                ${order.customer?.name || 'Guest'} • <span>${KwabzUtils.formatPrice(order.total_price || 0)}</span>
              </p>
            </div>
          </div>
          <p class="text-label-sm" style="color:var(--outline);">${KwabzUtils.timeAgo(order.created_at)}</p>
        </div>
        `;
      }).join('');
    }
    // Handle Plan Upgrade
    window.handleUpgradePlan = async function (e) {
      e.preventDefault();
      const codeInput = document.getElementById('activationCodeInput');
      const btn = document.getElementById('btnUpgrade');
      const code = codeInput.value.trim().toUpperCase();
      if (!code) return;

      const user = KwabzStore.getCurrentUser();
      if (!user) return;

      const sellerProfile = window.currentSellerData;
      if (!sellerProfile || !sellerProfile.id) return KwabzUtils.toast('Seller profile not fully loaded yet. Please wait.', 'error');

      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined animate-spin">sync</span>';

      try {
        const db = firebase.firestore();
        const pinDoc = await db.collection('seller_pins').doc(code).get();

        if (!pinDoc.exists) {
          throw new Error('Invalid activation code.');
        }

        const pinData = pinDoc.data();
        if (pinData.status === 'used') {
          throw new Error('This activation code has already been used.');
        }

        if (pinData.status !== 'active') {
          throw new Error('This activation code is pending admin approval. Please wait until it is activated.');
        }

        // Fix: Activation pins are generated with the 'plan' field, not 'account_type'.
        const newPlan = (pinData.plan || pinData.account_type || 'basic').toLowerCase();

        const currentMonthsPaid = sellerProfile.months_paid || 0;

        const batch = db.batch();
        batch.update(db.collection('sellers').doc(sellerProfile.id), {
          plan: newPlan,
          listing_limit: newPlan === 'basic' ? 15 : newPlan === 'premium' ? 25 : 5,
          months_paid: currentMonthsPaid + 1,
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        batch.update(db.collection('seller_pins').doc(code), {
          status: 'used',
          used_by: sellerProfile.id,
          used_at: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();

        KwabzUtils.toast(`Success! Your account has been upgraded to ${newPlan.toUpperCase()}.`, 'success');
        codeInput.value = '';

      } catch (err) {
        console.error('Upgrade Error:', err);
        KwabzUtils.toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Apply';
      }
    };

    // Pending Upgrade Request Logic
    window.openUpgradeRequestMenu = function () {
      document.getElementById('upgradeRequestFormStep').style.display = 'block';
      document.getElementById('upgradeRequestSuccessStep').style.display = 'none';
      document.getElementById('upgradeRequestModal').classList.add('open');
    };

    window.generatePendingCode = async function () {
      const plan = document.getElementById('requestPlanSelect').value;
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      const sellerProfile = window.currentSellerData;
      const btn = event.currentTarget;

      try {
        btn.disabled = true;
        btn.textContent = 'Generating...';
        await firebase.firestore().collection('seller_pins').doc(pin).set({
          plan: plan,
          status: 'pending',
          seller_id: sellerProfile ? sellerProfile.id : 'unknown',
          seller_name: sellerProfile ? sellerProfile.name : 'unknown',
          created_at: new Date().toISOString()
        });

        document.getElementById('generatedPendingCode').textContent = pin;
        document.getElementById('upgradeRequestFormStep').style.display = 'none';
        document.getElementById('upgradeRequestSuccessStep').style.display = 'block';

      } catch (err) {
        console.error(err);
        KwabzUtils.toast('Failed to generate request: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Pending Code';
      }
    };

    window.copyPendingCode = function () {
      const code = document.getElementById('generatedPendingCode').textContent;
      navigator.clipboard.writeText(code);
      KwabzUtils.toast('Code copied to clipboard!', 'success');
    };

    window.contactAdminPendingCode = function () {
      const settings = KwabzStore.getSettings() || {};
      const adminNumber = settings.whatsappSupportNumber || '233240000000';
      const code = document.getElementById('generatedPendingCode').textContent;
      const plan = document.getElementById('requestPlanSelect').value.toUpperCase();
      const storeName = window.currentSellerData ? window.currentSellerData.name : 'my store';
      const text = encodeURIComponent(`Hello Admin, I would like to upgrade ${storeName} to the ${plan} plan. My pending upgrade code is: ${code}. Please verify and activate it.`);
      window.open(`https://wa.me/${adminNumber}?text=${text}`, '_blank');
    };

    // Auto-hide FAB container on mobile after inactivity (to avoid blocking bulk actions / lists)
    document.addEventListener('DOMContentLoaded', () => {
      const fabContainer = document.getElementById('sellerMobileFabContainer');
      if (!fabContainer) return;

      fabContainer.style.transition = 'opacity 0.4s cubic-bezier(0.25, 1, 0.5, 1), transform 0.4s cubic-bezier(0.25, 1, 0.5, 1), bottom 0.4s cubic-bezier(0.25, 1, 0.5, 1)';

      let hideTimeout = null;

      function showFab() {
        fabContainer.style.opacity = '1';
        fabContainer.style.pointerEvents = 'auto';
        if (hideTimeout) clearTimeout(hideTimeout);
        hideTimeout = setTimeout(hideFab, 2500); // 2.5s inactivity hide
      }

      function hideFab() {
        const supportPanel = document.getElementById('supportPanel');
        const dial = document.getElementById('sellerFabDial');
        const isSupportOpen = supportPanel && supportPanel.style.display !== 'none';
        const isDialOpen = dial && dial.classList.contains('open');

        // Only hide if the support panel and speed dial are not open
        if (!isSupportOpen && !isDialOpen) {
          fabContainer.style.opacity = '0';
          fabContainer.style.pointerEvents = 'none';
        }
      }

      window.addEventListener('scroll', showFab, { passive: true });
      window.addEventListener('touchstart', showFab, { passive: true });
      window.addEventListener('click', showFab, { passive: true });
      window.addEventListener('mousemove', showFab, { passive: true });

      // Start initial timer
      showFab();
    });

  