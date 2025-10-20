const { Schema, model } = require('mongoose')
const AutoIncrement = require("mongoose-sequence")(require("mongoose"))

const restaurantSchema = new Schema({
    // restaurantId: {
    //     type: Number,
    //     unique: true
    // },
    name: { type: String, required: true },
    nameChanged: { type: Boolean, default: true }, // Track if name has been changed
    slug: { type: String, unique: true }, // for QR link
    folderKey: String, // Cloudinary folder key
    qrCodeURL: String,
    adminId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    address: {
        city: String,
        area: String,
        street: String
    },
    location: {
        type: { 
            type: String, 
            enum: ['Point'], 
            default: 'Point' 
        },
        coordinates: [Number] // [lng, lat]
    },
    contactNumber: {
        number: String,
        countryCode: String
    },
    images: [
        {
            url: String,
            publicId: String,
            hash: String,
        }
    ],
    tableCount: Number,
    isOpen: { 
        type: Boolean, 
        default: true 
    },
    isApproved: { 
        type: Boolean, 
        default: false 
    },
    isBlocked: { 
        type: Boolean, 
        default: false 
    },
    // Subscription and Language Management
    subscription: {
        type: String,
        enum: ['standard', 'premium'],
        default: 'standard'
    },
    languages: {
        type: [String],
        default: []
    },
    theme: {
        primaryColor: {
            type: String,
            default: "#000000"
        },
        secondaryColor: {
            type: String,
            default: "#ffffff"
        },
        buttonColor: {
            type: String,
            default: "#000000"
        },
        logo: {
            url: String,
            publicId: String,
            hash: String,
        },
        favIcon: {
            url: String,
            publicId: String,
            hash: String,
        },
        bannerImages: [
            {
                url: String,
                publicId: String,
                hash: String,
            }
        ],
        offerBannerImages: [
            {
                url: String,
                publicId: String,
                hash: String,
            }
        ],
        // layoutStyle: {
        //     type: String,
        //     enum: ["default", "modern", "classic"], // optional, if you plan multiple layouts
        //     default: "default"
        // }
    },
    socialMediaLinks: [
        {
            platform: { 
                type: String, 
                required: true 
            },
            link: { 
                type: String, 
                required: true 
            }
        }
    ],
    googleReviewLink: String,
    isTakeAwayAvailable: { 
        type: Boolean, 
        default: false 
    },
    isHomeDeliveryAvailable: { 
        type: Boolean, 
        default: false 
    },
    isDineInAvailable: { 
        type: Boolean, 
        default: true 
    },
    isCustomerOrderAvailable: {
        type: Boolean, 
        default: true 
    },
    operatingHours: {
        openingTime: {
            type: String,
            default: "00:00" // Format: "HH:MM" (24-hour format)
        },
        closingTime: {
            type: String,
            default: "23:59" // Format: "HH:MM" (24-hour format)
        },
        timezone: {
            type: String,
            default: "Asia/Dubai" // UAE timezone
        }
    }
}, { timestamps: true });

// restaurantSchema.plugin(AutoIncrement, { inc_field: 'restaurantId' })

const Restaurant = model('Restaurant', restaurantSchema)
module.exports = Restaurant