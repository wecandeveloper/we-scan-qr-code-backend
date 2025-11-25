const express = require('express');
const router = express.Router();
const setupRoutes = require('./route.util');
const paymobCtlr = require('../controllers/payment.paymob.controller');

const routes = [
    // Guest-based payment intention creation (no auth required)
    {
        method: 'post',
        path: '/create-intention',
        middlewares: [], // No auth for guest orders
        handler: paymobCtlr.createPaymentIntention,
    },
    // Handle Paymob payment success callback (no auth required - called by Paymob redirect)
    {
        method: 'get',
        path: '/success',
        middlewares: [], // No auth - public callback
        handler: paymobCtlr.handlePaymentSuccess,
    },
    // Handle Paymob payment failure callback (no auth required)
    {
        method: 'get',
        path: '/failure',
        middlewares: [], // No auth - public callback
        handler: paymobCtlr.handlePaymentFailure,
    },
    // Paymob webhook endpoint (no auth - uses HMAC verification)
    {
        method: 'post',
        path: '/webhook',
        middlewares: [], // HMAC verification in handler
        handler: paymobCtlr.handleWebhook,
    },
];

setupRoutes(router, routes);
module.exports = router;

