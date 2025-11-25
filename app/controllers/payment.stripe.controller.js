const Payment = require('../models/payment.model');
const Order = require('../models/order.model');
const stripe = require('stripe');
const { validateOrderBeforePayment } = require('../utils/orderValidation');
const { decryptPaymentKey } = require('../utils/paymentEncryption');
const { createOrderAfterPayment } = require('../utils/orderCreation');
const socketService = require('../services/socketService/socketService');
const Counter = require('../models/counter.model');
const { v4: uuidv4 } = require('uuid');

// Helper function to get or create guestId (same logic as order.controller.js)
async function getOrCreateGuestId(body) {
    let guestId = body.guestId;

    if (!guestId) {
        return uuidv4();
    }

    const previousOrder = await Order.findOne({ guestId });

    if (!previousOrder) {
        return uuidv4();
    }

    if (String(previousOrder.restaurantId) !== String(body.restaurantId)) {
        return uuidv4();
    }

    return guestId;
}

const paymentsCtlr = {};

/**
 * Create Stripe payment session for guest order
 * @param {Object} body - Request body containing guestCart, restaurantId, paymentOption
 * @returns {Object} - Payment session details
 */
paymentsCtlr.createPaymentSession = async ({ body }) => {
    const { guestCart, restaurantId, paymentOption } = body;

    if (!guestCart || !restaurantId) {
        throw { status: 400, message: "Guest cart and restaurant ID are required" };
    }

    // Get or create guestId
    const guestId = await getOrCreateGuestId({ restaurantId, guestId: guestCart.guestId });

    // Validate order before payment
    const validation = await validateOrderBeforePayment(guestCart, restaurantId, guestId, paymentOption);

    // If payment option is not 'pay_now', handle based on payment option
    if (validation.skipPayment) {
        // For pay_later: Send notification to admin for accept/decline (old flow)
        // For cash_on_delivery: Also send notification for accept/decline
        if (paymentOption === 'pay_later' || paymentOption === 'cash_on_delivery') {
            // Don't create order or payment record yet
            // Send notification to admin for accept/decline
            // Use the old order creation flow (order.controller.js create)
            // Return a flag to indicate this should go through the old flow
            return {
                message: "Order request sent to restaurant for approval",
                data: {
                    requiresApproval: true,
                    paymentOption: paymentOption,
                    guestId: guestId,
                    skipPayment: true
                }
            };
        }
        
        // For other skipPayment cases (shouldn't happen, but handle gracefully)
        throw { 
            status: 400, 
            message: `Invalid payment option: ${paymentOption}. For pay_later and cash_on_delivery, orders require admin approval.` 
        };
    }

    // Get restaurant payment settings
    const restaurant = validation.restaurant;
    const paymentSettings = restaurant.paymentSettings;

    if (!paymentSettings.stripe || !paymentSettings.stripe.secretKey) {
        throw { status: 400, message: "Stripe is not configured for this restaurant" };
    }

    // Decrypt Stripe secret key
    const secretKey = decryptPaymentKey(paymentSettings.stripe.secretKey);
    const stripeInstance = stripe(secretKey);

    // Build line items for Stripe
    const lineItems = [];
    const Product = require('../models/product.model');
    
    // Add product line items
    for (const item of validation.validatedCart.lineItems) {
        // Fetch product to get name
        const product = await Product.findById(item.productId).select('name');
        const productName = product ? product.name : 'Product';
        
        // Build product name with size and add-ons details
        let displayName = productName;
        const descriptionParts = [];
        
        // Add size information if available
        if (item.selectedSize && item.selectedSize.name) {
            displayName += ` - ${item.selectedSize.name}`;
        }
        
        // Add product-specific add-ons to description
        if (item.productAddOns && Array.isArray(item.productAddOns) && item.productAddOns.length > 0) {
            const addOnNames = item.productAddOns.map(addOn => addOn.name).join(', ');
            descriptionParts.push(`Add-ons: ${addOnNames}`);
        }
        
        // Add comments if available
        if (item.comments) {
            descriptionParts.push(`Note: ${item.comments}`);
        }
        
        // Add quantity info to description
        if (item.quantity > 1) {
            descriptionParts.push(`Qty: ${item.quantity}`);
        }
        
        const description = descriptionParts.length > 0 ? descriptionParts.join(' | ') : undefined;
        const unitAmount = Math.round(item.basePrice * 100); // Convert to cents
        
        lineItems.push({
            price_data: {
                currency: (paymentSettings.currency || 'AED').toLowerCase(),
                product_data: {
                    name: displayName.substring(0, 100), // Stripe limit for name
                    description: description ? description.substring(0, 500) : undefined, // Stripe limit for description
                },
                unit_amount: unitAmount,
            },
            quantity: item.quantity,
        });
    }

    // Add common addOns as separate line items
    for (const addOn of validation.validatedCart.addOnsLineItems) {
        let addOnDisplayName = addOn.commonAddOnName;
        if (addOn.quantity > 1) {
            addOnDisplayName += ` (Qty: ${addOn.quantity})`;
        }
        
        lineItems.push({
            price_data: {
                currency: (paymentSettings.currency || 'AED').toLowerCase(),
                product_data: {
                    name: addOnDisplayName.substring(0, 100),
                    description: 'Common Add-On',
                },
                unit_amount: Math.round(addOn.price * 100),
            },
            quantity: addOn.quantity,
        });
    }

    // Create customer data from delivery address or guest info
    let customerData = {};
    if (validation.validatedCart.deliveryAddress) {
        const addr = validation.validatedCart.deliveryAddress;
        customerData = {
            name: addr.name || 'Guest Customer',
            email: addr.email || `guest_${guestId}@dineos.com`,
            phone: addr.phone?.number ? `${addr.phone.countryCode || ''}${addr.phone.number}` : undefined,
        };
    } else {
        customerData = {
            name: 'Guest Customer',
            email: `guest_${guestId}@dineos.com`,
        };
    }

    // Create Stripe customer
    const customer = await stripeInstance.customers.create(customerData);

    // Create payment session
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3030';
    const restaurantSlug = restaurant.slug || restaurantId.toString(); // Use slug if available, fallback to ID
    const session = await stripeInstance.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: lineItems,
            mode: "payment",
        customer: customer.id,
        success_url: `${frontendUrl}/restaurant/${restaurantSlug}?payment_success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/restaurant/${restaurantSlug}?payment_cancelled=true&session_id={CHECKOUT_SESSION_ID}`,
        metadata: {
            restaurantId: restaurantId.toString(),
            restaurantSlug: restaurantSlug,
            guestId: guestId,
            orderType: validation.validatedCart.orderType,
            paymentOption: paymentOption
        }
    });

    // Initialize counter for Payment model (mongoose-sequence plugin requirement)
    // mongoose-sequence uses 'counters' collection with _id: 'payments'
    const mongoose = require('mongoose');
    const SequenceCounter = mongoose.connection.collection('counters');
    
    // Ensure counter exists before saving Payment
    // This prevents "Cannot read properties of null (reading 'seq')" error
    try {
        await SequenceCounter.findOneAndUpdate(
            { _id: 'payments' },
            { $setOnInsert: { seq: 0 } },
            { upsert: true }
        );
    } catch (error) {
        // If error is about duplicate key (restaurantId index), the counter might still work
        // mongoose-sequence will handle it, but we log for debugging
        if (error.code !== 11000) {
            console.log('Counter initialization warning:', error.message);
        }
    }

    // Create payment record (pending status)
    const payment = new Payment({
        restaurantId: restaurantId,
        guestId: guestId,
        lineItems: validation.validatedCart.lineItems,
        addOnsLineItems: validation.validatedCart.addOnsLineItems || [],
        deliveryAddress: validation.validatedCart.deliveryAddress,
        tableId: validation.validatedCart.tableId?._id || validation.validatedCart.tableId || null,
        originalAmount: validation.validatedCart.originalAmount,
        discountAmount: validation.validatedCart.discountAmount,
        shippingCharge: validation.validatedCart.shippingCharge,
        totalAmount: validation.validatedCart.totalAmount,
        paymentType: "card",
        paymentStatus: "pending",
        paymentOption: paymentOption,
        gateway: 'stripe',
        sessionID: session.id
    });
    await payment.save();

        return {
        message: 'Payment session created successfully',
            data: {
                sessionId: session.id,
                paymentURL: session.url,
            paymentId: payment._id
        }
    };
};

/**
 * Handle Stripe payment success webhook/callback
 * @param {Object} params - Request params containing sessionID
 * @param {Object} body - Request body (optional)
 * @returns {Object} - Updated payment and order details
 */
paymentsCtlr.handlePaymentSuccess = async ({ params: { sessionID }, body }) => {
    if (!sessionID) {
        throw { status: 400, message: "Session ID is required" };
    }

    // Find payment by session ID
    const payment = await Payment.findOne({ sessionID: sessionID });
    if (!payment) {
        throw { status: 404, message: "Payment not found" };
    }

    // Get restaurant to decrypt Stripe keys
    const Restaurant = require('../models/restaurant.model');
    const restaurant = await Restaurant.findById(payment.restaurantId);
    if (!restaurant || !restaurant.paymentSettings || !restaurant.paymentSettings.stripe) {
        throw { status: 404, message: "Restaurant or payment settings not found" };
    }

    // Decrypt and verify payment with Stripe
    const secretKey = decryptPaymentKey(restaurant.paymentSettings.stripe.secretKey);
    const stripeInstance = stripe(secretKey);

    const session = await stripeInstance.checkout.sessions.retrieve(sessionID);
    
    if (session.payment_status !== 'paid') {
        throw { status: 400, message: "Payment not completed" };
    }

    // ✅ Check if order already exists (prevent duplicate creation from webhook/redirect race condition)
    if (payment.orderId) {
        // Order already created (likely by webhook), just return existing order
        const Order = require('../models/order.model');
        const existingOrder = await Order.findById(payment.orderId)
            .populate({ 
                path: "lineItems.productId", 
                select: ["name", "images", "price", "offerPrice", "translations"], 
                populate: { path: "categoryId", select: ["name", "translations"] } 
            })
            .populate("restaurantId", "name address")
            .populate("tableId", "tableNumber")
            .populate("paymentId", "paymentStatus paymentOption gateway transactionID");
        
        return {
            message: "Payment successful and order already created",
            data: {
                payment: payment,
                order: existingOrder
            }
        };
    }

    // Update payment record
    payment.transactionID = session.payment_intent;
    payment.paymentStatus = 'paid';
    payment.paymentDate = new Date();
    await payment.save();

    // Create order immediately (payment done orders cannot be declined)
    // Determine orderType from deliveryAddress or tableId
    let orderType = 'Dine-In';
    if (payment.deliveryAddress) {
        // Check if it's Home-Delivery (has phone) or Take-Away
        orderType = payment.deliveryAddress.phone ? 'Home-Delivery' : 'Take-Away';
    }
    
    const orderData = {
        restaurantId: payment.restaurantId,
        guestId: payment.guestId,
        orderType: orderType,
        lineItems: payment.lineItems,
        addOnsLineItems: payment.addOnsLineItems || [],
        deliveryAddress: payment.deliveryAddress,
        tableId: payment.tableId || null,
        totalAmount: payment.totalAmount,
        originalAmount: payment.originalAmount,
        discountAmount: payment.discountAmount || 0,
        shippingCharge: payment.shippingCharge || 0
    };

    // Create order using utility function
    const order = await createOrderAfterPayment(orderData, payment);

    // Update payment with orderId
    payment.orderId = order._id;
    await payment.save();

    return {
        message: "Payment successful and order created",
        data: {
            payment: payment,
            order: order
        }
    };
};

/**
 * Handle Stripe payment failure
 * @param {Object} params - Request params containing sessionID
 * @param {Object} body - Request body (optional)
 * @returns {Object} - Updated payment details
 */
paymentsCtlr.handlePaymentFailure = async ({ params: { sessionID }, body }) => {
    if (!sessionID) {
        throw { status: 400, message: "Session ID is required" };
    }

    const payment = await Payment.findOne({ sessionID: sessionID });
    if (!payment) {
        throw { status: 404, message: "Payment not found" };
    }

    // Update payment status to failed
    payment.paymentStatus = 'failed';
    await payment.save();

    // No order should be created for failed payments
    // Cart remains unchanged (handled on frontend)

    return {
        message: "Payment failed",
        data: payment
    };
};

/**
 * Get payment session details
 * @param {Object} params - Request params containing sessionID
 * @returns {Object} - Session and payment details
 */
paymentsCtlr.getSession = async ({ params: { sessionID } }) => {
    if (!sessionID) {
        throw { status: 400, message: "Session ID is required" };
    }

    const payment = await Payment.findOne({ sessionID: sessionID });
    if (!payment) {
        throw { status: 404, message: "Payment not found" };
    }

    // Get restaurant to decrypt Stripe keys
    const Restaurant = require('../models/restaurant.model');
    const restaurant = await Restaurant.findById(payment.restaurantId);
    if (!restaurant || !restaurant.paymentSettings || !restaurant.paymentSettings.stripe) {
        throw { status: 404, message: "Restaurant or payment settings not found" };
    }

    // Decrypt and retrieve session from Stripe
    const secretKey = decryptPaymentKey(restaurant.paymentSettings.stripe.secretKey);
    const stripeInstance = stripe(secretKey);

    const session = await stripeInstance.checkout.sessions.retrieve(sessionID);

    // Update payment with transaction ID if available
    if (session.payment_intent && !payment.transactionID) {
        payment.transactionID = session.payment_intent;
        await payment.save();
    }

    return {
        message: "Session retrieved successfully",
        data: {
            session: session,
            payment: payment
        }
    };
};

/**
 * Handle Stripe webhook events
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - Webhook processing result
 */
paymentsCtlr.handleWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // Try to parse event data to get session ID (before verification)
        // This allows us to find the payment and get the correct restaurant's webhook secret
        let parsedBody;
        try {
            parsedBody = JSON.parse(req.body.toString());
        } catch (e) {
            parsedBody = req.body;
        }

        // Try to get session ID from event data
        let sessionId = null;
        if (parsedBody.data?.object?.id && parsedBody.type === 'checkout.session.completed') {
            sessionId = parsedBody.data.object.id;
        } else if (parsedBody.data?.object?.id && parsedBody.type === 'payment_intent.payment_failed') {
            // For payment_intent events, we'll need to find by transaction ID later
        }

        // Try to find payment and restaurant
        let restaurant = null;
        let webhookSecret = null;
        let secretKey = null;

        if (sessionId) {
            const payment = await Payment.findOne({ sessionID: sessionId });
            if (payment) {
                const Restaurant = require('../models/restaurant.model');
                restaurant = await Restaurant.findById(payment.restaurantId);
                if (restaurant?.paymentSettings?.stripe?.webhookSecret) {
                    webhookSecret = decryptPaymentKey(restaurant.paymentSettings.stripe.webhookSecret);
                    secretKey = decryptPaymentKey(restaurant.paymentSettings.stripe.secretKey);
                }
            }
        }

        // Fallback: try to get from any recent Stripe payment
        if (!webhookSecret) {
            const testPayment = await Payment.findOne({ gateway: 'stripe' }).sort({ createdAt: -1 });
            if (testPayment) {
                const Restaurant = require('../models/restaurant.model');
                restaurant = await Restaurant.findById(testPayment.restaurantId);
                if (restaurant?.paymentSettings?.stripe?.webhookSecret) {
                    webhookSecret = decryptPaymentKey(restaurant.paymentSettings.stripe.webhookSecret);
                    secretKey = decryptPaymentKey(restaurant.paymentSettings.stripe.secretKey);
                }
            }
        }

        if (!webhookSecret || !secretKey) {
            console.error('Webhook secret not found');
            return res.status(400).send('Webhook secret not configured');
        }

        const stripeInstance = stripe(secretKey);

        // Verify webhook signature
        event = stripeInstance.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            
            // Find payment by session ID
            const payment = await Payment.findOne({ sessionID: session.id });
            
            if (!payment) {
                console.error('Payment not found for session:', session.id);
                return res.status(404).json({ error: 'Payment not found' });
            }

            // Get restaurant to decrypt webhook secret for verification
            const Restaurant = require('../models/restaurant.model');
            const restaurant = await Restaurant.findById(payment.restaurantId);
            
            if (!restaurant || !restaurant.paymentSettings || !restaurant.paymentSettings.stripe) {
                console.error('Restaurant or payment settings not found for payment:', payment._id);
                return res.status(404).json({ error: 'Restaurant payment settings not found' });
            }

            // Only process if payment is still pending
            if (payment.paymentStatus === 'pending' && session.payment_status === 'paid') {
                // Update payment record
                payment.transactionID = session.payment_intent;
                payment.paymentStatus = 'paid';
                payment.paymentDate = new Date();
                await payment.save();

                // Create order if not already created
                if (!payment.orderId) {
                    let orderType = 'Dine-In';
                    if (payment.deliveryAddress) {
                        orderType = payment.deliveryAddress.phone ? 'Home-Delivery' : 'Take-Away';
                    }
                    
                    const orderData = {
                        restaurantId: payment.restaurantId,
                        guestId: payment.guestId,
                        orderType: orderType,
                        lineItems: payment.lineItems,
                        addOnsLineItems: payment.addOnsLineItems || [],
                        deliveryAddress: payment.deliveryAddress,
                        tableId: payment.tableId || null,
                        totalAmount: payment.totalAmount
                    };

                    const order = await createOrderAfterPayment(orderData, payment);
                    payment.orderId = order._id;
                    await payment.save();
                }
            }
        } else if (event.type === 'payment_intent.payment_failed') {
            const paymentIntent = event.data.object;
            
            // Find payment by transaction ID
            const payment = await Payment.findOne({ transactionID: paymentIntent.id });
            
            if (payment && payment.paymentStatus === 'pending') {
                payment.paymentStatus = 'failed';
                await payment.save();
            }
        }

        // Return a response to acknowledge receipt of the event
        res.json({ received: true });
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
};

module.exports = paymentsCtlr;
