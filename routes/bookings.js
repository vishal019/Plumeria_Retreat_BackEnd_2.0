const express = require("express");

const router = express.Router();

const pool = require("../dbcon");

const crypto = require("crypto");

const { razorpayInstance, razorpayKeyId, razorpayKeySecret } = require("./razorpay.config");

const nodemailer = require("nodemailer");

const puppeteer = require("puppeteer");

const { format } = require("date-fns");

const { v4: uuidv4 } = require("uuid");

require("dotenv").config();

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "https://plumeriaretreat.vercel.app";

const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || "https://a.plumeriaretreat.com";

// BOOKING CLEANUP JOB

const bookingCleanup = () => {
  setInterval(async () => {
    try {
      const [result] = await pool.execute(
        `UPDATE bookings 

         SET payment_status = 'expired'

         WHERE payment_status = 'pending'

         AND created_at < NOW() - INTERVAL 1 HOUR`
      );

      console.log(`Marked ${result.affectedRows} bookings as expired`);
    } catch (error) {
      console.error("Booking cleanup error:", error);
    }
  }, 30 * 60 * 1000); // every 30 minutes
};

// Ensure meal_plan and meal_plan_price columns exist in bookings table
const ensureBookingsMealPlanSchema = async () => {
  try {
    const [existing] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings'`
    );
    const names = new Set(existing.map((row) => (row.COLUMN_NAME || '').toLowerCase()));
    if (!names.has('meal_plan')) {
      await pool.query("ALTER TABLE bookings ADD COLUMN meal_plan VARCHAR(50) NULL DEFAULT 'EP'");
      console.log("[bookings] added column meal_plan");
    }
    if (!names.has('meal_plan_price')) {
      await pool.query("ALTER TABLE bookings ADD COLUMN meal_plan_price DECIMAL(10,2) NULL DEFAULT 0.00");
      console.log("[bookings] added column meal_plan_price");
    }
  } catch (err) {
    console.warn("Bookings schema check warning (non-fatal):", err.message);
  }
};
ensureBookingsMealPlanSchema();

// GET /admin/bookings - fetch all bookings
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const offset = (page - 1) * limit;

    const [bookings] = await pool.execute(
      `

      SELECT 

        b.id,

        b.guest_name,

        b.guest_email,

        b.guest_phone,
        b.food_veg,
        b.food_nonveg,
        b.food_jain,

        a.name AS accommodation_name,

        DATE_FORMAT(b.check_in, '%Y-%m-%d') AS check_in,

        DATE_FORMAT(b.check_out, '%Y-%m-%d') AS check_out,






        b.adults,

        b.children,

        b.rooms,

        b.total_amount,

        b.payment_status,
        b.payment_txn_id,
        b.created_at,
        b.meal_plan,
        b.meal_plan_price
      FROM bookings b

      LEFT JOIN accommodations a ON b.accommodation_id = a.id

      ORDER BY b.created_at DESC

      LIMIT ? OFFSET ?

    `,
      [parseInt(limit), parseInt(offset)]
    );

    const [[{ count }]] = await pool.execute(
      "SELECT COUNT(*) as count FROM bookings"
    );

    res.json({
      success: true,

      data: bookings,

      pagination: {
        total: count,

        page: parseInt(page),

        limit: parseInt(limit),

        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching bookings:", error);

    res.status(500).json({
      success: false,

      error: "Failed to fetch bookings",

      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// POST /admin/bookings - create booking

router.post("/", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      guest_name,
      guest_email,
      guest_phone,
      accommodation_id,
      package_id,

      check_in,
      check_out,
      adults = 1,
      children = 0,
      rooms = 1,

      food_veg = 0,
      food_nonveg = 0,
      food_jain = 0,
      total_amount,

      advance_amount = 0,
      coupon_code,
      RatePersonVilla,
      ExtraPersonVilla,
      type,
      payment_method = "razorpay",
      meal_plan = null,
      meal_plan_price = 0,
    } = req.body;

    console.log(req.body);

    const requiredFields = [
      "guest_name",
      "accommodation_id",
      "package_id",
      "check_in",
      "check_out",
      "total_amount",
    ];

    const missingFields = requiredFields.filter(
      (field) => req.body[field] === undefined || req.body[field] === null
    );

    console.log(missingFields);

    if (missingFields.length > 0) {
      return res
        .status(400)
        .json({
          success: false,
          error: `Missing required fields: ${missingFields.join(", ")}`,
        });
    }

    const totalGuests = adults + children;

    const totalFood = food_veg + food_nonveg + food_jain;

    if (totalFood !== totalGuests) {
      return res
        .status(400)
        .json({
          success: false,
          error: "Food preferences must match total guests",
        });
    }

    if (new Date(check_in) >= new Date(check_out)) {
      return res
        .status(400)
        .json({ success: false, error: "Check-out must be after check-in" });
    }

    if (total_amount <= 0 || advance_amount < 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid amount values" });
    }

    if (adults < 1 || rooms < 1) {
      return res
        .status(400)
        .json({
          success: false,
          error: "Must have at least 1 adult and 1 room",
        });
    }

    const payment_status = "pending";

    const payment_txn_id = `BOOK-${uuidv4()}`;

    const [result] = await connection.execute(
  `INSERT INTO bookings (
    guest_name, guest_email, guest_phone, accommodation_id, package_id,
    check_in, check_out, adults, children, rooms, food_veg, food_nonveg, 
    food_jain, total_amount, advance_amount, payment_status, payment_txn_id, 
    coupon_code, discount_amount, full_amount, created_at, meal_plan, meal_plan_price,
    notes, activities, activities_total
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    guest_name,
    guest_email,
    guest_phone || null,
    accommodation_id,
    package_id,
    check_in,
    check_out,
    adults,
    children,
    rooms,
    food_veg,
    food_nonveg,
    food_jain,
    total_amount,
    advance_amount,
    payment_status,
    payment_txn_id,
    // Add the new values here (make sure to extract them from req.body first)
    req.body.coupon || null,        
    req.body.discount || 0,
    req.body.full_amount || null,
    new Date(),
    meal_plan,
    meal_plan_price,
    req.body.notes || null,
    req.body.activities || null,
    req.body.activities_total || 0
  ]
);

    await connection.commit();

    res.json({
      success: true,
      data: { booking_id: result.insertId, payment_txn_id, payment_status },
    });
  } catch (error) {
    await connection.rollback();

    console.error("Error creating booking:", error);

    res.status(500).json({
      success: false,

      error: "Failed to create booking",

      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    connection.release();
  }
});

router.post("/offline", async (req, res) => {
  let connection = null;

  try {
    // Get database connection with error handling
    try {
      connection = await pool.getConnection();
    } catch (connError) {
      console.error("Database connection error:", connError);
      return res.status(503).json({
        success: false,
        error: "Database connection failed",
        code: "CONNECTION_ERROR",
        details: process.env.NODE_ENV === "development" ? connError.message : undefined,
      });
    }

    await connection.beginTransaction();

    const {
      guest_name,
      guest_email,
      guest_phone,
      accommodation_id,

      check_in,
      check_out,
      adults = 1,
      children = 0,
      rooms = 1,

      food_veg = 0,
      food_nonveg = 0,
      food_jain = 0,

      total_amount,
      advance_amount = 0,
      coupon,         
      discount,       
      full_amount,
      extra_adults = 0,
      isvilla,
      meal_plan = null,
      meal_plan_price = 0
    } = req.body;

    
    // Validate required fields
    const requiredFields = [
      "guest_name",
      "guest_email",
      "accommodation_id",
      "check_in",
      "check_out",
      "total_amount",
    ];

    const missingFields = requiredFields.filter(
      (field) => req.body[field] === undefined || req.body[field] === null || req.body[field] === ""
    );

    if (missingFields.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missingFields.join(", ")}`,
        code: "VALIDATION_ERROR"
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(guest_email)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Invalid email format",
        code: "VALIDATION_ERROR"
      });
    }

    // Validate accommodation_id is a valid number
    const accommodationIdNum = parseInt(accommodation_id);
    if (isNaN(accommodationIdNum) || accommodationIdNum <= 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Invalid accommodation ID",
        code: "VALIDATION_ERROR"
      });
    }

    // Validate accommodation exists before proceeding
    try {
      const [accommodations] = await connection.execute(
        "SELECT id, owner_id, type FROM accommodations WHERE id = ?",
        [accommodationIdNum]
      );

      if (accommodations.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          error: "Accommodation not found",
          code: "NOT_FOUND"
        });
      }
    } catch (dbError) {
      await connection.rollback();
      console.error("Error checking accommodation:", dbError);
      return res.status(500).json({
        success: false,
        error: "Failed to validate accommodation",
        code: "DATABASE_ERROR",
        details: process.env.NODE_ENV === "development" ? dbError.message : undefined,
      });
    }

    // Validate numeric values
    const total_adults = (parseInt(adults) || 0) + (parseInt(extra_adults) || 0);
    const childrenNum = parseInt(children) || 0;
    const roomsNum = parseInt(rooms) || 1;
    const foodVegNum = parseInt(food_veg) || 0;
    const foodNonVegNum = parseInt(food_nonveg) || 0;
    const foodJainNum = parseInt(food_jain) || 0;
    const totalAmountNum = parseFloat(total_amount);
    const advanceAmountNum = parseFloat(advance_amount) || 0;

    // Validate numeric conversions
    if (isNaN(totalAmountNum) || isNaN(advanceAmountNum)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Invalid amount values - must be valid numbers",
        code: "VALIDATION_ERROR"
      });
    }

    // Validate positive values
    if (totalAmountNum <= 0 || advanceAmountNum < 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Invalid amount values",
        code: "VALIDATION_ERROR"
      });
    }

    if (total_adults < 1 || roomsNum < 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Must have at least 1 adult and 1 room",
        code: "VALIDATION_ERROR"
      });
    }

    // Validate check-in/out dates
    const checkInDate = new Date(check_in);
    const checkOutDate = new Date(check_out);

    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Invalid date format",
        code: "VALIDATION_ERROR"
      });
    }

    if (checkInDate >= checkOutDate) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Check-out must be after check-in",
        code: "VALIDATION_ERROR"
      });
    }

    // Validate food count vs guest count
    const totalGuests = total_adults + childrenNum;
    const totalFood = foodVegNum + foodNonVegNum + foodJainNum;

    if (totalFood > 0 && totalFood !== totalGuests) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: "Food preferences must match total guests",
        code: "VALIDATION_ERROR"
      });
    }

    const payment_status = "success";
    const payment_txn_id = `BOOK-${uuidv4()}`;

    // Insert into bookings
    let result;
    try {
      [result] = await connection.execute(
        `INSERT INTO bookings (
          guest_name, guest_email, guest_phone, accommodation_id,
          check_in, check_out, adults, children, rooms, food_veg, food_nonveg,
          food_jain, total_amount, advance_amount, payment_status, payment_txn_id, created_at, meal_plan, meal_plan_price, notes, activities, activities_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guest_name,
          guest_email,
          guest_phone || null,
          accommodationIdNum,
          check_in,
          check_out,
          total_adults,
          childrenNum,
          roomsNum,
          foodVegNum,
          foodNonVegNum,
          foodJainNum,
          totalAmountNum,
          advanceAmountNum,
          payment_status,
          payment_txn_id,
          new Date(),
          meal_plan,
          meal_plan_price,
          req.body.notes || null,
          req.body.activities ? (typeof req.body.activities === 'string' ? req.body.activities : JSON.stringify(req.body.activities)) : null,
          req.body.activities_total || 0
        ]
      );
    } catch (insertError) {
      await connection.rollback();
      
      // Handle specific database errors
      if (insertError.code === "ER_NO_REFERENCED_ROW_2") {
        return res.status(400).json({
          success: false,
          error: "Invalid accommodation reference",
          code: "FOREIGN_KEY_ERROR"
        });
      } else if (insertError.code === "ER_BAD_NULL_ERROR") {
        return res.status(400).json({
          success: false,
          error: "Required field is missing",
          code: "NULL_CONSTRAINT_ERROR",
          details: process.env.NODE_ENV === "development" ? insertError.sqlMessage : undefined
        });
      } else if (insertError.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          success: false,
          error: "Duplicate booking entry",
          code: "DUPLICATE_ENTRY"
        });
      }
      
      console.error("Error inserting booking:", insertError);
      throw insertError; // Re-throw to be caught by outer catch
    }

    const booking_id = result.insertId;
    if (!booking_id) {
      await connection.rollback();
      return res.status(500).json({
        success: false,
        error: "Failed to create booking - no ID returned",
        code: "DATABASE_ERROR"
      });
    }

    // Fetch booking details with accommodation
    let booking;
    try {
      const [bookings] = await connection.execute(
        `SELECT b.*, a.name AS accommodation_name, a.address AS accommodation_address,
         a.latitude, a.longitude, a.owner_id, a.type AS accommodation_type
         FROM bookings b
         JOIN accommodations a ON b.accommodation_id = a.id
         WHERE b.id = ?`,
        [booking_id]
      );

      if (bookings.length === 0) {
        await connection.rollback();
        return res.status(500).json({
          success: false,
          error: "Booking created but could not be retrieved",
          code: "DATABASE_ERROR"
        });
      }

      booking = bookings[0];
    } catch (fetchError) {
      await connection.rollback();
      console.error("Error fetching booking:", fetchError);
      return res.status(500).json({
        success: false,
        error: "Failed to retrieve booking details",
        code: "DATABASE_ERROR",
        details: process.env.NODE_ENV === "development" ? fetchError.message : undefined,
      });
    }

    let ownerEmail = null;
    let ownerName = null;
    let ownerPhone = null;

    // Get owner details using owner_id
    if (booking.owner_id) {
      try {
        const [users] = await connection.execute(
          "SELECT name, email, phoneNumber FROM users WHERE id = ?",
          [booking.owner_id]
        );

        if (users.length > 0) {
          const user = users[0];
          ownerEmail = user.email || "babukale60@gmail.com";
          ownerName = user.name || "babu kale";
          ownerPhone = user.phoneNumber || "9923366051";
        } 

      } catch (ownerError) {
        // Log but don't fail the booking if owner fetch fails
        console.error("Error fetching owner details:", ownerError);
        ownerEmail = "babukale60@gmail.com";
        ownerName = "babu kale";
        ownerPhone = "9923366051";
      }
    }

    // Commit transaction
    try {
      await connection.commit();
    } catch (commitError) {
      await connection.rollback();
      console.error("Error committing transaction:", commitError);
      return res.status(500).json({
        success: false,
        error: "Failed to commit booking transaction",
        code: "TRANSACTION_ERROR",
        details: process.env.NODE_ENV === "development" ? commitError.message : undefined,
      });
    }

    // Send email - don't fail the booking if email fails
    const formatDate = (dateStr) => {
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "";
        return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1)
          .toString()
          .padStart(2, "0")}/${d.getFullYear()}`;
      } catch (e) {
        return "";
      }
    };

    const remainingAmount = booking.total_amount - booking.advance_amount;

    try {
      await sendPdfEmail({
      email: booking.guest_email,
      name: booking.guest_name,
      BookingId: booking.id,
      BookingDate: formatDate(booking.created_at),
      CheckinDate: formatDate(booking.check_in),
      CheckoutDate: formatDate(booking.check_out),
      totalPrice: booking.total_amount,
      advancePayable: booking.advance_amount,
      remainingAmount: remainingAmount.toFixed(2),

      mobile: booking.guest_phone,

      totalPerson: booking.adults + booking.children,

      adult: booking.adults,

      child: booking.children,

      vegCount: booking.food_veg,

      nonvegCount: booking.food_nonveg,

      joinCount: booking.food_jain,

      accommodationName: booking.accommodation_name || "",

      accommodationAddress: booking.accommodation_address || "",

      latitude: booking.latitude || "",

      longitude: booking.longitude || "",

      ownerEmail: ownerEmail || "",
      ownerName: ownerName || "",
      ownerPhone: ownerPhone || "",
      rooms : booking.rooms || "",
      coupon: coupon || "",
      discount: discount || "",
      full_amount: full_amount || "",
      acc_type: booking.accommodation_type || "camping", mealPlan: booking.meal_plan, notes: booking.notes, activitiesTotal: booking.activities_total
    });
    } catch (emailError) {
      // Log email error but don't fail the response
      console.error("Error sending confirmation email:", emailError);
      // Continue to send success response
    }

    res.json({
      success: true,
      data: {
        booking,
        owner_email: ownerEmail,
        owner_name: ownerName,
        owner_phone: ownerPhone,
      },
    });
  } catch (error) {
    // Handle rollback with error handling
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Error during rollback:", rollbackError);
      }
    }

    console.error("Error creating booking:", error);

    // Determine error type and status code
    let statusCode = 500;
    let errorCode = "SERVER_ERROR";
    let errorMessage = "Failed to create booking";

    if (error.code) {
      // MySQL error codes
      if (error.code.startsWith("ER_")) {
        statusCode = 400;
        errorCode = "DATABASE_ERROR";
        
        if (error.code === "ER_ROW_IS_REFERENCED_2") {
          errorMessage = "Cannot create booking - accommodation is referenced incorrectly";
        } else if (error.code === "ER_BAD_FIELD_ERROR") {
          errorMessage = "Invalid field in database query";
        } else if (error.code === "ER_NO_SUCH_TABLE") {
          errorMessage = "Database table missing";
          statusCode = 500;
        }
      } else if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
        statusCode = 503;
        errorCode = "DATABASE_CONNECTION_ERROR";
        errorMessage = "Database connection unavailable";
      }
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      code: errorCode,
      details: process.env.NODE_ENV === "development" ? {
        message: error.message,
        sqlMessage: error.sqlMessage,
        code: error.code,
        sql: error.sql
      } : undefined,
    });
  } finally {
    // Always release connection
    if (connection) {
      try {
        connection.release();
      } catch (releaseError) {
        console.error("Error releasing connection:", releaseError);
      }
    }
  }
});

router.delete(['/:id', '/delete/:id', '/bookings/:id', '/bookings/delete/:id'], async (req, res) => {
  try {
    const { id } = req.params;
    const bookingId = parseInt(id, 10);

    // Validate ID
    if (isNaN(bookingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID',
      });
    }

    // Check if booking exists
    const [existing] = await pool.execute('SELECT id FROM bookings WHERE id = ?', [bookingId]);

    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Delete booking
    await pool.execute('DELETE FROM bookings WHERE id = ?', [bookingId]);

    return res.json({
      success: true,
      message: 'Booking deleted successfully',
    });
  } catch (error) {
    console.error("❌ Error deleting booking:", error.sqlMessage || error.message);
  
    res.status(500).json({
      success: false,
      error: "Failed to delete booking",
      details: error.sqlMessage || error.message, // 👈 expose real DB error
    });
  }
});

// POST /admin/bookings/payments/razorpay/create-order
// POST /admin/bookings/payments/razorpay
router.post(["/payments/razorpay/create-order", "/payments/razorpay", "/payments/payu"], async (req, res) => {
  try {
    const { amount, firstname, email, phone, booking_id, productinfo } = req.body;

    // --- Validation ---
    if (!amount || !booking_id) {
      return res.status(400).json({ success: false, error: "Missing required payment parameters: amount or booking_id" });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ success: false, error: "Invalid payment amount" });
    }

    // --- Check pending booking ---
    const [booking] = await pool.execute(
      'SELECT id, total_amount, advance_amount, guest_name, guest_email, guest_phone FROM bookings WHERE id = ? AND payment_status = "pending"',
      [booking_id]
    );

    if (booking.length === 0) {
      return res.status(404).json({ success: false, error: "Pending booking not found or already processed" });
    }

    // Razorpay requires amount in smallest currency sub-unit (paise for INR, 1 INR = 100 paise)
    const amountInPaise = Math.round(numericAmount * 100);

    const receiptId = `rcpt_${booking_id}_${Date.now()}`.substring(0, 40);

    const orderOptions = {
      amount: amountInPaise,
      currency: "INR",
      receipt: receiptId,
      notes: {
        booking_id: String(booking_id),
        guest_name: firstname || booking[0].guest_name || "",
        guest_email: email || booking[0].guest_email || "",
        productinfo: productinfo || `Booking #${booking_id}`
      }
    };

    console.log("💳 Creating Razorpay Order:", orderOptions);
    const order = await razorpayInstance.orders.create(orderOptions);
    console.log("✅ Razorpay Order Created:", order.id);

    // Update booking with Razorpay Order ID as pending payment_txn_id
    await pool.execute(
      'UPDATE bookings SET payment_txn_id = ?, payment_status = "pending" WHERE id = ?',
      [order.id, booking_id]
    );

    // Respond to frontend
    res.json({
      success: true,
      message: "Razorpay order initiated",
      key_id: razorpayKeyId,
      order: order,
      booking_id: booking_id,
      amount: numericAmount,
      currency: "INR"
    });

  } catch (error) {
    console.error("💥 Razorpay order initiation error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to initiate Razorpay order",
      details: error.message || error
    });
  }
});

// POST /admin/bookings/payments/razorpay/verify
router.post("/payments/razorpay/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, booking_id } = req.body;

    console.log("🔐 Verifying Razorpay Payment:", {
      razorpay_order_id,
      razorpay_payment_id,
      booking_id
    });

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: "Missing required Razorpay verification fields"
      });
    }

    // Verify HMAC-SHA256 signature
    const signatureBody = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", razorpayKeySecret)
      .update(signatureBody.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.error("❌ Razorpay signature mismatch! Possible tampering.");
      if (booking_id) {
        await pool.execute('UPDATE bookings SET payment_status = "failed" WHERE id = ?', [booking_id]);
      }
      return res.status(400).json({
        success: false,
        error: "Razorpay payment verification failed: signature mismatch"
      });
    }

    console.log("✅ Razorpay Signature Verified Successfully!");

    // Update booking in database
    const newStatus = "success";
    let targetBookingId = booking_id;

    if (targetBookingId) {
      await pool.execute(
        "UPDATE bookings SET payment_status = ?, payment_txn_id = ? WHERE id = ?",
        [newStatus, razorpay_payment_id, targetBookingId]
      );
    } else {
      await pool.execute(
        "UPDATE bookings SET payment_status = ?, payment_txn_id = ? WHERE payment_txn_id = ?",
        [newStatus, razorpay_payment_id, razorpay_order_id]
      );
    }

    // Fetch booking details for confirmation & PDF email
    const [bookings] = await pool.execute(`
      SELECT guest_email, id, guest_name, guest_phone, rooms, adults, children, 
             food_veg, food_nonveg, food_jain, check_in, check_out, 
             total_amount, advance_amount, accommodation_id, coupon_code, discount_amount, full_amount
      FROM bookings 
      WHERE payment_txn_id = ? OR id = ?`,
      [razorpay_payment_id, targetBookingId || -1]
    );

    if (bookings && bookings.length > 0) {
      const bk = bookings[0];
      const remainingAmount = parseFloat(bk.total_amount || 0) - parseFloat(bk.advance_amount || 0);

      const formatDate = (dateValue) => {
        if (!dateValue) return "Invalid date";
        try {
          const date = new Date(dateValue);
          if (isNaN(date.getTime())) throw new Error("Invalid date");
          return format(date, "dd/MM/yyyy");
        } catch (e) {
          return "Invalid date";
        }
      };

      const today = new Date();
      const formattedDate = format(today, "yyyy-MM-dd");
      const recipientEmail = bk.guest_email?.trim();

      const [accommodations] = await pool.execute(
        "SELECT name, address, latitude, longitude, owner_id, type FROM accommodations WHERE id = ?",
        [bk.accommodation_id]
      );

      const acc = accommodations[0] || {};
      const owner_id = acc.owner_id;

      let ownerName = "", ownerEmail = "", ownerPhone = "";
      if (owner_id) {
        const [user] = await pool.execute(
          "SELECT name, email, phoneNumber FROM users WHERE id = ?",
          [owner_id]
        );
        if (user && user.length > 0) {
          ownerName = user[0].name || "";
          ownerEmail = user[0].email || "";
          ownerPhone = user[0].phoneNumber || "";
        }
      }

      console.log("🚀 Sending confirmation email for booking:", bk.id);
      try {
        await sendPdfEmail({
          email: recipientEmail,
          name: bk.guest_name,
          BookingId: bk.id,
          BookingDate: formattedDate,
          CheckinDate: formatDate(bk.check_in),
          CheckoutDate: formatDate(bk.check_out),
          totalPrice: bk.total_amount,
          advancePayable: bk.advance_amount,
          remainingAmount: remainingAmount.toFixed(2),
          mobile: bk.guest_phone,
          totalPerson: (Number(bk.adults) || 1) + (Number(bk.children) || 0),
          adult: bk.adults,
          child: bk.children,
          vegCount: bk.food_veg,
          nonvegCount: bk.food_nonveg,
          joinCount: bk.food_jain,
          accommodationName: acc.name || "",
          accommodationAddress: acc.address || "",
          latitude: acc.latitude || "",
          longitude: acc.longitude || "",
          ownerEmail: ownerEmail || "",
          ownerName: ownerName || "",
          ownerPhone: ownerPhone || "",
          coupon: bk.coupon_code || "N/A",
          discount: bk.discount_amount || "0",
          full_amount: bk.full_amount || "0",
          acc_type: (acc.type || "camping").toLowerCase(),
          rooms: bk.rooms || 1, mealPlan: bk.meal_plan, notes: bk.notes, activitiesTotal: bk.activities_total,
        });
        console.log("✅ Confirmation email sent to:", recipientEmail);
      } catch (mailErr) {
        console.error("❌ Email sending failed:", mailErr.message);
      }
    }

    res.json({
      success: true,
      message: "Payment verified successfully",
      payment_id: razorpay_payment_id,
      order_id: razorpay_order_id,
      booking_id: targetBookingId || (bookings[0] ? bookings[0].id : null)
    });

  } catch (error) {
    console.error("💥 Razorpay verification error:", error);
    res.status(500).json({
      success: false,
      error: "Payment verification failed",
      details: error.message
    });
  }
});

// GET & POST /admin/bookings/:id/retry-payment - Retry payment for an existing booking
router.all("/:id/retry-payment", async (req, res) => {
  try {
    const { id } = req.params;
    const [bookings] = await pool.execute(
      "SELECT b.*, a.name AS accommodation_name FROM bookings b LEFT JOIN accommodations a ON b.accommodation_id = a.id WHERE b.id = ?",
      [id]
    );

    if (bookings.length === 0) {
      return res.status(404).json({ success: false, error: "Booking not found" });
    }

    const booking = bookings[0];
    if (booking.payment_status === "success" || booking.payment_status === "paid") {
      return res.status(400).json({ success: false, error: "Booking is already paid" });
    }

    const amount = parseFloat(booking.advance_amount || booking.total_amount || 0);
    if (amount <= 0) {
      return res.status(400).json({ success: false, error: "Invalid booking amount" });
    }

    const amountInPaise = Math.round(amount * 100);
    const receiptId = `retry_${id}_${Date.now()}`.substring(0, 40);

    const order = await razorpayInstance.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: receiptId,
      notes: {
        booking_id: String(id),
        guest_name: booking.guest_name || "",
        guest_email: booking.guest_email || "",
        productinfo: `Retry Booking #${id}`
      }
    });

    await pool.execute(
      'UPDATE bookings SET payment_txn_id = ?, payment_status = "pending" WHERE id = ?',
      [order.id, id]
    );

    res.json({
      success: true,
      key_id: razorpayKeyId,
      order: order,
      booking_id: id,
      guest_name: booking.guest_name,
      guest_email: booking.guest_email,
      guest_phone: booking.guest_phone,
      accommodation_name: booking.accommodation_name,
      amount: amount
    });
  } catch (error) {
    console.error("Error creating retry payment order:", error);
    res.status(500).json({ success: false, error: "Failed to initiate retry payment", details: error.message });
  }
});


// // GET /payment-status/:txnid - Check payment status

// router.get('/payment-status/:txnid', async (req, res) => {

//   try {

//     const { txnid } = req.params;

//     const { force_payu } = req.query;

//     if (!txnid) {

//       return res.status(400).json({

//         success: false,

//         error: 'Transaction ID is required'

//       });

//     }

//     const [bookings] = await pool.execute(

//       'SELECT id, payment_status, payment_txn_id, total_amount, advance_amount, created_at FROM bookings WHERE payment_txn_id = ?',

//       [txnid]

//     );

//     if (bookings.length === 0) {

//       return res.status(404).json({

//         success: false,

//         error: 'Transaction not found'

//       });

//     }

//     const booking = bookings[0];

//     const shouldCheckPayU = force_payu === 'true' ||

//                            booking.payment_status === 'failed' ||

//                            booking.payment_status === 'pending';

//     if (!shouldCheckPayU && booking.payment_status === 'success') {

//       return res.json({

//         success: true,

//         data: {

//           txnid,

//           status: booking.payment_status,

//           source: 'database',

//           booking_id: booking.id,

//           amount: booking.advance_amount || booking.total_amount,

//           message: 'Payment already confirmed as successful'

//         }

//       });

//     }

//     try {

//       const payuClient = new PayU({ key: payu_key, salt: payu_salt });

//       const verifiedData = await payuClient.verifyPayment(txnid);

//       if (!verifiedData || !verifiedData.transaction_details || !verifiedData.transaction_details[txnid]) {

//         return res.json({

//           success: true,

//           data: {

//             txnid,

//             status: booking.payment_status,

//             source: 'database',

//             booking_id: booking.id,

//             amount: booking.advance_amount || booking.total_amount,

//             warning: 'PayU verification returned no data - check merchant dashboard manually',

//             payu_response: verifiedData

//           }

//         });

//       }

//       const transaction = verifiedData.transaction_details[txnid];

//       let finalStatus = 'pending';

//       if (transaction.status === 'success') {

//         finalStatus = 'success';

//       } else if (transaction.status === 'failure' || transaction.status === 'failed') {

//         finalStatus = 'failed';

//       }

//       if (finalStatus !== booking.payment_status) {

//         await pool.execute(

//           'UPDATE bookings SET payment_status = ? WHERE payment_txn_id = ?',

//           [finalStatus, txnid]

//         );

//       }

//       return res.json({

//         success: true,

//         data: {

//           txnid,

//           status: finalStatus,

//           source: 'payu',

//           booking_id: booking.id,

//           amount: transaction.amount || booking.advance_amount || booking.total_amount,

//           payment_id: transaction.mihpayid,

//           payment_mode: transaction.mode,

//           bank_ref_num: transaction.bank_ref_num,

//           payu_status: transaction.status,

//           status_updated: finalStatus !== booking.payment_status,

//           original_db_status: booking.payment_status

//         }

//       });

//     } catch (payuError) {

//       return res.json({

//         success: true,

//         data: {

//           txnid,

//           status: booking.payment_status,

//           source: 'database',

//           booking_id: booking.id,

//           amount: booking.advance_amount || booking.total_amount,

//           error: 'PayU verification failed',

//           error_details: payuError.message,

//           recommendation: 'Check PayU merchant dashboard manually'

//         }

//       });

//     }

//   } catch (error) {

//     console.error('Error checking payment status:', error);

//     res.status(500).json({

//       success: false,

//       error: 'Failed to check payment status',

//       details: process.env.NODE_ENV === 'development' ? error.message : undefined

//     });

//   }

// });

// POST /verify/:txnid - Handle PayU callback (UPDATED)




async function sendPdfEmail(params) {
  const {
    email,
    name,
    BookingId,
    BookingDate,
    CheckinDate,
    CheckoutDate,
    totalPrice,
    advancePayable,
    remainingAmount,
    mobile,
    totalPerson,
    adult,
    child,
    vegCount,
    nonvegCount,
    joinCount,
    accommodationName,
    accommodationAddress,
    latitude,
    longitude,
    ownerEmail,
    ownerName,
    ownerPhone,
    coupon,
    discount,
    full_amount,
    rooms,
    acc_type,
    mealPlan,
    notes,
    activitiesTotal
  } = params;

  console.log("Sending PDF email to:", email);

  if (
    !email ||
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    console.error("❌ Invalid or missing email, aborting mail send:", email);
    return;
  }

  const type = acc_type ? (acc_type.charAt(0).toUpperCase() + acc_type.slice(1).toLowerCase()) : 'Accommodation';
  const roomsCount = rooms || 1;
  const bookedDate = BookingDate; 
  
  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">

<head>
  <meta http-equiv="Content-type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="format-detection" content="date=no" />
  <meta name="format-detection" content="address=no" />
  <meta name="format-detection" content="telephone=no" />
  <meta name="x-apple-disable-message-reformatting" />
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Lato:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet" />
  <title>Booking Confirmation</title>

  <style type="text/css" media="screen">
    body { padding: 0 !important; margin: 0 !important; display: block !important; min-width: 100% !important; width: 100% !important; background: #F9F7F5; -webkit-text-size-adjust: none; font-family: 'Lato', Arial, sans-serif; }
    a { color: #7D236F; text-decoration: none; }
    p { margin: 0 !important; }
    img { -ms-interpolation-mode: bicubic; display: block; }
    .mcnPreviewText { display: none !important; }
    @media only screen and (max-width: 600px) {
      .mobile-shell { width: 100% !important; min-width: 100% !important; padding: 0 10px !important; }
      .stack-column { display: block !important; width: 100% !important; max-width: 100% !important; direction: ltr !important; }
      .mobile-center { text-align: center !important; }
      .table-responsive { font-size: 12px !important; }
      .table-responsive th, .table-responsive td { padding: 8px 6px !important; }
      .header-title { font-size: 18px !important; }
    }
  </style>
</head>

<body style="padding:0; margin:0; background:#F9F7F5; -webkit-text-size-adjust:none;">
  <span class="mcnPreviewText" style="display:none; font-size:0px; line-height:0px; max-height:0px; max-width:0px; opacity:0; overflow:hidden; visibility:hidden; mso-hide:all;"></span>

  <table width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#F9F7F5">
    <tr>
      <td align="center" valign="top" style="padding: 24px 0;">

        <table width="650" border="0" cellspacing="0" cellpadding="0" class="mobile-shell" style="width:650px; max-width:650px; background:#ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(125, 35, 111, 0.08); border: 1px solid #ECE4DC;">
          
          <tr>
            <td height="6" bgcolor="#7D236F" style="background: linear-gradient(90deg, #7D236F 0%, #C48D2A 100%);"></td>
          </tr>

          <tr>
            <td style="padding: 24px 28px 20px; border-bottom: 2px solid #F3ECE5;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td valign="middle" align="left">
                    <h1 class="header-title" style="margin: 0; color: #36414C; font-family: 'Cinzel', Georgia, serif; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; line-height: 26px;">
                      ${accommodationName}
                    </h1>
                    <div style="font-size: 13px; color: #7D236F; font-weight: bold; margin-top: 6px;">
                      Booking ID: <span style="background: #F8EDF5; padding: 2px 7px; border-radius: 4px; border: 1px solid #E8D0E3;">${BookingId}</span>
                    </div>
                    <div style="font-size: 13px; color: #736B65; margin-top: 4px;">
                      Booking Date: <span style="color: #2D2520;">${bookedDate}</span>
                    </div>
                  </td>
                  <td valign="middle" align="right" class="fluid-img" style="width: 170px;">
                    <img src="https://plumeriaretreat.com/assets/plumeria-removebg-preview-CWtMayYt.png" alt="Plumeria Retreat Logo" style="max-height: 60px; max-width: 160px; height: auto; width: auto;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 28px;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size: 16px; color: #2D2520; line-height: 24px; padding-bottom: 12px;">
                    Dear <b>${name}</b>,
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 14px; color: #4B4642; line-height: 22px; padding-bottom: 16px;">
                    <b>${accommodationName}</b> has received and registered your booking. The primary guest must present a copy of this confirmation e-voucher upon check-in.
                  </td>
                </tr>
                <tr>
                  <td style="background: #FCF8F2; border-left: 4px solid #C48D2A; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px;">
                    <div style="font-size: 14px; color: #2D2520; line-height: 22px;">
                      <b>Advance Payable:</b> <span style="color: #7D236F; font-size: 16px; font-weight: bold;">INR ${advancePayable}</span>
                      <br />
                      <span style="font-size: 12.5px; color: #6D645D;">
                        If there are any discrepancies, please write to us at 
                        <a href="mailto:${ownerEmail}" style="color: #7D236F; font-weight: bold; text-decoration: underline;">${ownerEmail}</a>.
                      </span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 12px; color: #8F8780; text-align: right; padding-top: 14px; padding-bottom: 6px;">
                    All prices are in INR (₹)
                  </td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" class="table-responsive" style="border-collapse: collapse; border: 1px solid #ECE4DC; border-radius: 8px; overflow: hidden; margin-top: 6px; margin-bottom: 24px;">
                <thead>
                  <tr bgcolor="#7D236F">
                    <th width="45%" align="left" style="color: #ffffff; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 14px;">
                      Booking Details
                    </th>
                    <th width="55%" align="left" style="color: #ffffff; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 14px; border-left: 1px solid #943A86;">
                      Tariff & Payment Breakup
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <!-- Guest & Stay Parameters -->
                    <td valign="top" style="padding: 14px; background: #FAF7F5; border-right: 1px solid #ECE4DC; font-size: 13px; line-height: 20px; color: #3E3834;">
                      <p style="padding-bottom: 6px;">Mobile: <b>${mobile}</b></p>
                      <p style="padding-bottom: 6px;">Check-In: <b>${CheckinDate}</b></p>
                      <p style="padding-bottom: 6px;">Check-Out: <b>${CheckoutDate}</b></p>
                      <p style="padding-bottom: 6px;">Rooms: <b>${roomsCount}</b></p>
                      <p style="padding-bottom: 6px;">Adults: <b>${adult}</b></p>
                      
                      ${mealPlan ? `<p style="padding-bottom: 6px;">Meal Plan: <b>${mealPlan}</b></p>` : ''}
                      
                      ${child > 0 ? `
                        <p style="padding-bottom: 6px;">Children: <b>${child}</b></p>
                      ` : ''}
                    </td>

                    <!-- Financial Summary -->
                    <td valign="top" style="padding: 14px; background: #ffffff; font-size: 13px; line-height: 22px; color: #2D2520;">
                      <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="color: #6E6761; padding-bottom: 4px;">Base Amount:</td>
                          <td align="right" style="padding-bottom: 4px;"><b>₹${full_amount}</b></td>
                        </tr>

                        <!-- NEW ACTIVITIES ROW -->
                        <!-- NEW ACTIVITIES ROW -->
                        ${(activitiesTotal && Number(activitiesTotal) > 0) ? `
                        <tr>
                          <td style="color: #6E6761; padding-bottom: 2px;">Activities & Add-ons:</td>
                          <td align="right" style="color: #2D2520; padding-bottom: 2px;"><b>+ ₹${activitiesTotal}</b></td>
                        </tr>
                        ` : ''}
                        ${notes ? `
                        <tr>
                          <td colspan="2" style="font-size: 11px; color: #8F8780; padding-bottom: 6px; line-height: 14px;">
                            ${notes}
                          </td>
                        </tr>
                        ` : ''}
                        
                        ${(discount && discount > 0) ? `
                        <tr>
                          <td style="color: #6E6761; padding-bottom: 4px;">Discount:</td>
                          <td align="right" style="color: #2E7D32; padding-bottom: 4px;"><b>- ₹${discount}</b></td>
                        </tr>
                        ` : ''}

                        ${coupon ? `
                        <tr>
                          <td style="color: #6E6761; padding-bottom: 4px;">Coupon Applied:</td>
                          <td align="right" style="color: #C48D2A; font-weight: bold; padding-bottom: 4px;">${coupon}</td>
                        </tr>
                        ` : ''}

                        <tr style="border-top: 1px dashed #E0D7CF;">
                          <td style="padding-top: 6px; padding-bottom: 4px; font-weight: bold;">Total (incl. Taxes):</td>
                          <td align="right" style="padding-top: 6px; padding-bottom: 4px; font-weight: bold;">₹${totalPrice}</td>
                        </tr>
                        <tr>
                          <td style="color: #7D236F; font-weight: bold; padding-bottom: 4px;">Advance Paid:</td>
                          <td align="right" style="color: #7D236F; font-weight: bold; padding-bottom: 4px;">₹${advancePayable}</td>
                        </tr>
                        <tr style="border-top: 1px solid #ECE4DC;">
                          <td style="padding-top: 6px; color: #C48D2A; font-weight: bold;">Balance at Check-in:</td>
                          <td align="right" style="padding-top: 6px; color: #C48D2A; font-weight: bold; font-size: 14px;">₹${remainingAmount}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
                <tr>
                  <td style="border-bottom: 2px solid #C48D2A; padding-bottom: 6px;">
                    <span style="color: #7D236F; font-family: 'Cinzel', Georgia, serif; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">
                      Cancellation Policy
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 13px; color: #524B46; line-height: 20px; padding-top: 10px;">
                    From <b>${bookedDate}</b>, a 100% penalty applies upon cancellation. In case of a no-show, no refund will be provided. The reservation cannot be cancelled or modified on or after the scheduled date.
                  </td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: #FAF7F5; border-radius: 8px; border: 1px solid #ECE4DC; margin-bottom: 22px;">
                <tr>
                  <td style="padding: 14px 16px;">
                    <div style="color: #7D236F; font-weight: bold; font-size: 13.5px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                      🎒 Things to Carry
                    </div>
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 13px; color: #4B4642; line-height: 20px;">
                      <tr><td style="padding: 2px 0;">• Extra pair of clothing & comfortable footwear</td></tr>
                      <tr><td style="padding: 2px 0;">• Warm jackets/layers (temperatures drop pleasantly at Pawna Lake during night)</td></tr>
                      <tr><td style="padding: 2px 0;">• Toothbrush, paste, and essential personal toiletries</td></tr>
                      <tr><td style="padding: 2px 0;">• Personal medicines & insect repellent if needed</td></tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-top: 2px solid #7D236F; padding-top: 14px; margin-bottom: 16px;">
                <tr>
                  <td>
                    <span style="color: #7D236F; font-family: 'Cinzel', Georgia, serif; font-size: 14px; font-weight: bold; text-transform: uppercase;">
                      Location & Contact Details
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 10px;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50%" valign="top" class="stack-column" style="font-size: 13px; color: #443E3A; line-height: 20px; padding-right: 12px; padding-bottom: 12px;">
                          <b>${accommodationName}</b><br />
                          At: ${accommodationAddress}<br />
                          Pawna Lake, Maharashtra<br />
                          <div style="margin-top: 6px;">
                            <a href="http://maps.google.com/maps?q=${latitude},${longitude}" target="_blank" style="color: #C48D2A; font-weight: bold; text-decoration: underline;">
                              📍 View on Google Maps
                            </a>
                          </div>
                        </td>

                        <td width="50%" valign="top" class="stack-column" style="font-size: 13px; color: #443E3A; line-height: 20px; padding-bottom: 12px;">
                          <b>Email:</b> <a href="mailto:booking@plumeriaretreat.com" style="color: #7D236F;">booking@plumeriaretreat.com</a><br />
                          <b>Contact Person:</b> ${ownerName}<br />
                          <b>Phone:</b> <a href="tel:${ownerPhone}" style="color: #7D236F; font-weight: bold;">${ownerPhone}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td bgcolor="#FAF7F5" style="padding: 16px 28px; border-top: 1px solid #ECE4DC; text-align: center; font-size: 12px; color: #8F8780; line-height: 18px;">
              Please do not reply directly to this automated email. For any modifications, reach out to 
              <a href="mailto:${ownerEmail}" style="color: #7D236F; font-weight: bold;">${ownerEmail}</a>.<br />
              © ${accommodationName} • Pawna Lake Cottages & Camping
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com",
    secure: false,
    port: 587,
    auth: {
      user: process.env.EMAIL_USER || "booking@plumeriaretreat.com",
      pass: process.env.EMAIL_PASS || "Plumeria@2020?",
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER || "booking@plumeriaretreat.com",
    to: email.trim(),
    cc: ownerEmail,
    bcc: "admin@plumeriaretreat.com",
    subject: "Resort Camping Booking",
    html: html,
  };

  try {
    let info = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent:", info.response);
    return info;
  } catch (err) {
    console.error("❌ Mail send error:", err);
    throw err;
  }
}

router.post("/success/verify/:txnid", async (req, res) => {
  console.log("✅ Payment verification callback received");

  const { txnid } = req.params;
  // const responseData = req.body; // PayU posts txn details here
  // console.log("🔍 PayU Callback Data:", responseData);

  try {
    // --- Rebuild Hash from PayU callback ---
    // const {
    //   status, firstname, email, amount, productinfo,
    //   mihpayid, txnid: payuTxnId,
    //   hash: payuHash,
    //   udf1, udf2, udf3, udf4, udf5, udf6, udf7, udf8, udf9, udf10
    // } = responseData;

    // const hashSequence =
    //   `${payu_salt}|${status}||||||${udf10}|${udf9}|${udf8}|${udf7}|${udf6}|${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${payuTxnId}|${payu_key}`;

    // const calcHash = crypto.createHash("sha512").update(hashSequence).digest("hex");

    // console.log("🔐 PayU Provided Hash:", payuHash);
    // console.log("🔐 Server Calculated Hash:", calcHash);

    // if (calcHash !== payuHash) {
    //   console.error("❌ Hash mismatch – possible tampering!");
    //   return res.redirect(`${FRONTEND_BASE_URL}/payment/failed/${txnid}`);
    // }

    // --- Update DB ---
    const newStatus = "success";
    await pool.execute(
      "UPDATE bookings SET payment_status = ? WHERE payment_txn_id = ?",
      [newStatus, txnid]
    );
    console.log("✅ Booking updated with status:", newStatus);
    const [bookings] = await pool.execute(`
      SELECT guest_email, id, guest_name, guest_phone, rooms, adults, children, 
             food_veg, food_nonveg, food_jain, check_in, check_out, 
             total_amount, advance_amount, accommodation_id , coupon_code ,discount_amount ,full_amount
      FROM bookings WHERE payment_txn_id = ?`,
      [txnid]
    );
    console.log("📦 Bookings fetched:", bookings);

    if (newStatus === "success" && bookings && bookings.length > 0) {
      const bk = bookings[0];
      console.log("🎟️ Booking details:", bk);

      const remainingAmount =
        parseFloat(bk.total_amount) - parseFloat(bk.advance_amount);
      console.log("💰 Remaining amount:", remainingAmount);

      const formatDate = (dateValue) => {
        if (!dateValue) return "Invalid date";
        try {
          const date = new Date(dateValue);
          if (isNaN(date.getTime())) throw new Error("Invalid date");
          return format(date, "dd/MM/yyyy");
        } catch (e) {
          console.error("❌ Invalid date format:", dateValue);
          return "Invalid date";
        }
      };

      const today = new Date();
      const day = String(today.getDate()).padStart(2, "0");
      const month = String(today.getMonth() + 1).padStart(2, "0");
      const year = today.getFullYear();
      const formattedDate = `${year}-${month}-${day}`;
      console.log("📅 Booking date formatted:", formattedDate);

      const recipientEmail = bk.guest_email?.trim();
      console.log("📧 Guest email:", recipientEmail);

      const [accommodations] = await pool.execute(`
        SELECT name, address, latitude, longitude, owner_id, type
        FROM accommodations WHERE id = ?`,
        [bk.accommodation_id]
      );
      console.log("🏠 Accommodation fetched:", accommodations);

      const acc = accommodations[0] || {};
      console.log("🏡 Selected accommodation:", acc);

      const owner_id = acc.owner_id;
      console.log("👤 Owner ID:", owner_id);

      const [user] = await pool.execute(
        `SELECT name, email, phoneNumber FROM users WHERE id = ?`,
        [owner_id]
      );
      console.log("👨 Owner fetched:", user);

      const ownerName = user[0]?.name;
      const ownerEmail = user[0]?.email;
      const ownerPhone = user[0]?.phoneNumber;
      console.log("📧 Owner email:", ownerEmail);

      // If you want to enable email sending later, you can log like this:
      
      console.log("🚀 Attempting to send confirmation email...");
      try {
        await sendPdfEmail({
          email: recipientEmail,
          name: bk.guest_name,
          BookingId: bk.id,
          BookingDate: formattedDate,
          CheckinDate: formatDate(bk.check_in),
          CheckoutDate: formatDate(bk.check_out),
          totalPrice: bk.total_amount,
          advancePayable: bk.advance_amount,
          remainingAmount: remainingAmount.toFixed(2),
          mobile: bk.guest_phone,
          totalPerson: bk.adults + bk.children,
          adult: bk.adults,
          child: bk.children,
          vegCount: bk.food_veg,
          nonvegCount: bk.food_nonveg,
          joinCount: bk.food_jain,
          accommodationName: acc.name || "",
          accommodationAddress: acc.address || "",
          latitude: acc.latitude || "",
          longitude: acc.longitude || "",
          ownerEmail: ownerEmail || "",
          ownerName: ownerName || "",
          ownerPhone: ownerPhone || "",
          coupon: bk.coupon_code || "N/A",
          discount: bk.discount_amount || "0",
          full_amount: bk.full_amount || "0",
          acc_type: acc.type.toLowerCase() || 'camping', mealPlan: bk.meal_plan,
          rooms: bk.rooms || 0,
          notes: bk.notes, activitiesTotal: bk.activities_total,
        });
        console.log("✅ Confirmation email sent to:", recipientEmail);
      } catch (e) {
        console.error("❌ Email sending failed:", e.message);
      }
    }

    // (Optional) fetch booking + send email logic (your existing code)

    return res.redirect(`${FRONTEND_BASE_URL}/payment/${newStatus}/${txnid}`);

  } catch (error) {
    console.error("💥 Verification error:", error);
    return res.redirect(`${FRONTEND_BASE_URL}/payment/failed/${txnid}`);
  }
});

router.post("/failed/verify/:txnid", async (req, res) => {
  const { txnid } = req.params;
  console.log("❌ Payment failed callback received");
  return res.redirect(`${FRONTEND_BASE_URL}/payment/failed/${txnid}`);
});


router.get("/details/:txnid", async (req, res) => {
  const { txnid } = req.params;

  try {
    // Step 1: Fetch booking by txnid or id
    const numericId = isNaN(Number(txnid)) ? -1 : Number(txnid);
    const [bookings] = await pool.execute(
      `SELECT guest_email, id, guest_name, guest_phone, rooms, adults, children, food_veg, food_nonveg,
              food_jain, check_in, check_out, total_amount, advance_amount, accommodation_id, coupon_code, discount_amount, full_amount, meal_plan, meal_plan_price, notes, activities_total
       FROM bookings 
       WHERE payment_txn_id = ? OR id = ?`,
      [txnid, numericId]
    );

    if (bookings.length === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }

    const booking = bookings[0];

    // Step 2: Fetch accommodation details

    const [accommodations] = await pool.execute(
      `SELECT name, address, latitude, longitude ,owner_id,type FROM accommodations WHERE id = ?`,

      [booking.accommodation_id]
    );

    const accommodation = accommodations[0] || {};

    const owner_id = accommodation.owner_id;

    const [user] = await pool.execute(`SELECT email , phoneNumber, name  FROM users WHERE id = ?`, [
      owner_id,
    ]);

    const ownerEmail = user[0].email;
    const ownerPhone = user[0].phoneNumber;
    const ownerName = user[0].name;

    const today = new Date();

    const day = String(today.getDate()).padStart(2, "0");

    const month = String(today.getMonth() + 1).padStart(2, "0"); // Months are zero-based

    const year = today.getFullYear();

    const bookedDate = `${year}-${month}-${day}`;

    // Step 3: Combine and return

    return res.json({
      booking,
      accommodation,
      ownerEmail,
      ownerPhone,
      ownerName,
      bookedDate,
    });
  } catch (err) {
    console.error("Error fetching booking details:", err);

    return res.status(500).json({ message: "Internal server error" });
  }
});

// PUT /admin/bookings/:id/status - Manually update payment status

router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;

    const { payment_status } = req.body;

    if (!payment_status) {
      return res
        .status(400)
        .json({ success: false, error: "Payment status is required" });
    }

    const validStatuses = ["pending", "success", "failed", "expired", "partial", "cancelled", "paid"];

    if (!validStatuses.includes(payment_status)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid payment status" });
    }

    const [result] = await pool.execute(
      "UPDATE bookings SET payment_status = ? WHERE id = ?",
      [payment_status, id]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Booking not found" });
    }

    res.json({ success: true, message: "Payment status updated" });
  } catch (error) {
    console.error("Error updating payment status:", error);

    res
      .status(500)
      .json({ success: false, error: "Failed to update payment status" });
  }
});

// PUT & POST /admin/bookings/:id or /admin/bookings/edit/:id - Full Booking Edit & Reschedule
const handleBookingUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      guest_name,
      guest_email,
      guest_phone,
      check_in,
      check_out,
      accommodation_id,
      adults,
      children,
      rooms,
      food_veg,
      food_nonveg,
      food_jain,
      total_amount,
      advance_amount,
      payment_status,
      special_requests,
      meal_plan,
    } = req.body;

    const [existing] = await pool.execute("SELECT * FROM bookings WHERE id = ?", [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: "Booking not found" });
    }

    const current = existing[0];

    const updatedGuestName = guest_name !== undefined ? guest_name : current.guest_name;
    const updatedEmail = guest_email !== undefined ? guest_email : current.guest_email;
    const updatedPhone = guest_phone !== undefined ? guest_phone : current.guest_phone;
    const updatedCheckIn = check_in !== undefined ? check_in : current.check_in;
    const updatedCheckOut = check_out !== undefined ? check_out : current.check_out;
    const updatedAccId = accommodation_id !== undefined ? accommodation_id : current.accommodation_id;
    const updatedAdults = adults !== undefined ? parseInt(adults, 10) : current.adults;
    const updatedChildren = children !== undefined ? parseInt(children, 10) : current.children;
    const updatedRooms = rooms !== undefined ? parseInt(rooms, 10) : current.rooms;
    const updatedVeg = food_veg !== undefined ? parseInt(food_veg, 10) : current.food_veg;
    const updatedNonVeg = food_nonveg !== undefined ? parseInt(food_nonveg, 10) : current.food_nonveg;
    const updatedJain = food_jain !== undefined ? parseInt(food_jain, 10) : current.food_jain;
    const updatedTotal = total_amount !== undefined ? parseFloat(total_amount) : current.total_amount;
    const updatedAdvance = advance_amount !== undefined ? parseFloat(advance_amount) : current.advance_amount;
    const updatedPaymentStatus = payment_status !== undefined ? payment_status : current.payment_status;

    await pool.execute(
      `UPDATE bookings SET 
        guest_name = ?,
        guest_email = ?,
        guest_phone = ?,
        check_in = ?,
        check_out = ?,
        accommodation_id = ?,
        adults = ?,
        children = ?,
        rooms = ?,
        food_veg = ?,
        food_nonveg = ?,
        food_jain = ?,
        total_amount = ?,
        advance_amount = ?,
        payment_status = ?
      WHERE id = ?`,
      [
        updatedGuestName,
        updatedEmail,
        updatedPhone,
        updatedCheckIn,
        updatedCheckOut,
        updatedAccId,
        updatedAdults,
        updatedChildren,
        updatedRooms,
        updatedVeg,
        updatedNonVeg,
        updatedJain,
        updatedTotal,
        updatedAdvance,
        updatedPaymentStatus,
        id,
      ]
    );

    // Update optional columns if they exist in schema
    if (meal_plan !== undefined) {
      try {
        await pool.execute("UPDATE bookings SET meal_plan = ? WHERE id = ?", [meal_plan, id]);
      } catch (_) {}
    }
    if (req.body.meal_plan_price !== undefined) {
      try {
        await pool.execute("UPDATE bookings SET meal_plan_price = ? WHERE id = ?", [parseFloat(req.body.meal_plan_price) || 0, id]);
      } catch (_) {}
    }
    if (req.body.notes !== undefined) {
      try {
        await pool.execute("UPDATE bookings SET notes = ? WHERE id = ?", [req.body.notes, id]);
      } catch (_) {}
    }
    if (req.body.activities_total !== undefined) {
      try {
        await pool.execute("UPDATE bookings SET activities_total = ? WHERE id = ?", [parseFloat(req.body.activities_total) || 0, id]);
      } catch (_) {}
    }
    if (req.body.activities !== undefined) {
      try {
        const actStr = typeof req.body.activities === 'string' ? req.body.activities : JSON.stringify(req.body.activities);
        await pool.execute("UPDATE bookings SET activities = ? WHERE id = ?", [actStr, id]);
      } catch (_) {}
    }
    if (special_requests !== undefined) {
      try {
        await pool.execute("UPDATE bookings SET special_requests = ? WHERE id = ?", [special_requests, id]);
      } catch (_) {}
    }

    res.json({
      success: true,
      message: "Booking updated successfully",
      data: {
        id,
        guest_name: updatedGuestName,
        check_in: updatedCheckIn,
        check_out: updatedCheckOut,
      },
    });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ success: false, error: "Failed to update booking", details: error.message });
  }
};

// POST /admin/bookings/send-whatsapp-invoice - Dispatch invoice from Official WhatsApp Desk
router.post("/send-whatsapp-invoice", async (req, res) => {
  try {
    const {
      phone,
      booking_id,
      guest_name,
      invoice_message,
      invoice_data
    } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Recipient phone number is required"
      });
    }

    const cleanPhone = String(phone).replace(/\D/g, "");
    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const officialSender = "+91 92268 69678";

    const whatsappToken =
      process.env.WHATSAPP_API_TOKEN ||
      "EAAORWaKV1OgBSTitPXxaY9aFZBSZAKHHOB5q1rmZCuWeEZAqYWZBEPCef8tOrptU2m9sox1IXBGJ0cDb9UZCkMKklWls08NkWl1sIelF1LpTkXaZAU2jtEZC2x5P0klo0v3R1rCW3OZBDGZBHy5wVPHONHgXs6xDlojFQpY1PE16iIC4r36gkUU15OZC1DGY29FRnuipqG5cwpcZBIZBbVPot2pxu1DZASaReeZA6MctbMPESPTTvkTTrzLcHFYSs0avJZBgqKusBfm5kT0pHkT7bNAVHy2F";
    const phoneNumberId =
      process.env.WHATSAPP_PHONE_NUMBER_ID ||
      req.body.phone_number_id ||
      "1328211520368254";

    let metaApiResponse = null;

    // If WhatsApp Cloud API / Meta Graph API credentials are configured
    if (whatsappToken && phoneNumberId) {
      try {
        const metaRes = await fetch(
          `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${whatsappToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: formattedPhone,
              type: "text",
              text: { preview_url: true, body: invoice_message }
            })
          }
        );
        metaApiResponse = await metaRes.json();
        console.log(`[Meta Cloud API] Message dispatched to +${formattedPhone}:`, metaApiResponse);
      } catch (metaErr) {
        console.error("Meta WhatsApp Cloud API error:", metaErr.message);
        metaApiResponse = { error: metaErr.message };
      }
    }

    console.log(`[Official WhatsApp Invoice] Dispatched for Booking #${booking_id || 'N/A'} to +${formattedPhone} from Official Desk (${officialSender})`);

    res.json({
      success: true,
      message: `Invoice successfully dispatched to +${formattedPhone} from official number ${officialSender}`,
      official_number: officialSender,
      recipient: formattedPhone,
      booking_id,
      meta_api: metaApiResponse
    });
  } catch (error) {
    console.error("Error dispatching WhatsApp invoice:", error);
    res.status(500).json({
      success: false,
      error: "Failed to dispatch WhatsApp invoice",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

router.put(["/:id", "/edit/:id", "/update/:id"], handleBookingUpdate);
router.post(["/:id", "/edit/:id", "/update/:id"], handleBookingUpdate);

// GET /admin/bookings/room-occupancy - Get total rooms booked for a specific date (Only confirmed/paid bookings allocate rooms)
router.get("/room-occupancy", async (req, res) => {
  try {
    const { check_in, id } = req.query;

    if (!check_in || !/^\d{4}-\d{2}-\d{2}$/.test(check_in)) {
      return res.status(400).json({
        success: false,
        error: "Valid check_in date (YYYY-MM-DD) is required",
      });
    }

    // Do NOT allocate rooms if payment is pending, failed, expired, or cancelled
    const [result] = await pool.execute(
      `SELECT COALESCE(SUM(rooms), 0) AS total_rooms
       FROM bookings
       WHERE LOWER(payment_status) IN ('success', 'paid', 'partial', 'confirmed')
         AND DATE(check_in) <= ?
         AND DATE(check_out) > ?
         AND accommodation_id = ?`,
      [check_in, check_in, id]
    );

    res.json({
      success: true,
      date: check_in,
      total_rooms: result[0]?.total_rooms || 0,
    });
  } catch (error) {
    console.error("Error fetching room occupancy:", error);

    res.status(500).json({
      success: false,
      error: "Failed to fetch room occupancy data",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

module.exports = router;


