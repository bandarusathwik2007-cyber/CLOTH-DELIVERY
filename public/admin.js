// Admin session states
let currentUser = JSON.parse(localStorage.getItem('cloth_delivery_admin_user')) || null;
let authToken = localStorage.getItem('cloth_delivery_admin_token') || null;

// DOM Elements
const userDisplay = document.getElementById('user-display');
const adminLogoutBtn = document.getElementById('admin-logout-btn');
const adminLoginGate = document.getElementById('admin-login-gate');
const adminLoginForm = document.getElementById('admin-login-form');
const adminLoginAlert = document.getElementById('admin-login-alert');
const adminPanelContent = document.getElementById('admin-panel-content');
const adminGlobalLoader = document.getElementById('admin-global-loader');

// Inventory Elements
const productIngestionForm = document.getElementById('product-ingestion-form');
const ingestionAlertContainer = document.getElementById('ingestion-alert-container');
const inventoryTableBody = document.getElementById('inventory-table-body');
const liveModifierAlertContainer = document.getElementById('live-modifier-alert-container');

// Complaints Queue Elements
const adminComplaintsList = document.getElementById('admin-complaints-list');
const adminComplaintsEmpty = document.getElementById('admin-complaints-empty');
const complaintsQueueAlert = document.getElementById('complaints-queue-alert');

// Orders Placed Elements
const adminOrdersBody = document.getElementById('admin-orders-body');
const adminOrdersEmpty = document.getElementById('admin-orders-empty');
const adminOrdersAlert = document.getElementById('admin-orders-alert');

document.addEventListener('DOMContentLoaded', () => {
  verifyAdminAccess();
  setupAdminEventListeners();
});

function setupAdminEventListeners() {
  // Login Submit
  adminLoginForm.addEventListener('submit', handleAdminLogin);

  // Logout Click
  adminLogoutBtn.addEventListener('click', signOutAdmin);

  // Tab Switches
  document.getElementById('admin-tabs-list').addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-btn')) {
      document.querySelectorAll('#admin-tabs-list .tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

      e.target.classList.add('active');
      const tabId = e.target.getAttribute('data-tab');
      document.getElementById(`pane-${tabId}`).classList.add('active');

      if (tabId === 'inventory') {
        loadInventoryData();
      } else if (tabId === 'complaints') {
        loadComplaintsQueue();
      } else if (tabId === 'orders') {
        loadOrdersPlaced();
      }
    }
  });

  // Product Ingestion Form Submit
  productIngestionForm.addEventListener('submit', handleProductIngestion);
}

// Authentication & Guard Checks
async function verifyAdminAccess() {
  if (authToken && currentUser && currentUser.role === 'admin') {
    // Session exists, show dashboard
    showAdminDashboard();
  } else {
    // Show authentication gate
    adminLoginGate.style.display = 'block';
    adminPanelContent.style.display = 'none';
    adminLogoutBtn.style.display = 'none';
    userDisplay.style.display = 'none';
  }
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const username = document.getElementById('admin-username').value;
  const password = document.getElementById('admin-password').value;

  clearAlerts(adminLoginAlert);

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok) {
      showAlert(adminLoginAlert, data.error || 'Authentication failed.', 'danger');
      return;
    }

    // Role Guard Check
    if (data.user.role !== 'admin') {
      showAlert(adminLoginAlert, 'Unauthorized: Access restricted to store administrators.', 'danger');
      return;
    }


    // Authenticated successfully
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('cloth_delivery_admin_token', authToken);
    localStorage.setItem('cloth_delivery_admin_user', JSON.stringify(currentUser));

    showAdminDashboard();
    adminLoginForm.reset();
  } catch (err) {
    console.error('Admin login submit error:', err);
    showAlert(adminLoginAlert, 'Server error during authentication.', 'danger');
  }
}

function showAdminDashboard() {
  adminLoginGate.style.display = 'none';
  adminPanelContent.style.display = 'block';
  
  userDisplay.textContent = `Owner: ${currentUser.username}`;
  userDisplay.style.display = 'inline-block';
  adminLogoutBtn.style.display = 'inline-block';

  // Load default panel
  loadInventoryData();
}

function signOutAdmin() {
  localStorage.removeItem('cloth_delivery_admin_token');
  localStorage.removeItem('cloth_delivery_admin_user');
  window.location.reload();
}

/* ==========================================================================
   INVENTORY: INGESTION FORM & LIVE MODIFIER RENDER
   ========================================================================== */

async function loadInventoryData() {
  showLoader(true);
  try {
    const response = await fetch('/api/products');
    if (!response.ok) throw new Error('Could not load inventory catalog.');
    const products = await response.json();

    renderInventoryGrid(products);
  } catch (err) {
    console.error('Error fetching inventory:', err);
    showAlert(liveModifierAlertContainer, 'Failed to fetch inventory dataset.', 'danger');
  } finally {
    showLoader(false);
  }
}

function renderInventoryGrid(productsArray) {
  inventoryTableBody.innerHTML = '';

  if (productsArray.length === 0) {
    inventoryTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; font-style: italic;">No products registered in database.</td></tr>`;
    return;
  }

  productsArray.forEach(product => {
    // Sort variants to ensure S, M, L, XL order
    const orderedSizes = ['S', 'M', 'L', 'XL'];
    const variantMap = {};
    if (product.variants) {
      product.variants.forEach(v => {
        variantMap[v.size] = v.stock_quantity;
      });
    }

    const row = document.createElement('tr');
    row.id = `admin-row-${product.id}`;

    // Generate size stocks cell with buttons and mini inputs
    let sizesStocksHTML = '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
    orderedSizes.forEach(size => {
      const currentStock = variantMap[size] !== undefined ? variantMap[size] : 0;
      sizesStocksHTML += `
        <div class="stock-updater-row">
          <span>${size}:</span>
          <button class="stock-btn-mini btn-dec" data-id="${product.id}" data-size="${size}">-</button>
          <input type="number" class="stock-input-mini input-stock" 
                 id="stock-val-${product.id}-${size}"
                 data-id="${product.id}" data-size="${size}" 
                 min="0" value="${currentStock}">
          <button class="stock-btn-mini btn-inc" data-id="${product.id}" data-size="${size}">+</button>
        </div>
      `;
    });
    sizesStocksHTML += '</div>';

    row.innerHTML = `
      <td>
        <div class="prod-cell">
          <img src="${product.image_url}" alt="${product.name}" class="admin-prod-thumb">
          <div class="prod-cell-details">
            <h5>${product.name}</h5>
            <span>ID: ${product.id}</span>
          </div>
        </div>
      </td>
      <td>
        ${sizesStocksHTML}
      </td>
      <td>
        <strong>${formatCurrency(product.base_price)}</strong>
      </td>
      <td>
        <button class="action-btn-danger btn-delete-product" data-id="${product.id}">Delete</button>
      </td>
    `;

    inventoryTableBody.appendChild(row);
  });

  // Bind live stock modification event triggers
  bindLiveStockTriggers();
}

function bindLiveStockTriggers() {
  // Increment Trigger
  document.querySelectorAll('.btn-inc').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const prodId = e.currentTarget.getAttribute('data-id');
      const size = e.currentTarget.getAttribute('data-size');
      const inputEl = document.getElementById(`stock-val-${prodId}-${size}`);
      const val = parseInt(inputEl.value) + 1;
      
      inputEl.value = val;
      updateVariantStock(prodId, size, val);
    });
  });

  // Decrement Trigger
  document.querySelectorAll('.btn-dec').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const prodId = e.currentTarget.getAttribute('data-id');
      const size = e.currentTarget.getAttribute('data-size');
      const inputEl = document.getElementById(`stock-val-${prodId}-${size}`);
      const val = Math.max(0, parseInt(inputEl.value) - 1);
      
      inputEl.value = val;
      updateVariantStock(prodId, size, val);
    });
  });

  // Direct Text Input Blur / Enter Key Triggers
  document.querySelectorAll('.input-stock').forEach(input => {
    input.addEventListener('change', (e) => {
      const prodId = e.target.getAttribute('data-id');
      const size = e.target.getAttribute('data-size');
      const val = Math.max(0, parseInt(e.target.value) || 0);
      
      e.target.value = val;
      updateVariantStock(prodId, size, val);
    });

    input.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        e.target.blur();
      }
    });
  });

  // Delete product button
  document.querySelectorAll('.btn-delete-product').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const prodId = e.target.getAttribute('data-id');
      if (confirm(`Warning: This will permanently delete Product ID ${prodId} and its sizes from database. Continue?`)) {
        deleteProduct(prodId);
      }
    });
  });
}

// REST Update Call: Live Inventory Modifier
async function updateVariantStock(productId, size, count) {
  try {
    const response = await fetch(`/api/admin/products/${productId}/variants`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ size, stock_quantity: count })
    });

    const data = await response.json();
    if (!response.ok) {
      showAlert(liveModifierAlertContainer, data.error || 'Failed to update stock quantity.', 'danger');
      return;
    }

    // Flawlessly updated, flashes brief indicator
    const input = document.getElementById(`stock-val-${productId}-${size}`);
    input.style.borderColor = 'var(--color-success)';
    setTimeout(() => { input.style.borderColor = 'var(--color-border)'; }, 1000);

  } catch (err) {
    console.error('Variant stock PUT failure:', err);
    showAlert(liveModifierAlertContainer, 'Connection error. Stock not updated in DB.', 'danger');
  }
}

// Ingestion Form Submissions
async function handleProductIngestion(e) {
  e.preventDefault();
  clearAlerts(ingestionAlertContainer);
  showLoader(true);

  const name = document.getElementById('ingest-name').value;
  const description = document.getElementById('ingest-desc').value;
  const base_price = document.getElementById('ingest-price').value;
  const imageFile = document.getElementById('ingest-image').files[0];
  
  const stock_S = document.getElementById('ingest-stock-S').value;
  const stock_M = document.getElementById('ingest-stock-M').value;
  const stock_L = document.getElementById('ingest-stock-L').value;
  const stock_XL = document.getElementById('ingest-stock-XL').value;

  const formData = new FormData();
  formData.append('name', name);
  formData.append('description', description);
  formData.append('base_price', base_price);
  formData.append('product_image', imageFile);
  formData.append('stock_S', stock_S);
  formData.append('stock_M', stock_M);
  formData.append('stock_L', stock_L);
  formData.append('stock_XL', stock_XL);

  try {
    const response = await fetch('/api/admin/products', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      body: formData
    });

    const data = await response.json();
    if (!response.ok) {
      showAlert(ingestionAlertContainer, data.error || 'Product registration failed.', 'danger');
      return;
    }

    showAlert(ingestionAlertContainer, 'Product created and catalog updated!', 'success');
    productIngestionForm.reset();
    
    // Reload catalog modifier
    loadInventoryData();
  } catch (err) {
    console.error('Product creation error:', err);
    showAlert(ingestionAlertContainer, 'Network failure adding product.', 'danger');
  } finally {
    showLoader(false);
  }
}

// Delete Product
async function deleteProduct(productId) {
  showLoader(true);
  try {
    const response = await fetch(`/api/admin/products/${productId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      showAlert(liveModifierAlertContainer, data.error || 'Failed to delete product.', 'danger');
      return;
    }

    showAlert(liveModifierAlertContainer, 'Product removed successfully.', 'success');
    loadInventoryData();
  } catch (err) {
    console.error('Delete request error:', err);
    showAlert(liveModifierAlertContainer, 'Network error trying to delete product.', 'danger');
  } finally {
    showLoader(false);
  }
}

/* ==========================================================================
   COMPLAINTS QUEUE: SEVERITY ORGANIZE & STATUS ACTIONS
   ========================================================================== */

async function loadComplaintsQueue() {
  showLoader(true);
  try {
    const response = await fetch('/api/admin/complaints', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (!response.ok) throw new Error('Failed to retrieve complaints data.');
    const complaints = await response.json();

    renderComplaintsQueue(complaints);
  } catch (err) {
    console.error('Error fetching tickets list:', err);
    showAlert(complaintsQueueAlert, 'Failed to retrieve tickets.', 'danger');
  } finally {
    showLoader(false);
  }
}

function renderComplaintsQueue(complaints) {
  adminComplaintsList.innerHTML = '';
  
  if (complaints.length === 0) {
    adminComplaintsEmpty.style.display = 'block';
    return;
  }

  adminComplaintsEmpty.style.display = 'none';

  complaints.forEach(ticket => {
    // Map Issue Types to Severity values for display
    let severityLabel = 'Low Severity';
    let severityClass = 'severity-low';

    if (ticket.issue_type === 'Damaged Clothes') {
      severityLabel = 'High Severity';
      severityClass = 'severity-high';
    } else if (ticket.issue_type === 'Wrong Delivery') {
      severityLabel = 'Medium Severity';
      severityClass = 'severity-medium';
    }

    const ticketDate = new Date(ticket.created_at).toLocaleString();

    const ticketEl = document.createElement('div');
    ticketEl.className = 'admin-complaint-ticket';
    ticketEl.id = `admin-ticket-${ticket.id}`;

    ticketEl.innerHTML = `
      <div class="ticket-details">
        <div class="ticket-header">
          <span class="severity-indicator ${severityClass}">${severityLabel}</span>
          <span class="status-badge status-${ticket.status.toLowerCase()}" id="ticket-status-${ticket.id}">${ticket.status}</span>
        </div>
        <h3 style="font-family: var(--font-editorial); margin-top: 0.5rem;">
          ${ticket.issue_type} — Ticket #${ticket.id}
        </h3>
        <p style="font-size: 0.85rem; color: var(--color-text-secondary);">
          Customer: <strong>${ticket.username}</strong> | Order Ref: ${ticket.order_id ? `#${ticket.order_id}` : 'General'} | Filed: ${ticketDate}
        </p>
        <div class="ticket-desc">
          ${ticket.description}
        </div>
        
        <!-- Resolve & Delete Actions -->
        <div style="margin-top: 1rem; display: flex; gap: 1rem; align-items: center;">
          <span id="resolve-container-${ticket.id}">
            ${ticket.status === 'Pending' ? `
              <button class="primary-btn resolve-ticket-btn" data-id="${ticket.id}" style="padding: 0.6rem 1.2rem; font-size: 0.85rem; width: auto; margin-right: 0.5rem;">
                Mark Resolved
              </button>
            ` : ''}
          </span>
          <button class="action-btn-danger delete-ticket-btn" data-id="${ticket.id}" style="padding: 0.6rem 1.2rem; font-size: 0.85rem; width: auto;">
            Delete Ticket
          </button>
        </div>
      </div>

      <!-- Proof Image Container -->
      <div class="ticket-proof">
        ${ticket.image_proof_url ? `
          <a href="${ticket.image_proof_url}" target="_blank">
            <img src="${ticket.image_proof_url}" alt="Damage Proof File">
          </a>
          <span>Click to view full photo</span>
        ` : `
          <span style="color: var(--color-text-muted); font-style: italic;">No photo proof uploaded</span>
        `}
      </div>
    `;

    adminComplaintsList.appendChild(ticketEl);
  });

  // Bind resolve triggers
  document.querySelectorAll('.resolve-ticket-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const ticketId = e.target.getAttribute('data-id');
      resolveComplaintTicket(ticketId);
    });
  });

  // Bind delete triggers
  document.querySelectorAll('.delete-ticket-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const ticketId = e.target.getAttribute('data-id');
      if (confirm(`Are you sure you want to permanently delete support ticket #${ticketId}?`)) {
        deleteComplaintTicket(ticketId);
      }
    });
  });
}

// REST Update Call: Mark complaint resolved
async function resolveComplaintTicket(ticketId) {
  try {
    const response = await fetch(`/api/admin/complaints/${ticketId}/resolve`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      showAlert(complaintsQueueAlert, data.error || 'Failed to update ticket status.', 'danger');
      return;
    }

    // Success update state UI
    const statusBadge = document.getElementById(`ticket-status-${ticketId}`);
    statusBadge.textContent = 'Resolved';
    statusBadge.className = 'status-badge status-resolved';

    // Hide Resolve Action button
    const actionContainer = document.getElementById(`resolve-container-${ticketId}`);
    actionContainer.innerHTML = '';
  } catch (err) {
    console.error('Resolve ticket API failure:', err);
    showAlert(complaintsQueueAlert, 'Connection error. Status not changed in DB.', 'danger');
  }
}

// REST Delete Call: Delete complaint ticket permanently
async function deleteComplaintTicket(ticketId) {
  showLoader(true);
  clearAlerts(complaintsQueueAlert);
  try {
    const response = await fetch(`/api/admin/complaints/${ticketId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      showAlert(complaintsQueueAlert, data.error || 'Failed to delete complaint ticket.', 'danger');
      return;
    }

    showAlert(complaintsQueueAlert, 'Complaint ticket deleted successfully.', 'success');
    loadComplaintsQueue();
  } catch (err) {
    console.error('Delete ticket API failure:', err);
    showAlert(complaintsQueueAlert, 'Connection error. Ticket not deleted in DB.', 'danger');
  } finally {
    showLoader(false);
  }
}

/* ==========================================================================
   UTILITY HELPER CALLS
   ========================================================================== */

function showLoader(state) {
  adminGlobalLoader.style.display = state ? 'inline-block' : 'none';
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

// PANEL 3: ORDERS PLACED METHODS
async function loadOrdersPlaced() {
  showLoader(true);
  clearAlerts(adminOrdersAlert);
  try {
    const response = await fetch('/api/admin/orders', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!response.ok) throw new Error('Failed to fetch orders data.');
    const orders = await response.json();

    renderOrdersPlaced(orders);
  } catch (err) {
    console.error('Error fetching placed orders:', err);
    showAlert(adminOrdersAlert, 'Failed to retrieve orders list.', 'danger');
  } finally {
    showLoader(false);
  }
}

function renderOrdersPlaced(orders) {
  adminOrdersBody.innerHTML = '';

  if (orders.length === 0) {
    adminOrdersEmpty.style.display = 'block';
    return;
  }

  adminOrdersEmpty.style.display = 'none';

  orders.forEach(order => {
    const orderDate = new Date(order.created_at).toLocaleString();
    const row = document.createElement('tr');

    let itemsHTML = '<ul style="list-style: none; padding-left: 0; font-size: 0.85rem; margin: 0;">';
    if (order.items && order.items.length > 0) {
      order.items.forEach(item => {
        itemsHTML += `<li>${item.product_name} (${item.size}) x ${item.quantity} @ ${formatCurrency(item.price)}</li>`;
      });
    } else {
      itemsHTML += '<li>No items recorded</li>';
    }
    itemsHTML += '</ul>';

    row.innerHTML = `
      <td><strong>#${order.id}</strong></td>
      <td style="font-size: 0.85rem; white-space: nowrap;">${orderDate}</td>
      <td>${order.username}</td>
      <td>
        <div style="font-size: 0.85rem;">
          <div><strong>Name:</strong> ${order.customer_name}</div>
          <div><strong>Address:</strong> ${order.shipping_address}</div>
          <div><strong>Phone:</strong> ${order.phone_number}</div>
        </div>
      </td>
      <td>${itemsHTML}</td>
      <td><strong>${formatCurrency(order.total_price)}</strong></td>
    `;
    adminOrdersBody.appendChild(row);
  });
}
