const { Schema, model } = require('mongoose');

const pendingSaasSignupSchema = new Schema(
    {
        email: { type: String, required: true, index: true },
        passwordHash: { type: String, required: true },
        firstName: { type: String, default: '' },
        lastName: { type: String, default: '' },
        restaurantName: { type: String, required: true },
        phoneNumber: { type: String, default: '' },
        phoneCountryCode: { type: String, default: '' },
        tier: { type: String, enum: ['standard', 'premium', 'advanced'], required: true },
        interval: { type: String, enum: ['month', 'year'], default: 'month' },
        status: {
            type: String,
            enum: ['pending', 'completed', 'failed'],
            default: 'pending'
        },
        stripeCheckoutSessionId: { type: String, default: null },
        completedUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        completedRestaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null }
    },
    { timestamps: true }
);

module.exports = model('PendingSaasSignup', pendingSaasSignupSchema);
