const express = require('express');
const router = express.Router();

const { authenticateUser, authorizeUser } = require('../middlewares/auth');
const setupRoutes = require('./route.util');

const paymentsCtlr = require('../controllers/payment.paymob.controller');

const routes = [
    {
        method: "post",
        path: "/",
        middlewares: [
            authenticateUser,
            authorizeUser(['customer'])
        ],
        handler: paymentsCtlr.payment
    },
    {
        method: "get",
        path: "/session/:sessionID",
        middlewares: [
            authenticateUser,
            authorizeUser(['customer'])
        ],
        handler: paymentsCtlr.getSession
    },
    {
        method: "post",
        path: "/session/success",
        middlewares: [
            authenticateUser,
            authorizeUser(['customer'])
        ],
        handler: paymentsCtlr.successUpdate
    },
    {
        method: "post",
        path: "/session/failed",
        middlewares: [
            authenticateUser,
            authorizeUser(['customer'])
        ],
        handler: paymentsCtlr.failedUpdate
    },
    {
        method: "get",
        path: "/history",
        middlewares: [
            authenticateUser,
            authorizeUser(['customer'])
        ],
        handler: paymentsCtlr.myHistory
    },
    {
        method: "get",
        path: "/allHistory",
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin'])
        ],
        handler: paymentsCtlr.list
    },
    {
        method: "get",
        path: "/allPaymentStoreHistory",
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin'])
        ],
        handler: paymentsCtlr.list
    },
    {
        method: "get",
        path: "/list/:paymentId",
        middlewares: [
            authenticateUser,
            authorizeUser(['customer', 'storeAdmin', 'superAdmin'])
        ],
        handler: paymentsCtlr.show
    },
    {
        method: "delete",
        path: "/delete/:paymentId",
        middlewares: [
            authenticateUser,
            authorizeUser(['storeAdmin', 'superAdmin'])
        ],
        handler: paymentsCtlr.delete
    },
    {
        method: 'post',
        path: '/bulk-delete',
        middlewares: [authenticateUser, authorizeUser(['superAdmin'])],
        handler: paymentsCtlr.bulkDeletePayments,
    },
]

setupRoutes(router, routes);
module.exports = router; 