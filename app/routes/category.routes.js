const express = require('express');
const router = express.Router();

const categoryCtlr = require('../controllers/category.controller')
const { authenticateUser, authorizeUser } = require('../middlewares/auth');
const setupRoutes = require('./route.util');
const { checkSchema } = require('express-validator');
const categoryValidationSchema = require('../validators/category.validator');
const upload = require('../services/unifiedUploader/unified.multer');

const routes = [
    {
        method: 'post',
        path: '/create',
        middlewares: [
            upload.single('image'), 
            checkSchema(categoryValidationSchema), 
            authenticateUser,
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: categoryCtlr.create,
    },
    {
        method: 'get',
        path: '/listAll',
        middlewares: [
            authenticateUser,
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: categoryCtlr.listAll,
    },
    // {
    //     method: 'get',
    //     path: '/listByRestaurantForAdmin',
    //     middlewares: [
    //         authenticateUser,
    //         authorizeUser(['restaurantAdmin'])
    //     ],
    //     handler: categoryCtlr.listByRestaurantForAdmin,
    // },
    {
        method: 'get',
        path: '/listByRestaurant/:restaurantSlug',
        middlewares: [],
        handler: categoryCtlr.listByRestaurant,
    },
    {
        method: 'get',
        path: '/show/:categoryId',
        middlewares: [],
        handler: categoryCtlr.show,
    },
    {
        method: 'put',
        path: '/update/:categoryId',
        middlewares: [
            upload.single('image'), 
            authenticateUser, 
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: categoryCtlr.update,
    },
    {
        method: 'delete',
        path: '/delete/:categoryId',
        middlewares: [
            authenticateUser, 
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: categoryCtlr.delete,
    },
    {
        method: 'delete',
        path: '/bulk-delete',
        middlewares: [
            authenticateUser, 
            authorizeUser(['superAdmin', 'restaurantAdmin'])
        ],
        handler: categoryCtlr.bulkDelete,
    },
]

setupRoutes(router, routes);
module.exports = router;  // Export the router to use in the main app.js file.