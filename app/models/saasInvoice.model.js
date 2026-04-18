const { Schema, model } = require('mongoose');

const saasInvoiceSchema = new Schema(
    {
        restaurantId: {
            type: Schema.Types.ObjectId,
            ref: 'Restaurant',
            required: true,
            index: true
        },
        stripeInvoiceId: { type: String, required: true, unique: true },
        stripeSubscriptionId: { type: String, default: null },
        amountDue: { type: Number, default: 0 },
        amountPaid: { type: Number, default: 0 },
        currency: { type: String, default: 'aed' },
        status: { type: String, default: null },
        hostedInvoiceUrl: { type: String, default: null },
        invoicePdf: { type: String, default: null },
        periodStart: { type: Date, default: null },
        periodEnd: { type: Date, default: null }
    },
    { timestamps: true }
);

saasInvoiceSchema.index({ restaurantId: 1, createdAt: -1 });

module.exports = model('SaasInvoice', saasInvoiceSchema);
