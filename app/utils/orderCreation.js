const Order = require('../models/order.model');
const Counter = require('../models/counter.model');
const socketService = require('../services/socketService/socketService');

/**
 * Create an order after payment success or for pay_later/cod orders
 * @param {Object} orderData - Order data from validated cart or payment
 * @param {Object} paymentData - Payment data (optional, for paid orders)
 * @returns {Object} - Created order with populated fields
 */
async function createOrderAfterPayment(orderData, paymentData = null) {
    // Ensure restaurantId is ObjectId
    const mongoose = require('mongoose');
    const restaurantId = mongoose.Types.ObjectId.isValid(orderData.restaurantId) 
        ? new mongoose.Types.ObjectId(orderData.restaurantId)
        : orderData.restaurantId;

    // Generate unique order number per restaurant
    // First, try to find existing counter
    let counter = await Counter.findOne({ restaurantId: restaurantId });
    
    if (!counter) {
        // Counter doesn't exist, create it
        try {
            counter = await Counter.create({
                restaurantId: restaurantId,
                seq: 0  // Start at 0, will be incremented to 1
            });
        } catch (error) {
            // If creation fails (e.g., race condition), try to find it again
            counter = await Counter.findOne({ restaurantId: restaurantId });
            if (!counter) {
                throw { status: 500, message: "Failed to create or find counter for order number generation" };
            }
        }
    }
    
    // Increment the counter
    counter.seq = (counter.seq || 0) + 1;
    await counter.save();

    const orderDetails = {
        ...orderData,
        restaurantId: restaurantId,
        orderNo: `O${counter.seq}`,
        status: 'Order Received'
    };

    // Add payment information if provided
    if (paymentData) {
        orderDetails.paymentId = paymentData._id || paymentData.id;
        orderDetails.paymentStatus = paymentData.paymentStatus || 'paid';
        orderDetails.paymentOption = paymentData.paymentOption || null;
        orderDetails.isPaid = paymentData.paymentStatus === 'paid';
    } else if (orderData.paymentOption) {
        // For pay_later or cash_on_delivery orders
        orderDetails.paymentStatus = 'pending';
        orderDetails.paymentOption = orderData.paymentOption;
        orderDetails.isPaid = false;
    }

    // Create the order in DB
    const order = await Order.create(orderDetails);

    // Populate order with related data
    const populatedOrder = await Order.findById(order._id)
        .populate({ 
            path: "lineItems.productId", 
            select: ["name", "images", "price", "offerPrice", "translations"], 
            populate: { path: "categoryId", select: ["name", "translations"] } 
        })
        .populate("restaurantId", "name address")
        .populate("tableId", "tableNumber")
        .populate("paymentId", "paymentStatus paymentOption gateway transactionID");

    // Extract table number and customer details for notification
    let tableNo = null;
    if (populatedOrder.tableId) {
        tableNo = populatedOrder.tableId.tableNumber || null;
    } else if (orderData.tableId) {
        // If tableId is an object with tableNumber
        if (typeof orderData.tableId === 'object' && orderData.tableId.tableNumber) {
            tableNo = orderData.tableId.tableNumber;
        }
    }

    let customerName = null;
    let customerPhone = null;
    if (populatedOrder.deliveryAddress) {
        customerName = populatedOrder.deliveryAddress.name || null;
        if (populatedOrder.deliveryAddress.phone) {
            const phone = populatedOrder.deliveryAddress.phone;
            customerPhone = phone.countryCode && phone.number 
                ? `${phone.countryCode}${phone.number}` 
                : null;
        }
    } else if (orderData.deliveryAddress) {
        customerName = orderData.deliveryAddress.name || null;
        if (orderData.deliveryAddress.phone) {
            const phone = orderData.deliveryAddress.phone;
            customerPhone = phone.countryCode && phone.number 
                ? `${phone.countryCode}${phone.number}` 
                : null;
        }
    }

    // Notify restaurant
    // For paid orders, this is an acknowledgment (not a request)
    // For unpaid orders, this is a request for approval
    const notificationData = {
        restaurantId: orderData.restaurantId,
        guestId: orderData.guestId,
        orderNo: orderDetails.orderNo,
        orderType: orderData.orderType,
        totalAmount: orderData.totalAmount,
        isPaid: orderDetails.isPaid,
        paymentStatus: orderDetails.paymentStatus,
        paymentOption: orderDetails.paymentOption || null,
        tableNo: tableNo,
        customerName: customerName,
        customerPhone: customerPhone,
        // Include full order details for notifications
        orderDetails: {
            orderNo: orderDetails.orderNo,
            orderType: orderData.orderType,
            totalAmount: orderData.totalAmount,
            lineItems: populatedOrder.lineItems || orderData.lineItems || [],
            addOnsLineItems: populatedOrder.addOnsLineItems || orderData.addOnsLineItems || [],
            deliveryAddress: populatedOrder.deliveryAddress || orderData.deliveryAddress || null,
            tableId: populatedOrder.tableId || orderData.tableId || null,
            status: orderDetails.status,
            paymentStatus: orderDetails.paymentStatus,
            paymentOption: orderDetails.paymentOption
        },
        timestamp: new Date()
    };

    socketService.emitOrderNotification(orderData.restaurantId, notificationData);

    // If order is paid, also notify customer that order was created
    if (orderDetails.isPaid) {
        socketService.emitCustomerNotification(orderData.guestId, {
            status: "created",
            orderNo: orderDetails.orderNo,
            message: "Your order has been placed successfully!"
        });
    }

    return populatedOrder;
}

module.exports = {
    createOrderAfterPayment
};

