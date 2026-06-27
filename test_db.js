require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function test() {
  try {
    const users = await pool.query('SELECT * FROM users');
    console.log('Users in DB:', users.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

test();
