require('dotenv').config();
const express = require('express');
const cors = require('cors');
const configureDB = require('./app/config/db');
const { corsOptions } = require('./app/config/corsOptions');
const router = require('./app/routes/common.routes');
const v2Router = require('./app/routes/v2/v2.routes');
const commonController = require('./app/controllers/common.controller');
const saasSubscriptionV2 = require('./app/controllers/v2/saasSubscription.v2.controller');
const { handleStripeWebhook } = require('./app/controllers/v2/saasWebhook.v2.controller');
const app = express();
const PORT = 5030;
const http = require('http');
const { Server } = require('socket.io');
const socketService = require('./app/services/socketService/socketService');

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

async function start() {
    await configureDB();

    socketService.initSocket(io);

    app.use(cors(corsOptions));

    // Stripe webhooks require raw body for signature verification
    app.use('/api/payment/stripe/webhook', express.raw({ type: 'application/json' }));
    app.post('/api/v2/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
    // All other routes use JSON
    app.use(express.json());

    app.use('/api', router);
    // Public SaaS signup (aliases on /api/* so proxies that only forward /api work; same handlers as v2)
    app.post(
        '/api/subscriptions/guest-checkout',
        commonController(saasSubscriptionV2.createGuestCheckout)
    );
    app.post(
        '/api/subscriptions/complete-guest',
        commonController(saasSubscriptionV2.completeGuestSignup)
    );
    app.post(
        '/api/subscriptions/check-signup-email',
        commonController(saasSubscriptionV2.checkSignupEmail)
    );
    app.post(
        '/api/subscriptions/guest-send-email-otp',
        commonController(saasSubscriptionV2.sendGuestSignupEmailOtp)
    );
    app.post(
        '/api/subscriptions/guest-verify-email-otp',
        commonController(saasSubscriptionV2.verifyGuestSignupEmailOtp)
    );
    app.use('/api/v2', v2Router);

    app.get('/', (req, res) => {
        res.send('API Running');
    });

    app.use('/health', (req, res) => {
        res.status(200).send('Welcome to Backend of Dine-OS Application');
    });

    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
