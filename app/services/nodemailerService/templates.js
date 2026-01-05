const { WEBSITE_URL } = process.env;

const otpMailTemplate = (otp) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WeScan QR Menu - OTP Verification</title>
    <style>
        /* Reset */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: Arial, Helvetica, sans-serif;
        }

        body {
            background-color: #f4f7fc;
            color: #333333;
            padding: 0;
            margin: 0;
        }

        .email-wrapper {
            max-width: 600px;
            margin: 30px auto;
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            border: 1px solid #e0e6ed;
        }

        /* Header */
        .email-header {
            background-color: #00a8e8;
            padding: 20px;
            text-align: center;
        }

        .email-header img {
            height: 100%;
            width: 150px;
            display: block;
            margin: 0 auto;
        }

        /* Body */
        .email-body {
            padding: 30px 25px;
            text-align: center;
        }

        .email-body h1 {
            font-size: 22px;
            margin-bottom: 12px;
            color: #222222;
        }

        .email-body p {
            font-size: 15px;
            color: #555555;
            margin-bottom: 20px;
        }

        /* OTP Box */
        .otp-box {
            display: inline-block;
            background-color: #f0f8ff;
            color: #00a8e8;
            font-size: 28px;
            font-weight: bold;
            padding: 12px 28px;
            border-radius: 8px;
            letter-spacing: 4px;
            margin: 15px 0;
            border: 1px solid #00a8e8;
        }

        /* Security Note */
        .security-note {
            margin-top: 25px;
            font-size: 13px;
            color: #777777;
        }

        /* Footer */
        .email-footer {
            margin-top: 30px;
            padding: 18px;
            text-align: center;
            background-color: #f7f9fc;
            border-top: 1px solid #e6e6e6;
        }

        .email-footer p {
            font-size: 12px;
            color: #777777;
            margin-bottom: 6px;
        }

        .email-footer a {
            color: #00a8e8;
            text-decoration: none;
            font-weight: 500;
        }

        @media screen and (max-width: 600px) {
            .email-wrapper {
                margin: 15px;
            }

            .email-header img {
                width: 120px;
            }

            .email-body h1 {
                font-size: 18px;
            }

            .otp-box {
                font-size: 22px;
                padding: 10px 24px;
            }
        }
    </style>
</head>
<body>
    <div class="email-wrapper">
        <!-- Header -->
        <div class="email-header">
            <img src="https://res.cloudinary.com/dblnpclgb/image/upload/v1756978484/we-scan-logo_mzgyfg.png" alt="WeScan Logo" />
        </div>

        <!-- Body -->
        <div class="email-body">
            <h1>Welcome to WeScan QR Menu 🎉</h1>
            <p>Thank you for registering with <strong>WeScan</strong>. Use the OTP below to verify your email address and complete your signup.</p>

            <!-- OTP -->
            <div class="otp-box">${otp}</div>

            <p class="security-note">
                ⚠️ Do not share this OTP with anyone for your security.
            </p>
        </div>

        <!-- Footer -->
        <div class="email-footer">
            <p>© ${new Date().getFullYear()} WeScan QR Menu. All rights reserved.</p>
            <p>
                <a href="${WEBSITE_URL}privacy">Privacy Policy</a> |
                <a href="${WEBSITE_URL}terms">Terms & Conditions</a>
            </p>
        </div>
    </div>
</body>
</html>
`;

module.exports = {
    otpMailTemplate
};