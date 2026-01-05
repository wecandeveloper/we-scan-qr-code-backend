const { default: mongoose } = require('mongoose')
const Refund = require('../models/refund.model')
const Order = require('../models/order.model')
const Wallet = require('../models/wallet.model')
const { pick } = require('lodash')

// Stripe integration (you'll need to install stripe: npm install stripe)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const refundCtlr = {}

// Create refund request (customer initiated)
refundCtlr.create = async ({ params: { orderId }, user, body }) => {
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
        throw { status: 400, message: "Valid Order ID is required" };
    }

    const order = await Order.findOne({ _id: orderId, customerId: user.id });
    if (!order) {
        return { message: "Order not found", data: null };
    }

    // Check if order can be refunded
    if (order.status === 'Delivered' && order.refundStatus !== 'none') {
        return { status: 400, message: "Order already has a refund request" };
    }

    if (order.status === 'Canceled') {
        return { status: 400, message: "Order is already cancelled" };
    }

    const refundData = {
        orderId: orderId,
        customerId: user.id,
        refundType: body.refundType || 'full',
        refundMethod: body.refundMethod || 'stripe',
        originalAmount: order.totalAmount,
        refundAmount: body.refundAmount || order.totalAmount,
        currency: 'AED',
        reason: body.reason,
        customerNotes: body.customerNotes,
        status: 'pending'
    };

    const refund = await Refund.create(refundData);

    // Update order with refund info
    await Order.findByIdAndUpdate(orderId, {
        refundStatus: 'pending',
        refundId: refund._id,
        refundReason: body.reason
    });

    return {
        message: 'Refund request created successfully',
        data: refund
    };
}

// Process refund (admin only)
refundCtlr.processRefund = async ({ params: { refundId }, body }) => {
    if (!refundId || !mongoose.Types.ObjectId.isValid(refundId)) {
        throw { status: 400, message: "Valid Refund ID is required" };
    }

    const refund = await Refund.findById(refundId)
        .populate('orderId')
        .populate('customerId', 'firstName lastName email');

    if (!refund) {
        return { message: "Refund not found", data: null };
    }

    if (refund.status !== 'pending') {
        return { status: 400, message: "Refund is not in pending status" };
    }

    const updatedBody = pick(body, ['refundMethod', 'adminNotes', 'refundAmount']);
    
    try {
        let result;
        
        switch (updatedBody.refundMethod) {
            case 'stripe':
                // Debug: Log payment information
                console.log('Order payment info:', {
                    paymentIntentId: refund.orderId.paymentIntentId,
                    stripeChargeId: refund.orderId.stripeChargeId,
                    paymentMethod: refund.orderId.paymentMethod
                });
                
                // Check if order has Stripe payment information, with fallback to payment record
                let hasPaymentInfo = refund.orderId.paymentIntentId || refund.orderId.stripeChargeId;
                
                if (!hasPaymentInfo) {
                    console.log('Order missing payment info, checking payment record...');
                    const Payment = require('../models/payment.model');
                    const payment = await Payment.findOne({ 
                        customerId: refund.customerId,
                        totalAmount: refund.orderId.totalAmount
                    }).sort({ createdAt: -1 });
                    
                    if (payment && payment.sessionID) {
                        hasPaymentInfo = true;
                        console.log('Found payment info in payment record:', payment.sessionID);
                    }
                }
                
                if (!hasPaymentInfo) {
                    return { 
                        status: 400, 
                        message: "This order does not have Stripe payment information. Please use manual refund method instead." 
                    };
                }
                result = await processStripeRefund(refund, updatedBody.refundAmount);
                break;
            case 'wallet':
                result = await processWalletRefund(refund, updatedBody.refundAmount);
                break;
            case 'manual':
                result = await processManualRefund(refund, updatedBody.refundAmount);
                break;
            default:
                return { status: 400, message: "Invalid refund method" };
        }

        // Update refund status
        await refund.updateStatus('processing', body.processedBy, updatedBody.adminNotes);
        
        // Update order status
        await Order.findByIdAndUpdate(refund.orderId._id, {
            refundStatus: 'processing',
            refundMethod: updatedBody.refundMethod,
            refundAmount: updatedBody.refundAmount || refund.refundAmount
        });

        return {
            message: 'Refund processing initiated',
            data: refund
        };

    } catch (error) {
        await refund.updateStatus('failed', body.processedBy, error.message);
        return { status: 500, message: "Refund processing failed", error: error.message };
    }
}

// Complete refund (admin only)
refundCtlr.completeRefund = async ({ params: { refundId }, body }) => {
    if (!refundId || !mongoose.Types.ObjectId.isValid(refundId)) {
        throw { status: 400, message: "Valid Refund ID is required" };
    }

    const refund = await Refund.findById(refundId);
    if (!refund) {
        return { message: "Refund not found", data: null };
    }

    if (refund.status !== 'processing') {
        return { status: 400, message: "Refund is not in processing status" };
    }

    await refund.updateStatus('completed', body.processedBy, body.adminNotes);

    // Update order status
    await Order.findByIdAndUpdate(refund.orderId, {
        refundStatus: 'completed',
        refundDate: new Date()
    });

    return {
        message: 'Refund completed successfully',
        data: refund
    };
}

// Cancel refund (admin only)
refundCtlr.cancelRefund = async ({ params: { refundId }, body }) => {
    if (!refundId || !mongoose.Types.ObjectId.isValid(refundId)) {
        throw { status: 400, message: "Valid Refund ID is required" };
    }

    const refund = await Refund.findById(refundId);
    if (!refund) {
        return { message: "Refund not found", data: null };
    }

    if (refund.status === 'completed') {
        return { status: 400, message: "Cannot cancel completed refund" };
    }

    await refund.updateStatus('cancelled', body.processedBy, body.adminNotes);

    // Update order status
    await Order.findByIdAndUpdate(refund.orderId, {
        refundStatus: 'none',
        refundId: null
    });

    return {
        message: 'Refund cancelled successfully',
        data: refund
    };
}

// Get all refunds (admin only)
refundCtlr.listRefunds = async ({ query }) => {
    const { status, limit = 50, skip = 0 } = query;
    
    let filter = {};
    if (status) {
        filter.status = status;
    }

    const refunds = await Refund.find(filter)
        .populate('orderId', 'orderNumber totalAmount status')
        .populate('customerId', 'firstName lastName email')
        .populate('processedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(skip));

    if (!refunds || refunds.length === 0) {
        return { message: "No refunds found", data: null };
    }

    return { data: refunds };
}

// Get customer refunds
refundCtlr.getMyRefunds = async ({ user }) => {
    const refunds = await Refund.find({ customerId: user.id })
        .populate('orderId', 'orderNumber totalAmount status')
        .sort({ createdAt: -1 });

    if (!refunds || refunds.length === 0) {
        return { message: "No refunds found", data: null };
    }

    return { data: refunds };
}

// Get refund details
refundCtlr.show = async ({ params: { refundId }, user }) => {
    if (!refundId || !mongoose.Types.ObjectId.isValid(refundId)) {
        throw { status: 400, message: "Valid Refund ID is required" };
    }

    let refund;
    if (user.role === 'customer') {
        refund = await Refund.findOne({ _id: refundId, customerId: user.id })
            .populate('orderId', 'orderNumber totalAmount status')
            .populate('customerId', 'firstName lastName email');
    } else {
        refund = await Refund.findById(refundId)
            .populate('orderId', 'orderNumber totalAmount status')
            .populate('customerId', 'firstName lastName email')
            .populate('processedBy', 'firstName lastName');
    }

    if (!refund) {
        return { message: "Refund not found", data: null };
    }

    return { data: refund };
}

// Helper function: Process Stripe refund
const processStripeRefund = async (refund, amount) => {
    try {
        // Get the order with payment details
        const order = await Order.findById(refund.orderId);
        if (!order) {
            throw new Error("Order not found");
        }

        let paymentIntentId = order.paymentIntentId;
        let stripeChargeId = order.stripeChargeId;

        // If order doesn't have payment info, try to get it from payment record
        if (!paymentIntentId && !stripeChargeId) {
            console.log('Order missing payment info, fetching from payment record...');
            const Payment = require('../models/payment.model');
            const payment = await Payment.findOne({ 
                customerId: refund.customerId,
                totalAmount: order.totalAmount
            }).sort({ createdAt: -1 });
            
            if (payment && payment.sessionID) {
                paymentIntentId = payment.sessionID;
                stripeChargeId = payment.transactionID;
                console.log('Found payment info:', { paymentIntentId, stripeChargeId });
            }
        }

        // Check if we have payment intent or charge ID
        if (!paymentIntentId && !stripeChargeId) {
            throw new Error("No Stripe payment information found for this order");
        }

        // Create Stripe refund
        const refundData = {
            amount: Math.round(amount * 100), // Convert to cents
            reason: 'requested_by_customer'
        };

        // Use payment intent if available, otherwise use charge ID
        if (paymentIntentId) {
            refundData.payment_intent = paymentIntentId;
        } else if (stripeChargeId) {
            refundData.charge = stripeChargeId;
        }

        const stripeRefund = await stripe.refunds.create(refundData);

        // Update refund with Stripe information
        await Refund.findByIdAndUpdate(refund._id, {
            stripeRefundId: stripeRefund.id,
            stripePaymentIntentId: paymentIntentId,
            stripeChargeId: stripeChargeId
        });

        return { 
            success: true, 
            stripeRefundId: stripeRefund.id,
            message: "Stripe refund processed successfully",
            isTestMode: stripeRefund.livemode === false
        };
    } catch (error) {
        throw new Error(`Stripe refund failed: ${error.message}`);
    }
}

// Helper function: Process wallet refund
const processWalletRefund = async (refund, amount) => {
    try {
        let wallet = await Wallet.findOne({ customerId: refund.customerId });
        
        if (!wallet) {
            wallet = new Wallet({
                customerId: refund.customerId,
                balance: 0,
                currency: 'AED'
            });
        }

        await wallet.addCredit(
            amount, 
            `Refund for Order #${refund.orderId.orderNumber}`, 
            refund.orderId._id, 
            refund._id
        );

        await Refund.findByIdAndUpdate(refund._id, {
            walletTransactionId: wallet.transactions[wallet.transactions.length - 1]._id
        });

        return { success: true, walletBalance: wallet.balance };
    } catch (error) {
        throw new Error(`Wallet refund failed: ${error.message}`);
    }
}

// Helper function: Process manual refund
const processManualRefund = async (refund, amount) => {
    try {
        // For manual refunds, just mark as processing
        // Admin will handle the actual refund outside the system
        return { success: true, message: "Manual refund marked for processing" };
    } catch (error) {
        throw new Error(`Manual refund failed: ${error.message}`);
    }
}

// Delete refund (admin only)
refundCtlr.deleteRefund = async ({ params: { refundId }, user }) => {
    if (!refundId || !mongoose.Types.ObjectId.isValid(refundId)) {
        throw { status: 400, message: "Valid Refund ID is required" };
    }

    const refund = await Refund.findById(refundId);
    if (!refund) {
        throw { status: 404, message: "Refund not found" };
    }

    // Check if refund can be deleted (only pending or cancelled refunds)
    if (refund.status === 'processing' || refund.status === 'completed') {
        throw { status: 400, message: "Cannot delete refund that is processing or completed" };
    }

    // Delete the refund
    await Refund.findByIdAndDelete(refundId);

    // Reset order refund status if this was the only refund for the order
    const remainingRefunds = await Refund.countDocuments({ orderId: refund.orderId });
    if (remainingRefunds === 0) {
        await Order.findByIdAndUpdate(refund.orderId, {
            refundStatus: 'none',
            refundId: null,
            refundMethod: null,
            refundAmount: 0,
            refundReason: null
        });
    }

    return { 
        message: 'Refund deleted successfully', 
        data: { deletedRefundId: refundId } 
    };
}

module.exports = refundCtlr
