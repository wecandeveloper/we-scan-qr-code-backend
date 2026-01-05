const { default: mongoose } = require('mongoose')
const Refund = require('../models/refund.model')
const Order = require('../models/order.model')
const Wallet = require('../models/wallet.model')
const notificationCtlr = require('./notification.controller')
const { pick } = require('lodash')
const axios = require('axios')

const refundPaymobCtlr = {}

// Paymob Config
const PAYMOB_API_KEY = process.env.PAYMOB_API_KEY;
const PAYMOB_SECRET_KEY = process.env.PAYMOB_SECRET_KEY;

// Create refund request (customer)
refundPaymobCtlr.create = async ({ params: { orderId }, user, body }) => {
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
        throw { status: 400, message: "Valid Order ID is required" };
    }

    const order = await Order.findById(orderId);
    if (!order) {
        throw { status: 404, message: "Order not found" };
    }

    if (order.customerId.toString() !== user.id) {
        throw { status: 403, message: "Unauthorized access to this order" };
    }

    if (order.status === 'Canceled' || order.status === 'Refunded') {
        throw { status: 400, message: "Cannot create refund for canceled or already refunded order" };
    }

    const refundData = pick(body, ['reason', 'amount']);
    refundData.customerId = user.id;
    refundData.orderId = orderId;
    refundData.status = 'pending';
    refundData.refundAmount = refundData.amount || order.totalAmount;
    refundData.refundType = refundData.amount < order.totalAmount ? 'partial' : 'full';
    refundData.refundMethod = 'paymob';
    refundData.originalAmount = order.totalAmount;

    const refund = await Refund.create(refundData);

    // Update order refund status
    await Order.findByIdAndUpdate(orderId, {
        refundStatus: 'pending',
        refundId: refund._id
    });

    return { 
        message: 'Refund request created successfully', 
        data: refund 
    };
}

// Process refund (admin only)
refundPaymobCtlr.processRefund = async ({ params: { refundId }, body }) => {
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

    const updatedBody = pick(body, ['refundMethod', 'adminNotes', 'refundAmount', 'bankDetails']);
    
    try {
        // Just update refund details and status to processing (no payment processing yet)
        await refund.updateStatus('processing', body.processedBy, updatedBody.adminNotes);
        
        // Update refund details
        refund.refundMethod = updatedBody.refundMethod;
        refund.refundAmount = updatedBody.refundAmount || refund.refundAmount;
        refund.adminNotes = updatedBody.adminNotes;
        
        // Update bank details if provided
        if (updatedBody.bankDetails && updatedBody.refundMethod === 'bank_transfer') {
            refund.bankDetails = updatedBody.bankDetails;
        }
        
        await refund.save();
        
        // Update order status
        await Order.findByIdAndUpdate(refund.orderId._id, {
            refundStatus: 'processing',
            refundMethod: updatedBody.refundMethod,
            refundAmount: updatedBody.refundAmount || refund.refundAmount
        });

        // Fetch the updated refund with populated data
        const updatedRefund = await Refund.findById(refundId)
            .populate('orderId', 'orderNumber totalAmount status cancellationReason cancelledBy cancelledAt orderDate')
            .populate('customerId', 'firstName lastName email')
            .populate('processedBy', 'firstName lastName');

        // Create notification for refund processing
        try {
            console.log('Creating refund processing notification for customer:', refund.customerId._id);
            const notification = await notificationCtlr.createNotification(
                refund.customerId._id,
                'refund_processing',
                'Refund Processing Started',
                `Your refund for Order #${refund.orderId.orderNumber} is now being processed. Amount: AED ${refund.refundAmount.toFixed(2)}`,
                {
                    refundId: refund._id,
                    orderId: refund.orderId._id,
                    orderNumber: refund.orderId.orderNumber,
                    refundAmount: refund.refundAmount,
                    refundMethod: updatedBody.refundMethod
                },
                'high'
            );
            console.log('Refund processing notification created successfully:', notification._id);
        } catch (notificationError) {
            console.error('Failed to create refund processing notification:', notificationError);
        }

        return {
            message: 'Refund prepared for processing',
            data: updatedRefund
        };

    } catch (error) {
        await refund.updateStatus('failed', body.processedBy, error.message);
        return { status: 500, message: "Refund processing failed", error: error.message };
    }
}

// Initiate payment for refund (admin only)
refundPaymobCtlr.initiatePayment = async ({ params: { refundId }, body }) => {
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

    try {
        // Update bank details if provided in request body for bank transfer refunds
        if (refund.refundMethod === 'bank_transfer' && body.bankDetails) {
            refund.bankDetails = body.bankDetails;
            await refund.save();
        }
        
        let result;
        
        switch (refund.refundMethod) {
            case 'paymob':
                // Check if order has Paymob payment information
                const order = await Order.findById(refund.orderId);
                console.log('Order payment info:', {
                    paymentIntentId: order.paymentIntentId,
                    stripeChargeId: order.stripeChargeId,
                    paymentMethod: order.paymentMethod
                });
                
                if (!order.paymentIntentId && !order.stripeChargeId) {
                    return { 
                        status: 400, 
                        message: "This order does not have Paymob payment information. Please use manual refund method instead." 
                    };
                }
                result = await processPaymobRefund(refund, refund.refundAmount);
                break;
            case 'wallet':
                result = await processWalletRefund(refund, refund.refundAmount);
                break;
            case 'manual':
                result = await processManualRefund(refund, refund.refundAmount);
                break;
            case 'bank_transfer':
                result = await processBankTransferRefund(refund, refund.refundAmount);
                break;
            default:
                return { status: 400, message: "Invalid refund method" };
        }

        // Update refund status to payment initiated
        await refund.updateStatus('payment_initiated', body.processedBy, body.adminNotes);

        // Fetch the updated refund with populated data
        const updatedRefund = await Refund.findById(refundId)
            .populate('orderId', 'orderNumber totalAmount status cancellationReason cancelledBy cancelledAt orderDate')
            .populate('customerId', 'firstName lastName email')
            .populate('processedBy', 'firstName lastName');

        return {
            message: 'Payment initiated successfully',
            data: { refund: updatedRefund, paymentResult: result }
        };

    } catch (error) {
        await refund.updateStatus('payment_failed', body.processedBy, error.message);
        return { status: 500, message: "Payment initiation failed", error: error.message };
    }
}

// Complete refund (admin only)
refundPaymobCtlr.completeRefund = async ({ params: { refundId }, body }) => {
    if (!refundId || !mongoose.Types.ObjectId.isValid(refundId)) {
        throw { status: 400, message: "Valid Refund ID is required" };
    }

    const refund = await Refund.findById(refundId);
    if (!refund) {
        return { message: "Refund not found", data: null };
    }

    if (refund.status !== 'payment_initiated') {
        return { status: 400, message: "Refund payment must be initiated first" };
    }

    await refund.updateStatus('completed', body.processedBy, body.adminNotes);

    // Update order status
    await Order.findByIdAndUpdate(refund.orderId, {
        refundStatus: 'completed',
        refundAmount: refund.refundAmount
    });

    // Fetch the updated refund with populated data
    const updatedRefund = await Refund.findById(refundId)
        .populate('orderId', 'orderNumber totalAmount status cancellationReason cancelledBy cancelledAt orderDate')
        .populate('customerId', 'firstName lastName email')
        .populate('processedBy', 'firstName lastName');

    // Create notification for refund completion
    try {
        await notificationCtlr.createNotification(
            refund.customerId,
            'refund_completed',
            'Refund Completed Successfully!',
            `Your refund for Order #${refund.orderId.orderNumber} has been completed. Amount: AED ${refund.refundAmount.toFixed(2)}`,
            {
                refundId: refund._id,
                orderId: refund.orderId,
                orderNumber: refund.orderId.orderNumber,
                refundAmount: refund.refundAmount,
                refundMethod: refund.refundMethod
            },
            'high'
        );
    } catch (notificationError) {
        console.error('Failed to create refund completion notification:', notificationError);
    }

    return {
        message: 'Refund completed successfully',
        data: updatedRefund
    };
}

// Cancel refund (admin only)
refundPaymobCtlr.cancelRefund = async ({ params: { refundId }, body }) => {
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
        refundStatus: 'cancelled',
    });

    // Fetch the updated refund with populated data
    const updatedRefund = await Refund.findById(refundId)
        .populate('orderId', 'orderNumber totalAmount status cancellationReason cancelledBy cancelledAt orderDate')
        .populate('customerId', 'firstName lastName email')
        .populate('processedBy', 'firstName lastName');

    return {
        message: 'Refund cancelled successfully',
        data: updatedRefund
    };
}

// Get all refunds (admin only)
refundPaymobCtlr.listRefunds = async ({ query }) => {
    const { status, limit = 50, skip = 0 } = query;
    
    let filter = {};
    if (status) {
        filter.status = status;
    }

    const refunds = await Refund.find(filter)
        .populate('orderId', 'totalAmount status orderNumber cancellationReason cancelledBy cancelledAt orderDate')
        .populate('customerId', 'firstName lastName email')
        .populate('processedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(skip));

    return { data: refunds };
}

// Get customer refunds
refundPaymobCtlr.getMyRefunds = async ({ user }) => {
    const refunds = await Refund.find({ customerId: user.id })
        .populate('orderId', 'orderNumber totalAmount status cancellationReason cancelledBy cancelledAt orderDate')
        .sort({ createdAt: -1 });

    if (!refunds || refunds.length === 0) {
        return { message: "No refunds found", data: null };
    }

    return { data: refunds };
}

// Get refund details
refundPaymobCtlr.show = async ({ params: { refundId }, user }) => {
    if (!refundId || !mongoose.Types.ObjectId.isValid(refundId)) {
        throw { status: 400, message: "Valid Refund ID is required" };
    }

    let refund;
    if (user.role === 'customer') {
        refund = await Refund.findOne({ _id: refundId, customerId: user.id })
            .populate('orderId', 'orderNumber totalAmount status cancellationReason cancelledBy cancelledAt orderDate')
            .populate('customerId', 'firstName lastName email');
    } else {
        refund = await Refund.findById(refundId)
            .populate('orderId', 'orderNumber totalAmount status cancellationReason cancelledBy cancelledAt orderDate')
            .populate('customerId', 'firstName lastName email')
            .populate('processedBy', 'firstName lastName');
    }

    if (!refund) {
        return { message: "Refund not found", data: null };
    }

    return { data: refund };
}

// Delete refund (admin only)
refundPaymobCtlr.deleteRefund = async ({ params: { refundId }, user }) => {
    if (!refundId || !mongoose.Types.ObjectId.isValid(refundId)) {
        throw { status: 400, message: "Valid Refund ID is required" };
    }

    const refund = await Refund.findById(refundId);
    if (!refund) {
        throw { status: 404, message: "Refund not found" };
    }

    // Check if refund can be deleted (only pending or cancelled refunds)
    if (refund.status === 'processing') {
        throw { status: 400, message: "Cannot delete refund that is processing" };
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

// Helper function: Process Paymob refund
const processPaymobRefund = async (refund, amount) => {
    try {
        // Get the order with payment details
        const order = await Order.findById(refund.orderId);
        if (!order) {
            throw new Error("Order not found");
        }

        let paymentIntentId = order.paymentIntentId;
        let transactionId = order.stripeChargeId; // Using stripeChargeId field for Paymob transaction ID

        // If order doesn't have payment info, try to get it from payment record
        if (!paymentIntentId && !transactionId) {
            console.log('Order missing payment info, fetching from payment record...');
            const Payment = require('../models/payment.model');
            const payment = await Payment.findOne({ 
                customerId: refund.customerId,
                totalAmount: order.totalAmount
            }).sort({ createdAt: -1 });
            
            if (payment && payment.sessionID) {
                paymentIntentId = payment.sessionID;
                transactionId = payment.transactionID;
                console.log('Found payment info:', { paymentIntentId, transactionId });
            }
        }

        // Check if we have payment information
        if (!paymentIntentId && !transactionId) {
            throw new Error("No Paymob payment information found for this order");
        }

        // For Paymob, we need to use their refund API
        // Note: Paymob refund API might be different, this is a placeholder
        // You'll need to check Paymob documentation for the actual refund API
        
        console.log('Processing Paymob refund:', {
            paymentIntentId,
            transactionId,
            amount
        });

        // Placeholder for Paymob refund API call
        // const paymobRefund = await axios.post('https://uae.paymob.com/api/refund', {
        //     api_key: PAYMOB_API_KEY,
        //     transaction_id: transactionId,
        //     amount: Math.round(amount * 100) // Convert to cents
        // });

        // For now, we'll simulate a successful refund
        const paymobRefundId = `paymob_refund_${Date.now()}`;

        // Update refund with Paymob information
        await Refund.findByIdAndUpdate(refund._id, {
            stripeRefundId: paymobRefundId, // Reusing field for Paymob refund ID
            stripePaymentIntentId: paymentIntentId,
            stripeChargeId: transactionId
        });

        return { 
            success: true, 
            paymobRefundId: paymobRefundId,
            message: "Paymob refund processed successfully",
            isTestMode: true // Paymob test mode
        };
    } catch (error) {
        throw new Error(`Paymob refund failed: ${error.message}`);
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
                currency: 'AED',
                transactions: []
            });
            await wallet.save();
        }

        // Ensure we have an order number for the reason text
        let orderNumberText = '';
        if (refund.orderId && typeof refund.orderId === 'object' && refund.orderId.orderNumber) {
            orderNumberText = `#${refund.orderId.orderNumber}`;
        } else if (refund.orderId) {
            const orderDoc = await Order.findById(refund.orderId).select('orderNumber');
            orderNumberText = orderDoc?.orderNumber ? `#${orderDoc.orderNumber}` : '';
        }

        const reason = `Refund for Order ${orderNumberText}`.trim();

        console.log('Processing wallet refund:', {
            customerId: refund.customerId,
            amount,
            reason,
            currentBalance: wallet.balance
        });

        // Manually update wallet balance and create transaction
        const newBalance = wallet.balance + amount;
        
        // Create transaction object with all required fields
        const transaction = {
            type: 'credit',
            amount: amount,
            balance: newBalance,
            reason: reason,
            orderId: refund.orderId?._id || refund.orderId || null,
            refundId: refund._id,
            status: 'completed',
            createdAt: new Date()
        };

        // Update wallet with new balance and transaction
        await Wallet.findByIdAndUpdate(wallet._id, {
            $inc: { 
                balance: amount,
                totalCredited: amount 
            },
            $set: { 
                lastTransactionDate: new Date() 
            },
            $push: { 
                transactions: transaction 
            }
        });

        // Get the updated wallet to access the transaction
        const updatedWallet = await Wallet.findById(wallet._id);
        const lastTransaction = updatedWallet.transactions[updatedWallet.transactions.length - 1];

        console.log('Wallet transaction created:', {
            transactionId: lastTransaction._id,
            type: lastTransaction.type,
            amount: lastTransaction.amount,
            balance: lastTransaction.balance,
            reason: lastTransaction.reason
        });

        // Persist reference to wallet transaction on refund
        await Refund.findByIdAndUpdate(refund._id, {
            walletTransactionId: lastTransaction._id
        });

        return { success: true, walletBalance: updatedWallet.balance };
    } catch (error) {
        console.error('Wallet refund error:', error);
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

// Helper function: Process bank transfer refund
const processBankTransferRefund = async (refund, amount) => {
    try {
        // For bank transfer refunds, validate bank details and mark as processing
        if (!refund.bankDetails || !refund.bankDetails.bankName || !refund.bankDetails.accountNumber) {
            throw new Error("Bank details are required for bank transfer refunds");
        }

        // Log bank transfer details for admin processing
        console.log('Bank Transfer Refund Details:', {
            refundId: refund._id,
            amount: amount,
            bankDetails: refund.bankDetails,
            customerId: refund.customerId,
            orderId: refund.orderId
        });

        // In a real implementation, you might:
        // 1. Send notification to admin with bank details
        // 2. Create a bank transfer request
        // 3. Integrate with banking API
        // 4. Send confirmation to customer

        return { 
            success: true, 
            message: "Bank transfer refund initiated",
            bankDetails: refund.bankDetails,
            transferInstructions: `Transfer AED ${amount} to ${refund.bankDetails.accountHolderName} at ${refund.bankDetails.bankName}`
        };
    } catch (error) {
        throw new Error(`Bank transfer refund failed: ${error.message}`);
    }
}

// Add bank details to refund (customer only)
refundPaymobCtlr.addBankDetails = async ({ params: { refundId }, body, user }) => {
    if (!refundId || !mongoose.Types.ObjectId.isValid(refundId)) {
        throw { status: 400, message: "Valid Refund ID is required" };
    }

    const refund = await Refund.findById(refundId);
    if (!refund) {
        return { message: "Refund not found", data: null };
    }

    // Check if customer owns this refund
    if (refund.customerId.toString() !== user.id.toString()) {
        return { status: 403, message: "Access denied. You can only add bank details to your own refunds." };
    }

    // Check if refund is in processing status and is bank transfer
    if (refund.status !== 'processing' || refund.refundMethod !== 'bank_transfer') {
        return { status: 400, message: "Bank details can only be added to processing bank transfer refunds" };
    }

    try {
        // Update bank details
        refund.bankDetails = {
            bankName: body.bankName,
            accountHolderName: body.accountHolderName,
            accountNumber: body.accountNumber,
            iban: body.iban || '',
            swiftCode: body.swiftCode || '',
            branchCode: body.branchCode || '',
            routingNumber: body.routingNumber || ''
        };

        await refund.save();

        // Fetch the updated refund with populated data
        const updatedRefund = await Refund.findById(refundId)
            .populate('orderId', 'orderNumber totalAmount status cancellationReason cancelledBy cancelledAt orderDate')
            .populate('customerId', 'firstName lastName email')
            .populate('processedBy', 'firstName lastName');

        // Create notification for bank details added
        try {
            await notificationCtlr.createNotification(
                refund.customerId,
                'bank_details_added',
                'Bank Details Added Successfully',
                `Your bank details have been added for refund #${refund._id.slice(-8)}. The refund will be processed shortly.`,
                {
                    refundId: refund._id,
                    orderId: refund.orderId,
                    refundAmount: refund.refundAmount
                },
                'medium'
            );
        } catch (notificationError) {
            console.error('Failed to create bank details notification:', notificationError);
        }

        return {
            message: 'Bank details added successfully',
            data: updatedRefund
        };
    } catch (error) {
        return { status: 500, message: "Failed to add bank details", error: error.message };
    }
}

// Bulk delete refunds
refundPaymobCtlr.bulkDeleteRefunds = async ({ body }) => {
    const { refundIds } = body;
    
    if (!refundIds || !Array.isArray(refundIds) || refundIds.length === 0) {
        throw { status: 400, message: "Refund IDs array is required" };
    }

    try {
        // Delete refunds from database
        const result = await Refund.deleteMany({ _id: { $in: refundIds } });

        return {
            message: `Successfully deleted ${result.deletedCount} refunds`,
            data: { deletedCount: result.deletedCount }
        };
    } catch (error) {
        throw { status: 500, message: `Bulk delete failed: ${error.message}` };
    }
};

module.exports = refundPaymobCtlr
