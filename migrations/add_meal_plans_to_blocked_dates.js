/**
 * Migration: Add meal_plans column to blocked_dates table
 * Run once: node migrations/add_meal_plans_to_blocked_dates.js
 */

const pool = require('../dbcon');

async function migrate() {
  try {
    // Check if column already exists
    const [cols] = await pool.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'blocked_dates' 
        AND COLUMN_NAME = 'meal_plans'
    `);

    if (cols.length > 0) {
      console.log('[Migration] meal_plans column already exists in blocked_dates. Skipping.');
      process.exit(0);
    }

    // Add the column
    await pool.execute(`
      ALTER TABLE blocked_dates 
      ADD COLUMN meal_plans LONGTEXT NULL DEFAULT NULL 
      COMMENT 'JSON-serialized EP/CP/MAP meal plan overrides for this specific date'
    `);

    console.log('[Migration] ✅ Successfully added meal_plans column to blocked_dates table.');
    process.exit(0);
  } catch (err) {
    console.error('[Migration] ❌ Failed:', err.message);
    process.exit(1);
  }
}

migrate();
