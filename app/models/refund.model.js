const { Schema, model } = require("mongoose");

const refundSchema = new Schema({
    orderId: {
        type: Schema.Types.ObjectId,
        ref: "Order",
        required: true
    },
    customerId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    refundType: {
        type: String,
        enum: ['full', 'partial'],
        required: true
    },
    refundMethod: {
        type: String,
        enum: ['stripe', 'paymob', 'wallet', 'manual', 'bank_transfer'],
        required: true
    },
    originalAmount: {
        type: Number,
        required: true
    },
    refundAmount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: "AED"
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'payment_initiated', 'payment_failed', 'completed', 'failed', 'cancelled'],
        default: 'pending'
    },
    reason: {
        type: String,
        required: true
    },
    adminNotes: String,
    customerNotes: String,
    
    // Stripe specific fields
    stripeRefundId: String,
    stripePaymentIntentId: String,
    
    // Bank transfer specific fields
    bankDetails: {
        bankName: String,
        accountHolderName: String,
        accountNumber: String,
        iban: String,
        swiftCode: String,
        branchCode: String,
        routingNumber: String
    },
    stripeChargeId: String,
    
    // Wallet specific fields
    walletTransactionId: String,
    
    // Manual refund fields
    manualRefundDetails: {
        accountNumber: String,
        bankName: String,
        routingNumber: String,
        accountHolderName: String
    },
    
    // Processing details
    processedBy: {
        type: Schema.Types.ObjectId,
        ref: "User"
    },
    processedAt: Date,
    completedAt: Date,
    
    // Refund timeline
    requestedAt: {
        type: Date,
        default: Date.now
    },
    approvedAt: Date,
    rejectedAt: Date,
    
    // Additional metadata
    metadata: {
        type: Map,
        of: String
    },
    
    // Refund items (for partial refunds)
    refundItems: [{
        productId: {
            type: Schema.Types.ObjectId,
            ref: "Product"
        },
        quantity: Number,
        unitPrice: Number,
        totalPrice: Number,
        reason: String
    }],
    
    // Communication
    communicationLog: [{
        type: {
            type: String,
            enum: ['email', 'sms', 'notification', 'admin_note']
        },
        message: String,
        sentAt: {
            type: Date,
            default: Date.now
        },
        sentBy: {
            type: Schema.Types.ObjectId,
            ref: "User"
        }
    }]
}, { timestamps: true });

// Indexes for better performance
refundSchema.index({ orderId: 1 });
refundSchema.index({ customerId: 1 });
refundSchema.index({ status: 1 });
refundSchema.index({ refundMethod: 1 });
refundSchema.index({ createdAt: -1 });

// Virtual for refund percentage
refundSchema.virtual('refundPercentage').get(function() {
    return (this.refundAmount / this.originalAmount) * 100;
});

// Virtual for processing time
refundSchema.virtual('processingTime').get(function() {
    if (this.completedAt && this.requestedAt) {
        return this.completedAt - this.requestedAt;
    }
    return null;
});

// Method to update status
refundSchema.methods.updateStatus = function(newStatus, adminId = null, notes = null) {
    this.status = newStatus;
    
    if (newStatus === 'processing') {
        this.processedBy = adminId;
        this.processedAt = new Date();
    } else if (newStatus === 'completed') {
        this.completedAt = new Date();
    }
    
    if (notes) {
        this.communicationLog.push({
            type: 'admin_note',
            message: notes,
            sentBy: adminId
        });
    }
    
    return this.save();
};

// Method to add communication
refundSchema.methods.addCommunication = function(type, message, sentBy) {
    this.communicationLog.push({
        type: type,
        message: message,
        sentBy: sentBy
    });
    
    return this.save();
};

// Static method to get refunds by status
refundSchema.statics.getRefundsByStatus = function(status, limit = 50, skip = 0) {
    return this.find({ status: status })
        .populate('orderId', 'orderNumber totalAmount status')
        .populate('customerId', 'firstName lastName email')
        .populate('processedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);
};

// Static method to get customer refunds
refundSchema.statics.getCustomerRefunds = function(customerId, limit = 50, skip = 0) {
    return this.find({ customerId: customerId })
        .populate('orderId', 'orderNumber totalAmount status')
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);
};

const Refund = model('Refund', refundSchema);
module.exports = Refund;
