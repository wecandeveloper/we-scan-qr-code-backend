const nodemailer = require('nodemailer')
require('dotenv').config()

// Gmail: use the full address for EMAIL and a Google "App password" for APP_PASSWORD
// (https://support.google.com/accounts/answer/185833). A normal account password will fail with 535.

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL,
        pass: process.env.APP_PASSWORD
    },
    tls: {
        rejectUnauthorized: false
    }
})

module.exports = transporter