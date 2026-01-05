const express = require('express');
const router = express.Router();

const refundCtlr = require('../controllers/refund.stripe.controller')
const { authenticateUser, authorizeUser } = require('../middlewares/auth');
const setupRoutes = require('./route.util');
const { checkSchema } = require('express-validator');
const refundStripeValidationSchema = require('../validators/refund.stripe.validator');

const routes = [
    {
        method: 'post',
        path: '/create/:orderId',
        middlewares: [
            authenticateUser,
            authorizeUser(['customer']),
            checkSchema(refundStripeValidationSchema.create)
        ],
        handler: refundCtlr.create,
    },
    {
        method: 'get',
        path: '/myRefunds',
        middlewares: [
            authenticateUser,
            authorizeUser(['customer'])
        ],
        handler: refundCtlr.getMyRefunds,
    },
    {
        method: 'get',
        path: '/show/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['customer', 'storeAdmin', 'superAdmin'])
        ],
        handler: refundCtlr.show,
    },
    {
        method: 'get',
        path: '/list',
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin'])
        ],
        handler: refundCtlr.listRefunds,
    },
    {
        method: 'put',
        path: '/process/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin']),
            checkSchema(refundStripeValidationSchema.process)
        ],
        handler: refundCtlr.processRefund,
    },
    {
        method: 'put',
        path: '/complete/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin']),
            checkSchema(refundStripeValidationSchema.complete)
        ],
        handler: refundCtlr.completeRefund,
    },
    {
        method: 'put',
        path: '/cancel/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin']),
            checkSchema(refundStripeValidationSchema.cancel)
        ],
        handler: refundCtlr.cancelRefund,
    },
    {
        method: 'delete',
        path: '/delete/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin'])
        ],
        handler: refundCtlr.deleteRefund,
    },
]

setupRoutes(router, routes);
module.exports = router;
