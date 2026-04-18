const slugify = require('slugify');
const { default: mongoose } = require('mongoose');
const User = require('../../models/user.model');
const Restaurant = require('../../models/restaurant.model');
const Table = require('../../models/table.model');
const PendingSaasSignup = require('../../models/pendingSaasSignup.model');
const { generateQRCodeURL } = require('../generateQRCode/generateQrCode');
const { uploadImageBuffer } = require('../unifiedUploader/unified.uploader');
const { websiteUrl } = require('../../apis/api');
const { requireSaasStripe } = require('./stripeSaas');
const { upsertSaasSubscriptionFromStripe } = require('./subscriptionSync.service');

async function makeUniqueSlug(name) {
    const base = slugify(String(name || 'restaurant'), { lower: true, strict: true }) || 'restaurant';
    let slug = base;
    let n = 0;
    while (await Restaurant.findOne({ slug })) {
        n += 1;
        slug = `${base}-${n}`;
    }
    return slug;
}

async function seedTables(restaurantId, count) {
    const tables = [];
    for (let i = 1; i <= count; i += 1) {
        tables.push({ restaurantId, tableNumber: `T${i}` });
    }
    if (tables.length) {
        await Table.insertMany(tables);
    }
}

/**
 * Create restaurant + admin from a paid guest Stripe Checkout session (idempotent).
 * @param {import('stripe').Stripe.Checkout.Session} session
 * @returns {Promise<{ ok: boolean, reason?: string, userId?: string, restaurantId?: string }>}
 */
async function provisionGuestSignupFromStripeSession(session) {
    if (session.mode !== 'subscription' || !session.subscription) {
        return { ok: false, reason: 'not_subscription' };
    }

    const pendingId = session.metadata?.pendingSignupId;
    if (!pendingId || !mongoose.Types.ObjectId.isValid(pendingId)) {
        return { ok: false, reason: 'no_pending' };
    }

    const pending = await PendingSaasSignup.findById(pendingId);
    if (!pending) {
        return { ok: false, reason: 'pending_missing' };
    }

    if (pending.status === 'completed' && pending.completedUserId) {
        return {
            ok: true,
            userId: String(pending.completedUserId),
            restaurantId: pending.completedRestaurantId ? String(pending.completedRestaurantId) : undefined
        };
    }

    if (session.payment_status !== 'paid') {
        return { ok: false, reason: 'unpaid' };
    }

    const emailNorm = pending.email.toLowerCase().trim();
    let user = await User.findOne({ 'email.address': emailNorm });
    if (user) {
        await PendingSaasSignup.findByIdAndUpdate(pending._id, {
            status: 'completed',
            completedUserId: user._id,
            completedRestaurantId: user.restaurantId || null
        });
        return {
            ok: true,
            userId: String(user._id),
            restaurantId: user.restaurantId ? String(user.restaurantId) : undefined
        };
    }

    const tier =
        pending.tier && ['standard', 'premium', 'advanced'].includes(pending.tier) ? pending.tier : 'standard';
    const slug = await makeUniqueSlug(pending.restaurantName);
    const folderKey = `We-QrCode/${slug}`;
    const tableCount = 5;

    user = new User({
        firstName: pending.firstName || '',
        lastName: pending.lastName || '',
        email: { address: emailNorm, isVerified: false },
        password: pending.passwordHash,
        phone: {
            number: pending.phoneNumber || '',
            countryCode: pending.phoneCountryCode || '',
            isVerified: false
        },
        role: 'restaurantAdmin'
    });

    try {
        await user.save();
    } catch (err) {
        if (err && err.code === 11000) {
            user = await User.findOne({ 'email.address': emailNorm });
            if (user) {
                await PendingSaasSignup.findByIdAndUpdate(pending._id, {
                    status: 'completed',
                    completedUserId: user._id,
                    completedRestaurantId: user.restaurantId || null
                });
                return {
                    ok: true,
                    userId: String(user._id),
                    restaurantId: user.restaurantId ? String(user.restaurantId) : undefined
                };
            }
        }
        console.error('[guestSaas] user save failed', err);
        return { ok: false, reason: 'user_create_failed' };
    }

    const restaurant = new Restaurant({
        name: pending.restaurantName.trim(),
        adminId: user._id,
        slug,
        folderKey,
        images: [],
        subscription: tier,
        isApproved: true,
        isOpen: true,
        address: { street: '', area: '', city: '' },
        contactNumber: { number: '', countryCode: '' },
        location: { type: 'Point', coordinates: [0, 0] },
        tableCount,
        isDineInAvailable: true,
        isTakeAwayAvailable: tier === 'premium' || tier === 'advanced',
        isHomeDeliveryAvailable: tier === 'premium' || tier === 'advanced',
        isCustomerOrderAvailable: true
    });

    try {
        await restaurant.save();
    } catch (err) {
        console.error('[guestSaas] restaurant save failed', err);
        await User.findByIdAndDelete(user._id);
        return { ok: false, reason: 'restaurant_create_failed' };
    }

    await User.findByIdAndUpdate(user._id, { restaurantId: restaurant._id });
    await seedTables(restaurant._id, tableCount);

    try {
        const restaurantUrl = `${websiteUrl}/restaurant/${restaurant.slug}`;
        const qrBuffer = await generateQRCodeURL(restaurantUrl);
        const uploadedQR = await uploadImageBuffer(qrBuffer, null, `${restaurant.folderKey}/Qr-Code`);
        restaurant.qrCodeURL = uploadedQR.secure_url;
        await restaurant.save();
    } catch (err) {
        console.error('[guestSaas] QR upload failed', err);
    }

    const stripe = requireSaasStripe();
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price'] });

    await upsertSaasSubscriptionFromStripe(sub, String(restaurant._id), String(user._id));

    try {
        await stripe.subscriptions.update(subId, {
            metadata: {
                restaurantId: String(restaurant._id),
                userId: String(user._id),
                tier,
                billingInterval: pending.interval || 'month',
                pendingSignupId: String(pending._id),
                signupSource: 'guest_saas'
            }
        });
    } catch (err) {
        console.warn('[guestSaas] subscription metadata update failed', err.message);
    }

    await PendingSaasSignup.findByIdAndUpdate(pending._id, {
        status: 'completed',
        completedUserId: user._id,
        completedRestaurantId: restaurant._id
    });

    return { ok: true, userId: String(user._id), restaurantId: String(restaurant._id) };
}

module.exports = { provisionGuestSignupFromStripeSession };
