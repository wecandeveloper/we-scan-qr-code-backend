const { Schema, model, default: mongoose } = require("mongoose");
const AutoIncrement = require('mongoose-sequence')(require('mongoose'));

const couponSchema = new Schema(
    {
        name : {
            type : String,
            required : true
        },
        code: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true, // ensures all stored codes are uppercase
        },
        type: {
            type: String,
            enum: ["percentage", "fixed"], // 10% or $10
            default: "percentage",
        },
        value: {
            type: Number,
            required: true, // 10 => 10% or 10 AED depending on type
        },
        maxDiscount: {
            type: Number,
            default: null, // Optional limit for percentage coupons
        },
        minOrderAmount: {
            type: Number,
            default: 0, // Only valid if cart total >= this
        },
        usageLimit: {
            type: Number,
            default: 1, // How many times it can be used globally
        },
        usedCount: {
            type: Number,
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        validFrom: {
            type: Date,
            default: Date.now,
        },
        validTill: {
            type: Date,
            required: true,
        },
        applicableTo: {
            type: [String], // Optional: limit to categories or product tags
            default: [], // e.g., ["electronics", "clothing"]
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // or "User" depending on who creates it
        },
}, { timestamps: true });

// Auto-update isActive before saving
couponSchema.pre('save', function (next) {
    const now = new Date();
    this.isActive = this.validFrom <= now && this.validTill >= now;
    next();
});


const Coupon = model("Coupon", couponSchema);
module.exports = Coupon
