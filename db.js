require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL environment variable is missing in .env file!");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL pool client:', err);
});

let initPromise = null;
let queryQueue = Promise.resolve();
let activeTxnClient = null;

// Enqueue operation to run sequentially, mimicking SQLite's single-thread model
function enqueue(op) {
  return new Promise((resolve, reject) => {
    queryQueue = queryQueue.then(async () => {
      try {
        const res = await op();
        resolve(res);
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Helper to translate SQLite '?' placeholders to PostgreSQL '$1, $2, ...'
function translateSql(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

// Initialize connection and schemas on Neon PostgreSQL
function ensureInitialized() {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'customer' CHECK(role IN ('customer', 'admin'))
          )
        `);

        await pool.query(`
          CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            base_price REAL NOT NULL,
            image_url TEXT
          )
        `);

        await pool.query(`
          CREATE TABLE IF NOT EXISTS product_variants (
            id SERIAL PRIMARY KEY,
            product_id INTEGER NOT NULL,
            size TEXT NOT NULL CHECK(size IN ('S', 'M', 'L', 'XL')),
            stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
            FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
            UNIQUE(product_id, size)
          )
        `);

        await pool.query(`
          CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            total_price REAL NOT NULL,
            customer_name TEXT NOT NULL,
            shipping_address TEXT NOT NULL,
            phone_number TEXT NOT NULL,
            status TEXT DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await pool.query(`
          CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id),
            size TEXT NOT NULL,
            quantity INTEGER NOT NULL CHECK(quantity > 0),
            price REAL NOT NULL
          )
        `);

        await pool.query(`
          CREATE TABLE IF NOT EXISTS complaints (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
            issue_type TEXT NOT NULL CHECK(issue_type IN ('Wrong Delivery', 'Damaged Clothes', 'Other')),
            description TEXT NOT NULL,
            image_proof_url TEXT,
            status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Resolved')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('Neon PostgreSQL tables initialized/verified successfully.');
      } catch (err) {
        console.error('PostgreSQL table initialization error:', err);
        throw err;
      }
    })();
  }
  return initPromise;
}

// Emulate sqlite3 connection object methods for drop-in usage
const db = {
  get: (sql, params = [], callback) => {
    let actualParams = params;
    let actualCallback = callback;
    if (typeof params === 'function') {
      actualCallback = params;
      actualParams = [];
    }

    enqueue(async () => {
      try {
        await ensureInitialized();
        const finalSql = translateSql(sql);
        const dbClient = activeTxnClient || pool;
        const res = await dbClient.query(finalSql, actualParams);
        if (actualCallback) {
          actualCallback(null, res.rows[0]);
        }
      } catch (err) {
        if (actualCallback) {
          actualCallback(err);
        }
      }
    });
  },

  all: (sql, params = [], callback) => {
    let actualParams = params;
    let actualCallback = callback;
    if (typeof params === 'function') {
      actualCallback = params;
      actualParams = [];
    }

    enqueue(async () => {
      try {
        await ensureInitialized();
        const finalSql = translateSql(sql);
        const dbClient = activeTxnClient || pool;
        const res = await dbClient.query(finalSql, actualParams);
        if (actualCallback) {
          actualCallback(null, res.rows);
        }
      } catch (err) {
        if (actualCallback) {
          actualCallback(err);
        }
      }
    });
  },

  run: function (sql, params = [], callback) {
    let actualParams = params;
    let actualCallback = callback;
    if (typeof params === 'function') {
      actualCallback = params;
      actualParams = [];
    }

    enqueue(async () => {
      try {
        await ensureInitialized();

        let finalSql = sql;

        // Handle SQLite-specific PRAGMA queries as no-ops
        if (/pragma/i.test(finalSql)) {
          if (actualCallback) {
            actualCallback.call({ lastID: null, changes: 0 }, null);
          }
          return;
        }

        // Handle transaction boundaries
        if (/begin\s+transaction|begin/i.test(finalSql)) {
          activeTxnClient = await pool.connect();
          await activeTxnClient.query('BEGIN');
          if (actualCallback) {
            actualCallback.call({ lastID: null, changes: 0 }, null);
          }
          return;
        }

        const isCommitOrRollback = /commit/i.test(finalSql) || /rollback/i.test(finalSql);
        const dbClient = activeTxnClient || pool;

        // SQLite-to-PostgreSQL syntax translation
        if (/insert\s+or\s+ignore\s+into\s+users/i.test(finalSql)) {
          finalSql = finalSql.replace(/insert\s+or\s+ignore\s+into\s+users/i, 'INSERT INTO users') + ' ON CONFLICT (username) DO NOTHING';
        } else if (/insert\s+or\s+ignore\s+into\s+product_variants/i.test(finalSql)) {
          finalSql = finalSql.replace(/insert\s+or\s+ignore\s+into\s+product_variants/i, 'INSERT INTO product_variants') + ' ON CONFLICT (product_id, size) DO NOTHING';
        }

        finalSql = translateSql(finalSql);

        // Append RETURNING id to INSERT statements to fetch the auto-increment ID
        const isInsert = /^\s*insert\s+/i.test(finalSql);
        if (isInsert && !/returning\s+/i.test(finalSql)) {
          finalSql += ' RETURNING id';
        }

        const res = await dbClient.query(finalSql, actualParams);

        const context = {
          lastID: (res.rows && res.rows[0] && res.rows[0].id) || null,
          changes: res.rowCount
        };

        if (isCommitOrRollback && activeTxnClient) {
          activeTxnClient.release();
          activeTxnClient = null;
        }

        if (actualCallback) {
          actualCallback.call(context, null);
        }
      } catch (err) {
        const isCommitOrRollback = /commit/i.test(sql) || /rollback/i.test(sql);
        if (isCommitOrRollback && activeTxnClient) {
          activeTxnClient.release();
          activeTxnClient = null;
        }
        if (actualCallback) {
          actualCallback(err);
        }
      }
    });
  },

  // SQLite serialize mock
  serialize: (fn) => {
    fn();
  },

  // SQLite prepare mock
  prepare: (sql) => {
    return {
      run: function (...args) {
        const callback = args[args.length - 1];
        const params = args.slice(0, -1);
        db.run(sql, params, callback);
      },
      finalize: () => {}
    };
  },

  close: (callback) => {
    enqueue(async () => {
      if (activeTxnClient) {
        activeTxnClient.release();
        activeTxnClient = null;
      }
      await pool.end();
      if (callback) {
        callback(null);
      }
    });
  }
};

module.exports = db;
