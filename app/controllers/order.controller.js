const { default: mongoose } = require('mongoose')
const { v4: uuidv4 } = require('uuid');
const Order = require('../models/order.model')
const { pick } = require('lodash')
const Product = require('../models/product.model')
const Table = require('../models/table.model');
const User = require('../models/user.model');
const Restaurant = require('../models/restaurant.model');
const Counter = require("../models/counter.model");
const CommonAddOn = require('../models/commonAddOn.model');
const Payment = require('../models/payment.model');
const socketService = require('../services/socketService/socketService');
const { getBusinessDayBoundaries, getBusinessWeekBoundaries, getBusinessMonthBoundaries } = require('../utils/timezoneUtils');
// const Address = require('../models/address.model')

/**
 * Calculate line item price - supports both old and new formats
 * @param {Object} lineItem - Line item from order
 * @param {Object} product - Product document
 * @returns {Object} - Updated line item with calculated prices
 */
function calculateLineItemPrice(lineItem, product) {
    // Check if new format is being used (has selectedSize, productAddOns, or commonAddOns)
    const isNewFormat = lineItem.selectedSize || 
                       (lineItem.productAddOns && lineItem.productAddOns.length > 0) || 
                       (lineItem.commonAddOns && lineItem.commonAddOns.length > 0);

    if (!isNewFormat) {
        // OLD FORMAT - Backward compatibility
        // Use existing logic: product.offerPrice or product.price
        const itemPrice = product.offerPrice && product.offerPrice > 0 ? product.offerPrice : product.price;
        return {
            ...lineItem,
            price: itemPrice,
            basePrice: itemPrice,
            itemSubtotal: itemPrice,
            itemTotal: itemPrice * (lineItem.quantity || 1)
        };
    }

    // NEW FORMAT - Calculate with sizes and addOns
    let basePrice = 0;

    // Determine base price: selected size price OR product base price
    if (lineItem.selectedSize && lineItem.selectedSize.price !== undefined) {
        // Product has sizes and size is selected
        basePrice = lineItem.selectedSize.price;
    } else {
        // No size selected or product has no sizes - use product price
        // Apply offer price if available
        basePrice = product.offerPrice && product.offerPrice > 0 ? product.offerPrice : product.price;
    }

    // Calculate addOns total
    let productAddOnsTotal = 0;
    if (lineItem.productAddOns && Array.isArray(lineItem.productAddOns)) {
        productAddOnsTotal = lineItem.productAddOns.reduce((sum, addOn) => {
            return sum + (parseFloat(addOn.price) || 0);
        }, 0);
    }

    let commonAddOnsTotal = 0;
    if (lineItem.commonAddOns && Array.isArray(lineItem.commonAddOns)) {
        commonAddOnsTotal = lineItem.commonAddOns.reduce((sum, addOn) => {
            return sum + (parseFloat(addOn.price) || 0);
        }, 0);
    }

    // Calculate totals
    const itemSubtotal = basePrice + productAddOnsTotal + commonAddOnsTotal;
    const quantity = parseFloat(lineItem.quantity) || 1;
    const itemTotal = itemSubtotal * quantity;

    return {
        ...lineItem,
        basePrice: basePrice,
        itemSubtotal: itemSubtotal,
        itemTotal: itemTotal,
        // Keep legacy price field for backward compatibility
        price: itemSubtotal
    };
}

async function getOrCreateGuestId(body) {
    let guestId = body.guestId;

    if (!guestId) {
        // No guestId sent → issue a new one
        return uuidv4();
    }

    const previousOrder = await Order.findOne({ guestId });

    if (!previousOrder) {
        // guestId sent but no order found → treat as new guest
        return uuidv4();
    }

    if (String(previousOrder.restaurantId) !== String(body.restaurantId)) {
        // Same guest ID but different restaurant → assign new ID
        return uuidv4();
    }

    // Reuse for same restaurant
    return guestId;
}

const orderCtlr = {}

orderCtlr.create = async ({ body }) => {
    const orderObj = { ...body };

    // Assign restaurantId and guestId
    orderObj.restaurantId = body.restaurantId;
    orderObj.guestId = await getOrCreateGuestId(body);

    // Check if payment is enabled for this restaurant
    const Restaurant = require('../models/restaurant.model');
    const restaurant = await Restaurant.findById(orderObj.restaurantId);
    
    // If payment is enabled, check payment option
    // For pay_later/cash_on_delivery: Allow order creation (will go through accept/decline)
    // For pay_now: Block (should go through payment API)
    if (restaurant?.paymentSettings?.isPaymentEnabled) {
        // Check if this is a pay_later or cash_on_delivery order
        // These should go through the old accept/decline flow
        const isPayLater = orderObj.paymentOption === 'pay_later' || orderObj.paymentOption === 'cash_on_delivery';
        
        if (!isPayLater) {
            // For pay_now orders, they must go through payment API
            // Check for recent orders/payments to provide better error messages
            const recentOrder = await Order.findOne({
                restaurantId: orderObj.restaurantId,
                guestId: orderObj.guestId
            }).sort({ createdAt: -1 });
            
            if (recentOrder && recentOrder.createdAt) {
                const timeDiff = Date.now() - new Date(recentOrder.createdAt).getTime();
                if (timeDiff < 10 * 60 * 1000) { // 10 minutes
                    throw { 
                        status: 400, 
                        message: "Order already created. Please check your orders or wait a moment before trying again." 
                    };
                }
            }
            
            // Check for recent payment records
            const Payment = require('../models/payment.model');
            const recentPayment = await Payment.findOne({
                restaurantId: orderObj.restaurantId,
                guestId: orderObj.guestId,
                paymentStatus: { $in: ['pending', 'paid'] }
            }).sort({ createdAt: -1 });
            
            if (recentPayment && recentPayment.createdAt) {
                const timeDiff = Date.now() - new Date(recentPayment.createdAt).getTime();
                if (timeDiff < 10 * 60 * 1000) { // 10 minutes
                    if (recentPayment.orderId) {
                        const existingOrder = await Order.findById(recentPayment.orderId);
                        if (existingOrder) {
                            throw { 
                                status: 400, 
                                message: "Order already created through payment system. Please check your orders." 
                            };
                        }
                    }
                }
            }
            
            // Block pay_now orders from using this endpoint
            throw { 
                status: 403, 
                message: "Payment is enabled for this restaurant. Pay Now orders must be placed through the payment system. Please use the payment option in your cart." 
            };
        }
        // For pay_later/cash_on_delivery, allow order creation (will go through accept/decline flow)
    }

    // Basic validations
    if (!orderObj.restaurantId) throw { status: 400, message: "Restaurant ID is required" };
    if ((!orderObj.lineItems || orderObj.lineItems.length === 0) && (!orderObj.addOnsLineItems || orderObj.addOnsLineItems.length === 0))
        throw { status: 400, message: "At least one item is required" };
    if (!orderObj.orderType) throw { status: 400, message: "Order type is required" };

    // Separate common addOns from lineItems into addOnsLineItems
    const addOnsLineItems = [];
    const productLineItems = [];
    
    // Process lineItems - separate common addOns from products
    for (let i = 0; i < (orderObj.lineItems || []).length; i++) {
        const lineItem = orderObj.lineItems[i];
        
        // Handle common addOn items (no productId)
        if (!lineItem.productId || lineItem.isCommonAddOn || lineItem.commonAddOnName) {
            // Validate common addOn
            if (lineItem.commonAddOnName) {
                const commonAddOn = await CommonAddOn.findOne({ 
                    name: lineItem.commonAddOnName, 
                    isAvailable: true 
                });
                if (!commonAddOn) {
                    throw { status: 400, message: `Invalid or unavailable common addOn "${lineItem.commonAddOnName}"` };
                }
                // Add to addOnsLineItems
                addOnsLineItems.push({
                    commonAddOnName: lineItem.commonAddOnName,
                    quantity: lineItem.quantity || 1,
                    price: commonAddOn.price,
                    basePrice: commonAddOn.price,
                    itemSubtotal: commonAddOn.price,
                    itemTotal: (commonAddOn.price || 0) * (lineItem.quantity || 1)
                });
            }
            // Skip product validation for common addOns
            continue;
        }
        
        // Add product items to productLineItems
        productLineItems.push(lineItem);
    }
    
    // Also process addOnsLineItems if sent separately
    if (orderObj.addOnsLineItems && Array.isArray(orderObj.addOnsLineItems)) {
        for (const addOnItem of orderObj.addOnsLineItems) {
            const commonAddOn = await CommonAddOn.findOne({ 
                name: addOnItem.commonAddOnName, 
                isAvailable: true 
            });
            if (!commonAddOn) {
                throw { status: 400, message: `Invalid or unavailable common addOn "${addOnItem.commonAddOnName}"` };
            }
            addOnsLineItems.push({
                commonAddOnName: addOnItem.commonAddOnName,
                quantity: addOnItem.quantity || 1,
                price: commonAddOn.price,
                basePrice: commonAddOn.price,
                itemSubtotal: commonAddOn.price,
                itemTotal: (commonAddOn.price || 0) * (addOnItem.quantity || 1)
            });
        }
    }
    
    // Update orderObj with separated items
    orderObj.lineItems = productLineItems;
    orderObj.addOnsLineItems = addOnsLineItems;

    // Validate Products and calculate prices
    for (let i = 0; i < orderObj.lineItems.length; i++) {
        const lineItem = orderObj.lineItems[i];
        
        const product = await Product.findById(lineItem.productId);
        
        if (!product || !product.isAvailable) {
            throw { status: 400, message: "Invalid or Unavailable product in lineItems" };
        } else if (String(product.restaurantId) !== String(orderObj.restaurantId)) {
            throw { status: 400, message: "Product does not belong to this restaurant" };
        }

        // Validate sizes if provided
        if (lineItem.selectedSize) {
            const validSize = product.sizes && product.sizes.find(
                s => s.name === lineItem.selectedSize.name && s.isAvailable
            );
            if (!validSize) {
                throw { status: 400, message: `Invalid or unavailable size "${lineItem.selectedSize.name}" for product ${product.name}` };
            }
            // Update selectedSize with correct price from product
            lineItem.selectedSize.price = validSize.price;
        } else if (product.sizes && product.sizes.length > 0) {
            // If product has sizes but none selected, use first available size as default
            const defaultSize = product.sizes.find(s => s.isAvailable) || product.sizes[0];
            if (defaultSize) {
                lineItem.selectedSize = {
                    name: defaultSize.name,
                    price: defaultSize.price
                };
            }
        }

        // Validate product-specific addOns if provided
        if (lineItem.productAddOns && Array.isArray(lineItem.productAddOns)) {
            for (const selectedAddOn of lineItem.productAddOns) {
                const validAddOn = product.addOns && product.addOns.find(
                    a => a.name === selectedAddOn.name && a.isAvailable
                );
                if (!validAddOn) {
                    throw { status: 400, message: `Invalid or unavailable addOn "${selectedAddOn.name}" for product ${product.name}` };
                }
                // Update addOn with correct price from product
                selectedAddOn.price = validAddOn.price;
            }
        }

        // Note: Common addOns are now handled separately in addOnsLineItems
        // Product-specific addOns remain in productAddOns field

        // Calculate prices using helper function
        orderObj.lineItems[i] = calculateLineItemPrice(lineItem, product);
    }

    let table;
    if (orderObj.orderType === "Dine-In") {
        // Validate table
        if (!orderObj.tableId) throw { status: 400, message: "Table ID is required" };
        table = await Table.findById(orderObj.tableId);
        if (!table) throw { status: 400, message: "Invalid table ID" };
        if (String(table.restaurantId) !== String(orderObj.restaurantId)) {
            throw { status: 400, message: "Table ID does not belong to this restaurant" };
        }
    }

    if (orderObj.orderType === "Home-Delivery" || orderObj.orderType === "Take-Away") {
        if (!orderObj.deliveryAddress) throw { status: 400, message: "Delivery address is required" };
    }

    // Calculate total amount - support both old and new formats
    // Include both lineItems and addOnsLineItems
    let totalAmount = 0;
    
    // Calculate from product lineItems
    totalAmount += (orderObj.lineItems || []).reduce((acc, item) => {
        // Use itemTotal if available (new format), otherwise fall back to old calculation
        if (item.itemTotal !== undefined) {
            return acc + item.itemTotal;
        }
        // Old format fallback
        const quantity = parseFloat(item.quantity) || 0;
        const price = parseFloat(item.price) || 0;
        return acc + quantity * price;
    }, 0);
    
    // Calculate from addOnsLineItems
    totalAmount += (orderObj.addOnsLineItems || []).reduce((acc, item) => {
        if (item.itemTotal !== undefined) {
            return acc + item.itemTotal;
        }
        const quantity = parseFloat(item.quantity) || 0;
        const price = parseFloat(item.price) || 0;
        return acc + quantity * price;
    }, 0);
    
    orderObj.totalAmount = totalAmount;

    // If payment is enabled and this is a pay_later/cash_on_delivery order, set payment fields
    // (but don't create payment record - that will be done after acceptance if needed)
    if (restaurant?.paymentSettings?.isPaymentEnabled) {
        if (orderObj.paymentOption === 'pay_later' || orderObj.paymentOption === 'cash_on_delivery') {
            // Set payment fields on order (no paymentId yet - will be set after acceptance if needed)
            orderObj.paymentOption = orderObj.paymentOption;
            orderObj.paymentStatus = 'pending';
            orderObj.isPaid = false;
        }
    }

    // Populate product details for the notification
    const populatedOrderDetails = {
        ...orderObj,
        lineItems: await Promise.all(orderObj.lineItems.map(async (item) => {
            const product = await Product.findById(item.productId)
                .populate('categoryId', 'name translations')
                .select('name images price offerPrice translations categoryId');
            
            return {
                ...item,
                productId: product
            };
        })),
        // addOnsLineItems don't need product population
        addOnsLineItems: orderObj.addOnsLineItems || []
    };

    // Emit notification via Socket.IO for restaurant approval
    const notificationData = {
        restaurantId: orderObj.restaurantId,
        type: orderObj.orderType === "Dine-In" ? "Dine In Order" : "Home Delivery Order",
        tableNo: table ? table.tableNumber : null,
        message: orderObj.orderType === "Dine-In" 
            ? `New Order Request from Table ${table.tableNumber}` 
            : orderObj.orderType === "Home-Delivery" ? `New Home Delivery Order Request` : `New Take Away Order Request`,
        // tempOrder: orderObj, // Send temp order for approval
        orderDetails: populatedOrderDetails
    };
    
    socketService.emitOrderNotification(orderObj.restaurantId, notificationData);

    // Return success message with guestId for tracking
    return { 
        success: true, 
        message: "Order request sent to restaurant for approval.",
        guestId: orderObj.guestId
    };
};

orderCtlr.accept = async ({ body }) => {
    const { orderDetails } = body;

    // Check if this is a paid order (already created, cannot be accepted/declined)
    const existingPaidOrder = await Order.findOne({
        restaurantId: orderDetails.restaurantId,
        guestId: orderDetails.guestId,
        isPaid: true,
        status: 'Order Received'
    }).sort({ createdAt: -1 });

    if (existingPaidOrder) {
        throw { 
            status: 400, 
            message: "This order has already been paid and created. Paid orders cannot be accepted or declined." 
        };
    }

    // Check if there's a payment record for this order that's already paid
    const payment = await Payment.findOne({
        restaurantId: orderDetails.restaurantId,
        guestId: orderDetails.guestId,
        paymentStatus: 'paid'
    }).sort({ createdAt: -1 });

    if (payment && payment.orderId) {
        // Order already created from payment
        const existingOrder = await Order.findById(payment.orderId)
            .populate({ 
                path: "lineItems.productId", 
                select: ["name", "images", "price", "offerPrice", "translations"], 
                populate: { path: "categoryId", select: ["name", "translations"] } 
            })
            .populate("restaurantId", "name address")
            .populate("tableId", "tableNumber");

        if (existingOrder) {
            throw { 
                status: 400, 
                message: "This order has already been paid and created. Paid orders cannot be accepted or declined.",
                data: existingOrder
            };
        }
    }

    // Generate unique order number per restaurant
    const counter = await Counter.findOneAndUpdate(
        { restaurantId: orderDetails.restaurantId },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );

    orderDetails.orderNo = `O${counter.seq}`;
    
    // ✅ Ensure status is set to 'Order Received' (valid enum value)
    // Remove any invalid status like 'requested' that might be in orderDetails
    orderDetails.status = 'Order Received';

    // If this is a pay_later or cash_on_delivery order, ensure payment fields are set
    // (No paymentId - payment record is not created for pay_later orders)
    if (orderDetails.paymentOption === 'pay_later' || orderDetails.paymentOption === 'cash_on_delivery') {
        orderDetails.paymentStatus = 'pending';
        orderDetails.isPaid = false;
        // paymentId remains null/undefined for pay_later orders
    }

    // Create the actual order in DB
    const order = await Order.create(orderDetails);

    const newOrder = await Order.findById(order._id)
        .populate({ 
            path: "lineItems.productId", 
            select: ["name", "images", "price", "offerPrice", "translations"], 
            populate: { path: "categoryId", select: ["name", "translations"] } 
        })
        .populate("restaurantId", "name address")
        .populate("tableId", "tableNumber")
        .populate('paymentId', 'paymentStatus paymentOption gateway transactionID');

    // Notify customer that order was accepted
    socketService.emitCustomerNotification(orderDetails.guestId, {
        status: "accepted",
        orderNo: orderDetails.orderNo,
        message: "Your order has been accepted!"
    });

    // Notify all restaurant dashboards to stop any pending order request notifications
    socketService.emitToRestaurant(orderDetails.restaurantId, 'order_request_resolved', {
        restaurantId: orderDetails.restaurantId,
        guestId: orderDetails.guestId,
        status: 'accepted',
        orderNo: orderDetails.orderNo
    });

    return { success: true, message: "Order accepted and created successfully.", data: newOrder };
};

orderCtlr.decline = async ({ body }) => {
    const { orderDetails } = body;

    // Check if this is a paid order (cannot be declined)
    const existingPaidOrder = await Order.findOne({
        restaurantId: orderDetails.restaurantId,
        guestId: orderDetails.guestId,
        isPaid: true,
        status: 'Order Received'
    }).sort({ createdAt: -1 });

    if (existingPaidOrder) {
        throw { 
            status: 400, 
            message: "This order has already been paid. Paid orders cannot be declined." 
        };
    }

    // Check if there's a payment record for this order that's already paid
    const payment = await Payment.findOne({
        restaurantId: orderDetails.restaurantId,
        guestId: orderDetails.guestId,
        paymentStatus: 'paid'
    }).sort({ createdAt: -1 });

    if (payment && payment.orderId) {
        // Order already created from payment
        const existingOrder = await Order.findById(payment.orderId);
        if (existingOrder) {
            throw { 
                status: 400, 
                message: "This order has already been paid and created. Paid orders cannot be declined." 
            };
        }
    }

    // Notify customer that order was declined
    socketService.emitCustomerNotification(orderDetails.guestId, {
        status: "declined",
        message: "Sorry, your order has been declined by the restaurant."
    });

    // Notify all restaurant dashboards to stop any pending order request notifications
    socketService.emitToRestaurant(orderDetails.restaurantId, 'order_request_resolved', {
        restaurantId: orderDetails.restaurantId,
        guestId: orderDetails.guestId,
        status: 'declined'
    });

    return { success: true, message: "Order declined successfully." };
};

orderCtlr.listAllOrders = async () => {
    const orders = await Order.find().sort({ createdAt : -1 })
        .populate({
            path: 'lineItems.productId',
            populate: { path: 'categoryId', select: 'name translations' },
            select: ['name', 'price', 'offerPrice', 'images', 'translations']
        })
        .populate('restaurantId', 'name address')
        .populate('tableId', 'tableNumber')
        .populate('paymentId', 'paymentStatus paymentOption gateway transactionID');
    if(!orders || orders.length === 0) {
        return { message: "No orders found", data: null }
    } else {
        return { data: orders }
    }
}

// Example using query parameters
orderCtlr.listRestaurantOrders = async ({ user, query }) => {
    const userData = await User.findById(user.id);
    const restaurantId = userData.restaurantId;

    if (!restaurantId) throw { status: 403, message: "You are not assigned to any restaurant" };

    // Get restaurant operating hours
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) throw { status: 404, message: "Restaurant not found" };

    const operatingHours = restaurant.operatingHours || {
        openingTime: "00:00",
        closingTime: "23:59",
        timezone: "Asia/Dubai"
    };

    // Default: no filter (return all)
    let dateFilter = {};

    const now = new Date();

    if (query.filter === "daily") {
        const { startDate, endDate } = getBusinessDayBoundaries(operatingHours, now);
        dateFilter = { createdAt: { $gte: startDate, $lte: endDate } };
    } else if (query.filter === "weekly") {
        const { startDate, endDate } = getBusinessWeekBoundaries(operatingHours, now);
        dateFilter = { createdAt: { $gte: startDate, $lte: endDate } };
    } else if (query.filter === "monthly") {
        const { startDate, endDate } = getBusinessMonthBoundaries(operatingHours, now);
        dateFilter = { createdAt: { $gte: startDate, $lte: endDate } };
    } else if (query.from && query.to) {
        // Custom range
        const fromDate = new Date(query.from);
        const toDate = new Date(query.to);
        dateFilter = { createdAt: { $gte: fromDate, $lte: toDate } };
    }

    const orders = await Order.find({ restaurantId, ...dateFilter })
        .sort({ createdAt: -1 })
        .populate({
            path: 'lineItems.productId',
            populate: { path: 'categoryId', select: 'name translations' },
            select: ['name', 'price', 'offerPrice', 'images', 'translations']
        })
        .populate("restaurantId", "name address")
        .populate("tableId", "tableNumber")
        .populate('paymentId', 'paymentStatus paymentOption gateway transactionID');

    if (!orders || orders.length === 0) return { message: "No orders found", data: null };
    return { data: orders };
};

orderCtlr.getMyOrders = async ({ params: { guestId } }) => {
    const orders = await Order.find({ guestId : guestId }).sort({ createdAt: -1 })
        .populate({
            path: 'lineItems.productId',
            populate: { path: 'categoryId', select: 'name translations' },
            select: ['name', 'price', 'offerPrice', 'images', 'translations']
        })
        .populate('restaurantId', 'name address')
        .populate('tableId', 'tableNumber')
        .populate('paymentId', 'paymentStatus paymentOption gateway transactionID');
    if(!orders || orders.length === 0) {
        return { message: "No orders found", data: null }
    } else {
        return { data: orders }
    }
}

// New function to get orders for a specific restaurant
orderCtlr.getMyRestaurantOrders = async ({ params: { guestId, restaurantId } }) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: "Valid Restaurant ID is required" };
    }

    // Fetch restaurant to get operating hours
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) throw { status: 404, message: "Restaurant not found" };

    const operatingHours = restaurant.operatingHours || {
        openingTime: "00:00",
        closingTime: "23:59",
        timezone: "Asia/Dubai"
    };

    // Limit to current business-day window
    const now = new Date();
    const { startDate, endDate } = getBusinessDayBoundaries(operatingHours, now);

    // Auto-clean previous or out-of-window orders for this guest in this restaurant
    await Order.deleteMany({
        guestId: guestId,
        restaurantId: restaurantId,
        $or: [
            { createdAt: { $lt: startDate } },
            { createdAt: { $gt: endDate } }
        ]
    });

    const orders = await Order.find({
        guestId: guestId,
        restaurantId: restaurantId,
        createdAt: { $gte: startDate, $lte: endDate }
    })
        .sort({ createdAt: -1 })
        .populate({
            path: 'lineItems.productId',
            populate: { path: 'categoryId', select: 'name translations' },
            select: ['name', 'price', 'offerPrice', 'images', 'translations']
        })
        .populate('restaurantId', 'name address')
        .populate('tableId', 'tableNumber')
        .populate('paymentId', 'paymentStatus paymentOption gateway transactionID');

    if (!orders || orders.length === 0) {
        return { message: "No orders found for today", data: null };
    }
    return { data: orders };
}

// Delete all orders for a guest in a restaurant that are NOT in today's business-day window
orderCtlr.deletePreviousMyRestaurantOrders = async ({ params: { guestId, restaurantId } }) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: "Valid Restaurant ID is required" };
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) throw { status: 404, message: "Restaurant not found" };

    const operatingHours = restaurant.operatingHours || {
        openingTime: "00:00",
        closingTime: "23:59",
        timezone: "Asia/Dubai"
    };

    const now = new Date();
    const { startDate, endDate } = getBusinessDayBoundaries(operatingHours, now);

    // Delete orders outside the current business-day window
    const deleteResult = await Order.deleteMany({
        guestId: guestId,
        restaurantId: restaurantId,
        $or: [
            { createdAt: { $lt: startDate } },
            { createdAt: { $gt: endDate } }
        ]
    });

    return {
        success: true,
        deletedCount: deleteResult?.deletedCount || 0,
        message: `Removed ${deleteResult?.deletedCount || 0} previous orders outside today's business window`
    };
}

orderCtlr.show = async ({ params: { orderId } }) => {
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
            throw { status: 400, message: "Valid Category ID is required" };
        }

    const order = await Order.findById(orderId)
        .populate({
            path: 'lineItems.productId',
            populate: { path: 'categoryId', select: 'name translations' },
            select: ['name', 'price', 'offerPrice', 'images', 'translations']
        })
        .populate('restaurantId', 'name address')
        .populate('tableId', 'tableNumber')
        .populate('paymentId', 'paymentStatus paymentOption gateway transactionID');

    if(!order) {
        return { message: "No Order found"};
    }
    
    return { data: order };
}

orderCtlr.cancelOrder = async ({ params: { orderId, guestId }, body }) => {
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
        throw { status: 400, message: "Valid Order ID is required" };
    }

    // Validate cancellation reason if status is Cancelled
    if (body.status === 'Cancelled' && !body.cancellationReason) {
        throw { status: 400, message: "Cancellation reason is required when cancelling an order" };
    }

    const updatedBody = pick(body, ['status', 'cancellationReason']);
    let cancelledOrder;

    cancelledOrder = await Order.findOneAndUpdate({_id: orderId, guestId: guestId}, updatedBody, { new: true })
        .populate({
            path: 'lineItems.productId',
            populate: { path: 'categoryId', select: 'name translations' },
            select: ['name', 'price', 'offerPrice', 'images', 'translations']
        })
        .populate('restaurantId', 'name address')
        .populate('tableId', 'tableNumber')
        .populate('paymentId', 'paymentStatus paymentOption gateway transactionID');

    if (!cancelledOrder) {
        return { message: "No Order found", data: null };
    }


    // Emit socket event to notify admin about order cancellation
    const cancellationData = {
        orderId: cancelledOrder._id,
        orderNo: cancelledOrder.orderNo,
        orderType: cancelledOrder.orderType,
        tableNo: cancelledOrder.tableId?.tableNumber || null,
        customerName: cancelledOrder.deliveryAddress?.name || null,
        customerPhone: cancelledOrder.deliveryAddress?.phone.countryCode + cancelledOrder.deliveryAddress?.phone.number || null,
        cancellationReason: cancelledOrder.cancellationReason,
        cancelledAt: new Date()
    };
    
    socketService.emitToRestaurant(cancelledOrder.restaurantId._id, 'order_cancelled', cancellationData);

    return {
        message: 'Order Cancelled Successfully',
        data: cancelledOrder
    };
};

orderCtlr.changeStatus = async ({ params: { orderId }, user, body }) => {
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
        throw { status: 400, message: "Valid Order ID is required" };
    }

    const order = await Order.findById(orderId);
    if (!order) {
        return { message: "Order not found", data: null };
    }

    const userData = await User.findById(user.id);
    const restaurantId = userData.restaurantId;
    if(String(restaurantId) !== String(order.restaurantId)){
        throw { status: 403, message: "RestauratId Mismatch or You are not the owner of this Restaurant" };
    }

    if (!body?.status || typeof body?.status !== "string") {
        throw { status: 400, message: "Order status is required" };
    }

    const updatedBody = pick(body, ['status']);
    const updatedOrder = await Order.findByIdAndUpdate(orderId, updatedBody, { new: true })
        .populate('restaurantId', 'name address')
        .populate('tableId', 'tableNumber')
        .populate('paymentId', 'paymentStatus paymentOption gateway transactionID');

    console.log('🚨 Updated Order:', updatedOrder);

    // Emit status change notification to customer
    const statusChangeData = {
        orderId: updatedOrder._id,
        orderNo: updatedOrder.orderNo,
        status: updatedOrder.status,
        orderType: updatedOrder.orderType,
        tableNo: updatedOrder.tableId?.tableNumber || null,
        customerName: updatedOrder.deliveryAddress?.name || null,
        customerPhone: updatedOrder.deliveryAddress?.phone?.countryCode + updatedOrder.deliveryAddress?.phone?.number || null,
        changedAt: new Date()
    };

    // If admin is cancelling, add cancellation reason to the data
    if (updatedOrder.status === 'Cancelled' && updatedOrder.cancellationReason) {
        statusChangeData.cancellationReason = updatedOrder.cancellationReason;
    }

    // Emit to customer's guest room instead of restaurant room
    const guestId = updatedOrder.guestId;
    if (guestId) {
        socketService.emitToGuest(guestId, 'order_status_changed', statusChangeData);
    }

    return {
        message: 'Order Status Changed',
        status: updatedOrder.status,
        data: updatedOrder
    };
};


orderCtlr.delete = async ({ params: { orderId }, user }) => {
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
        throw { status: 400, message: "Valid Order ID is required" };
    }
    const order = await Order.findById(orderId);
    if (!order) {
        throw { status: 404, message: "Order not found" };
    }

    const userData = await User.findById(user.id);
    const restaurantId = userData.restaurantId;
    if(String(restaurantId) !== String(order.restaurantId)){
        throw { status: 403, message: "RestauratId Mismatch or You are not the owner of this Restaurant" };
    }

    const deletedOrder = await Order.findByIdAndDelete(orderId);

    return { message: "Order deleted Successfully", data: deletedOrder };
};

orderCtlr.bulkDelete = async ({ body: { orderIds }, user }) => {
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        throw { status: 400, message: "Order IDs array is required" };
    }

    // Validate all order IDs
    const invalidIds = orderIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
        throw { status: 400, message: "Invalid Order IDs provided" };
    }

    // Get user data to verify restaurant ownership
    const userData = await User.findById(user.id);
    if (!userData) {
        throw { status: 404, message: "User not found" };
    }

    const restaurantId = userData.restaurantId;
    if (!restaurantId) {
        throw { status: 403, message: "User is not associated with any restaurant" };
    }

    // Find all orders and verify ownership
    const orders = await Order.find({ _id: { $in: orderIds } });
    if (orders.length !== orderIds.length) {
        throw { status: 404, message: "Some orders not found" };
    }

    // Verify all orders belong to the user's restaurant
    const unauthorizedOrders = orders.filter(order => String(order.restaurantId) !== String(restaurantId));
    if (unauthorizedOrders.length > 0) {
        throw { status: 403, message: "You are not authorized to delete some of these orders" };
    }

    // Delete all orders
    const deletedOrders = await Order.deleteMany({ _id: { $in: orderIds } });

    return { 
        message: `${deletedOrders.deletedCount} orders deleted successfully`, 
        data: { deletedCount: deletedOrders.deletedCount } 
    };
};

module.exports = orderCtlr