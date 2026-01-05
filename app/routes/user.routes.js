const express = require('express');
const router = express.Router();
const {
    registerValidationSchema,
    loginValidationSchema,
    updateUserValidationSchema
} = require('../validators/user.validator');
const userCtlr = require('../controllers/user.controller');
const { authenticateUser, authorizeUser } = require('../middlewares/auth');
const setupRoutes = require('./route.util'); // Import the utility
const { checkSchema } = require('express-validator');
const upload = require('../services/unifiedUploader/unified.multer');
// Define your routes in an array
const routes = [
    {
        method: 'post',
        path: '/register',
        middlewares: [
            upload.single('profilePic'),
            checkSchema(registerValidationSchema)
        ],
        handler: userCtlr.register
    },
    {
        method: 'post',
        path: '/login',
        middlewares: [checkSchema(loginValidationSchema)],
        handler: userCtlr.login
    },
    {
        method: 'get',
        path: '/account',
        middlewares: [authenticateUser, authorizeUser(["customer", "restaurantAdmin", "superAdmin"])],
        handler: userCtlr.account
    },
    {
        method: 'get',
        path: '/list',
        middlewares: [
            authenticateUser, 
            authorizeUser(["superAdmin"])
        ],
        handler: userCtlr.list
    },
    {
        method: 'put',
        path: '/update',
        middlewares: [
            upload.single('profilePic'),
            authenticateUser, 
            authorizeUser(["restaurantAdmin", "superAdmin"]), 
            checkSchema(updateUserValidationSchema),
        ],
        handler: userCtlr.updateUser
    },
    {
        method: 'delete',
        path: '/delete/:userId',
        middlewares: [
            authenticateUser, 
            authorizeUser(["superAdmin"]), 
        ],
        handler: userCtlr.delete
    },
    {
        method: 'put',
        path: '/toggleBlock/:userId',
        middlewares: [
            authenticateUser, 
            authorizeUser(["superAdmin"]), 
        ],
        handler: userCtlr.toggleBlockUser
    },
    {
        method: 'post',
        path: '/send-phone-otp',
        middlewares: [],
        handler: userCtlr.sendPhoneOtp
    },
    {
        method: 'post',
        path: '/verify-phone-otp',
        middlewares: [],
        handler: userCtlr.verifyPhoneOtp
    },
    {
        method: 'post',
        path: '/send-mail-otp',
        middlewares: [],
        handler: userCtlr.sendMailOtp
    },
    {
        method: 'post',
        path: '/verify-mail-otp',
        middlewares: [],
        handler: userCtlr.verifyMailOtp
    },
    {
        method: 'post',
        path: '/change-password',
        middlewares: [
            authenticateUser,
            authorizeUser(["customer", "restaurantAdmin", "superAdmin"]),
        ],
        handler: userCtlr.changePassword
    },
    {
        method: 'put',
        path: '/change-password-byAdmin/:userId',
        middlewares: [
            authenticateUser,
            authorizeUser(["superAdmin"]),
        ],
        handler: userCtlr.changePasswordByAdmin
    }
];

// Use the utility to set up the routes
setupRoutes(router, routes);

module.exports = router;