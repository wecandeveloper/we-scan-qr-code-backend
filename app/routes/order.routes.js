const express = require('express');
const router = express.Router();

const orderCtlr = require('../controllers/order.controller')
const { authenticateUser, authorizeUser } = require('../middlewares/auth');
const setupRoutes = require('./route.util');
const { checkSchema } = require('express-validator');
const {changeOrderValidationShcema, orderValidationSchema, adminCancelValidationSchema} = require('../validators/order.validator');

const routes = [
    {
        method: 'post',
        path: '/create',
        middlewares: [
            checkSchema(orderValidationSchema)
        ],
        handler: orderCtlr.create,
    },
    {
        method: 'post',
        path: '/accept',
        middlewares: [
            authenticateUser,
            authorizeUser(['restaurantAdmin']),
        ],
        handler: orderCtlr.accept,
    },
    {
        method: 'post',
        path: '/decline',
        middlewares: [
            authenticateUser,
            authorizeUser(['restaurantAdmin']),
        ],
        handler: orderCtlr.decline,
    },
    {
        method: 'put',
        path: '/cancel/:guestId/:orderId',
        middlewares: [
            checkSchema(changeOrderValidationShcema)
        ],
        handler: orderCtlr.cancelOrder,
    },
    {
        method: 'put',
        path: '/changeStatus/:orderId',
        middlewares: [
            authenticateUser,
            authorizeUser(['restaurantAdmin']),
            checkSchema(changeOrderValidationShcema)
        ],
        handler: orderCtlr.changeStatus,
    },
    {
        method: 'get',
        path: '/list',
        middlewares: [],
        handler: orderCtlr.listAllOrders,
    },
    {
        method: 'get',
        path: '/listRestaurantOrders',
        middlewares: [
            authenticateUser,
            authorizeUser(['restaurantAdmin'])
        ],
        handler: orderCtlr.listRestaurantOrders,
    },
    {
        method: 'get',
        path: '/myOrders/:guestId',
        middlewares: [],
        handler: orderCtlr.getMyOrders,
    },
    {
        method: 'get',
        path: '/myRestaurantOrders/:guestId/:restaurantId',
        middlewares: [],
        handler: orderCtlr.getMyRestaurantOrders,
    },
    {
        method: 'delete',
        path: '/myRestaurantOrders/previous/:guestId/:restaurantId',
        middlewares: [],
        handler: orderCtlr.deletePreviousMyRestaurantOrders,
    },
    {
        method: 'get',
        path: '/show/:orderId',
        middlewares: [],
        handler: orderCtlr.show,
    },
    {
        method: 'delete',
        path: '/delete/:orderId',
        middlewares: [
            authenticateUser,
            authorizeUser(['restaurantAdmin'])
        ],
        handler: orderCtlr.delete,
    },
    {
        method: 'delete',
        path: '/bulk-delete',
        middlewares: [
            authenticateUser,
            authorizeUser(['restaurantAdmin'])
        ],
        handler: orderCtlr.bulkDelete,
    },
]

setupRoutes(router, routes);
module.exports = router; 