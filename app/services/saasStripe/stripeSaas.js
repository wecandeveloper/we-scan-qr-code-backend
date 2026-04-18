const stripe = require('stripe');

function requireSaasStripe() {
    const key = process.env.STRIPE_SAAS_SECRET_KEY;
    if (!key) {
        throw { status: 503, message: 'SaaS Stripe is not configured (STRIPE_SAAS_SECRET_KEY)' };
    }
    return stripe(key);
}

function getIntervalPriceIds() {
    return {
        standard: {
            month: process.env.STRIPE_SAAS_PRICE_STANDARD_MONTHLY,
            year: process.env.STRIPE_SAAS_PRICE_STANDARD_YEARLY
        },
        premium: {
            month: process.env.STRIPE_SAAS_PRICE_PREMIUM_MONTHLY,
            year: process.env.STRIPE_SAAS_PRICE_PREMIUM_YEARLY
        },
        advanced: {
            month: process.env.STRIPE_SAAS_PRICE_ADVANCED_MONTHLY,
            year: process.env.STRIPE_SAAS_PRICE_ADVANCED_YEARLY
        }
    };
}

/** Single price per tier; used when interval-specific prices are not set */
function getLegacyTierPriceIds() {
    return {
        standard: process.env.STRIPE_SAAS_PRICE_STANDARD,
        premium: process.env.STRIPE_SAAS_PRICE_PREMIUM,
        advanced: process.env.STRIPE_SAAS_PRICE_ADVANCED
    };
}

function getTierPriceIds() {
    const byInterval = getIntervalPriceIds();
    const legacy = getLegacyTierPriceIds();
    return {
        standard: byInterval.standard.month || byInterval.standard.year || legacy.standard,
        premium: byInterval.premium.month || byInterval.premium.year || legacy.premium,
        advanced: byInterval.advanced.month || byInterval.advanced.year || legacy.advanced
    };
}

function tierFromStripePriceId(priceId) {
    if (!priceId) return 'standard';
    const byInterval = getIntervalPriceIds();
    const legacy = getLegacyTierPriceIds();
    const flat = [
        ...Object.values(byInterval.standard),
        ...Object.values(byInterval.premium),
        ...Object.values(byInterval.advanced)
    ].filter(Boolean);
    if (flat.includes(priceId)) {
        if (
            [byInterval.premium.month, byInterval.premium.year].filter(Boolean).includes(priceId)
        ) {
            return 'premium';
        }
        if (
            [byInterval.advanced.month, byInterval.advanced.year].filter(Boolean).includes(priceId)
        ) {
            return 'advanced';
        }
        return 'standard';
    }
    if (priceId === legacy.premium) return 'premium';
    if (priceId === legacy.advanced) return 'advanced';
    return 'standard';
}

function priceIdForTier(tier, interval = 'month') {
    const byInterval = getIntervalPriceIds();
    const legacy = getLegacyTierPriceIds();
    const iv = interval === 'year' ? 'year' : 'month';
    const mapped = byInterval[tier]?.[iv];
    if (mapped) return mapped;
    const legacyId = legacy[tier];
    if (legacyId) return legacyId;
    throw { status: 503, message: `Missing Stripe price env for tier: ${tier}, interval: ${interval}` };
}

module.exports = {
    requireSaasStripe,
    getTierPriceIds,
    getIntervalPriceIds,
    getLegacyTierPriceIds,
    tierFromStripePriceId,
    priceIdForTier
};
