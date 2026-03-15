require('dotenv').config();
const { createClient } = require("@libsql/client");

const turso = createClient({
    url: process.env.TURSO_DATABASE_URL, // libsql://eporia-music-database-eporia.aws-us-east-2.turso.io
    authToken: process.env.TURSO_AUTH_TOKEN
});

module.exports = turso;