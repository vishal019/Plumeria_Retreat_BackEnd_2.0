const Razorpay = require("razorpay");
const dotenv = require("dotenv");
dotenv.config();

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY || "rzp_test_placeholder";
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || "placeholder_secret";

const razorpayInstance = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: razorpayKeySecret,
});

module.exports = {
  razorpayInstance,
  razorpayKeyId,
  razorpayKeySecret,
};
