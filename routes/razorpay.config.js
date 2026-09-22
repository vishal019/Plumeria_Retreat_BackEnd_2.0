const dotenv = require("dotenv");
dotenv.config();

let Razorpay = null;
try {
  Razorpay = require("razorpay");
} catch (err) {
  console.warn("⚠️ Razorpay module not found. Run 'npm install razorpay' on the server.");
}

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY || "rzp_test_placeholder";
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || "placeholder_secret";

let razorpayInstance = null;
if (Razorpay) {
  try {
    razorpayInstance = new Razorpay({
      key_id: razorpayKeyId,
      key_secret: razorpayKeySecret,
    });
  } catch (e) {
    console.error("Error initializing Razorpay instance:", e.message);
  }
} else {
  razorpayInstance = {
    orders: {
      create: async () => {
        throw new Error("Razorpay package is not installed on the server. Please run 'npm install razorpay'");
      }
    }
  };
}

module.exports = {
  razorpayInstance,
  razorpayKeyId,
  razorpayKeySecret,
};
