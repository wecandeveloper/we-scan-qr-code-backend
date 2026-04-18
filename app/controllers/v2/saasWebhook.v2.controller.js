const StripeWebhookEvent = require('../../models/stripeWebhookEvent.model');
const { requireSaasStripe } = require('../../services/saasStripe/stripeSaas');
const {
    upsertSaasSubscriptionFromStripe,
    upsertInvoiceFromStripe,
    restaurantIdFromStripeObject,
    markSubscriptionExpired
} = require('../../services/saasStripe/subscriptionSync.service');
const {
    notifyInvoicePaymentFailed,
    notifyInvoicePaymentActionRequired
} = require('../../services/saasStripe/saasBillingNotify.service');
const { default: mongoose } = require('mongoose');

async function claimEvent(eventId, type) {
    try {
        await StripeWebhookEvent.create({ stripeEventId: eventId, type });
        return true;
    } catch (err) {
        if (err && err.code === 11000) {
            return false;
        }
        throw err;
    }
}

async function handleCheckoutSessionCompleted(session) {
    if (session.mode !== 'subscription' || !session.subscription) {
        return;
    }
    const restaurantId = session.metadata?.restaurantId;
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        console.error('[saas webhook] checkout.session.completed missing restaurantId');
        return;
    }
    const stripe = requireSaasStripe();
    const sub = await stripe.subscriptions.retrieve(session.subscription, {
        expand: ['items.data.price']
    });
    const adminUserId = session.metadata?.userId;
    await upsertSaasSubscriptionFromStripe(
        sub,
        restaurantId,
        mongoose.Types.ObjectId.isValid(adminUserId) ? adminUserId : null
    );
}

async function handleSubscriptionUpdated(subscription) {
    const restaurantId = restaurantIdFromStripeObject(subscription);
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        return;
    }
    await upsertSaasSubscriptionFromStripe(subscription, restaurantId, null);
}

async function handleSubscriptionDeleted(subscription) {
    const restaurantId = restaurantIdFromStripeObject(subscription);
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        return;
    }
    await markSubscriptionExpired(restaurantId);
}

async function handleInvoice(invoice, isFailed = false, isActionRequired = false) {
    let restaurantId = invoice.metadata?.restaurantId;
    let subscriptionObj = null;
    if (!restaurantId && invoice.subscription) {
        const stripe = requireSaasStripe();
        subscriptionObj =
            typeof invoice.subscription === 'string'
                ? await stripe.subscriptions.retrieve(invoice.subscription)
                : invoice.subscription;
        restaurantId = restaurantIdFromStripeObject(subscriptionObj);
    }
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        return;
    }
    await upsertInvoiceFromStripe(invoice, restaurantId);
    if (invoice.subscription) {
        const stripe = requireSaasStripe();
        const sub =
            subscriptionObj ||
            (typeof invoice.subscription === 'string'
                ? await stripe.subscriptions.retrieve(invoice.subscription)
                : invoice.subscription);
        await upsertSaasSubscriptionFromStripe(sub, restaurantId, null);
    }
    if (isFailed) {
        await notifyInvoicePaymentFailed(restaurantId, invoice);
    }
    if (isActionRequired) {
        await notifyInvoicePaymentActionRequired(restaurantId, invoice);
    }
}

/**
 * Express handler — must be mounted with express.raw on this path only.
 */
async function handleStripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_SAAS_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[saas webhook] STRIPE_SAAS_WEBHOOK_SECRET missing');
        return res.status(503).send('Webhook not configured');
    }

    let event;
    try {
        const stripe = requireSaasStripe();
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
        console.error('[saas webhook] signature failed', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const isNew = await claimEvent(event.id, event.type);
    if (!isNew) {
        return res.json({ received: true, duplicate: true });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutSessionCompleted(event.data.object);
                break;
            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object);
                break;
            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object);
                break;
            case 'invoice.paid':
            case 'invoice.finalized':
                await handleInvoice(event.data.object, false, false);
                break;
            case 'invoice.payment_failed':
                await handleInvoice(event.data.object, true, false);
                break;
            case 'invoice.payment_action_required':
                await handleInvoice(event.data.object, false, true);
                break;
            default:
                break;
        }
    } catch (e) {
        console.error('[saas webhook] handler error', e);
        return res.status(500).json({ message: 'Webhook processing failed' });
    }

    return res.json({ received: true });
}

module.exports = { handleStripeWebhook };
