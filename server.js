const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'CLOTH_DELIVERY_SECRET_2026';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for local file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'public', 'uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Helper functions wrapping sqlite3 queries in Promises for async/await usage
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

// Middleware to verify JWT Token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Middleware to verify Admin Role
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

/* ==========================================================================
   AUTHENTICATION API
   ========================================================================== */

// Sign Up
app.post('/api/auth/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const existingUser = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = await dbRun(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, 'customer']
    );

    res.status(201).json({ message: 'User registered successfully', userId: result.lastID });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Database error during registration' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({
      message: 'Login successful',
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Database error during login' });
  }
});

// Get Current User
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.status(200).json({ user: req.user });
});

/* ==========================================================================
   PRODUCT CATALOG API
   ========================================================================== */

// Get All Products (with their Variants & Stock)
app.get('/api/products', async (req, res) => {
  const { search, category } = req.query;
  try {
    let query = `
      SELECT p.*, pv.id AS variant_id, pv.size, pv.stock_quantity 
      FROM products p
      LEFT JOIN product_variants pv ON p.id = pv.product_id
    `;
    const params = [];
    const conditions = [];

    if (search) {
      conditions.push(`(p.name LIKE ? OR p.description LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    const rows = await dbAll(query, params);

    // Group variants under products
    const productMap = {};
    rows.forEach((row) => {
      if (!productMap[row.id]) {
        productMap[row.id] = {
          id: row.id,
          name: row.name,
          description: row.description,
          base_price: row.base_price,
          image_url: row.image_url,
          variants: []
        };
      }
      if (row.size) {
        productMap[row.id].variants.push({
          id: row.variant_id,
          size: row.size,
          stock_quantity: row.stock_quantity
        });
      }
    });

    res.status(200).json(Object.values(productMap));
  } catch (err) {
    console.error('Fetch products error:', err);
    res.status(500).json({ error: 'Database error fetching products' });
  }
});

// Get Single Product Details
app.get('/api/products/:id', async (req, res) => {
  const productId = req.params.id;
  try {
    const product = await dbGet('SELECT * FROM products WHERE id = ?', [productId]);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const variants = await dbAll(
      'SELECT id, size, stock_quantity FROM product_variants WHERE product_id = ?',
      [productId]
    );

    product.variants = variants;
    res.status(200).json(product);
  } catch (err) {
    console.error('Fetch product error:', err);
    res.status(500).json({ error: 'Database error fetching product details' });
  }
});

// Dynamic variant stock lookup
app.get('/api/products/:id/stock', async (req, res) => {
  const productId = req.params.id;
  const { size } = req.query;

  if (!size) return res.status(400).json({ error: 'Size query parameter is required' });

  try {
    const variant = await dbGet(
      'SELECT stock_quantity FROM product_variants WHERE product_id = ? AND size = ?',
      [productId, size]
    );

    if (!variant) {
      return res.status(404).json({ error: 'Variant size not found for this product' });
    }

    res.status(200).json({ size, stock_quantity: variant.stock_quantity });
  } catch (err) {
    console.error('Fetch stock error:', err);
    res.status(500).json({ error: 'Database error fetching stock' });
  }
});

/* ==========================================================================
   CHECKOUT SYSTEM (WITH DATABASE TRANSACTION)
   ========================================================================== */

app.post('/api/checkout', authenticateToken, async (req, res) => {
  const { items, customer_name, shipping_address, phone_number } = req.body; // Expects [{ product_id, size, quantity }], customer details
  const userId = req.user.id;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Your cart is empty' });
  }

  if (!customer_name || !shipping_address || !phone_number) {
    return res.status(400).json({ error: 'Customer details (Full Name, Shipping Address, Phone Number) are required' });
  }

  try {
    // Begin Database Transaction
    await dbRun('BEGIN TRANSACTION');

    let totalPrice = 0;
    const updates = [];

    // 1. Stock Check & Calculations
    for (const item of items) {
      const product = await dbGet('SELECT name, base_price FROM products WHERE id = ?', [item.product_id]);
      if (!product) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: `Product ID ${item.product_id} does not exist.` });
      }

      const variant = await dbGet(
        'SELECT stock_quantity FROM product_variants WHERE product_id = ? AND size = ?',
        [item.product_id, item.size]
      );

      if (!variant) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: `Size ${item.size} is unavailable for product "${product.name}".` });
      }

      if (variant.stock_quantity < item.quantity) {
        await dbRun('ROLLBACK');
        return res.status(400).json({
          error: `Insufficient stock for product "${product.name}" in size ${item.size}. Available: ${variant.stock_quantity}, requested: ${item.quantity}`
        });
      }

      totalPrice += product.base_price * item.quantity;
      updates.push({
        product_id: item.product_id,
        size: item.size,
        quantity: item.quantity,
        price: product.base_price,
        new_stock: variant.stock_quantity - item.quantity
      });
    }

    // 2. Insert Order (including Name, Address, and Phone Number)
    const orderResult = await dbRun(
      'INSERT INTO orders (user_id, total_price, customer_name, shipping_address, phone_number, status) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, totalPrice, customer_name, shipping_address, phone_number, 'Completed']
    );
    const orderId = orderResult.lastID;

    // 3. Deduct Stock & Write Order Items
    for (const update of updates) {
      // Deduct stock
      await dbRun(
        'UPDATE product_variants SET stock_quantity = ? WHERE product_id = ? AND size = ?',
        [update.new_stock, update.product_id, update.size]
      );

      // Insert item
      await dbRun(
        'INSERT INTO order_items (order_id, product_id, size, quantity, price) VALUES (?, ?, ?, ?, ?)',
        [orderId, update.product_id, update.size, update.quantity, update.price]
      );
    }

    // Commit Transaction
    await dbRun('COMMIT');
    res.status(200).json({ message: 'Order placed successfully', orderId, total_price: totalPrice });
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Database transaction rollback failure:', rollbackErr);
    }
    console.error('Checkout failure:', err);
    res.status(500).json({ error: 'Server error during checkout process' });
  }
});

// Fetch Current Customer Orders
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const orders = await dbAll(
      'SELECT id, total_price, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.status(200).json(orders);
  } catch (err) {
    console.error('Fetch orders error:', err);
    res.status(500).json({ error: 'Database error fetching order history' });
  }
});

/* ==========================================================================
   CUSTOMER COMPLAINT PORTAL API
   ========================================================================== */

// File a support ticket (Accepts image proof file via multer)
app.post('/api/complaints', authenticateToken, upload.single('image_proof'), async (req, res) => {
  const { issue_type, description, order_id } = req.body;
  const userId = req.user.id;

  if (!issue_type || !description) {
    return res.status(400).json({ error: 'Issue type and description are required' });
  }

  const allowedIssues = ['Wrong Delivery', 'Damaged Clothes', 'Other'];
  if (!allowedIssues.includes(issue_type)) {
    return res.status(400).json({ error: 'Invalid issue type selected' });
  }

  // Handle uploaded proof image path
  const imageProofUrl = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const parsedOrderId = order_id ? parseInt(order_id) : null;
    const result = await dbRun(
      'INSERT INTO complaints (user_id, order_id, issue_type, description, image_proof_url, status) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, parsedOrderId, issue_type, description, imageProofUrl, 'Pending']
    );

    res.status(201).json({ message: 'Support ticket submitted successfully', complaintId: result.lastID });
  } catch (err) {
    console.error('Complaint submission error:', err);
    res.status(500).json({ error: 'Database error saving support complaint' });
  }
});

// Fetch complaints for the active customer
app.get('/api/complaints', authenticateToken, async (req, res) => {
  try {
    const complaints = await dbAll(
      'SELECT id, order_id, issue_type, description, image_proof_url, status, created_at FROM complaints WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.status(200).json(complaints);
  } catch (err) {
    console.error('Fetch customer complaints error:', err);
    res.status(500).json({ error: 'Database error fetching complaints' });
  }
});

// Delete a customer's own complaint ticket
app.delete('/api/complaints/:id', authenticateToken, async (req, res) => {
  const complaintId = req.params.id;
  const userId = req.user.id;
  try {
    const complaint = await dbGet('SELECT * FROM complaints WHERE id = ?', [complaintId]);
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    if (complaint.user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized: You can only remove your own complaints' });
    }
    await dbRun('DELETE FROM complaints WHERE id = ?', [complaintId]);
    res.status(200).json({ message: 'Complaint removed successfully', complaintId });
  } catch (err) {
    console.error('Delete customer complaint error:', err);
    res.status(500).json({ error: 'Database error deleting complaint' });
  }
});


/* ==========================================================================
   PROTECTED OWNER (ADMIN) DASHBOARD API
   ========================================================================== */

// 1. Product Ingestion Form (Admin Only, supports photo upload)
app.post('/api/admin/products', authenticateToken, requireAdmin, upload.single('product_image'), async (req, res) => {
  const { name, description, base_price, stock_S, stock_M, stock_L, stock_XL } = req.body;

  if (!name || !base_price) {
    return res.status(400).json({ error: 'Product name and base price are required' });
  }

  const image_url = req.file ? `/uploads/${req.file.filename}` : '/uploads/placeholder.png';

  try {
    await dbRun('BEGIN TRANSACTION');

    const result = await dbRun(
      'INSERT INTO products (name, description, base_price, image_url) VALUES (?, ?, ?, ?)',
      [name, description, parseFloat(base_price), image_url]
    );
    const productId = result.lastID;

    // Default variants stocks to 0 if not provided
    const stocks = {
      S: parseInt(stock_S) || 0,
      M: parseInt(stock_M) || 0,
      L: parseInt(stock_L) || 0,
      XL: parseInt(stock_XL) || 0
    };

    for (const [size, quantity] of Object.entries(stocks)) {
      await dbRun(
        'INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)',
        [productId, size, quantity]
      );
    }

    await dbRun('COMMIT');
    res.status(201).json({ message: 'Product and variants created successfully', productId });
  } catch (err) {
    try {
      await dbRun('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed during product insertion:', rollbackErr);
    }
    console.error('Admin create product error:', err);
    res.status(500).json({ error: 'Server error creating product' });
  }
});

// 2. Live Inventory Modifier (Admin Only, updates all variant stocks for a product)
app.put('/api/admin/products/:id/variants', authenticateToken, requireAdmin, async (req, res) => {
  const productId = req.params.id;
  const { size, stock_quantity } = req.body; // Can accept single variant update

  if (!size || stock_quantity === undefined) {
    return res.status(400).json({ error: 'Size and stock quantity are required' });
  }

  const validSizes = ['S', 'M', 'L', 'XL'];
  if (!validSizes.includes(size)) {
    return res.status(400).json({ error: 'Invalid size specified' });
  }

  const stockVal = parseInt(stock_quantity);
  if (isNaN(stockVal) || stockVal < 0) {
    return res.status(400).json({ error: 'Stock quantity must be a non-negative integer' });
  }

  try {
    const result = await dbRun(
      'UPDATE product_variants SET stock_quantity = ? WHERE product_id = ? AND size = ?',
      [stockVal, productId, size]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    res.status(200).json({ message: 'Inventory updated successfully', productId, size, stock_quantity: stockVal });
  } catch (err) {
    console.error('Admin update variant error:', err);
    res.status(500).json({ error: 'Server error updating stock variants' });
  }
});

// 3. Product Removal (Admin Only, deletes from database)
app.delete('/api/admin/products/:id', authenticateToken, requireAdmin, async (req, res) => {
  const productId = req.params.id;
  try {
    const result = await dbRun('DELETE FROM products WHERE id = ?', [productId]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json({ message: 'Product and variants deleted successfully', productId });
  } catch (err) {
    console.error('Admin delete product error:', err);
    res.status(500).json({ error: 'Server error deleting product' });
  }
});

// 4. Complaint Management Queue (Admin Only, sorted by severity and date)
// Severity Rank: Damaged Clothes (High = 1) > Wrong Delivery (Medium = 2) > Other (Low = 3)
app.get('/api/admin/complaints', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const complaints = await dbAll(`
      SELECT c.*, u.username 
      FROM complaints c
      JOIN users u ON c.user_id = u.id
      ORDER BY 
        CASE c.status
          WHEN 'Pending' THEN 1
          ELSE 2
        END ASC,
        CASE c.issue_type
          WHEN 'Damaged Clothes' THEN 1
          WHEN 'Wrong Delivery' THEN 2
          ELSE 3
        END ASC,
        c.created_at DESC
    `);
    res.status(200).json(complaints);
  } catch (err) {
    console.error('Admin fetch complaints error:', err);
    res.status(500).json({ error: 'Server error fetching complaint list' });
  }
});

// Resolve a ticket
app.put('/api/admin/complaints/:id/resolve', authenticateToken, requireAdmin, async (req, res) => {
  const complaintId = req.params.id;
  try {
    const result = await dbRun(
      "UPDATE complaints SET status = 'Resolved' WHERE id = ?",
      [complaintId]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.status(200).json({ message: 'Ticket marked as resolved', complaintId });
  } catch (err) {
    console.error('Admin resolve complaint error:', err);
    res.status(500).json({ error: 'Server error updating ticket status' });
  }
});

// Delete a complaint ticket (Admin only)
app.delete('/api/admin/complaints/:id', authenticateToken, requireAdmin, async (req, res) => {
  const complaintId = req.params.id;
  try {
    const result = await dbRun('DELETE FROM complaints WHERE id = ?', [complaintId]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.status(200).json({ message: 'Ticket deleted successfully by admin', complaintId });
  } catch (err) {
    console.error('Admin delete complaint error:', err);
    res.status(500).json({ error: 'Server error deleting ticket' });
  }
});


// GET all orders for the store owner (Admin only)
app.get('/api/admin/orders', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orders = await dbAll(`
      SELECT o.*, u.username 
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `);

    for (const order of orders) {
      const items = await dbAll(`
        SELECT oi.*, p.name AS product_name 
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [order.id]);
      order.items = items;
    }

    res.status(200).json(orders);
  } catch (err) {
    console.error('Admin fetch orders error:', err);
    res.status(500).json({ error: 'Server error fetching orders list' });
  }
});

// Express static middleware handles serving page files like index.html, admin.html, and support.html automatically.

app.get('/api/db-debug', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  let urlDetails = {};
  try {
    if (process.env.DATABASE_URL) {
      const rawUrl = process.env.DATABASE_URL;
      const maskedUrl = rawUrl.replace(/./g, (char) => {
        if ([':', '/', '@', '?', '=', '&', '.', '-'].includes(char)) {
          return char;
        }
        return '*';
      });

      let parsed = {};
      try {
        const dbUrl = new URL(rawUrl);
        parsed = {
          protocol: dbUrl.protocol,
          host: dbUrl.hostname,
          port: dbUrl.port,
          database: dbUrl.pathname
        };
      } catch (e) {
        parsed = { error: e.message };
      }

      urlDetails = {
        maskedUrl,
        parsed
      };
    } else {
      urlDetails = { error: 'DATABASE_URL env var is empty/missing' };
    }
  } catch (e) {
    urlDetails = { error: 'Failed in debug code: ' + e.message };
  }

  try {
    const result = await dbGet('SELECT NOW() AS now');
    res.json({ success: true, message: 'Database connection successful', urlDetails, serverTime: new Date().toISOString(), dbUrlLength: process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database query failed', urlDetails, serverTime: new Date().toISOString(), dbUrlLength: process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0, error: err.message, stack: err.stack });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
