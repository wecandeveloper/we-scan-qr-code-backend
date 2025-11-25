const express = require('express');
const router = express.Router();

const restaurantCtlr = require('../controllers/restaurant.controller')
const { authenticateUser, authorizeUser } = require('../middlewares/auth');
const setupRoutes = require('./route.util');
const { checkSchema } = require('express-validator');
const restaurantValidationSchema = require('../validators/restaurant.validator');
const upload = require('../services/unifiedUploader/unified.multer');

const routes = [
    {
        method: 'post',
        path: '/create',
        middlewares: [
            upload.fields([
                { name: "images", maxCount: 10 },
                { name: "logo", maxCount: 1 },
                { name: "favIcon", maxCount: 1 },
                { name: "bannerImages", maxCount: 5 },
                { name: "offerBannerImages", maxCount: 5 },
            ]),
            checkSchema(restaurantValidationSchema),
            authenticateUser, 
            authorizeUser(['restaurantAdmin'])
        ],
        handler: restaurantCtlr.create,
    },
    {
        method: 'get',
        path: '/list',
        middlewares: [
            // authenticateUser, 
            // authorizeUser(['superAdmin'])
        ],
        handler: restaurantCtlr.list,
    },
    {
        method: 'get',
        path: '/show/:restaurantSlug',
        middlewares: [],
        handler: restaurantCtlr.show,
    },
    {
        method: 'get',
        path: '/myRestaurant',
        middlewares: [
            authenticateUser,
            authorizeUser(['restaurantAdmin'])
        ],
        handler: restaurantCtlr.myRestaurant,
    },
    {
        method: 'get',
        path: '/listByCity',
        middlewares: [
            // authenticateUser, 
            // authorizeUser(['superAdmin'])
        ],
        handler: restaurantCtlr.listByCity,
    },
    {
        method: 'get',
        path: '/listNearBy',
        middlewares: [
            // authenticateUser, 
            // authorizeUser(['superAdmin'])
        ],
        handler: restaurantCtlr.listNearby,
    },
    {
        method: 'put',
        path: '/update/:restaurantId',
        middlewares: [
            upload.fields([
                { name: "images", maxCount: 10 },
                { name: "logo", maxCount: 1 },
                { name: "bannerImages", maxCount: 5 },
                { name: "offerBannerImages", maxCount: 5 },
                { name: "favIcon", maxCount: 1 },
            ]),
            authenticateUser, 
            authorizeUser(['superAdmin', 'restaurantAdmin']),
        ],
        handler: restaurantCtlr.update,
    },
    {
        method: 'put',
        path: '/:restaurantId/approve',
        middlewares: [
            authenticateUser, 
            authorizeUser(['superAdmin']),
        ],
        handler: restaurantCtlr.approveRestaurant,
    },
    {
        method: 'put',
        path: '/:restaurantId/block',
        middlewares: [
            authenticateUser, 
            authorizeUser(['superAdmin']),
        ],
        handler: restaurantCtlr.blockRestaurant,
    },
    {
        method: 'delete',
        path: '/delete/:restaurantId',
        middlewares: [
            authenticateUser, 
            authorizeUser(['superAdmin', 'restaurantAdmin']),
        ],
        handler: restaurantCtlr.delete,
    },
    {
        method: 'put',
        path: '/update-subscription',
        middlewares: [
            authenticateUser,
            authorizeUser(['superAdmin'])
        ],
        handler: restaurantCtlr.updateSubscription,
    },
    {
        method: 'post',
        path: '/:restaurantId/test-payment-connection',
        middlewares: [
            authenticateUser,
            authorizeUser(['restaurantAdmin'])
        ],
        handler: restaurantCtlr.testPaymentConnection,
    },
]

setupRoutes(router, routes);
module.exports = router;