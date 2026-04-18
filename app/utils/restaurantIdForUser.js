const User = require('../models/user.model');

async function getRestaurantIdForRestaurantAdmin(user) {
    if (!user?.id) return null;
    const u = await User.findById(user.id).select('restaurantId').lean();
    return u?.restaurantId || null;
}

module.exports = { getRestaurantIdForRestaurantAdmin };
