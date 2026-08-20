// utils/safeParse.js
function safeParse(value, fallback = null) {
  try {
    if (typeof value === 'string') {
      return JSON.parse(value);
    }
    return value;
  } catch (err) {
    console.warn('JSON parse error:', err.message, 'Data:', value);
    return fallback;
  }
}

module.exports = safeParse;
