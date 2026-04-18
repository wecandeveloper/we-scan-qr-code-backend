const SaasInvoice = require('../../models/saasInvoice.model');
const { getRestaurantIdForRestaurantAdmin } = require('../../utils/restaurantIdForUser');

const ctl = {};

ctl.myInvoices = async ({ user, query }) => {
    if (user.role !== 'restaurantAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const restaurantId = await getRestaurantIdForRestaurantAdmin(user);
    if (!restaurantId) {
        return { message: 'OK', data: { items: [], page: 1, limit: 30, total: 0 } };
    }
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 30));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
        SaasInvoice.find({ restaurantId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        SaasInvoice.countDocuments({ restaurantId })
    ]);
    return { message: 'OK', data: { items, page, limit, total } };
};

module.exports = ctl;
