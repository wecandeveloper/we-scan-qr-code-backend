const express = require('express');
const router = express.Router();

const refundPaymobCtlr = require('../controllers/refund.paymob.controller')
const { authenticateUser, authorizeUser } = require('../middlewares/auth');
const setupRoutes = require('./route.util');
const { checkSchema } = require('express-validator');
const refundPaymobValidationSchema = require('../validators/refund.paymob.validator');

const routes = [
    {
        method: 'post',
        path: '/create/:orderId',
        middlewares: [
            authenticateUser,
            authorizeUser(['customer']),
            checkSchema(refundPaymobValidationSchema.create)
        ],
        handler: refundPaymobCtlr.create,
    },
    {
        method: 'get',
        path: '/myRefunds',
        middlewares: [
            authenticateUser,
            authorizeUser(['customer'])
        ],
        handler: refundPaymobCtlr.getMyRefunds,
    },
    {
        method: 'get',
        path: '/show/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['customer', 'storeAdmin', 'superAdmin'])
        ],
        handler: refundPaymobCtlr.show,
    },
    {
        method: 'get',
        path: '/list',
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin'])
        ],
        handler: refundPaymobCtlr.listRefunds,
    },
    {
        method: 'put',
        path: '/process/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin']),
            checkSchema(refundPaymobValidationSchema.process)
        ],
        handler: refundPaymobCtlr.processRefund,
    },
    {
        method: 'put',
        path: '/initiate-payment/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin']),
            checkSchema(refundPaymobValidationSchema.initiatePayment)
        ],
        handler: refundPaymobCtlr.initiatePayment,
    },
    {
        method: 'put',
        path: '/add-bank-details/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['customer']),
            checkSchema(refundPaymobValidationSchema.addBankDetails)
        ],
        handler: refundPaymobCtlr.addBankDetails,
    },
    {
        method: 'put',
        path: '/complete/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin']),
            checkSchema(refundPaymobValidationSchema.complete)
        ],
        handler: refundPaymobCtlr.completeRefund,
    },
    {
        method: 'put',
        path: '/cancel/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin']),
            checkSchema(refundPaymobValidationSchema.cancel)
        ],
        handler: refundPaymobCtlr.cancelRefund,
    },
    {
        method: 'delete',
        path: '/delete/:refundId',
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin'])
        ],
        handler: refundPaymobCtlr.deleteRefund,
    },
    {
        method: 'post',
        path: '/bulk-delete',
        middlewares: [authenticateUser, authorizeUser(['superAdmin'])],
        handler: refundPaymobCtlr.bulkDeleteRefunds,
    },
]

setupRoutes(router, routes);
module.exports = router;
