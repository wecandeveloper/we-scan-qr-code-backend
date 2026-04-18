const SaasCoupon = require('../../models/saasCoupon.model');

/**
 * Stripe Checkout: discounts use promotion_code IDs; trial uses subscription_data.trial_period_days.
 * @param {string|undefined} promotionCodeRaw
 * @returns {Promise<{ discounts?: { promotion_code: string }[], subscriptionData: Record<string, unknown> }>}
 */
async function resolvePromotionForCheckout(promotionCodeRaw) {
    const code = String(promotionCodeRaw || '')
        .trim()
        .toUpperCase();
    if (!code) {
        return { discounts: undefined, subscriptionData: {} };
    }
    const doc = await SaasCoupon.findOne({
        promotionCode: code,
        isActive: true,
        $nor: [{ isPaused: true }]
    }).lean();
    if (!doc) {
        const err = new Error('Invalid or inactive promotion code');
        err.status = 400;
        throw err;
    }
    if (doc.kind === 'trial_days') {
        const days = Number(doc.trialPeriodDays);
        if (!Number.isFinite(days) || days < 1 || days > 730) {
            const err = new Error('Invalid trial promotion');
            err.status = 400;
            throw err;
        }
        return {
            discounts: undefined,
            subscriptionData: { trial_period_days: Math.floor(days) }
        };
    }
    if (!doc.stripePromotionCodeId) {
        const err = new Error('Promotion code is not redeemable');
        err.status = 400;
        throw err;
    }
    return {
        discounts: [{ promotion_code: doc.stripePromotionCodeId }],
        subscriptionData: {}
    };
}

module.exports = { resolvePromotionForCheckout };
