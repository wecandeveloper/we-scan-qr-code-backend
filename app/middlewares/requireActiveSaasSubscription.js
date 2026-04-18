const Restaurant = require('../models/restaurant.model');
const SaasSubscription = require('../models/saasSubscription.model');
const { getRestaurantIdForRestaurantAdmin } = require('../utils/restaurantIdForUser');

/**
 * Blocks mutating restaurant-admin actions unless billing is in good standing.
 * superAdmin always passes.
 */
const requireActiveSaasSubscription = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }
        if (req.user.role === 'superAdmin') {
            return next();
        }
        if (req.user.role !== 'restaurantAdmin') {
            return next();
        }

        const restaurantId = await getRestaurantIdForRestaurantAdmin(req.user);
        if (!restaurantId) {
            return next();
        }

        const restaurant = await Restaurant.findById(restaurantId)
            .select('billingOverride')
            .lean();

        if (restaurant?.billingOverride?.enabled) {
            return next();
        }

        const saas = await SaasSubscription.findOne({ restaurantId }).lean();
        if (saas && saas.status === 'active') {
            return next();
        }

        return res.status(402).json({
            message: 'An active Dineos subscription is required for this action',
            code: 'SAAS_SUBSCRIPTION_REQUIRED',
            status: saas?.status || 'none'
        });
    } catch (err) {
        console.error('[requireActiveSaasSubscription]', err);
        return res.status(500).json({ message: 'Subscription check failed' });
    }
};

module.exports = { requireActiveSaasSubscription };
