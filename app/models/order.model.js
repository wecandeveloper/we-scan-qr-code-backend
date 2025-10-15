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
            price: Number
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