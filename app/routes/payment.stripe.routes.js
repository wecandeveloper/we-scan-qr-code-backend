const express = require('express');
const router = express.Router();
const setupRoutes = require('./route.util');
const stripeCtlr = require('../controllers/payment.stripe.controller');

const routes = [
    // Guest-based payment session creation (no auth required)
    {
        method: 'post',
        path: '/create-session',
        middlewares: [], // No auth for guest orders
        handler: stripeCtlr.createPaymentSession,
    },
    // Get session details (no auth required for guest)
    {
        method: 'get',
        path: '/session/:sessionID',
        middlewares: [], // No auth for guest orders
        handler: stripeCtlr.getSession,
    },
    // Handle payment success callback (no auth required - called by Stripe redirect)
    {
        method: 'get',
        path: '/success/:sessionID',
        middlewares: [], // No auth - public callback
        handler: stripeCtlr.handlePaymentSuccess,
    },
    // Handle payment failure callback (no auth required)
    {
        method: 'get',
        path: '/failure/:sessionID',
        middlewares: [], // No auth - public callback
        handler: stripeCtlr.handlePaymentFailure,
    },
    // Stripe webhook endpoint (no auth - uses webhook signature verification)
    {
        method: 'post',
        path: '/webhook',
        middlewares: [], // Webhook signature verification in handler
        handler: stripeCtlr.handleWebhook,
    },
];

setupRoutes(router, routes);
module.exports = router;

