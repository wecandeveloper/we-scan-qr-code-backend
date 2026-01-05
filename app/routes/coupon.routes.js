const express = require('express')
const router = express.Router()

const couponCtlr = require('../controllers/coupon.controller')
const {authenticateUser, authorizeUser } = require('../middlewares/auth')
const setupRoutes = require('./route.util');
const { checkSchema } = require('express-validator');
const couponValidationSchema = require('../validators/coupon.validator')

const routes = [
    {
        method: 'post',
        path: '/create',
        middlewares: [
            // checkSchema(couponValidationSchema),
            authenticateUser, 
            authorizeUser(['superAdmin', 'storeAdmin'])
        ],
        handler: couponCtlr.create,
    },
    {
        method: 'get',
        path: '/list',
        middlewares: [],
        handler: couponCtlr.list,
    },
        {
        method: 'get',
        path: '/show/:couponId',
        middlewares: [
            authenticateUser, 
            authorizeUser(['superAdmin', 'storeAdmin'])
        ],
        handler: couponCtlr.show,
    },
    {
        method: 'put',
        path: '/update/:couponId',
        middlewares: [
            authenticateUser, 
            authorizeUser(['superAdmin', 'storeAdmin'])
        ],
        handler: couponCtlr.update,
    },
    {
        method: 'delete',
        path: '/delete/:couponId',
        middlewares: [
            authenticateUser, 
            authorizeUser(['superAdmin', 'storeAdmin'])
        ],
        handler: couponCtlr.delete,
    },
]

setupRoutes(router, routes);
module.exports = router; 