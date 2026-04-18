const { Schema, model } = require('mongoose');

const saasCouponSchema = new Schema(
    {
        name: { type: String, required: true },
        kind: {
            type: String,
            enum: ['percent_off', 'amount_off', 'free_period', 'trial_days'],
            required: true
        },
        stripeCouponId: { type: String, default: null },
        stripePromotionCodeId: { type: String, default: null },
        promotionCode: { type: String, default: null, uppercase: true, trim: true },
        percentOff: { type: Number, default: null },
        amountOff: { type: Number, default: null },
        currency: { type: String, default: 'aed' },
        durationInMonths: { type: Number, default: null },
        /** When kind === trial_days — Stripe Checkout subscription_data.trial_period_days */
        trialPeriodDays: { type: Number, default: null },
        maxRedemptions: { type: Number, default: null },
        expiresAt: { type: Date, default: null },
        isActive: { type: Boolean, default: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        metadata: { type: Schema.Types.Mixed, default: {} }
    },
    { timestamps: true }
);

saasCouponSchema.index({ promotionCode: 1 }, { unique: true, sparse: true });

module.exports = model('SaasCoupon', saasCouponSchema);
