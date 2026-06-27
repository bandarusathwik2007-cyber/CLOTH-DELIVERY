const db = require('./db');
const bcrypt = require('bcryptjs');

db.serialize(() => {
  console.log('Seeding database...');

  // 1. Seed Users
  const users = [
    { username: 'admin', password: 'adminpassword', role: 'admin' },
    { username: 'customer', password: 'customerpassword', role: 'customer' }
  ];

  let usersProcessed = 0;
  users.forEach((u) => {
    const hashedPassword = bcrypt.hashSync(u.password, 10);
    db.run(
      `INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`,
      [u.username, hashedPassword, u.role],
      function (err) {
        if (err) {
          console.error(`Error seeding user ${u.username}:`, err);
        } else if (this.changes > 0) {
          console.log(`Seeded user: ${u.username} (Role: ${u.role})`);
        }
        usersProcessed++;
        if (usersProcessed === users.length) {
          seedProducts();
        }
      }
    );
  });

  // 2. Seed Products and Variants
  function seedProducts() {
    const products = [
      {
        name: 'Silk Minimalist Shirt',
        description: 'An elegant, lightweight pure silk shirt with a relaxed silhouette and clean lines. Perfect for formal and casual occasions alike.',
        base_price: 1200.00,
        image_url: '/uploads/silk_shirt.png',
        variants: { S: 10, M: 0, L: 5, XL: 8 } // M is out of stock
      },
      {
        name: 'Cashmere Knit Sweater',
        description: 'Ultra-soft premium cashmere wool knitted sweater in sand beige, designed for a cozy luxury aesthetic and superior warmth.',
        base_price: 1800.00,
        image_url: '/uploads/cashmere_sweater.png',
        variants: { S: 5, M: 7, L: 0, XL: 12 } // L is out of stock
      },
      {
        name: 'Tailored Wool Trousers',
        description: 'Classic double-pleated charcoal wool trousers featuring a structured, high-waisted cut and a refined drape.',
        base_price: 1450.00,
        image_url: '/uploads/wool_trousers.png',
        variants: { S: 0, M: 8, L: 15, XL: 0 } // S and XL out of stock
      },
      {
        name: 'Classic Trench Coat',
        description: 'Double-breasted trench coat crafted from water-resistant gabardine cotton, featuring a classic storm flap and custom belt.',
        base_price: 2600.00,
        image_url: '/uploads/trench_coat.png',
        variants: { S: 8, M: 12, L: 10, XL: 5 }
      }
    ];

    let productsProcessed = 0;

    function checkDone() {
      productsProcessed++;
      if (productsProcessed === products.length) {
        // Allow a small timeout to let operations complete fully before closing
        setTimeout(() => {
          console.log('Seeding complete. Closing database connection.');
          db.close();
        }, 500);
      }
    }

    products.forEach((p) => {
      db.get(`SELECT id FROM products WHERE name = ?`, [p.name], (err, row) => {
        if (err) {
          console.error('Error checking product existence:', err);
          checkDone();
          return;
        }

        if (!row) {
          // Product doesn't exist, insert it
          db.run(
            `INSERT INTO products (name, description, base_price, image_url) VALUES (?, ?, ?, ?)`,
            [p.name, p.description, p.base_price, p.image_url],
            function (err2) {
              if (err2) {
                console.error(`Error inserting product ${p.name}:`, err2);
                checkDone();
                return;
              }
              const productId = this.lastID;
              console.log(`Seeded product: ${p.name} (ID: ${productId})`);

              // Insert variants
              const stmt = db.prepare(
                `INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)`
              );
              const variantKeys = Object.keys(p.variants);
              let variantsFinished = 0;

              for (const [size, stock] of Object.entries(p.variants)) {
                stmt.run(productId, size, stock, (err3) => {
                  if (err3) {
                    console.error(`Error inserting variant ${size} for product ${p.name}:`, err3);
                  } else {
                    console.log(`  Size ${size}: ${stock} items`);
                  }
                  variantsFinished++;
                  if (variantsFinished === variantKeys.length) {
                    checkDone();
                  }
                });
              }
              stmt.finalize();
            }
          );
        } else {
          console.log(`Product "${p.name}" already exists, skipping.`);
          checkDone();
        }
      });
    });
  }
});
