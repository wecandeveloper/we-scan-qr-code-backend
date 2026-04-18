const { default: mongoose } = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Restaurant = require('../../models/restaurant.model');
const User = require('../../models/user.model');
const PendingSaasSignup = require('../../models/pendingSaasSignup.model');
const SaasSubscription = require('../../models/saasSubscription.model');
const SaasInvoice = require('../../models/saasInvoice.model');
const { getRestaurantIdForRestaurantAdmin } = require('../../utils/restaurantIdForUser');
const {
    requireSaasStripe,
    priceIdForTier,
    getIntervalPriceIds,
    getLegacyTierPriceIds
} = require('../../services/saasStripe/stripeSaas');
const {
    upsertSaasSubscriptionFromStripe
} = require('../../services/saasStripe/subscriptionSync.service');
const { provisionGuestSignupFromStripeSession } = require('../../services/saasStripe/guestSaasSignup.service');
const { resolvePromotionForCheckout } = require('../../services/saasStripe/saasPromotionCheckout.service');
const redisClient = require('../../config/redis');
const { sendMailFunc } = require('../../services/nodemailerService/nodemailer.service');
const { otpMailTemplate } = require('../../services/nodemailerService/templates');

const ctl = {};

function guestSaasOtpRedisKey(emailNorm) {
    return `guest_saas_otp:${emailNorm}`;
}

function guestSaasEmailOkRedisKey(emailNorm) {
    return `guest_saas_email_ok:${emailNorm}`;
}

async function redisGetSafe(key) {
    try {
        return await redisClient.get(key);
    } catch (e) {
        return null;
    }
}

function maskId(id) {
    if (!id || id.length < 10) return null;
    return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

async function planIntervalBlock(stripe, priceId) {
    const empty = {
        configured: false,
        currency: null,
        unitAmount: null,
        interval: null,
        nickname: null
    };
    if (!priceId || !stripe) {
        return empty;
    }
    try {
        const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
        const product = typeof price.product === 'string' ? null : price.product;
        return {
            configured: true,
            currency: price.currency,
            unitAmount: price.unit_amount,
            interval: price.recurring?.interval || null,
            nickname: product?.name || null
        };
    } catch (e) {
        console.warn('[getPlans] price retrieve failed', priceId, e.message);
        return empty;
    }
}

ctl.getPlans = async () => {
    let stripe = null;
    try {
        stripe = requireSaasStripe();
    } catch (e) {
        console.warn('[getPlans] SaaS Stripe not configured:', e.message);
    }
    const byInterval = getIntervalPriceIds();
    const legacy = getLegacyTierPriceIds();
    const tierNames = ['standard', 'premium', 'advanced'];
    const data = [];
    for (const tier of tierNames) {
        const monthId = byInterval[tier].month || legacy[tier] || null;
        const yearId = byInterval[tier].year || null;
        data.push({
            tier,
            monthly: await planIntervalBlock(stripe, monthId),
            yearly: await planIntervalBlock(stripe, yearId)
        });
    }
    return { message: 'Plans', data };
};

function normalizeGuestEmail(email) {
    return String(email || '')
        .trim()
        .toLowerCase();
}

const GUEST_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

ctl.checkSignupEmail = async ({ body }) => {
    const emailNorm = normalizeGuestEmail(body?.email);
    if (!emailNorm) {
        return { message: 'OK', data: { available: true, empty: true } };
    }
    if (!GUEST_EMAIL_RE.test(emailNorm)) {
        return { message: 'OK', data: { available: true, invalidFormat: true } };
    }
    const existing = await User.findOne({ 'email.address': emailNorm }).select('_id').lean();
    return { message: 'OK', data: { available: !existing } };
};

ctl.sendGuestSignupEmailOtp = async ({ body }) => {
    const emailNorm = normalizeGuestEmail(body?.email);
    if (!emailNorm || !GUEST_EMAIL_RE.test(emailNorm)) {
        throw { status: 400, message: 'Valid email is required' };
    }
    if (!process.env.EMAIL || !String(process.env.APP_PASSWORD || '').trim()) {
        console.error('[sendGuestSignupEmailOtp] Missing EMAIL or APP_PASSWORD env');
        throw {
            status: 503,
            message:
                'Email service is not configured on the server (set EMAIL and APP_PASSWORD for Gmail SMTP).'
        };
    }
    const existing = await User.findOne({ 'email.address': emailNorm }).select('_id').lean();
    if (existing) {
        throw { status: 400, message: 'This email is already registered.' };
    }

    const otpKey = guestSaasOtpRedisKey(emailNorm);
    const okKey = guestSaasEmailOkRedisKey(emailNorm);
    const redisMailData = await redisGetSafe(otpKey);
    if (redisMailData && redisMailData.count > 5) {
        throw { status: 400, message: 'Too many requests. Try again later.' };
    }

    const otp = Math.floor(Math.random() * 900000) + 100000;
    await redisClient.set(
        otpKey,
        {
            otp,
            count: (redisMailData?.count ?? 0) + 1,
            createdAt: redisMailData?.createdAt ?? new Date(),
            lastSentAt: new Date()
        },
        60 * 10
    );
    await redisClient.del(okKey);

    try {
        const mailData = await sendMailFunc({
            to: emailNorm,
            subject: 'DineOS — verify your email',
            html: otpMailTemplate(otp)
        });
        if (!mailData?.isSend) {
            await redisClient.del(otpKey);
            throw { status: 400, message: 'Could not send email. Try again later.' };
        }
    } catch (err) {
        if (err.status) throw err;
        await redisClient.del(otpKey);
        const detail = err?.message || String(err);
        console.error('[sendGuestSignupEmailOtp] sendMail failed:', detail);
        const isProd = process.env.NODE_ENV === 'production';
        throw {
            status: 502,
            message: isProd
                ? 'Could not send verification email. The server mail settings may be invalid (Gmail requires an App Password).'
                : `Could not send verification email: ${detail}`
        };
    }

    return { message: 'Verification code sent', data: { sent: true } };
};

ctl.verifyGuestSignupEmailOtp = async ({ body }) => {
    const emailNorm = normalizeGuestEmail(body?.email);
    if (!emailNorm || !GUEST_EMAIL_RE.test(emailNorm)) {
        throw { status: 400, message: 'Valid email is required' };
    }
    const existing = await User.findOne({ 'email.address': emailNorm }).select('_id').lean();
    if (existing) {
        throw { status: 400, message: 'This email is already registered.' };
    }

    const otpKey = guestSaasOtpRedisKey(emailNorm);
    const stored = await redisGetSafe(otpKey);
    if (!stored) {
        throw { status: 400, message: 'Code expired or not sent. Request a new code.' };
    }
    const given = Number(body?.otp);
    if (!Number.isFinite(given) || given < 100000 || given > 999999) {
        throw { status: 400, message: 'Enter the 6-digit code from your email.' };
    }
    if (Number(stored.otp) !== given) {
        throw { status: 400, message: 'Incorrect code. Try again.' };
    }

    await redisClient.del(otpKey);
    await redisClient.set(guestSaasEmailOkRedisKey(emailNorm), { verifiedAt: Date.now() }, 60 * 30);

    return { message: 'Email verified', data: { verified: true } };
};

function escapeRegexAdmin(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

ctl.createGuestCheckout = async ({ body }) => {
    const {
        firstName,
        lastName,
        email,
        password,
        restaurantName,
        tier,
        interval: intervalRaw,
        phoneNumber,
        phoneCountryCode,
        promotionCode: promotionCodeRaw
    } = body;

    const emailNorm = normalizeGuestEmail(email);
    if (!emailNorm || !GUEST_EMAIL_RE.test(emailNorm)) {
        throw { status: 400, message: 'Valid email is required' };
    }
    if (!password || String(password).length < 8) {
        throw { status: 400, message: 'Password must be at least 8 characters' };
    }
    const rName = String(restaurantName || '').trim();
    if (rName.length < 2) {
        throw { status: 400, message: 'Restaurant name is required' };
    }
    if (!['standard', 'premium', 'advanced'].includes(tier)) {
        throw { status: 400, message: 'Invalid tier' };
    }
    const interval = intervalRaw === 'year' ? 'year' : 'month';

    const existing = await User.findOne({ 'email.address': emailNorm });
    if (existing) {
        throw {
            status: 400,
            message: 'An account with this email already exists. Sign in to manage your subscription.'
        };
    }

    const emailOkKey = guestSaasEmailOkRedisKey(emailNorm);
    const emailOk = await redisGetSafe(emailOkKey);
    if (!emailOk) {
        throw {
            status: 400,
            message: 'Please verify your email with the code we sent you before continuing to payment.'
        };
    }
    await redisClient.del(emailOkKey);

    const salt = await bcrypt.genSalt();
    const passwordHash = await bcrypt.hash(String(password), salt);

    const pending = await PendingSaasSignup.create({
        email: emailNorm,
        passwordHash,
        firstName: String(firstName || '').trim(),
        lastName: String(lastName || '').trim(),
        restaurantName: rName,
        phoneNumber: phoneNumber ? String(phoneNumber).trim() : '',
        phoneCountryCode: phoneCountryCode ? String(phoneCountryCode).trim() : '',
        tier,
        interval,
        status: 'pending'
    });

    const stripe = requireSaasStripe();
    const priceId = priceIdForTier(tier, interval);
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3030';

    let promoOpts = { discounts: undefined, subscriptionData: {} };
    if (promotionCodeRaw) {
        try {
            promoOpts = await resolvePromotionForCheckout(promotionCodeRaw);
        } catch (e) {
            if (e.status === 400) {
                throw { status: 400, message: e.message };
            }
            throw e;
        }
    }

    const subscriptionMetadata = {
        signupSource: 'guest_saas',
        pendingSignupId: String(pending._id),
        tier,
        billingInterval: interval
    };
    const sessionParams = {
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${frontend}/post-checkout?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontend}/?canceled=1`,
        customer_email: emailNorm,
        metadata: {
            signupSource: 'guest_saas',
            pendingSignupId: String(pending._id),
            tier,
            billingInterval: interval
        },
        subscription_data: {
            metadata: subscriptionMetadata,
            ...promoOpts.subscriptionData
        }
    };
    if (promoOpts.discounts?.length) {
        sessionParams.discounts = promoOpts.discounts;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    pending.stripeCheckoutSessionId = session.id;
    await pending.save();

    return {
        message: 'Checkout session created',
        data: { url: session.url, sessionId: session.id }
    };
};

ctl.completeGuestSignup = async ({ body }) => {
    const { sessionId } = body;
    if (!sessionId || typeof sessionId !== 'string') {
        throw { status: 400, message: 'sessionId is required' };
    }

    const stripe = requireSaasStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });

    if (session.metadata?.signupSource !== 'guest_saas' || !session.metadata?.pendingSignupId) {
        throw { status: 400, message: 'Invalid checkout session' };
    }

    const result = await provisionGuestSignupFromStripeSession(session);
    if (!result.ok) {
        if (result.reason === 'unpaid') {
            throw { status: 402, message: 'Payment not completed yet. Try again in a moment.' };
        }
        throw { status: 400, message: result.reason || 'Could not finish signup' };
    }

    const user = await User.findById(result.userId).populate('restaurantId', 'name').select('-password');
    if (!user) {
        throw { status: 500, message: 'Account not found after checkout' };
    }

    const tokenData = {
        id: String(user._id),
        role: user.role,
        userId: user.userId,
        email: user.email.address,
        number: user.phone?.number || ''
    };
    const token = jwt.sign(tokenData, process.env.JWT_SECRET, { expiresIn: '7d' });
    await User.findByIdAndUpdate(user._id, { jwtToken: token });

    const fresh = await User.findById(user._id).populate('restaurantId', 'name').select('-password');
    return { token, user: fresh };
};

ctl.createCheckout = async ({ body, user }) => {
    const { tier, interval: intervalRaw, restaurantId: bodyRestaurantId, promotionCode: promotionCodeRaw } =
        body;
    if (!['standard', 'premium', 'advanced'].includes(tier)) {
        throw { status: 400, message: 'Invalid tier' };
    }
    const interval = intervalRaw === 'year' ? 'year' : 'month';

    let restaurantId;
    if (user.role === 'restaurantAdmin') {
        restaurantId = await getRestaurantIdForRestaurantAdmin(user);
        if (!restaurantId) {
            throw { status: 400, message: 'Create your restaurant profile before subscribing' };
        }
    } else if (user.role === 'superAdmin') {
        if (!bodyRestaurantId || !mongoose.Types.ObjectId.isValid(bodyRestaurantId)) {
            throw {
                status: 400,
                message:
                    'Super admin checkout requires restaurantId in the JSON body (the restaurant to bill).'
            };
        }
        restaurantId = bodyRestaurantId;
    } else {
        throw { status: 403, message: 'Only restaurant or super admin accounts can start subscription checkout' };
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
        throw { status: 404, message: 'Restaurant not found' };
    }

    const ownerAdminId = restaurant.adminId;
    const adminUser = await User.findById(ownerAdminId).select('email.address');
    const customerEmail = adminUser?.email?.address || user.email || undefined;
    const metadataUserId = String(ownerAdminId || user.id);

    const stripe = requireSaasStripe();
    const priceId = priceIdForTier(tier, interval);
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3030';

    let promoOpts = { discounts: undefined, subscriptionData: {} };
    if (promotionCodeRaw) {
        try {
            promoOpts = await resolvePromotionForCheckout(promotionCodeRaw);
        } catch (e) {
            if (e.status === 400) {
                throw { status: 400, message: e.message };
            }
            throw e;
        }
    }

    const subMeta = {
        restaurantId: String(restaurantId),
        userId: metadataUserId,
        tier,
        billingInterval: interval
    };
    const sessionParams = {
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${frontend}/restaurant-admin/billing?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontend}/?canceled=1`,
        client_reference_id: String(restaurantId),
        customer_email: customerEmail,
        metadata: {
            restaurantId: String(restaurantId),
            userId: metadataUserId,
            tier,
            billingInterval: interval
        },
        subscription_data: {
            metadata: subMeta,
            ...promoOpts.subscriptionData
        }
    };
    if (promoOpts.discounts?.length) {
        sessionParams.discounts = promoOpts.discounts;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    await SaasSubscription.findOneAndUpdate(
        { restaurantId },
        {
            $set: {
                restaurantId,
                adminUserId: ownerAdminId,
                pendingCheckoutSessionId: session.id,
                status: 'pending',
                tier
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
        message: 'Checkout session created',
        data: { url: session.url, sessionId: session.id }
    };
};

ctl.me = async ({ user }) => {
    if (user.role !== 'restaurantAdmin') {
        throw { status: 403, message: 'Only restaurant admins can view billing' };
    }
    const restaurantId = await getRestaurantIdForRestaurantAdmin(user);
    if (!restaurantId) {
        return {
            message: 'Billing status',
            data: {
                restaurantId: null,
                restaurantName: null,
                billingOverride: { enabled: false },
                subscription: null,
                effectiveTier: 'standard',
                dashboardAllowed: true
            }
        };
    }

    let [restaurant, saas] = await Promise.all([
        Restaurant.findById(restaurantId).select('subscription billingOverride name').lean(),
        SaasSubscription.findOne({ restaurantId }).lean()
    ]);

    const override = restaurant?.billingOverride;

    const subscriptionLooksPaid = (doc) =>
        Boolean(
            doc &&
                (doc.status === 'active' ||
                    ['active', 'trialing'].includes(String(doc.stripeStatus || '').toLowerCase()))
        );

    // After checkout, Mongo can lag behind Stripe; refresh when we would still block dashboard access.
    if (saas?.stripeSubscriptionId && !override?.enabled && !subscriptionLooksPaid(saas)) {
        try {
            const stripe = requireSaasStripe();
            const sub = await stripe.subscriptions.retrieve(saas.stripeSubscriptionId, {
                expand: ['items.data.price']
            });
            await upsertSaasSubscriptionFromStripe(sub, restaurantId, saas.adminUserId || null);
            saas = await SaasSubscription.findOne({ restaurantId }).lean();
        } catch (e) {
            console.warn('[subscriptions/me] Stripe refresh failed', e.message);
        }
    }

    const effectiveTier = override?.enabled ? override.tier : restaurant?.subscription;

    const stripeSaysPaid =
        saas && ['active', 'trialing'].includes(String(saas.stripeStatus || '').toLowerCase());

    return {
        message: 'Billing status',
        data: {
            restaurantId,
            restaurantName: restaurant?.name,
            billingOverride: override || { enabled: false },
            subscription: saas
                ? {
                      status: saas.status,
                      tier: saas.tier,
                      currentPeriodEnd: saas.currentPeriodEnd,
                      cancelAtPeriodEnd: saas.cancelAtPeriodEnd,
                      pauseCollection: saas.pauseCollection,
                      stripeCustomerId: maskId(saas.stripeCustomerId),
                      stripeSubscriptionId: maskId(saas.stripeSubscriptionId)
                  }
                : null,
            effectiveTier,
            dashboardAllowed:
                user.role === 'superAdmin' ||
                Boolean(override?.enabled) ||
                (saas && saas.status === 'active') ||
                Boolean(stripeSaysPaid)
        }
    };
};

ctl.createPortalSession = async ({ user }) => {
    if (user.role !== 'restaurantAdmin') {
        throw { status: 403, message: 'Only restaurant admins can open billing portal' };
    }
    const restaurantId = await getRestaurantIdForRestaurantAdmin(user);
    const saas = await SaasSubscription.findOne({ restaurantId });
    if (!saas?.stripeCustomerId) {
        throw { status: 400, message: 'No Stripe customer on file. Complete checkout first.' };
    }
    const stripe = requireSaasStripe();
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3030';
    const params = {
        customer: saas.stripeCustomerId,
        return_url: `${frontend}/restaurant-admin/dashboard`
    };
    if (process.env.STRIPE_SAAS_PORTAL_CONFIGURATION_ID) {
        params.configuration = process.env.STRIPE_SAAS_PORTAL_CONFIGURATION_ID;
    }
    const portal = await stripe.billingPortal.sessions.create(params);
    return { message: 'Portal session', data: { url: portal.url } };
};

ctl.adminList = async ({ user, query }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const search = String(query.search || '').trim();
    const tier = String(query.tier || '').trim();
    const filter = {};
    if (search) {
        filter.name = new RegExp(escapeRegexAdmin(search), 'i');
    }
    if (tier && ['standard', 'premium', 'advanced'].includes(tier)) {
        filter.subscription = tier;
    }

    const sortBy = ['updatedAt', 'name', 'subscription', 'createdAt'].includes(query.sortBy)
        ? query.sortBy
        : 'updatedAt';
    const sortDir = query.sortDir === 'asc' ? 1 : -1;
    const sort = { [sortBy]: sortDir };

    const [restaurants, total] = await Promise.all([
        Restaurant.find(filter)
            .select('name slug subscription billingOverride adminId isApproved isBlocked')
            .populate('adminId', 'firstName lastName email phone')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        Restaurant.countDocuments(filter)
    ]);

    const ids = restaurants.map((r) => r._id);
    const subs = await SaasSubscription.find({ restaurantId: { $in: ids } }).lean();
    const subByRest = Object.fromEntries(subs.map((s) => [String(s.restaurantId), s]));

    const data = restaurants.map((r) => ({
        restaurant: r,
        saas: subByRest[String(r._id)] || null
    }));

    return { message: 'OK', data: { items: data, page, limit, total } };
};

ctl.adminPause = async ({ user, body }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { restaurantId } = body;
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: 'Invalid restaurantId' };
    }
    const saas = await SaasSubscription.findOne({ restaurantId });
    if (!saas?.stripeSubscriptionId) {
        throw { status: 400, message: 'No active Stripe subscription for this restaurant' };
    }
    const stripe = requireSaasStripe();
    const sub = await stripe.subscriptions.update(saas.stripeSubscriptionId, {
        pause_collection: { behavior: 'mark_uncollectible' }
    });
    await upsertSaasSubscriptionFromStripe(sub, restaurantId, null);
    return { message: 'Subscription billing paused', data: { status: sub.status } };
};

ctl.adminResume = async ({ user, body }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { restaurantId } = body;
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: 'Invalid restaurantId' };
    }
    const saas = await SaasSubscription.findOne({ restaurantId });
    if (!saas?.stripeSubscriptionId) {
        throw { status: 400, message: 'No Stripe subscription for this restaurant' };
    }
    const stripe = requireSaasStripe();
    const sub = await stripe.subscriptions.update(saas.stripeSubscriptionId, {
        pause_collection: ''
    });
    await upsertSaasSubscriptionFromStripe(sub, restaurantId, null);
    return { message: 'Subscription billing resumed', data: { status: sub.status } };
};

ctl.adminBillingOverride = async ({ user, body }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { restaurantId, enabled, tier, reason, until } = body;
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: 'Invalid restaurantId' };
    }
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
        throw { status: 404, message: 'Restaurant not found' };
    }

    if (enabled) {
        const t = tier || restaurant.subscription;
        if (!['standard', 'premium', 'advanced'].includes(t)) {
            throw { status: 400, message: 'Invalid tier' };
        }
        restaurant.subscription = t;
        restaurant.billingOverride = {
            enabled: true,
            tier: t,
            reason: reason || 'manual',
            until: until ? new Date(until) : null
        };
        await restaurant.save();
    } else {
        restaurant.billingOverride = {
            enabled: false,
            tier: restaurant.subscription,
            reason: '',
            until: null
        };
        await restaurant.save();
        const stripe = requireSaasStripe();
        const saas = await SaasSubscription.findOne({ restaurantId });
        if (saas?.stripeSubscriptionId) {
            const sub = await stripe.subscriptions.retrieve(saas.stripeSubscriptionId);
            await upsertSaasSubscriptionFromStripe(sub, restaurantId, null);
        }
    }
    const updated = await Restaurant.findById(restaurantId).lean();
    return { message: 'Billing override updated', data: updated };
};

ctl.adminInvoicesForRestaurant = async ({ user, params, query }) => {
    if (user.role !== 'superAdmin') {
        throw { status: 403, message: 'Forbidden' };
    }
    const { restaurantId } = params;
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: 'Invalid restaurantId' };
    }
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 30));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
        SaasInvoice.find({ restaurantId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        SaasInvoice.countDocuments({ restaurantId })
    ]);
    return { message: 'OK', data: { items, page, limit, total } };
};

module.exports = ctl;
