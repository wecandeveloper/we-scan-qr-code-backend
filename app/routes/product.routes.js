const express = require('express');
const router = express.Router();

const productCtlr = require('../controllers/product.controller')
const { authenticateUser, authorizeUser } = require('../middlewares/auth');
const setupRoutes = require('./route.util');
const { checkSchema } = require('express-validator');
// const categoryValidationSchema = require('../validators/product.validator');
const upload = require('../services/unifiedUploader/unified.multer');
const productValidationSchema = require('../validators/product.validator');

const routes = [
    {
        method: 'post',
        path: '/create',
        middlewares: [
            upload.array('images'),
            checkSchema(productValidationSchema),
            authenticateUser, 
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: productCtlr.create,
    },
    {
        method: 'get',
        path: '/list',
        middlewares: [],
        handler: productCtlr.list,
    },
    // {
    //     method: 'get',
    //     path: '/listByRestaurantForAdmin',
    //     middlewares: [
    //         authenticateUser,
    //         authorizeUser(['superAdmin', 'restaurantAdmin'])
    //     ],
    //     handler: productCtlr.listByRestaurantForAdmin,
    // },
    {
        method: 'get',
        path: '/listByRestaurant/:restaurantSlug',
        middlewares: [],
        handler: productCtlr.listByRestaurant,
    },
    {
        method: 'get',
        path: '/listByCategory/:categoryId',
        middlewares: [],
        handler: productCtlr.listByCategory,
    },
    {
        method: 'get',
        path: '/show/:productId',
        middlewares: [],
        handler: productCtlr.show,
    },
    {
        method: 'put',
        path: '/update/:productId',
        middlewares: [
            upload.array('images'),
            authenticateUser, 
            authorizeUser(['restaurantAdmin'])
        ],
        handler: productCtlr.update,
    },
    {
        method: 'delete',
        path: '/delete/:productId',
        middlewares: [
            authenticateUser, 
            authorizeUser(['superAdmin', 'restaurantAdmin'])],
        handler: productCtlr.delete,
    },
    {
        method: 'delete',
        path: '/bulk-delete',
        middlewares: [
            authenticateUser, 
            authorizeUser(['superAdmin', 'restaurantAdmin'])],
        handler: productCtlr.bulkDelete,
    },
]

setupRoutes(router, routes);
module.exports = router; 