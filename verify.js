const http = require('http');
const { spawn } = require('child_process');
const db = require('./db');

const TEST_PORT = 3001;
process.env.PORT = TEST_PORT; // Force server to run on 3001

let serverProcess;

// Helper to make HTTP requests using native Node http module
function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, rawBody: data });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Start API server as a background subprocess
function startServer() {
  return new Promise((resolve, reject) => {
    console.log(`Starting test server on port ${TEST_PORT}...`);
    serverProcess = spawn('node', ['server.js'], {
      env: { ...process.env, PORT: TEST_PORT },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes(`Server is running`)) {
        console.log('Test server is ready!');
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('Server stderr:', data.toString());
    });

    serverProcess.on('error', (err) => {
      reject(err);
    });
  });
}

// Run test suites
async function runTests() {
  console.log('\n--- Cleaning Database and Running Integration Tests ---\n');
  
  // Wipe test database to avoid pollution from previous runs
  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('PRAGMA foreign_keys = OFF');
      db.run('DELETE FROM complaints');
      db.run('DELETE FROM order_items');
      db.run('DELETE FROM orders');
      db.run('DELETE FROM product_variants');
      db.run('DELETE FROM products');
      db.run('DELETE FROM users');
      db.run('PRAGMA foreign_keys = ON', (err) => {
        if (err) reject(err);
        else {
          console.log('Database tables cleared.');
          resolve();
        }
      });
    });
  });

  // Re-seed tables
  const { execSync } = require('child_process');
  const seedOutput = execSync('node seed.js').toString();
  console.log('Seed output:\n', seedOutput);
  console.log('Seeded database with clean test dataset.');

  let tokenCustomer, tokenAdmin;

  try {
    // 1. Test Login Admin
    console.log('Testing Admin Login...');
    const loginAdminRes = await request('POST', '/api/auth/login', {
      username: 'admin',
      password: 'adminpassword'
    });
    if (loginAdminRes.status === 200 && loginAdminRes.body.token) {
      console.log('✔ Admin logged in successfully.');
      tokenAdmin = loginAdminRes.body.token;
    } else {
      throw new Error(`Failed Admin Login: Status ${loginAdminRes.status}`);
    }

    // 2. Test Login Customer
    console.log('Testing Customer Login...');
    const loginCustRes = await request('POST', '/api/auth/login', {
      username: 'customer',
      password: 'customerpassword'
    });
    if (loginCustRes.status === 200 && loginCustRes.body.token) {
      console.log('✔ Customer logged in successfully.');
      tokenCustomer = loginCustRes.body.token;
    } else {
      throw new Error(`Failed Customer Login: Status ${loginCustRes.status}`);
    }

    // 3. Setup product variant stock level for validation
    console.log('Inspecting initial variant stock for first product...');
    const productsRes = await request('GET', '/api/products');
    if (productsRes.status !== 200 || !Array.isArray(productsRes.body) || productsRes.body.length === 0) {
      throw new Error('Could not fetch products list');
    }
    
    const targetProduct = productsRes.body[0];
    const targetProductId = targetProduct.id;
    console.log(`Target product selected: "${targetProduct.name}" (ID: ${targetProductId})`);
    
    // We will update variant S of this product to exactly 2 items for testing
    console.log(`Resetting size S stock of Product ${targetProductId} to 2 items...`);
    const updateStockRes = await request('PUT', `/api/admin/products/${targetProductId}/variants`, {
      size: 'S',
      stock_quantity: 2
    }, tokenAdmin);
    
    if (updateStockRes.status === 200) {
      console.log('✔ Set variant S stock successfully.');
    } else {
      throw new Error(`Failed updating variant stock: ${JSON.stringify(updateStockRes.body)}`);
    }

    // 4. Test "No Stock" Safeguard (Insufficent stock checkout block)
    console.log('Testing safeguard: Purchase 3 items when stock is 2 (Should Fail)...');
    const badCheckoutRes = await request('POST', '/api/checkout', {
      items: [{ product_id: targetProductId, size: 'S', quantity: 3 }],
      customer_name: 'Test Cust',
      shipping_address: '123 sand lane',
      phone_number: '9999999999'
    }, tokenCustomer);

    if (badCheckoutRes.status === 400 && badCheckoutRes.body.error.includes('Insufficient stock')) {
      console.log('✔ Safeguard triggered: Checkout failed with: ' + badCheckoutRes.body.error);
    } else {
      throw new Error(`Fail: Expected status 400 and Insufficient stock error, got ${badCheckoutRes.status}: ${JSON.stringify(badCheckoutRes.body)}`);
    }

    // 5. Test Successful Checkout (Purchase 2 items, stock should go to 0)
    console.log('Testing checkout: Purchase 2 items when stock is 2 (Should Succeed)...');
    const goodCheckoutRes = await request('POST', '/api/checkout', {
      items: [{ product_id: targetProductId, size: 'S', quantity: 2 }],
      customer_name: 'Sathish Kumar',
      shipping_address: '456 Linen Blvd, India',
      phone_number: '9876543210'
    }, tokenCustomer);

    if (goodCheckoutRes.status === 200) {
      console.log('✔ Checkout transaction succeeded. Order ID: ' + goodCheckoutRes.body.orderId);
    } else {
      throw new Error(`Fail: Expected status 200, got ${goodCheckoutRes.status}: ${JSON.stringify(goodCheckoutRes.body)}`);
    }

    // 6. Verify Stock is now 0 (Check dynamic lookup)
    console.log('Verifying stock count is now 0...');
    const stockCheckRes = await request('GET', `/api/products/${targetProductId}/stock?size=S`);
    if (stockCheckRes.status === 200 && stockCheckRes.body.stock_quantity === 0) {
      console.log('✔ Dynamic stock lookup confirms 0 items remaining.');
    } else {
      throw new Error(`Fail: Expected stock quantity 0, got ${JSON.stringify(stockCheckRes.body)}`);
    }

    // 7. Test Safeguard: Purchase 1 item now that stock is 0 (Should Fail)
    console.log('Testing safeguard: Purchase 1 item when stock is 0 (Should Fail)...');
    const emptyCheckoutRes = await request('POST', '/api/checkout', {
      items: [{ product_id: targetProductId, size: 'S', quantity: 1 }],
      customer_name: 'Test Cust',
      shipping_address: '123 sand lane',
      phone_number: '9999999999'
    }, tokenCustomer);

    if (emptyCheckoutRes.status === 400 && emptyCheckoutRes.body.error.includes('Insufficient stock')) {
      console.log('✔ Safeguard triggered: Checkout blocked on 0 stock. Error: ' + emptyCheckoutRes.body.error);
    } else {
      throw new Error(`Fail: Expected checkout block on 0 stock, got ${emptyCheckoutRes.status}`);
    }

    // 8. Test Support Complaints Submission
    console.log('Filing customer complaint for Wrong Delivery...');
    const complaint1Res = await request('POST', '/api/complaints', {
      issue_type: 'Wrong Delivery',
      description: 'The package delivered was size M instead of S.',
      order_id: goodCheckoutRes.body.orderId
    }, tokenCustomer);

    if (complaint1Res.status === 201) {
      console.log('✔ Filed "Wrong Delivery" complaint.');
    } else {
      throw new Error('Failed filing complaint 1');
    }

    console.log('Filing customer complaint for Damaged Clothes...');
    const complaint2Res = await request('POST', '/api/complaints', {
      issue_type: 'Damaged Clothes',
      description: 'The wool trousers have a rip along the back seam.',
      order_id: goodCheckoutRes.body.orderId
    }, tokenCustomer);

    if (complaint2Res.status === 201) {
      console.log('✔ Filed "Damaged Clothes" complaint.');
    } else {
      throw new Error('Failed filing complaint 2');
    }

    // 9. Verify Admin Complaint Management Queue Severity Sorting
    // Damaged Clothes (High) should be sorted before Wrong Delivery (Medium)
    console.log('Verifying Admin Complaint Queue sorting by severity...');
    const adminComplaintsRes = await request('GET', '/api/admin/complaints', null, tokenAdmin);
    if (adminComplaintsRes.status === 200) {
      const tickets = adminComplaintsRes.body;
      console.log(`Retrieved ${tickets.length} tickets from queue.`);
      
      const firstTicket = tickets[0];
      const secondTicket = tickets[1];
      
      console.log(`First Ticket (Expected Damaged Clothes): ${firstTicket.issue_type}`);
      console.log(`Second Ticket (Expected Wrong Delivery): ${secondTicket.issue_type}`);
      
      if (firstTicket.issue_type === 'Damaged Clothes' && secondTicket.issue_type === 'Wrong Delivery') {
        console.log('✔ Severity sorting confirmed (Damaged Clothes [High] > Wrong Delivery [Medium]).');
      } else {
        throw new Error('Fail: Severity sorting failed in complaint list');
      }
    } else {
      throw new Error('Failed to retrieve admin complaints queue');
    }

    // 10. Verify Admin Orders Queue
    console.log('Verifying Admin Orders placed details retrieval...');
    const adminOrdersRes = await request('GET', '/api/admin/orders', null, tokenAdmin);
    if (adminOrdersRes.status === 200) {
      const orders = adminOrdersRes.body;
      if (orders.length > 0) {
        const order = orders[0];
        console.log(`✔ Admin Orders log matches order ID #${order.id}. Customer Name: ${order.customer_name}, Phone: ${order.phone_number}`);
        if (order.customer_name === 'Sathish Kumar' && order.phone_number === '9876543210' && order.items.length > 0) {
          console.log('✔ Order details and items verified successfully.');
        } else {
          throw new Error('Order details content does not match good checkout parameters');
        }
      } else {
        throw new Error('Fail: Admin orders queue returned empty');
      }
    } else {
      throw new Error('Failed to query admin orders endpoint');
    }

    // 11. Test Customer Deleting Own Complaint
    console.log('Testing customer deleting own support ticket...');
    const complaint1Id = complaint1Res.body.complaintId;
    const deleteOwnComplaintRes = await request('DELETE', `/api/complaints/${complaint1Id}`, null, tokenCustomer);
    if (deleteOwnComplaintRes.status === 200) {
      console.log('✔ Customer deleted their own complaint ticket successfully.');
    } else {
      throw new Error(`Fail: Expected customer deletion status 200, got ${deleteOwnComplaintRes.status}`);
    }

    // 12. Test Customer Trying to Delete Someone Else's Complaint
    console.log('Testing customer deleting unauthorized support ticket...');
    const complaint2Id = complaint2Res.body.complaintId;
    const deleteOtherComplaintRes = await request('DELETE', `/api/complaints/${complaint2Id}`, null, tokenAdmin); // tokenAdmin user_id !== tokenCustomer user_id (complaint owner)
    if (deleteOtherComplaintRes.status === 403) {
      console.log('✔ Safeguard triggered: Unauthorized deletion blocked with status 403.');
    } else {
      throw new Error(`Fail: Expected status 403 for unauthorized deletion, got ${deleteOtherComplaintRes.status}`);
    }

    // 13. Test Admin Deleting Any Complaint
    console.log('Testing admin deleting any support ticket...');
    const deleteAdminComplaintRes = await request('DELETE', `/api/admin/complaints/${complaint2Id}`, null, tokenAdmin);
    if (deleteAdminComplaintRes.status === 200) {
      console.log('✔ Admin deleted support ticket successfully.');
    } else {
      throw new Error(`Fail: Expected admin deletion status 200, got ${deleteAdminComplaintRes.status}`);
    }

    console.log('\n✔✔✔ ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY! ✔✔✔\n');

  } catch (err) {
    console.error('\n✖✖✖ TEST FAILURE ERROR: ✖✖✖\n', err);
  } finally {
    // Shutdown server
    if (serverProcess) {
      console.log('Shutting down test server...');
      serverProcess.kill();
    }
    console.log('Closing database connection...');
    db.close();
  }
}

// Execute tests
startServer()
  .then(runTests)
  .catch((err) => {
    console.error('Failed to start test server:', err);
  });
