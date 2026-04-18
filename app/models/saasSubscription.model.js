const { Schema, model } = require('mongoose');

const saasSubscriptionSchema = new Schema(
    {
        restaurantId: {
            type: Schema.Types.ObjectId,
            ref: 'Restaurant',
            required: true,
            unique: true,
            index: true
        },
        adminUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        stripeCustomerId: { type: String, default: null, index: true },
        stripeSubscriptionId: { type: String, default: null, index: true },
        stripePriceId: { type: String, default: null },
        tier: {
            type: String,
            enum: ['standard', 'premium', 'advanced'],
            default: 'standard'
        },
        status: {
            type: String,
            enum: ['pending', 'active', 'past_due', 'paused', 'canceled', 'expired'],
            default: 'pending'
        },
        stripeStatus: { type: String, default: null },
        currentPeriodStart: { type: Date, default: null },
        currentPeriodEnd: { type: Date, default: null },
        cancelAtPeriodEnd: { type: Boolean, default: false },
        pauseCollection: { type: Boolean, default: false },
        lastStripeEventId: { type: String, default: null },
        pendingCheckoutSessionId: { type: String, default: null }
    },
    { timestamps: true }
);

module.exports = model('SaasSubscription', saasSubscriptionSchema);
