const { Schema, model } = require('mongoose');

const stripeWebhookEventSchema = new Schema(
    {
        stripeEventId: { type: String, required: true, unique: true },
        type: { type: String, required: true },
        processedAt: { type: Date, default: Date.now }
    },
    { timestamps: true }
);

module.exports = model('StripeWebhookEvent', stripeWebhookEventSchema);
