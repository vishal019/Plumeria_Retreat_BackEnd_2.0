const PayU = require("payu-websdk");
const dotenv = require('dotenv');
dotenv.config();

const payu_key = process.env.PAYU_MERCHANT_KEY;
const payu_salt = process.env.PAYU_MERCHANT_SALT;

const payuClient = new PayU({ key: payu_key, salt: payu_salt });

module.exports = {
  payuClient,  // Export the client instance directly
  payu_key,
  payu_salt
};