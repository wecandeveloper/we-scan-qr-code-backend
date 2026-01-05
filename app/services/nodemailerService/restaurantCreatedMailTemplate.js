const restaurantCreatedMailTemplate = (restaurant) => `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>New Restaurant Registration - Admin Notification</title>
<style>
    body {
        background-color: #f4f7fc;
        font-family: Arial, Helvetica, sans-serif;
        color: #333333;
        margin: 0;
        padding: 0;
    }

    .email-wrapper {
        max-width: 600px;
        margin: 30px auto;
        background-color: #ffffff;
        border-radius: 12px;
        border: 1px solid #e0e6ed;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }

    .email-header {
        background-color: #00a8e8;
        padding: 20px;
        text-align: center;
        color: #ffffff;
    }

    .email-header h1 {
        font-size: 20px;
        margin: 0;
    }

    .email-body {
        padding: 30px 25px;
    }

    .email-body h2 {
        font-size: 18px;
        color: #222222;
        margin-bottom: 15px;
    }

    .restaurant-details {
        background-color: #f0f8ff;
        padding: 15px;
        border-radius: 8px;
        margin-bottom: 20px;
        border: 1px solid #00a8e8;
    }

    .restaurant-details p {
        margin: 6px 0;
        font-size: 14px;
        color: #555555;
    }

    .reminder {
        font-size: 14px;
        color: #333333;
        margin-bottom: 20px;
    }

    .footer {
        background-color: #f7f9fc;
        text-align: center;
        padding: 18px;
        border-top: 1px solid #e6e6e6;
        font-size: 12px;
        color: #777777;
    }

    .footer a {
        color: #00a8e8;
        text-decoration: none;
        font-weight: 500;
    }

    @media screen and (max-width: 600px) {
        .email-wrapper {
            margin: 15px;
        }
    }
</style>
</head>
<body>
    <div class="email-wrapper">
        <!-- Header -->
        <div class="email-header">
            <h1>New Restaurant Registration</h1>
        </div>

        <!-- Body -->
        <div class="email-body">
            <h2>Hi Admin,</h2>
            <p>A new restaurant has been registered on your platform. Please review the details below and take the necessary action to accept or block the restaurant profile.</p>

            <div class="restaurant-details">
                <p><strong>Name:</strong> ${restaurant.name}</p>
                <p><strong>Slug:</strong> ${restaurant.slug}</p>
                <p><strong>Email:</strong> ${restaurant.adminEmail || "Not Provided"}</p>
                <p><strong>Phone:</strong> ${restaurant.contactNumber?.countryCode || ""} ${restaurant.contactNumber?.number || ""}</p>
                <p><strong>City:</strong> ${restaurant.address?.city || ""}</p>
                <p><strong>Area:</strong> ${restaurant.address?.area || ""}</p>
                <p><strong>Street:</strong> ${restaurant.address?.street || ""}</p>
                <p><strong>Tables:</strong> ${restaurant.tableCount || 0}</p>
            </div>

            <p class="reminder">⚠️ Please login to your admin panel to <strong>accept</strong> or <strong>block</strong> this restaurant profile. Timely action ensures a smooth onboarding process for the restaurant owner.</p>
        </div>

        <!-- Footer -->
        <div class="footer">
            <p>© ${new Date().getFullYear()} WeScan QR Menu. All rights reserved.</p>
            <p>
                <a href="${process.env.WEBSITE_URL}privacy">Privacy Policy</a> |
                <a href="${process.env.WEBSITE_URL}terms">Terms & Conditions</a>
            </p>
        </div>
    </div>
</body>
</html>
`;

module.exports = { restaurantCreatedMailTemplate };
