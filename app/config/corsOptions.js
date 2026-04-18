/**
 * CORS configuration for the REST API.
 * Browsers send `Origin: <frontend>` (e.g. http://localhost:3030), not the API host.
 */
function buildAllowedOriginSet() {
    const fromEnv = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const defaults = [
        'http://localhost:3000',
        'http://localhost:3010',
        'http://localhost:3030',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3010',
        'http://127.0.0.1:3030',
        'http://127.0.0.1:5173',
        'https://dineos.ae',
        'https://www.dineos.ae'
    ];
    if (process.env.FRONTEND_URL) {
        defaults.push(process.env.FRONTEND_URL.replace(/\/$/, ''));
    }
    return new Set([...defaults, ...fromEnv]);
}

function corsOriginCallback(origin, callback) {
    if (!origin) {
        return callback(null, true);
    }
    const allowed = buildAllowedOriginSet();
    if (allowed.has(origin)) {
        return callback(null, origin);
    }
    if (/^http:\/\/localhost:\d+$/.test(origin)) {
        return callback(null, origin);
    }
    if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
        return callback(null, origin);
    }
    if (/^https:\/\/[a-z0-9-]+\.ngrok-free\.app$/i.test(origin)) {
        return callback(null, origin);
    }
    if (/^https:\/\/[a-z0-9-]+\.ngrok-free\.dev$/i.test(origin)) {
        return callback(null, origin);
    }
    if (/^https:\/\/[a-z0-9-]+\.ngrok\.io$/i.test(origin)) {
        return callback(null, origin);
    }
    if (/^https:\/\/[a-z0-9-]+\.ngrok\.app$/i.test(origin)) {
        return callback(null, origin);
    }
    console.warn('[cors] Blocked Origin:', origin);
    return callback(null, false);
}

const corsOptions = {
    origin: corsOriginCallback,
    // JWT is sent via `Authorization` header (not cookies); keep false unless you add cookie auth.
    credentials: false,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'X-Requested-With',
        'ngrok-skip-browser-warning'
    ],
    exposedHeaders: ['Content-Length'],
    optionsSuccessStatus: 204,
    maxAge: 86400
};

module.exports = { corsOptions, corsOriginCallback };
