const path = require('path');
require('dotenv').config({
    path: path.resolve(__dirname, '.env')
});

const getEnvNumber = (name, defaultValue) => {
    const raw = process.env[name];
    if (!raw) return defaultValue;
    const n = Number(raw);
    return Number.isFinite(n) ? n : defaultValue;
};

module.exports = {
    port: getEnvNumber('PORT', 3000),
    maxRoomUsers: getEnvNumber('MAX_ROOM_USERS', 10),
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '*')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
};
