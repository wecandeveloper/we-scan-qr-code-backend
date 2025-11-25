const express = require('express');
const router = express.Router();

const commonAddOnCtlr = require('../controllers/commonAddOn.controller');
const { authenticateUser, authorizeUser } = require('../middlewares/auth');
const setupRoutes = require('./route.util');

const routes = [
    {
        method: 'post',
        path: '/create',
        middlewares: [
            authenticateUser,
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: commonAddOnCtlr.create,
    },
    {
        method: 'get',
        path: '/list',
        middlewares: [
            authenticateUser,
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: commonAddOnCtlr.list,
    },
    {
        method: 'get',
        path: '/listAvailable',
        middlewares: [], // Public endpoint for frontend
        handler: commonAddOnCtlr.listAvailable,
    },
    {
        method: 'get',
        path: '/show/:commonAddOnId',
        middlewares: [
            authenticateUser,
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: commonAddOnCtlr.show,
    },
    {
        method: 'put',
        path: '/update/:commonAddOnId',
        middlewares: [
            authenticateUser,
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: commonAddOnCtlr.update,
    },
    {
        method: 'delete',
        path: '/delete/:commonAddOnId',
        middlewares: [
            authenticateUser,
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: commonAddOnCtlr.delete,
    },
    {
        method: 'delete',
        path: '/bulk-delete',
        middlewares: [
            authenticateUser,
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: commonAddOnCtlr.bulkDelete,
    },
];

setupRoutes(router, routes);
module.exports = router;

