// State management for storefront
let products = [];
let cart = JSON.parse(localStorage.getItem('cloth_delivery_cart')) || [];
let activeProduct = null;
let activeSize = null;
let activeSizeStock = null;
let currentUser = JSON.parse(localStorage.getItem('cloth_delivery_customer_user')) || null;
let authToken = localStorage.getItem('cloth_delivery_customer_token') || null;

// DOM Elements
const productsGrid = document.getElementById('catalog-products-grid');
const searchBar = document.getElementById('search-bar');
const categorySelector = document.getElementById('category-selector');

// Product Modal Elements
const productDetailModalBackdrop = document.getElementById('product-detail-modal-backdrop');
const productModalClose = document.getElementById('product-modal-close');
const modalProductImg = document.getElementById('modal-product-img');
const modalProductTitle = document.getElementById('modal-product-title');
const modalProductPrice = document.getElementById('modal-product-price');
const modalProductDesc = document.getElementById('modal-product-desc');
const modalSizeSelector = document.getElementById('modal-size-selector');
const modalStockCount = document.getElementById('modal-stock-count');
const modalOutOfStockBadgeContainer = document.getElementById('modal-out-of-stock-badge-container');
const modalAddToCartBtn = document.getElementById('modal-add-to-cart-btn');

// Cart Drawer Elements
const cartBtnToggle = document.getElementById('cart-btn-toggle');
const cartCountBadge = document.getElementById('cart-count-badge');
const cartDrawerBackdrop = document.getElementById('cart-drawer-backdrop');
const cartDrawerClose = document.getElementById('cart-drawer-close');
const cartItemsWrapper = document.getElementById('cart-items-wrapper');
const cartTotalPrice = document.getElementById('cart-total-price');
const cartCheckoutBtn = document.getElementById('cart-checkout-btn');

// Auth Elements
const authBtnToggle = document.getElementById('auth-btn-toggle');
const userDisplay = document.getElementById('user-display');
const authModalBackdrop = document.getElementById('auth-modal-backdrop');
const authModalClose = document.getElementById('auth-modal-close');
const authLoginPane = document.getElementById('auth-login-pane');
const authSignupPane = document.getElementById('auth-signup-pane');
const linkSwitchSignup = document.getElementById('link-switch-signup');
const linkSwitchLogin = document.getElementById('link-switch-login');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const loginAlertContainer = document.getElementById('login-alert-container');
const signupAlertContainer = document.getElementById('signup-alert-container');

// Checkout Elements
const checkoutModalBackdrop = document.getElementById('checkout-modal-backdrop');
const checkoutModalClose = document.getElementById('checkout-modal-close');
const checkoutSummaryTotal = document.getElementById('checkout-summary-total');
const checkoutDetailsForm = document.getElementById('checkout-details-form');
const checkoutAlertContainer = document.getElementById('checkout-alert-container');

/* ==========================================================================
   INITIALIZATION & API CALLS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  fetchProducts();
  checkAuthStatus();
  updateCartUI();

  // Wire up event listeners
  setupEventListeners();
});

// Event Listeners Routing
function setupEventListeners() {
  // Filters
  searchBar.addEventListener('input', filterProducts);
  categorySelector.addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-btn')) {
      document.querySelectorAll('#category-selector .filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      filterProducts();
    }
  });

  // Modal Close
  productModalClose.addEventListener('click', () => toggleModal(productDetailModalBackdrop, false));
  authModalClose.addEventListener('click', () => toggleModal(authModalBackdrop, false));
  checkoutModalClose.addEventListener('click', () => toggleModal(checkoutModalBackdrop, false));

  // Toggle Cart Drawer
  cartBtnToggle.addEventListener('click', () => toggleModal(cartDrawerBackdrop, true));
  cartDrawerClose.addEventListener('click', () => toggleModal(cartDrawerBackdrop, false));
  cartDrawerBackdrop.addEventListener('click', (e) => {
    if (e.target === cartDrawerBackdrop) toggleModal(cartDrawerBackdrop, false);
  });

  // Size Selector buttons inside Modal
  document.querySelectorAll('#modal-size-selector .size-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      selectProductSize(e.target.getAttribute('data-size'));
    });
  });

  // Add to Cart from Modal
  modalAddToCartBtn.addEventListener('click', addActiveItemToCart);

  // Toggle User Auth / Account Action
  authBtnToggle.addEventListener('click', () => {
    if (currentUser) {
      if (confirm(`You are signed in as ${currentUser.username}. Do you want to sign out?`)) {
        signOut();
      }
    } else {
      openAuthModal('login');
    }
  });

  // Auth panel switches
  linkSwitchSignup.addEventListener('click', () => switchAuthPanel('signup'));
  linkSwitchLogin.addEventListener('click', () => switchAuthPanel('login'));

  // Auth Forms Submission
  loginForm.addEventListener('submit', handleLogin);
  signupForm.addEventListener('submit', handleSignup);

  // Cart Checkout Action
  cartCheckoutBtn.addEventListener('click', () => {
    if (!currentUser) {
      toggleModal(cartDrawerBackdrop, false);
      openAuthModal('login');
      showAlert(loginAlertContainer, 'Please sign in to complete checkout.', 'danger');
    } else if (cart.length === 0) {
      alert('Your cart is empty.');
    } else {
      toggleModal(cartDrawerBackdrop, false);
      checkoutSummaryTotal.textContent = formatCurrency(calculateCartTotal());
      clearAlerts(checkoutAlertContainer);
      toggleModal(checkoutModalBackdrop, true);
    }
  });

  // Checkout Form Submission
  checkoutDetailsForm.addEventListener('submit', handleCheckout);
}

// Fetch all products
async function fetchProducts() {
  try {
    const response = await fetch('/api/products');
    if (!response.ok) throw new Error('Failed to load products');
    products = await response.json();
    renderProductsList(products);
  } catch (err) {
    console.error('Error fetching products:', err);
  }
}

// Check session
async function checkAuthStatus() {
  if (!authToken) return;
  try {
    const response = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
      localStorage.setItem('cloth_delivery_customer_user', JSON.stringify(currentUser));
      updateAuthUI();
    } else {
      signOut();
    }
  } catch (err) {
    console.error('Auth verification error:', err);
    signOut();
  }
}

/* ==========================================================================
   UI RENDERING: PRODUCT CATALOG
   ========================================================================== */

function renderProductsList(productsArray) {
  productsGrid.innerHTML = '';
  if (productsArray.length === 0) {
    productsGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; font-style: italic; color: var(--color-text-secondary);">No pieces found matching the criteria.</p>`;
    return;
  }

  productsArray.forEach((product) => {
    // Check if product is completely out of stock across all sizes
    const totalStock = product.variants ? product.variants.reduce((sum, v) => sum + v.stock_quantity, 0) : 0;
    const isOutOfStock = totalStock === 0;

    const productCard = document.createElement('div');
    productCard.className = 'product-card';
    productCard.id = `product-card-${product.id}`;
    
    productCard.innerHTML = `
      <div class="card-img-container">
        ${isOutOfStock ? `<span class="card-out-of-stock-badge">Sold Out</span>` : ''}
        <img src="${product.image_url}" alt="${product.name}" loading="lazy">
      </div>
      <div class="product-info">
        <h3>${product.name}</h3>
        <p>${product.description || 'No description available.'}</p>
        <div class="price-row">
          <span class="price">${formatCurrency(product.base_price)}</span>
          <button class="view-details-btn" id="btn-view-${product.id}">View Details</button>
        </div>
      </div>
    `;

    // Click handler opens detail view
    productCard.addEventListener('click', (e) => {
      // Don't trigger if click was inside another button if any added
      openProductDetails(product.id);
    });

    productsGrid.appendChild(productCard);
  });
}

function filterProducts() {
  const searchTerm = searchBar.value.toLowerCase().trim();
  const activeCategoryBtn = document.querySelector('#category-selector .filter-btn.active');
  const category = activeCategoryBtn ? activeCategoryBtn.getAttribute('data-category') : 'all';

  let filtered = products;

  // Search filter
  if (searchTerm) {
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(searchTerm) || 
      (p.description && p.description.toLowerCase().includes(searchTerm))
    );
  }

  // Category filter
  if (category !== 'all') {
    // Basic category routing (e.g. Shirts/Tops, Sweaters/Tops, Trousers/Bottoms, Coat/Outerwear)
    filtered = filtered.filter(p => {
      const name = p.name.toLowerCase();
      if (category === 'tops') {
        return name.includes('shirt') || name.includes('sweater') || name.includes('knit');
      } else if (category === 'bottoms') {
        return name.includes('trouser') || name.includes('pant') || name.includes('skirt') || name.includes('jean');
      } else if (category === 'outerwear') {
        return name.includes('coat') || name.includes('jacket') || name.includes('trench');
      }
      return true;
    });
  }

  renderProductsList(filtered);
}

/* ==========================================================================
   UI RENDERING: PRODUCT DETAIL MODAL & SIZE SELECTION
   ========================================================================== */

async function openProductDetails(productId) {
  try {
    const response = await fetch(`/api/products/${productId}`);
    if (!response.ok) throw new Error('Product details fetch failed');
    activeProduct = await response.json();
    
    activeSize = null;
    activeSizeStock = null;

    // Reset Modal Content
    modalProductImg.src = activeProduct.image_url;
    modalProductImg.alt = activeProduct.name;
    modalProductTitle.textContent = activeProduct.name;
    modalProductPrice.textContent = formatCurrency(activeProduct.base_price);
    modalProductDesc.textContent = activeProduct.description;

    // Reset Size buttons style
    document.querySelectorAll('#modal-size-selector .size-pill').forEach(btn => {
      btn.classList.remove('active');
    });

    // Reset Stock Counter UI
    modalStockCount.textContent = 'Select a size to view stock';
    modalStockCount.className = '';
    modalOutOfStockBadgeContainer.innerHTML = '';

    // Reset Add to Cart Button UI
    modalAddToCartBtn.disabled = true;
    modalAddToCartBtn.textContent = 'Select Size';
    modalAddToCartBtn.className = 'primary-btn';

    // Open Modal
    toggleModal(productDetailModalBackdrop, true);
  } catch (err) {
    console.error('Error rendering product detail modal:', err);
  }
}

// Size Button Click Handling & Dynamic Stock Indicator Logic
async function selectProductSize(size) {
  if (!activeProduct) return;
  activeSize = size;

  // Set active class on buttons
  document.querySelectorAll('#modal-size-selector .size-pill').forEach(btn => {
    if (btn.getAttribute('data-size') === size) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Dynamic fetch specific stock
  try {
    const response = await fetch(`/api/products/${activeProduct.id}/stock?size=${size}`);
    if (!response.ok) throw new Error('Failed to fetch stock quantity');
    const data = await response.json();
    activeSizeStock = data.stock_quantity;

    // Render stock indicators and safety triggers
    renderStockDetails(activeSizeStock);
  } catch (err) {
    console.error('Error fetching size stock:', err);
    modalStockCount.textContent = 'Stock verification error';
    modalStockCount.className = 'stock-badge-critical';
  }
}

function renderStockDetails(stock) {
  modalOutOfStockBadgeContainer.innerHTML = '';

  if (stock === 0) {
    // Out of Stock condition
    modalStockCount.innerHTML = `<span class="stock-badge-critical">Out of Stock (0 items available)</span>`;
    
    // SAFEGUARD: Disable button, alter text, display Out of Stock badge
    modalAddToCartBtn.disabled = true;
    modalAddToCartBtn.textContent = 'No Stock';
    modalAddToCartBtn.classList.add('no-stock-btn');

    const outOfStockBadge = document.createElement('span');
    outOfStockBadge.className = 'out-of-stock-visual-badge';
    outOfStockBadge.id = 'modal-out-of-stock-badge';
    outOfStockBadge.textContent = 'SOLD OUT';
    modalOutOfStockBadgeContainer.appendChild(outOfStockBadge);
  } else {
    // Available stock conditions
    modalAddToCartBtn.disabled = false;
    modalAddToCartBtn.textContent = 'Add to Cart';
    modalAddToCartBtn.classList.remove('no-stock-btn');

    if (stock < 5) {
      modalStockCount.innerHTML = `<span class="stock-badge-low">Low Stock (only ${stock} left)</span>`;
    } else {
      modalStockCount.innerHTML = `<span class="stock-badge-good">In Stock (${stock} available)</span>`;
    }
  }
}

/* ==========================================================================
   UI RENDERING: PERSISTENT SHOPPING CART
   ========================================================================== */

function addActiveItemToCart() {
  if (!activeProduct || !activeSize || activeSizeStock === undefined) return;

  // Double check stock quantity client-side
  if (activeSizeStock <= 0) {
    alert('This size is currently out of stock.');
    return;
  }

  const existingItemIndex = cart.findIndex(
    item => item.product_id === activeProduct.id && item.size === activeSize
  );

  if (existingItemIndex > -1) {
    const nextQty = cart[existingItemIndex].quantity + 1;
    if (nextQty > activeSizeStock) {
      alert(`Cannot add more. Only ${activeSizeStock} items available in stock.`);
      return;
    }
    cart[existingItemIndex].quantity = nextQty;
  } else {
    cart.push({
      product_id: activeProduct.id,
      name: activeProduct.name,
      price: activeProduct.base_price,
      image_url: activeProduct.image_url,
      size: activeSize,
      quantity: 1,
      available_stock: activeSizeStock // Store active stock limit
    });
  }

  saveCart();
  updateCartUI();
  toggleModal(productDetailModalBackdrop, false);
  toggleModal(cartDrawerBackdrop, true); // Slide drawer open
}

function updateCartUI() {
  cartItemsWrapper.innerHTML = '';
  const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  if (totalCount > 0) {
    cartCountBadge.textContent = totalCount;
    cartCountBadge.style.display = 'flex';
  } else {
    cartCountBadge.style.display = 'none';
  }

  if (cart.length === 0) {
    cartItemsWrapper.innerHTML = `<p class="cart-empty-message">Your shopping drawer is empty.</p>`;
    cartTotalPrice.textContent = '₹0.00';
    cartCheckoutBtn.disabled = true;
    return;
  }

  cartCheckoutBtn.disabled = false;

  cart.forEach((item, index) => {
    const itemCard = document.createElement('div');
    itemCard.className = 'cart-item';
    itemCard.innerHTML = `
      <div class="cart-item-img">
        <img src="${item.image_url}" alt="${item.name}">
      </div>
      <div class="cart-item-details">
        <h4>${item.name}</h4>
        <div class="cart-item-meta">Size: ${item.size}</div>
        <div class="cart-item-price">${formatCurrency(item.price)}</div>
        <div class="cart-item-actions">
          <div class="quantity-control">
            <button class="qty-btn dec-qty-btn" data-index="${index}">-</button>
            <span class="qty-val">${item.quantity}</span>
            <button class="qty-btn inc-qty-btn" data-index="${index}">+</button>
          </div>
          <button class="remove-item-btn" data-index="${index}">Remove</button>
        </div>
      </div>
    `;
    cartItemsWrapper.appendChild(itemCard);
  });

  cartTotalPrice.textContent = formatCurrency(calculateCartTotal());

  // Attach cart events
  document.querySelectorAll('.dec-qty-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      updateCartItemQuantity(idx, cart[idx].quantity - 1);
    });
  });

  document.querySelectorAll('.inc-qty-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      updateCartItemQuantity(idx, cart[idx].quantity + 1);
    });
  });

  document.querySelectorAll('.remove-item-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      removeCartItem(idx);
    });
  });
}

function updateCartItemQuantity(index, quantity) {
  if (quantity <= 0) {
    removeCartItem(index);
    return;
  }

  // Cap quantity at locally cached size stock limit if available
  const item = cart[index];
  if (item.available_stock && quantity > item.available_stock) {
    alert(`Only ${item.available_stock} items are in stock for this variant.`);
    return;
  }

  cart[index].quantity = quantity;
  saveCart();
  updateCartUI();
}

function removeCartItem(index) {
  cart.splice(index, 1);
  saveCart();
  updateCartUI();
}

function calculateCartTotal() {
  return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
}

function saveCart() {
  localStorage.setItem('cloth_delivery_cart', JSON.stringify(cart));
}

function clearCart() {
  cart = [];
  localStorage.removeItem('cloth_delivery_cart');
  updateCartUI();
}

/* ==========================================================================
   AUTHENTICATION LOGIC (SIGN IN / REGISTRATION)
   ========================================================================== */

function openAuthModal(mode) {
  switchAuthPanel(mode);
  clearAlerts(loginAlertContainer);
  clearAlerts(signupAlertContainer);
  toggleModal(authModalBackdrop, true);
}

function switchAuthPanel(mode) {
  if (mode === 'login') {
    authLoginPane.style.display = 'block';
    authSignupPane.style.display = 'none';
  } else {
    authLoginPane.style.display = 'none';
    authSignupPane.style.display = 'block';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  clearAlerts(loginAlertContainer);

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok) {
      showAlert(loginAlertContainer, data.error || 'Login failed.', 'danger');
      return;
    }

    if (data.user.role !== 'customer') {
      showAlert(loginAlertContainer, 'Unauthorized: Admin accounts cannot sign in as customers.', 'danger');
      return;
    }


    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('cloth_delivery_customer_token', authToken);
    localStorage.setItem('cloth_delivery_customer_user', JSON.stringify(currentUser));

    updateAuthUI();
    toggleModal(authModalBackdrop, false);
    
    // Clear login inputs
    loginForm.reset();
  } catch (err) {
    console.error('Login submit error:', err);
    showAlert(loginAlertContainer, 'Connection error. Please try again.', 'danger');
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const username = document.getElementById('signup-username').value;
  const password = document.getElementById('signup-password').value;

  clearAlerts(signupAlertContainer);

  try {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok) {
      showAlert(signupAlertContainer, data.error || 'Registration failed.', 'danger');
      return;
    }

    showAlert(signupAlertContainer, 'Registration successful! Please sign in.', 'success');
    setTimeout(() => {
      switchAuthPanel('login');
      signupForm.reset();
    }, 1500);
  } catch (err) {
    console.error('Signup submit error:', err);
    showAlert(signupAlertContainer, 'Connection error. Please try again.', 'danger');
  }
}

function updateAuthUI() {
  if (currentUser) {
    userDisplay.textContent = `Hi, ${currentUser.username}`;
    userDisplay.style.display = 'inline-block';
    authBtnToggle.title = 'Sign Out';
    
    // Check role, show dashboard access helper if admin
    if (currentUser.role === 'admin') {
      document.getElementById('nav-link-admin').style.fontWeight = 'bold';
    }
  } else {
    userDisplay.style.display = 'none';
    authBtnToggle.title = 'Account';
  }
}

function signOut() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('cloth_delivery_customer_token');
  localStorage.removeItem('cloth_delivery_customer_user');
  updateAuthUI();
  window.location.reload();
}

/* ==========================================================================
   CHECKOUT OPERATIONS
   ========================================================================== */

async function handleCheckout(e) {
  e.preventDefault();
  
  if (!authToken || !currentUser) {
    showAlert(checkoutAlertContainer, 'Session expired. Please re-authenticate.', 'danger');
    return;
  }

  clearAlerts(checkoutAlertContainer);
  
  const checkoutItems = cart.map(item => ({
    product_id: item.product_id,
    size: item.size,
    quantity: item.quantity
  }));

  const customer_name = document.getElementById('checkout-fullname').value;
  const shipping_address = document.getElementById('checkout-address').value;
  const phone_number = document.getElementById('checkout-phone').value;

  try {
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        items: checkoutItems,
        customer_name,
        shipping_address,
        phone_number
      })
    });

    const data = await response.json();
    if (!response.ok) {
      // Handle out-of-stock failure response (checks "No Stock" safeguard back-end return error)
      showAlert(checkoutAlertContainer, data.error || 'Checkout failed.', 'danger');
      // Re-fetch products to update storefront stocks immediately
      fetchProducts();
      return;
    }

    // Success
    showAlert(checkoutAlertContainer, 'Order submitted successfully! Thank you.', 'success');
    clearCart();
    
    setTimeout(() => {
      toggleModal(checkoutModalBackdrop, false);
      checkoutDetailsForm.reset();
      window.location.reload();
    }, 2000);

  } catch (err) {
    console.error('Checkout submit error:', err);
    showAlert(checkoutAlertContainer, 'Network error. Please try again.', 'danger');
  }
}

/* ==========================================================================
   MODAL UTILITY TRIGGERS
   ========================================================================== */

function toggleModal(modalBackdropElement, state) {
  if (state) {
    modalBackdropElement.classList.add('active');
  } else {
    modalBackdropElement.classList.remove('active');
  }
}

function showAlert(container, message, type) {
  container.innerHTML = `
    <div class="alert alert-${type}" role="alert">
      ${message}
    </div>
  `;
}

function clearAlerts(container) {
  container.innerHTML = '';
}

function formatCurrency(val) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(val);
}
