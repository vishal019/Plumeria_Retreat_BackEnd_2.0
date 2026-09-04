const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const cols = [
    ['meta_title', 'VARCHAR(255) NULL'],
    ['meta_description', 'TEXT NULL'],
    ['page_heading', 'VARCHAR(255) NULL'],
    ['image_details', 'LONGTEXT NULL'],
    ['room_numbers', 'LONGTEXT NULL'],
    ['activities', 'LONGTEXT NULL'],
    ['meal_details', 'LONGTEXT NULL'],
    ['how_to_reach', 'LONGTEXT NULL'],
    ['nearby_places', 'LONGTEXT NULL'],
    ['rules_and_policies', 'LONGTEXT NULL'],
    ['faqs', 'LONGTEXT NULL'],
    ['guest_stories', 'LONGTEXT NULL'],
    ['max_adults', 'INT NULL DEFAULT 2'],
    ['max_children', 'INT NULL DEFAULT 0'],
  ];

  const [existing] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accommodations'`
  );
  const names = new Set(existing.map((r) => r.COLUMN_NAME));

  for (const [name, def] of cols) {
    if (!names.has(name)) {
      await conn.query(`ALTER TABLE accommodations ADD COLUMN ${name} ${def}`);
      console.log('added', name);
    } else {
      console.log('exists', name);
    }
  }

  await conn.end();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
