const Payment = require('../models/payment.model')
const Cart = require('../models/cart.model')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const {pick} = require('lodash')
const User = require('../models/user.model')
const { default: mongoose } = require('mongoose')

const paymentsCtlr={}

paymentsCtlr.payment = async ({ user, body })=>{
    // const body = pick(body, ['cart','amount'])
    const cart = await Cart.findOne({customerId : user.id})
        .populate({ path: 'lineItems.productId', select : ['name', 'images', 'price'], populate: { path: 'categoryId', select: ['name']} })
        .populate('customerId', ['firstName', 'lastName', 'email'])
        .populate('appliedCoupon', ['name', 'code'])

        // console.log(cart.appliedCoupon)
    if(!cart) {
        return { message: "Cart not found", data: null };
    } else {
        //create a customer
        const customerDetails = await User.findById(user.id)
        // console.log(customerDetails)
        const customer = await stripe.customers.create({
            name: customerDetails.firstName + ' ' + customerDetails.lastName,
            address: {
                line1: customerDetails.street,
                postal_code: customerDetails.pincode,
                city: customerDetails.area,
                state: customerDetails.city,
                country: 'UAE',
            },
        })
        
        const lineItems = cart.lineItems.map((ele, i) => ({
            price_data: {
                currency: 'aed',
                product_data: {
                    name: String(ele.productId.name), // assuming design has a name property
                },
                unit_amount: Number(ele.price) * 100,
            },
            quantity: Number(ele.quantity),
        }))

        // console.log("sessionLineItems", lineItems)

        let couponId = null;

        if (cart.appliedCoupon && cart.discountAmount > 0) {
            const coupon = await stripe.coupons.create({
                amount_off: cart.discountAmount * 100,
                currency: 'aed',
                duration: 'once',
                name: `Discount for ${cart.appliedCoupon.code}`,
                metadata: {
                    applied_coupon_code: cart.appliedCoupon.code,
                    user_id: user.id.toString(),
                    source: 'custom_checkout'
                }
            });

            couponId = coupon.id;
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: lineItems,
            ...(couponId && { discounts: [{ coupon: couponId }] }),
            shipping_options: [
                {
                    shipping_rate_data: {
                    type: 'fixed_amount',
                    fixed_amount: {
                        amount: cart.shippingCharge * 100,
                        currency: 'aed',
                    },
                    display_name: 'Standard Shipping',
                    delivery_estimate: {
                        minimum: { unit: 'business_day', value: 1 },
                        maximum: { unit: 'business_day', value: 2 },
                    },
                    },
                },
            ],
            mode: "payment",
            success_url: 'http://localhost:3010/?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: 'http://localhost:3010/cart',
            // success_url: 'https://chrunchie-carvings.vercel.app/?session_id={CHECKOUT_SESSION_ID}',
            // cancel_url: 'https://chrunchie-carvings.vercel.app/cart',
            customer: customer.id
        })

        // console.log("session", session)
        
        //create a payment
        // const payment = new Payment(body)
        // payment.customerId = user.id
        // payment.cartId = cart._id
        // payment.transactionId = session.id
        // payment.amount = Number(cart.totalAmount)
        // payment.paymentType = "card"
        const payment = new Payment({
            customerId: user.id,
            cartId: cart._id,
            lineItems: cart.lineItems,
            sessionID: session.id,
            deliveryAddressId: body._id,
            originalAmount: cart.originalAmount,
            discountAmount: cart.discountAmount,
            shippingCharge: cart.shippingCharge,
            totalAmount: cart.totalAmount,
            paymentType: "card",
        });
        await payment.save()

        return {
            message : 'Payment Session created',
            data: {
                sessionId: session.id,
                paymentURL: session.url,
            }
        }
        // res.json({id:session.id,url: session.url})
    }
}

paymentsCtlr.getSession = async ({ params: { sessionID } }) => {
    const session = await stripe.checkout.sessions.retrieve(sessionID);

    if (!session || !session.payment_intent) {
        throw { status: 404, message: "Session or Payment Intent not found" };
    }

    // Update your Payment record with the real transaction ID
    const updatedPayment = await Payment.findOneAndUpdate(
        { sessionID: sessionID },
        { transactionID: session.payment_intent },
        { new: true }
    );

    return {
        message: "Session fetched successfully",
        paymentIntentId: session.payment_intent,
        data: updatedPayment
    };
};

paymentsCtlr.successUpdate = async({ params: { sessionID }, user, body })=>{
    const filteredBody = pick(body, ['paymentStatus'])
    if(!filteredBody.paymentStatus) {
        throw new Error('Invalid request')
    }
    const updatedPayment = await Payment.findOneAndUpdate({ sessionID: sessionID, customerId: user.id }, filteredBody, { new: true, }) 
    if(!updatedPayment) {
        throw new Error('Payment Details not found')
    }

    return {
        message: 'Payment Success, Status updated successfully',
        data: updatedPayment,
    }
}

paymentsCtlr.failedUpdate = async({ params: { sessionID }, user, body })=>{
    const filteredBody = pick(body, ['paymentStatus'])
    if(!filteredBody.paymentStatus) {
        throw new Error('Invalid request')
    }
    const updatedPayment = await Payment.findOneAndUpdate({ sessionID: sessionID, customerId: user.id }, filteredBody, { new: true, }) 
    if(!updatedPayment) {
        throw new Error('Payment Details not found')
    }

    return {
        message: 'Payment Failed, Status updated successfully',
        data: updatedPayment,
    }
}

paymentsCtlr.myHistory = async ({ user }) => {
    const id = user.id
    // console.log(id)
    const payments = await Payment.find({ customerId : id })
        .populate({ path: 'cartId', populate: { path: 'lineItems.productId', select : ['name', 'images'], populate: { path: 'categoryId', select: ['name'] } } })
        .populate('customerId', ['firstName', 'lastName', 'email.address']);
    
    if(!payments) {
        return { message: "No Payments found", data: null };
    }
    
    return { data: payments }; 
}

paymentsCtlr.list = async ({}) => {
    const payments = await Payment.find()
        .populate({ path: 'lineItems.productId', select : ['name', 'images', 'price'], populate: { path: 'categoryId', select: ['name']} })
        .populate('customerId', ['firstName', 'lastName', 'email', 'phone']);
    
    if(!payments) {
        return { message: "No Payments found", data: null };
    }
    
    return { data: payments };
}

paymentsCtlr.listStorePayments = async ({ user }) => {
    const payments = await Payment.find()
        .populate({ path: 'cartId', populate: { path: 'lineItems.productId', select : ['name', 'images'], populate: { path: 'categoryId', select: ['name'] } } })
        .populate('customerId', ['firstName', 'lastName', 'email.address']);
    
    if(!payments) {
        return { message: "No Payments found", data: null };
    }
    
    return { data: payments };
}

paymentsCtlr.show = async ({ params: { paymentId }, user }) => {
    if (!paymentId || !mongoose.Types.ObjectId.isValid(paymentId)) {
            throw { status: 400, message: "Valid Category ID is required" };
        }

    if(user.role === 'customer') {
        const payment = await Payment.findOne({_id : paymentId, customerId: user.id })
        .populate({ path: 'cartId', populate: { path: 'lineItems.productId', select : ['name', 'images'], populate: { path: 'categoryId', select: ['name'] }, populate: { path: 'storeId', select: ['name'] } } })
        .populate('customerId', ['firstName', 'lastName', 'email.address']);

        if(!payment) {
            return { message: "No Payment found", data: null };
        }
        
        return { data: payment };
    } else {
        const payment = await Payment.findById(paymentId)
            .populate({ path: 'cartId', populate: { path: 'lineItems.productId', select : ['name', 'images'], populate: { path: 'categoryId', select: ['name'] }, populate: { path: 'storeId', select: ['name'] } } })
            .populate('customerId', ['firstName', 'lastName', 'email.address']);

        if(!payment) {
            return { message: "No Payment found", data: null };
        }
        
        return { data: payment };
    }
}

paymentsCtlr.delete = async ({ params: { paymentId } }) => {
    if (!paymentId || !mongoose.Types.ObjectId.isValid(paymentId)) {
        throw { status: 400, message: "Valid Payment ID is required" };
    }
    const payment = await Payment.findByIdAndDelete(paymentId);
    if (!payment) {
        throw { status: 404, message: "Payment not found" };
    }
    return { message: "Payment deleted Successfully", data: payment };
};

module.exports = paymentsCtlr