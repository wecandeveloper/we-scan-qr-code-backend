const crypto = require('crypto');
const { default: mongoose } = require('mongoose');
const SaasCoupon = require('../../models/saasCoupon.model');
const SaasSubscription = require('../../models/saasSubscription.model');
const { requireSaasStripe } = require('../../services/saasStripe/stripeSaas');
const {
    upsertSaasSubscriptionFromStripe
} = require('../../services/saasStripe/subscriptionSync.service');

const ctl = {};

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

ctl.create = async ({ user, body }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const {
        name,
        kind,
        percentOff,
        amountOff,
        currency,
        durationInMonths,
        maxRedemptions,
        expiresAt,
        trialPeriodDays: trialPeriodDaysRaw,
        promotionCode: promotionCodeInput
    } = body;

    if (!name || !kind) {
        throw { status: 400, message: 'name and kind are required' };
    }

    if (kind === 'trial_days') {
        const trialPeriodDays = Number(trialPeriodDaysRaw);
        if (!Number.isFinite(trialPeriodDays) || trialPeriodDays < 1 || trialPeriodDays > 730) {
            throw { status: 400, message: 'trialPeriodDays must be a whole number between 1 and 730' };
        }
        let promoCode = String(promotionCodeInput || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9-_]/g, '');
        if (!promoCode) {
            promoCode = `DINEOS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        } else if (promoCode.length < 4) {
            throw { status: 400, message: 'Promotion code must be at least 4 characters' };
        }
        const dup = await SaasCoupon.findOne({ promotionCode: promoCode });
        if (dup) {
            throw { status: 400, message: 'That promotion code already exists' };
        }

        const doc = await SaasCoupon.create({
            name,
            kind: 'trial_days',
            stripeCouponId: null,
            stripePromotionCodeId: null,
            promotionCode: promoCode,
            trialPeriodDays: Math.floor(trialPeriodDays),
            durationInMonths: null,
            percentOff: null,
            amountOff: null,
            currency: 'aed',
            maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            createdBy: user.id
        });

        return { message: 'Trial promotion created', data: doc };
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
            throw { status: 400, message: 'free_period requires durationInMonths >= 1 (full discount for that many monthly invoices)' };
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
        trialPeriodDays: null,
        maxRedemptions: maxRedemptions || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: user.id
    });

    return { message: 'Coupon created', data: doc };
};

ctl.list = async ({ user, query }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 15));
    const skip = (page - 1) * limit;

    const search = String(query.search || '').trim();
    const kind = String(query.kind || '').trim();
    const sortBy = ['createdAt', 'name', 'promotionCode', 'kind'].includes(query.sortBy)
        ? query.sortBy
        : 'createdAt';
    const sortDir = query.sortDir === 'asc' ? 1 : -1;

    const filter = {};
    if (kind && ['percent_off', 'amount_off', 'free_period', 'trial_days'].includes(kind)) {
        filter.kind = kind;
    }
    if (search) {
        const rx = new RegExp(escapeRegex(search), 'i');
        filter.$or = [{ name: rx }, { promotionCode: rx }];
    }

    const [items, total] = await Promise.all([
        SaasCoupon.find(filter).sort({ [sortBy]: sortDir }).skip(skip).limit(limit).lean(),
        SaasCoupon.countDocuments(filter)
    ]);

    return { message: 'OK', data: { items, page, limit, total } };
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

ctl.setPaused = async ({ user, body }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { couponId, paused } = body;
    if (!mongoose.Types.ObjectId.isValid(couponId)) {
        throw { status: 400, message: 'Invalid couponId' };
    }
    const pausedBool = Boolean(paused);
    const doc = await SaasCoupon.findById(couponId);
    if (!doc) {
        throw { status: 404, message: 'Coupon not found' };
    }
    if (!doc.isActive) {
        throw { status: 400, message: 'Cannot change pause state on a deactivated coupon' };
    }

    if (doc.stripePromotionCodeId) {
        try {
            const stripe = requireSaasStripe();
            await stripe.promotionCodes.update(doc.stripePromotionCodeId, { active: !pausedBool });
        } catch (e) {
            throw { status: 502, message: e.message || 'Could not update promotion in Stripe' };
        }
    }

    doc.isPaused = pausedBool;
    await doc.save();
    return { message: pausedBool ? 'Coupon paused' : 'Coupon resumed', data: doc };
};

ctl.deactivate = async ({ user, body }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { couponId } = body;
    if (!mongoose.Types.ObjectId.isValid(couponId)) {
        throw { status: 400, message: 'Invalid couponId' };
    }
    const doc = await SaasCoupon.findById(couponId);
    if (!doc) {
        throw { status: 404, message: 'Coupon not found' };
    }
    if (!doc.isActive) {
        return { message: 'Already deactivated', data: doc };
    }

    if (doc.stripePromotionCodeId) {
        try {
            const stripe = requireSaasStripe();
            await stripe.promotionCodes.update(doc.stripePromotionCodeId, { active: false });
        } catch (e) {
            throw { status: 502, message: e.message || 'Could not deactivate promotion in Stripe' };
        }
    }

    doc.isActive = false;
    doc.isPaused = false;
    await doc.save();
    return { message: 'Coupon deactivated', data: doc };
};

module.exports = ctl;
