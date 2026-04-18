const { default: mongoose } = require('mongoose');
const Restaurant = require('../../models/restaurant.model');
const SaasSubscription = require('../../models/saasSubscription.model');
const SaasInvoice = require('../../models/saasInvoice.model');
const { getRestaurantIdForRestaurantAdmin } = require('../../utils/restaurantIdForUser');
const {
    requireSaasStripe,
    priceIdForTier,
    getIntervalPriceIds,
    getLegacyTierPriceIds
} = require('../../services/saasStripe/stripeSaas');
const {
    upsertSaasSubscriptionFromStripe
} = require('../../services/saasStripe/subscriptionSync.service');

const ctl = {};

function maskId(id) {
    if (!id || id.length < 10) return null;
    return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

async function planIntervalBlock(stripe, priceId) {
    const empty = {
        configured: false,
        currency: null,
        unitAmount: null,
        interval: null,
        nickname: null
    };
    if (!priceId || !stripe) {
        return empty;
    }
    try {
        const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
        const product = typeof price.product === 'string' ? null : price.product;
        return {
            configured: true,
            currency: price.currency,
            unitAmount: price.unit_amount,
            interval: price.recurring?.interval || null,
            nickname: product?.name || null
        };
    } catch (e) {
        console.warn('[getPlans] price retrieve failed', priceId, e.message);
        return empty;
    }
}

ctl.getPlans = async () => {
    let stripe = null;
    try {
        stripe = requireSaasStripe();
    } catch (e) {
        console.warn('[getPlans] SaaS Stripe not configured:', e.message);
    }
    const byInterval = getIntervalPriceIds();
    const legacy = getLegacyTierPriceIds();
    const tierNames = ['standard', 'premium', 'advanced'];
    const data = [];
    for (const tier of tierNames) {
        const monthId = byInterval[tier].month || legacy[tier] || null;
        const yearId = byInterval[tier].year || null;
        data.push({
            tier,
            monthly: await planIntervalBlock(stripe, monthId),
            yearly: await planIntervalBlock(stripe, yearId)
        });
    }
    return { message: 'Plans', data };
};

ctl.createCheckout = async ({ body, user }) => {
    if (user.role !== 'restaurantAdmin') {
        throw { status: 403, message: 'Only restaurant admins can subscribe' };
    }
    const { tier, interval: intervalRaw } = body;
    if (!['standard', 'premium', 'advanced'].includes(tier)) {
        throw { status: 400, message: 'Invalid tier' };
    }
    const interval = intervalRaw === 'year' ? 'year' : 'month';
    const restaurantId = await getRestaurantIdForRestaurantAdmin(user);
    if (!restaurantId) {
        throw { status: 400, message: 'Create your restaurant profile before subscribing' };
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
        throw { status: 404, message: 'Restaurant not found' };
    }

    const stripe = requireSaasStripe();
    const priceId = priceIdForTier(tier, interval);
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3030';

    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${frontend}/restaurant-admin/billing?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontend}/?canceled=1`,
        client_reference_id: String(restaurantId),
        customer_email: user.email || undefined,
        metadata: {
            restaurantId: String(restaurantId),
            userId: String(user.id),
            tier,
            billingInterval: interval
        },
        subscription_data: {
            metadata: {
                restaurantId: String(restaurantId),
                userId: String(user.id),
                tier,
                billingInterval: interval
            }
        }
    });

    await SaasSubscription.findOneAndUpdate(
        { restaurantId },
        {
            $set: {
                restaurantId,
                adminUserId: user.id,
                pendingCheckoutSessionId: session.id,
                status: 'pending',
                tier
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
        message: 'Checkout session created',
        data: { url: session.url, sessionId: session.id }
    };
};

ctl.me = async ({ user }) => {
    if (user.role !== 'restaurantAdmin') {
        throw { status: 403, message: 'Only restaurant admins can view billing' };
    }
    const restaurantId = await getRestaurantIdForRestaurantAdmin(user);
    if (!restaurantId) {
        return {
            message: 'Billing status',
            data: {
                restaurantId: null,
                restaurantName: null,
                billingOverride: { enabled: false },
                subscription: null,
                effectiveTier: 'standard',
                dashboardAllowed: true
            }
        };
    }

    const [restaurant, saas] = await Promise.all([
        Restaurant.findById(restaurantId).select('subscription billingOverride name').lean(),
        SaasSubscription.findOne({ restaurantId }).lean()
    ]);

    const override = restaurant?.billingOverride;
    const effectiveTier = override?.enabled ? override.tier : restaurant?.subscription;

    return {
        message: 'Billing status',
        data: {
            restaurantId,
            restaurantName: restaurant?.name,
            billingOverride: override || { enabled: false },
            subscription: saas
                ? {
                      status: saas.status,
                      tier: saas.tier,
                      currentPeriodEnd: saas.currentPeriodEnd,
                      cancelAtPeriodEnd: saas.cancelAtPeriodEnd,
                      pauseCollection: saas.pauseCollection,
                      stripeCustomerId: maskId(saas.stripeCustomerId),
                      stripeSubscriptionId: maskId(saas.stripeSubscriptionId)
                  }
                : null,
            effectiveTier,
            dashboardAllowed:
                user.role === 'superAdmin' ||
                Boolean(override?.enabled) ||
                (saas && saas.status === 'active')
        }
    };
};

ctl.createPortalSession = async ({ user }) => {
    if (user.role !== 'restaurantAdmin') {
        throw { status: 403, message: 'Only restaurant admins can open billing portal' };
    }
    const restaurantId = await getRestaurantIdForRestaurantAdmin(user);
    const saas = await SaasSubscription.findOne({ restaurantId });
    if (!saas?.stripeCustomerId) {
        throw { status: 400, message: 'No Stripe customer on file. Complete checkout first.' };
    }
    const stripe = requireSaasStripe();
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3030';
    const params = {
        customer: saas.stripeCustomerId,
        return_url: `${frontend}/restaurant-admin/dashboard`
    };
    if (process.env.STRIPE_SAAS_PORTAL_CONFIGURATION_ID) {
        params.configuration = process.env.STRIPE_SAAS_PORTAL_CONFIGURATION_ID;
    }
    const portal = await stripe.billingPortal.sessions.create(params);
    return { message: 'Portal session', data: { url: portal.url } };
};

ctl.adminList = async ({ user, query }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [restaurants, total] = await Promise.all([
        Restaurant.find()
            .select('name slug subscription billingOverride adminId isApproved isBlocked')
            .populate('adminId', 'firstName lastName email phone')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Restaurant.countDocuments()
    ]);

    const ids = restaurants.map((r) => r._id);
    const subs = await SaasSubscription.find({ restaurantId: { $in: ids } }).lean();
    const subByRest = Object.fromEntries(subs.map((s) => [String(s.restaurantId), s]));

    const data = restaurants.map((r) => ({
        restaurant: r,
        saas: subByRest[String(r._id)] || null
    }));

    return { message: 'OK', data: { items: data, page, limit, total } };
};

ctl.adminPause = async ({ user, body }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { restaurantId } = body;
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: 'Invalid restaurantId' };
    }
    const saas = await SaasSubscription.findOne({ restaurantId });
    if (!saas?.stripeSubscriptionId) {
        throw { status: 400, message: 'No active Stripe subscription for this restaurant' };
    }
    const stripe = requireSaasStripe();
    const sub = await stripe.subscriptions.update(saas.stripeSubscriptionId, {
        pause_collection: { behavior: 'mark_uncollectible' }
    });
    await upsertSaasSubscriptionFromStripe(sub, restaurantId, null);
    return { message: 'Subscription billing paused', data: { status: sub.status } };
};

ctl.adminResume = async ({ user, body }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { restaurantId } = body;
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: 'Invalid restaurantId' };
    }
    const saas = await SaasSubscription.findOne({ restaurantId });
    if (!saas?.stripeSubscriptionId) {
        throw { status: 400, message: 'No Stripe subscription for this restaurant' };
    }
    const stripe = requireSaasStripe();
    const sub = await stripe.subscriptions.update(saas.stripeSubscriptionId, {
        pause_collection: ''
    });
    await upsertSaasSubscriptionFromStripe(sub, restaurantId, null);
    return { message: 'Subscription billing resumed', data: { status: sub.status } };
};

ctl.adminBillingOverride = async ({ user, body }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { restaurantId, enabled, tier, reason, until } = body;
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: 'Invalid restaurantId' };
    }
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
        throw { status: 404, message: 'Restaurant not found' };
    }

    if (enabled) {
        const t = tier || restaurant.subscription;
        if (!['standard', 'premium', 'advanced'].includes(t)) {
            throw { status: 400, message: 'Invalid tier' };
        }
        restaurant.subscription = t;
        restaurant.billingOverride = {
            enabled: true,
            tier: t,
            reason: reason || 'manual',
            until: until ? new Date(until) : null
        };
        await restaurant.save();
    } else {
        restaurant.billingOverride = {
            enabled: false,
            tier: restaurant.subscription,
            reason: '',
            until: null
        };
        await restaurant.save();
        const stripe = requireSaasStripe();
        const saas = await SaasSubscription.findOne({ restaurantId });
        if (saas?.stripeSubscriptionId) {
            const sub = await stripe.subscriptions.retrieve(saas.stripeSubscriptionId);
            await upsertSaasSubscriptionFromStripe(sub, restaurantId, null);
        }
    }
    const updated = await Restaurant.findById(restaurantId).lean();
    return { message: 'Billing override updated', data: updated };
};

ctl.adminInvoicesForRestaurant = async ({ user, params, query }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { restaurantId } = params;
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: 'Invalid restaurantId' };
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
