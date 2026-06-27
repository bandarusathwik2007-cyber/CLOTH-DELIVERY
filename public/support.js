// Auth state
let currentUser = JSON.parse(localStorage.getItem('cloth_delivery_customer_user')) || null;
let authToken = localStorage.getItem('cloth_delivery_customer_token') || null;

// DOM Elements
const userDisplay = document.getElementById('user-display');
const authBtnToggle = document.getElementById('auth-btn-toggle');
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

// Support Specific Elements
const supportAuthGate = document.getElementById('support-auth-gate');
const supportLoginTrigger = document.getElementById('support-login-trigger');
const complaintSubmissionForm = document.getElementById('complaint-submission-form');
const complaintIssueType = document.getElementById('complaint-issue-type');
const complaintOrderId = document.getElementById('complaint-order-id');
const richEditorContent = document.getElementById('rich-editor-content');
const complaintImageProof = document.getElementById('complaint-image-proof');
const supportAlertContainer = document.getElementById('support-alert-container');
const supportLogEmpty = document.getElementById('support-log-empty');
const complaintsContainer = document.getElementById('complaints-container');

// Rich Text Editor Toolbar Buttons
const editorBold = document.getElementById('editor-bold');
const editorItalic = document.getElementById('editor-italic');
const editorUnderline = document.getElementById('editor-underline');

document.addEventListener('DOMContentLoaded', () => {
  checkAuthStatus();
  setupEventListeners();
  setupRichTextToolbar();
});

function setupEventListeners() {
  // Modal Close
  authModalClose.addEventListener('click', () => toggleModal(authModalBackdrop, false));
  
  // Auth Gates
  supportLoginTrigger.addEventListener('click', () => openAuthModal('login'));

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

  // Complaint Submission Form Handler
  complaintSubmissionForm.addEventListener('submit', handleComplaintSubmit);
}

// Check Session & Render View Panels
async function checkAuthStatus() {
  if (authToken) {
    try {
      const response = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        currentUser = data.user;
        localStorage.setItem('cloth_delivery_customer_user', JSON.stringify(currentUser));
        updateAuthUI();
        initializeSupportPortal();
      } else {
        signOut();
      }
    } catch (err) {
      console.error('Session verification error:', err);
      signOut();
    }
  } else {
    // Show auth warning gate
    supportAuthGate.style.display = 'block';
    complaintSubmissionForm.style.display = 'none';
    supportLogEmpty.textContent = 'Sign in to view submitted tickets.';
    complaintsContainer.style.display = 'none';
  }
}

// Populate orders and ticket logs for logged-in user
function initializeSupportPortal() {
  supportAuthGate.style.display = 'none';
  complaintSubmissionForm.style.display = 'block';
  
  fetchUserOrders();
  fetchUserComplaints();
}

// Fetch user orders to link complaints to order IDs
async function fetchUserOrders() {
  try {
    const response = await fetch('/api/orders', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!response.ok) throw new Error('Could not load orders');
    const orders = await response.json();

    // Populate dropdown
    complaintOrderId.innerHTML = '<option value="">No specific order / general complaint</option>';
    orders.forEach(order => {
      const formattedDate = new Date(order.created_at).toLocaleDateString();
      const option = document.createElement('option');
      option.value = order.id;
      option.textContent = `Order #${order.id} — Total ${formatCurrency(order.total_price)} (${formattedDate})`;
      complaintOrderId.appendChild(option);
    });
  } catch (err) {
    console.error('Error fetching user orders for support form:', err);
  }
}

// Fetch user complaints log
async function fetchUserComplaints() {
  try {
    const response = await fetch('/api/complaints', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!response.ok) throw new Error('Could not load complaints');
    const complaints = await response.json();

    if (complaints.length === 0) {
      supportLogEmpty.style.display = 'block';
      supportLogEmpty.textContent = 'You have not submitted any support complaints yet.';
      complaintsContainer.style.display = 'none';
      return;
    }

    supportLogEmpty.style.display = 'none';
    complaintsContainer.innerHTML = '';
    complaintsContainer.style.display = 'block';

    complaints.forEach(ticket => {
      const createdDate = new Date(ticket.created_at).toLocaleString();
      const ticketCard = document.createElement('div');
      ticketCard.className = 'complaint-item-card';
      ticketCard.innerHTML = `
        <div class="complaint-item-header">
          <span class="complaint-type">${ticket.issue_type}</span>
          <span class="status-badge status-${ticket.status.toLowerCase()}">${ticket.status}</span>
        </div>
        <div class="complaint-meta">
          Ticket #${ticket.id} ${ticket.order_id ? `| Order #${ticket.order_id}` : ''} | Filed: ${createdDate}
        </div>
        <div class="complaint-desc">
          ${ticket.description}
        </div>
        <div style="display: flex; gap: 1rem; align-items: center; margin-top: 0.5rem;">
          ${ticket.image_proof_url ? `
            <a href="${ticket.image_proof_url}" target="_blank" class="proof-link">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><polyline points="12 16 16 12 12 8"></polyline><line x1="8" y1="12" x2="16" y2="12"></line></svg>
              View Photo Proof
            </a>
          ` : ''}
          <button class="remove-log-btn" data-id="${ticket.id}" style="font-size: 0.8rem; color: var(--color-danger); background: none; border: none; cursor: pointer; padding: 0; display: inline-flex; align-items: center; gap: 0.25rem;">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            Remove Log
          </button>
        </div>
      `;
      complaintsContainer.appendChild(ticketCard);
    });

    // Bind event listeners for remove log buttons
    complaintsContainer.querySelectorAll('.remove-log-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const ticketId = e.currentTarget.getAttribute('data-id');
        if (confirm('Are you sure you want to remove this complaint log?')) {
          removeCustomerComplaint(ticketId);
        }
      });
    });

  } catch (err) {
    console.error('Error fetching complaints list:', err);
    supportLogEmpty.textContent = 'Failed to load support logs.';
  }
}

// Remove customer complaint log from database
async function removeCustomerComplaint(ticketId) {
  try {
    const response = await fetch(`/api/complaints/${ticketId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      alert(data.error || 'Failed to remove complaint log.');
      return;
    }

    // Refresh complaints log view
    fetchUserComplaints();
  } catch (err) {
    console.error('Error removing customer complaint:', err);
    alert('Connection error. Please try again.');
  }
}

// Form Submission & Validation Handler
async function handleComplaintSubmit(e) {
  e.preventDefault();
  clearAlerts(supportAlertContainer);

  const issueType = complaintIssueType.value;
  const orderId = complaintOrderId.value;
  const description = richEditorContent.innerHTML.trim();
  const file = complaintImageProof.files[0];

  // Validation
  if (!issueType) {
    showAlert(supportAlertContainer, 'Please select a valid issue type.', 'danger');
    return;
  }

  if (description === '' || richEditorContent.textContent.trim() === '') {
    showAlert(supportAlertContainer, 'Please enter details describing the complaint.', 'danger');
    return;
  }

  // STRICT REQUIREMENT: Upload proof required for Damaged Clothes
  if (issueType === 'Damaged Clothes' && !file) {
    showAlert(supportAlertContainer, 'Critical: Photo proof is mandatory for "Damaged Clothes" complaints.', 'danger');
    return;
  }

  // Build Multipart Form Data
  const formData = new FormData();
  formData.append('issue_type', issueType);
  if (orderId) {
    formData.append('order_id', orderId);
  }
  formData.append('description', description);
  if (file) {
    formData.append('image_proof', file);
  }

  try {
    const response = await fetch('/api/complaints', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      body: formData
    });

    const data = await response.json();
    if (!response.ok) {
      showAlert(supportAlertContainer, data.error || 'Failed to submit complaint.', 'danger');
      return;
    }

    // Success
    showAlert(supportAlertContainer, 'Complaint filed successfully. The CLOTH DELIVERY team is inspecting your request.', 'success');
    complaintSubmissionForm.reset();
    richEditorContent.innerHTML = '';
    
    // Refresh complaints log
    fetchUserComplaints();
  } catch (err) {
    console.error('Complaint submit execution error:', err);
    showAlert(supportAlertContainer, 'Server connection issue. Please retry.', 'danger');
  }
}

/* ==========================================================================
   CUSTOM RICH-TEXT EDITOR TOOLBAR HANDLERS
   ========================================================================== */

function setupRichTextToolbar() {
  editorBold.addEventListener('click', () => {
    document.execCommand('bold', false, null);
    richEditorContent.focus();
  });

  editorItalic.addEventListener('click', () => {
    document.execCommand('italic', false, null);
    richEditorContent.focus();
  });

  editorUnderline.addEventListener('click', () => {
    document.execCommand('underline', false, null);
    richEditorContent.focus();
  });

  // Placeholder trigger for empty contenteditable
  richEditorContent.addEventListener('focus', () => {
    if (richEditorContent.innerHTML === '<br>') {
      richEditorContent.innerHTML = '';
    }
  });
}

/* ==========================================================================
   AUTH HELPERS (MODALS & SYNC)
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
    
    // Refresh support page to show form & tickets
    initializeSupportPortal();
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
