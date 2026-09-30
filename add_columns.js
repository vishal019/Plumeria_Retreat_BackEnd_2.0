const pool = require('./dbcon');

async function run() {
  try {
    await pool.query('ALTER TABLE bookings ADD COLUMN notes TEXT;');
    console.log('Added notes column');
  } catch(e) { console.log(e.message); }

  try {
    await pool.query('ALTER TABLE bookings ADD COLUMN activities_total DECIMAL(10,2) DEFAULT 0;');
    console.log('Added activities_total column');
  } catch(e) { console.log(e.message); }

  try {
    await pool.query('ALTER TABLE bookings ADD COLUMN activities TEXT;');
    console.log('Added activities column');
  } catch(e) { console.log(e.message); }
  
  process.exit(0);
}
run();
