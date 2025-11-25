const { Schema, model } = require('mongoose');
const AutoIncrement = require("mongoose-sequence")(require("mongoose"));

const orderSchema = new Schema({
    orderNo: {
        type: String,
        required: true // Not unique anymore
    },
    orderType: {
        type: String,
        enum: ['Dine-In', 'Home-Delivery', 'Take-Away'],
        default: "Placed"
    },
    deliveryAddress: Object,
    guestId: String,
    restaurantId: {
        type: Schema.Types.ObjectId,
        ref: 'Restaurant',
        required: true
    },
    tableId: {
        type: Schema.Types.ObjectId,
        ref: 'Table'
    },
    lineItems: [
        {
            productId: {
                type: Schema.Types.ObjectId,
                ref: 'Product'
            },
            quantity: Number,
            // Legacy field - kept for backward compatibility
            // If new fields are present, this will be calculated from basePrice + addOns
            price: {
                type: Number,
                required: false // Made optional to support new structure
            },
            // NEW FIELDS (all optional for backward compatibility)
            comments: {
                type: String,
                default: ""
            },
            // Selected size (if product has sizes)
            selectedSize: {
                name: String,
                price: Number
            },
            // Product-specific addOns
            productAddOns: [
                {
                    name: String,
                    price: Number
                }
            ],
            // Calculated fields
            basePrice: {
                type: Number,
                required: false // Will be calculated: product price OR selected size price
            },
            itemSubtotal: {
                type: Number,
                required: false // basePrice + all addOn prices
            },
            itemTotal: {
                type: Number,
                required: false // itemSubtotal × quantity
            }
        }
    ],
    // Separate line items for common addOns (global addOns)
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
    totalAmount: Number,
    status: {
        type: String,
        enum: [
            // Take Away statuses
            'Order Received', 'Preparing', 'Ready for Collection', 'Collected',
            // Dining statuses  
            'Ready to Serve', 'Served',
            // Home Delivery statuses
            'Out for Delivery', 'Delivered',
            // Common statuses
            'Cancelled'
        ],
        default: "Order Received"
    },
    // Payment-related fields
    paymentId: {
        type: Schema.Types.ObjectId,
        ref: 'Payment',
        default: null
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded', null],
        default: null
    },
    paymentOption: {
        type: String,
        enum: ['pay_now', 'pay_later', 'cash_on_delivery', null],
        default: null
    },
    // Flag to indicate if order was paid (cannot be declined)
    isPaid: {
        type: Boolean,
        default: false
    },
    orderDate: {
        type: Date,
        default: Date.now
    },
    cancellationReason: {
        type: String,
        required: function() {
            return this.status === 'Cancelled';
        }
    }
}, { timestamps: true });

// Make orderNo unique per restaurant
orderSchema.index({ restaurantId: 1, orderNo: 1 }, { unique: true });

const Order = model('Order', orderSchema);
module.exports = Order;