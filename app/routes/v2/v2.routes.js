const { Router } = require('express');
const setupRoutes = require('../route.util');
const { authenticateUser, authorizeUser } = require('../../middlewares/auth');

const saasSubscriptionCtlr = require('../../controllers/v2/saasSubscription.v2.controller');
const saasPaymentsCtlr = require('../../controllers/v2/saasPayments.v2.controller');
const saasCouponsCtlr = require('../../controllers/v2/saasCoupons.v2.controller');

const router = Router();

const subscriptionRoutes = [
    { method: 'get', path: '/plans', middlewares: [], handler: saasSubscriptionCtlr.getPlans },
    {
        method: 'post',
        path: '/checkout',
        middlewares: [authenticateUser, authorizeUser(['restaurantAdmin'])],
        handler: saasSubscriptionCtlr.createCheckout
    },
    {
        method: 'get',
        path: '/me',
        middlewares: [authenticateUser, authorizeUser(['restaurantAdmin'])],
        handler: saasSubscriptionCtlr.me
    },
    {
        method: 'post',
        path: '/portal',
        middlewares: [authenticateUser, authorizeUser(['restaurantAdmin'])],
        handler: saasSubscriptionCtlr.createPortalSession
    },
    {
        method: 'get',
        path: '/admin/list',
        middlewares: [authenticateUser, authorizeUser(['superAdmin'])],
        handler: saasSubscriptionCtlr.adminList
    },
    {
        method: 'post',
        path: '/admin/pause',
        middlewares: [authenticateUser, authorizeUser(['superAdmin'])],
        handler: saasSubscriptionCtlr.adminPause
    },
    {
        method: 'post',
        path: '/admin/resume',
        middlewares: [authenticateUser, authorizeUser(['superAdmin'])],
        handler: saasSubscriptionCtlr.adminResume
    },
    {
        method: 'put',
        path: '/admin/billing-override',
        middlewares: [authenticateUser, authorizeUser(['superAdmin'])],
        handler: saasSubscriptionCtlr.adminBillingOverride
    },
    {
        method: 'get',
        path: '/admin/invoices/:restaurantId',
        middlewares: [authenticateUser, authorizeUser(['superAdmin'])],
        handler: saasSubscriptionCtlr.adminInvoicesForRestaurant
    }
];

const paymentRoutes = [
    {
        method: 'get',
        path: '/invoices',
        middlewares: [authenticateUser, authorizeUser(['restaurantAdmin'])],
        handler: saasPaymentsCtlr.myInvoices
    }
];

const couponRoutes = [
    {
        method: 'post',
        path: '/',
        middlewares: [authenticateUser, authorizeUser(['superAdmin'])],
        handler: saasCouponsCtlr.create
    },
    {
        method: 'get',
        path: '/',
        middlewares: [authenticateUser, authorizeUser(['superAdmin'])],
        handler: saasCouponsCtlr.list
    },
    {
        method: 'post',
        path: '/apply',
        middlewares: [authenticateUser, authorizeUser(['superAdmin'])],
        handler: saasCouponsCtlr.applyPromotionCode
    }
];

const subRouter = Router();
setupRoutes(subRouter, subscriptionRoutes);
router.use('/subscriptions', subRouter);

const payRouter = Router();
setupRoutes(payRouter, paymentRoutes);
router.use('/payments', payRouter);

const couponRouter = Router();
setupRoutes(couponRouter, couponRoutes);
router.use('/coupons', couponRouter);

module.exports = router;
