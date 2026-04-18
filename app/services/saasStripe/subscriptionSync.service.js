const Restaurant = require('../../models/restaurant.model');
const SaasSubscription = require('../../models/saasSubscription.model');
const SaasInvoice = require('../../models/saasInvoice.model');
const { tierFromStripePriceId } = require('./stripeSaas');

function firstSubscriptionItemPriceId(subscription) {
    const item = subscription?.items?.data?.[0];
    return item?.price?.id || item?.plan?.id || null;
}

function mapStripeSubscriptionToInternal(stripeSubscription) {
    const stripeStatus = stripeSubscription.status;
    const pauseCollection = Boolean(
        stripeSubscription.pause_collection &&
            stripeSubscription.pause_collection.behavior
    );

    let status = 'pending';
    if (pauseCollection) {
        status = 'paused';
    } else if (stripeStatus === 'active' || stripeStatus === 'trialing') {
        status = 'active';
    } else if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') {
        status = 'past_due';
    } else if (stripeStatus === 'canceled') {
        status = 'canceled';
    } else if (stripeStatus === 'incomplete' || stripeStatus === 'incomplete_expired') {
        status = 'pending';
    }

    const priceId = firstSubscriptionItemPriceId(stripeSubscription);
    const tier = tierFromStripePriceId(priceId);

    return {
        stripeStatus,
        status,
        tier,
        stripePriceId: priceId,
        currentPeriodStart: stripeSubscription.current_period_start
            ? new Date(stripeSubscription.current_period_start * 1000)
            : null,
        currentPeriodEnd: stripeSubscription.current_period_end
            ? new Date(stripeSubscription.current_period_end * 1000)
            : null,
        cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end),
        pauseCollection
    };
}

async function syncRestaurantSubscriptionTier(restaurantId, tier, billingOverride) {
    if (billingOverride?.enabled) {
        return;
    }
    await Restaurant.findByIdAndUpdate(restaurantId, { subscription: tier });
}

async function upsertSaasSubscriptionFromStripe(stripeSubscription, restaurantId, adminUserId) {
    const mapped = mapStripeSubscriptionToInternal(stripeSubscription);
    const billingOverride = await Restaurant.findById(restaurantId).select('billingOverride').lean();
    const override = billingOverride?.billingOverride;

    const $set = {
        restaurantId,
        stripeCustomerId: stripeSubscription.customer,
        stripeSubscriptionId: stripeSubscription.id,
        stripePriceId: mapped.stripePriceId,
        tier: mapped.tier,
        status: mapped.status,
        stripeStatus: mapped.stripeStatus,
        currentPeriodStart: mapped.currentPeriodStart,
        currentPeriodEnd: mapped.currentPeriodEnd,
        cancelAtPeriodEnd: mapped.cancelAtPeriodEnd,
        pauseCollection: mapped.pauseCollection,
        lastStripeEventId: stripeSubscription.id,
        pendingCheckoutSessionId: null
    };
    if (adminUserId) {
        $set.adminUserId = adminUserId;
    }

    const doc = await SaasSubscription.findOneAndUpdate(
        { restaurantId },
        { $set },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await syncRestaurantSubscriptionTier(restaurantId, mapped.tier, override);
    return doc;
}

async function markSubscriptionExpired(restaurantId) {
    await SaasSubscription.findOneAndUpdate(
        { restaurantId },
        { $set: { status: 'expired', stripeStatus: 'canceled' } },
        { upsert: false }
    );
    const r = await Restaurant.findById(restaurantId).select('billingOverride').lean();
    if (!r?.billingOverride?.enabled) {
        await Restaurant.findByIdAndUpdate(restaurantId, { subscription: 'standard' });
    }
}

async function upsertInvoiceFromStripe(invoice, restaurantId) {
    if (!invoice?.id || !restaurantId) return null;
    return SaasInvoice.findOneAndUpdate(
        { stripeInvoiceId: invoice.id },
        {
            $set: {
                restaurantId,
                stripeSubscriptionId: invoice.subscription || null,
                amountDue: invoice.amount_due || 0,
                amountPaid: invoice.amount_paid || 0,
                currency: (invoice.currency || 'aed').toLowerCase(),
                status: invoice.status,
                hostedInvoiceUrl: invoice.hosted_invoice_url || null,
                invoicePdf: invoice.invoice_pdf || null,
                periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
                periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null
            }
        },
        { upsert: true, new: true }
    );
}

function restaurantIdFromStripeObject(obj) {
    const md = obj?.metadata || {};
    return md.restaurantId || md.restaurant_id || null;
}

module.exports = {
    mapStripeSubscriptionToInternal,
    upsertSaasSubscriptionFromStripe,
    upsertInvoiceFromStripe,
    restaurantIdFromStripeObject,
    markSubscriptionExpired,
    syncRestaurantSubscriptionTier
};
