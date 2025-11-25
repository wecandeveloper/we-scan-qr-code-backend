const { Schema, model } = require('mongoose')
const AutoIncrement = require("mongoose-sequence")(require("mongoose"))

const paymentSchema = new Schema  ({
    paymentId: {
        type: Number,
        unique: true
    },
    // DineOs specific fields
    restaurantId: {
        type: Schema.Types.ObjectId,
        ref: 'Restaurant',
        required: true
    },
    guestId: {
        type: String,
        required: true
    },
    orderId: {
        type: Schema.Types.ObjectId,
        ref: 'Order',
        default: null // Will be set after order creation
    },
    // Line items from guestCart
    lineItems: [
        {
            productId: {
                type: Schema.Types.ObjectId,
                ref: 'Product'
            },
            quantity: Number,
            price: Number,
            // Support for sizes and addOns (optional)
            selectedSize: {
                name: String,
                price: Number
            },
            productAddOns: [
                {
                    name: String,
                    price: Number
                }
            ],
            comments: String
        }
    ],
    // Common addOns line items (separate from product lineItems)
    addOnsLineItems: [
        {
            commonAddOnName: {
                type: String,
                required: true
            },
            quantity: {
                type: Number,
                required: true
            },
            price: {
                type: Number,
                required: true
            },
            basePrice: {
                type: Number,
                required: false
            },
            itemSubtotal: {
                type: Number,
                required: false
            },
            itemTotal: {
                type: Number,
                required: false
            }
        }
    ],
    // Payment gateway session/transaction IDs
    sessionID: {
        type: String,
        default: null // Stripe session ID or Paymob intention ID
    },
    transactionID: {
        type: String,
        default: null // Stripe payment intent ID or Paymob transaction ID
    },
    special_reference: {
        type: String,
        default: null // Paymob special reference
    },
    // Delivery address (stored as object, not reference)
    deliveryAddress: {
        type: Object,
        default: null
    },
    // Table ID for Dine-In orders
    tableId: {
        type: Schema.Types.ObjectId,
        ref: 'Table',
        default: null
    },
    // Amount fields
    originalAmount: {
        type: Number,
        required: true
    },
    discountAmount: {
        type: Number,
        default: 0
    },
    shippingCharge: {
        type: Number,
        default: 0
    },
    totalAmount: {
        type: Number,
        required: true
    },
    // Payment details
    paymentType: {
        type: String,
        default: "card"
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: "pending"
    },
    paymentMethod: {
        type: String,
        enum: ['card', 'cash', 'cod'],
        default: 'card'
    },
    paymentOption: {
        type: String,
        enum: ['pay_now', 'pay_later', 'cash_on_delivery'],
        default: null
    },
    // Payment gateway used
    gateway: {
        type: String,
        enum: ['stripe', 'paymob', null],
        default: null
    },
    // Payment date (when payment was completed)
    paymentDate: {
        type: Date,
        default: null
    }
}, { timestamps: true })

paymentSchema.plugin(AutoIncrement, { 
    inc_field: 'paymentId'
    // Note: Uses default 'counters' collection
    // The unique index on restaurantId in 'counters' collection needs to be dropped
    // Run: db.counters.dropIndex("restaurantId_1") in MongoDB
});

const Payment = model('Payment', paymentSchema)
module.exports = Payment