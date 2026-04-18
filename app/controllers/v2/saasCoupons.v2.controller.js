const { default: mongoose } = require('mongoose');
const SaasCoupon = require('../../models/saasCoupon.model');
const SaasSubscription = require('../../models/saasSubscription.model');
const { requireSaasStripe } = require('../../services/saasStripe/stripeSaas');
const {
    upsertSaasSubscriptionFromStripe
} = require('../../services/saasStripe/subscriptionSync.service');

const ctl = {};

ctl.create = async ({ user, body }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { name, kind, percentOff, amountOff, currency, durationInMonths, maxRedemptions, expiresAt } =
        body;

    if (!name || !kind) {
        throw { status: 400, message: 'name and kind are required' };
    }

    const stripe = requireSaasStripe();
    const couponParams = {
        name,
        metadata: { source: 'dineos_saas' }
    };

    if (kind === 'percent_off') {
        if (!percentOff || percentOff < 1 || percentOff > 100) {
            throw { status: 400, message: 'percentOff must be 1-100' };
        }
        couponParams.percent_off = percentOff;
        couponParams.duration = durationInMonths ? 'repeating' : 'once';
        if (durationInMonths) {
            couponParams.duration_in_months = durationInMonths;
        }
    } else if (kind === 'amount_off') {
        if (!amountOff || amountOff < 1) {
            throw { status: 400, message: 'amountOff required (minor units, e.g. fils)' };
        }
        couponParams.amount_off = Math.round(amountOff);
        couponParams.currency = (currency || 'aed').toLowerCase();
        couponParams.duration = durationInMonths ? 'repeating' : 'once';
        if (durationInMonths) {
            couponParams.duration_in_months = durationInMonths;
        }
    } else if (kind === 'free_period') {
        if (!durationInMonths || durationInMonths < 1) {
            throw { status: 400, message: 'free_period requires durationInMonths >= 1' };
        }
        couponParams.percent_off = 100;
        couponParams.duration = 'repeating';
        couponParams.duration_in_months = durationInMonths;
    } else {
        throw { status: 400, message: 'Invalid kind' };
    }

    const stripeCoupon = await stripe.coupons.create(couponParams);
    const promo = await stripe.promotionCodes.create({
        coupon: stripeCoupon.id,
        max_redemptions: maxRedemptions || undefined,
        expires_at: expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : undefined
    });

    const doc = await SaasCoupon.create({
        name,
        kind,
        stripeCouponId: stripeCoupon.id,
        stripePromotionCodeId: promo.id,
        promotionCode: promo.code,
        percentOff: percentOff || null,
        amountOff: amountOff || null,
        currency: (currency || 'aed').toLowerCase(),
        durationInMonths: durationInMonths || null,
        maxRedemptions: maxRedemptions || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: user.id
    });

    return { message: 'Coupon created', data: doc };
};

ctl.list = async ({ user }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const items = await SaasCoupon.find().sort({ createdAt: -1 }).lean();
    return { message: 'OK', data: items };
};

ctl.applyPromotionCode = async ({ user, body }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { restaurantId, promotionCode } = body;
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: 'Invalid restaurantId' };
    }
    if (!promotionCode || typeof promotionCode !== 'string') {
        throw { status: 400, message: 'promotionCode is required' };
    }

    const stripe = requireSaasStripe();
    const wanted = promotionCode.trim().toUpperCase();
    const codes = await stripe.promotionCodes.list({ limit: 100, active: true });
    const promo = codes.data.find((p) => (p.code || '').toUpperCase() === wanted);
    if (!promo) {
        throw { status: 404, message: 'Promotion code not found or inactive' };
    }

    const saas = await SaasSubscription.findOne({ restaurantId });
    if (!saas?.stripeSubscriptionId) {
        throw { status: 400, message: 'Restaurant has no Stripe subscription to apply discount to' };
    }

    await stripe.subscriptions.retrieve(saas.stripeSubscriptionId);
    const updated = await stripe.subscriptions.update(saas.stripeSubscriptionId, {
        discounts: [{ promotion_code: promo.id }]
    });

    await upsertSaasSubscriptionFromStripe(updated, restaurantId, null);
    return { message: 'Promotion applied to subscription', data: { subscriptionId: updated.id } };
};

module.exports = ctl;
