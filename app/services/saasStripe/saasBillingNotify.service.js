const { sendMailFunc } = require('../nodemailerService/nodemailer.service');
const User = require('../../models/user.model');
const Restaurant = require('../../models/restaurant.model');

async function notifyRestaurantAdmins(restaurantId, subject, html) {
    const users = await User.find({ restaurantId, role: 'restaurantAdmin' })
        .select('email')
        .lean();
    const to = users.map((u) => u.email?.address).filter(Boolean);
    if (!to.length) return;
    try {
        await sendMailFunc({ to, subject, html });
    } catch (e) {
        console.error('[saasBillingNotify]', e);
    }
}

async function notifyInvoicePaymentFailed(restaurantId, invoice) {
    const restaurant = await Restaurant.findById(restaurantId).select('name').lean();
    const name = restaurant?.name || 'Your restaurant';
    const amount = invoice?.amount_due != null ? (invoice.amount_due / 100).toFixed(2) : '';
    const cur = (invoice?.currency || 'aed').toUpperCase();
    await notifyRestaurantAdmins(
        restaurantId,
        `Dineos: payment failed for ${name}`,
        `<p>We could not collect your subscription payment${amount ? ` (${amount} ${cur})` : ''}.</p>
         <p>Your subscription is past due. Please update your payment method in the billing portal to avoid service interruption.</p>`
    );
}

async function notifyInvoicePaymentActionRequired(restaurantId, invoice) {
    const restaurant = await Restaurant.findById(restaurantId).select('name').lean();
    const name = restaurant?.name || 'Your restaurant';
    await notifyRestaurantAdmins(
        restaurantId,
        `Dineos: action required — ${name}`,
        `<p>Your subscription invoice requires action (for example 3D Secure).</p>
         ${
             invoice?.hosted_invoice_url
                 ? `<p><a href="${invoice.hosted_invoice_url}">Open invoice</a></p>`
                 : ''
         }`
    );
}

module.exports = {
    notifyInvoicePaymentFailed,
    notifyInvoicePaymentActionRequired
};
