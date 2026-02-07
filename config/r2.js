/* src/config/r2.js */
require('dotenv').config();
const { S3Client } = require("@aws-sdk/client-s3");

// 1. Initialize the Client
// Note: We use "auto" for region because R2 handles it automatically.
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

module.exports = r2;