// Vercel serverless entry point
// All requests are routed here by vercel.json
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const app = require('../server/server');

module.exports = app;

