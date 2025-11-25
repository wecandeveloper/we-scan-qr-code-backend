const Payment = require('../models/payment.model');
const Order = require('../models/order.model');
const axios = require("axios");
const { validateOrderBeforePayment } = require('../utils/orderValidation');
const { decryptPaymentKey } = require('../utils/paymentEncryption');
const { createOrderAfterPayment } = require('../utils/orderCreation');
const socketService = require('../services/socketService/socketService');
const Counter = require('../models/counter.model');
const { v4: uuidv4 } = require('uuid');

// Helper function to get or create guestId
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

// Helper function to sanitize product names for Paymob
function sanitizeName(str = "") {
  return str
    .replace(/&amp;|&/g, "and")
    .replace(/&#39;|&apos;|'/g, "")
    .replace(/&quot;|"/g, "``")
    .replace(/&lt;|</g, " less ")
    .replace(/&gt;|>/g, " greater ")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
}

function normalizeName(str) {
  let clean = sanitizeName(str);
  if (clean.length > 50) {
    clean = clean.slice(0, 47) + "...";
  }
  return clean;
}

const paymobCtlr = {};

/**
 * Create Paymob payment intention for guest order
 * @param {Object} body - Request body containing guestCart, restaurantId, paymentOption
 * @returns {Object} - Payment intention details
 */
paymobCtlr.createPaymentIntention = async ({ body }) => {
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

    if (!paymentSettings.paymob || !paymentSettings.paymob.apiKey) {
        throw { status: 400, message: "Paymob is not configured for this restaurant" };
    }

    // Decrypt Paymob API key
    const apiKey = decryptPaymentKey(paymentSettings.paymob.apiKey);
    const integrationId = paymentSettings.paymob.integrationId;
    const merchantId = paymentSettings.paymob.merchantId;

    if (!integrationId || !merchantId) {
        throw { status: 400, message: "Paymob integration ID and merchant ID are required" };
    }

    // Authenticate with Paymob to get token
    const authRes = await axios.post("https://uae.paymob.com/api/auth/tokens", {
        api_key: apiKey
    });

    if (!authRes.data || !authRes.data.token) {
        throw { status: 500, message: "Paymob authentication failed" };
    }

    const authToken = authRes.data.token;

    // Build items array for Paymob
    const items = [];
    const Product = require('../models/product.model');

    // Add product line items
    for (const item of validation.validatedCart.lineItems) {
        // Fetch product to get name
        const product = await Product.findById(item.productId).select('name');
        const productName = product ? product.name : 'Product';
        
        items.push({
            name: normalizeName(productName),
            amount: Math.round(item.basePrice * 100), // Convert to cents
            description: `Quantity: ${item.quantity}`,
            quantity: item.quantity
        });
    }

    // Add common addOns
    for (const addOn of validation.validatedCart.addOnsLineItems) {
        items.push({
            name: normalizeName(addOn.commonAddOnName),
            amount: Math.round(addOn.price * 100),
            description: `Common Add-On`,
            quantity: addOn.quantity
        });
    }

    // Build customer data from delivery address
    let billingData = {
        first_name: 'Guest',
        last_name: 'Customer',
        email: `guest_${guestId}@dineos.com`,
        phone_number: '0000000000',
        country: 'AE'
    };

    if (validation.validatedCart.deliveryAddress) {
        const addr = validation.validatedCart.deliveryAddress;
        billingData = {
            first_name: addr.name ? addr.name.split(' ')[0] : 'Guest',
            last_name: addr.name ? addr.name.split(' ').slice(1).join(' ') || 'Customer' : 'Customer',
            email: addr.email || `guest_${guestId}@dineos.com`,
            phone_number: addr.phone?.number ? `${addr.phone.countryCode || ''}${addr.phone.number}` : '0000000000',
            country: 'AE'
        };
    }

    // Create Paymob intention
    const orderData = {
        amount: Math.round(validation.validatedCart.totalAmount * 100), // Convert to cents
        currency: (paymentSettings.currency || 'AED').toUpperCase(),
        payment_methods: [Number(integrationId)],
        items: items,
        billing_data: billingData,
        shipping_data: billingData,
        special_reference: `order-${restaurantId}-${guestId}-${Date.now()}`,
        redirection_url: `${process.env.FRONTEND_URL || 'http://localhost:3030'}/restaurant/${restaurant.slug || restaurantId}?payment_success=true`
    };

    const intentionRes = await axios.post(
        "https://uae.paymob.com/v1/intention/",
        orderData,
        {
        headers: {
                Authorization: `Token ${authToken}`,
            "Content-Type": "application/json"
        }
        }
    );

    const intention = intentionRes.data;

    if (!intention || !intention.id) {
        throw { status: 500, message: "Failed to create Paymob payment intention" };
    }

    // Initialize counter for Payment model (mongoose-sequence plugin requirement)
    // mongoose-sequence uses 'counters' collection with _id: 'payments'
    const mongoose = require('mongoose');
    const SequenceCounter = mongoose.connection.collection('counters');
    
    // Ensure counter exists before saving Payment
    try {
        await SequenceCounter.findOneAndUpdate(
            { _id: 'payments' },
            { $setOnInsert: { seq: 0 } },
            { upsert: true }
        );
    } catch (error) {
        // If error is about duplicate key (restaurantId index), the counter might still work
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
        gateway: 'paymob',
        sessionID: intention.id,
        special_reference: intention.special_reference
    });
    await payment.save();

    // Get public key from restaurant settings (if available) or use default
    const publicKey = paymentSettings.paymob.publicKey || process.env.PAYMOB_PUBLIC_KEY;

    return {
        message: 'Payment intention created successfully',
        data: {
        sessionId: intention.id,
            paymentURL: publicKey && intention.client_secret
                ? `https://uae.paymob.com/unifiedcheckout/?publicKey=${publicKey}&clientSecret=${intention.client_secret}`
                : intention.redirect_url || null,
            paymentId: payment._id,
            special_reference: intention.special_reference
        }
    };
};

/**
 * Handle Paymob payment success callback
 * @param {Object} query - Query parameters from Paymob callback
 * @returns {Object} - Updated payment and order details
 */
paymobCtlr.handlePaymentSuccess = async ({ query }) => {
    const { merchant_order_id, id: transactionID } = query;

    if (!merchant_order_id || !transactionID) {
        throw { status: 400, message: "Invalid request: missing order or transaction ID" };
    }

    // Find payment by special_reference
    const payment = await Payment.findOne({ special_reference: merchant_order_id });
    if (!payment) {
        throw { status: 404, message: "Payment not found" };
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
    payment.transactionID = transactionID;
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
        originalAmount: payment.originalAmount || payment.totalAmount,
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
 * Handle Paymob payment failure callback
 * @param {Object} query - Query parameters from Paymob callback
 * @returns {Object} - Updated payment details
 */
paymobCtlr.handlePaymentFailure = async ({ query }) => {
    const { merchant_order_id, id: transactionID } = query;

    if (!merchant_order_id || !transactionID) {
        throw { status: 400, message: "Invalid request: missing order or transaction ID" };
    }

    const payment = await Payment.findOne({ special_reference: merchant_order_id });
    if (!payment) {
        throw { status: 404, message: "Payment not found" };
    }

    // Update payment status to failed
    payment.transactionID = transactionID;
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
 * Handle Paymob webhook events
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - Webhook processing result
 */
paymobCtlr.handleWebhook = async (req, res) => {
    try {
        const webhookData = req.body;
        const hmac = req.headers['x-paymob-signature'] || req.headers['hmac'];

        // Find payment by transaction ID or special reference
        let payment = null;
        if (webhookData.obj?.id) {
            payment = await Payment.findOne({ transactionID: webhookData.obj.id.toString() });
        }
        if (!payment && webhookData.obj?.merchant_order_id) {
            payment = await Payment.findOne({ special_reference: webhookData.obj.merchant_order_id });
        }

        if (!payment) {
            console.error('Payment not found for webhook:', webhookData);
            return res.status(404).json({ error: 'Payment not found' });
        }

        // Get restaurant to decrypt HMAC secret
        const Restaurant = require('../models/restaurant.model');
        const restaurant = await Restaurant.findById(payment.restaurantId);
        
        if (!restaurant || !restaurant.paymentSettings || !restaurant.paymentSettings.paymob || !restaurant.paymentSettings.paymob.hmacSecret) {
            console.error('Restaurant HMAC secret not configured');
            return res.status(400).send('HMAC secret not configured');
        }

        const hmacSecret = decryptPaymentKey(restaurant.paymentSettings.paymob.hmacSecret);

        // Verify HMAC signature if provided
        if (hmac) {
            const crypto = require('crypto');
            const calculatedHmac = crypto
                .createHmac('sha512', hmacSecret)
                .update(JSON.stringify(webhookData))
                .digest('hex');
            
            if (calculatedHmac !== hmac) {
                console.error('HMAC verification failed');
                return res.status(400).send('Invalid HMAC signature');
            }
        }

        // Handle different webhook event types
        if (webhookData.type === 'TRANSACTION') {
            const transaction = webhookData.obj;
            
            if (transaction.success === true && transaction.pending === false) {
                // Payment successful
                if (payment.paymentStatus === 'pending') {
                    payment.transactionID = transaction.id?.toString() || payment.transactionID;
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
            } else if (transaction.success === false) {
                // Payment failed
                if (payment.paymentStatus === 'pending') {
                    payment.transactionID = transaction.id?.toString() || payment.transactionID;
                    payment.paymentStatus = 'failed';
                    await payment.save();
                }
            }
        }

        // Return success response
        res.json({ received: true });
    } catch (error) {
        console.error('Error processing Paymob webhook:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
};

module.exports = paymobCtlr;
