const { Types } = require("mongoose");

const couponValidationSchema = {
    name: {
        notEmpty: {
            errorMessage: "Coupon name is required",
        },
        isString: {
            errorMessage: "Coupon name must be a string",
        },
        trim: true,
    },

    code: {
        notEmpty: {
            errorMessage: "Coupon code is required",
        },
        isString: {
            errorMessage: "Coupon code must be a string",
        },
        trim: true,
        toUpperCase: true,
    },

    type: {
        optional: true,
        isIn: {
            options: [["percentage", "fixed"]],
            errorMessage: "Coupon type must be either 'percentage' or 'fixed'",
        },
    },

    value: {
        notEmpty: {
            errorMessage: "Coupon value is required",
        },
        isFloat: {
            options: { min: 0 },
            errorMessage: "Coupon value must be a positive number",
        },
    },

    maxDiscount: {
        optional: true,
        isFloat: {
            options: { min: 0 },
            errorMessage: "Max discount must be a positive number",
        },
    },

    minOrderAmount: {
        optional: true,
        isFloat: {
            options: { min: 0 },
            errorMessage: "Minimum order amount must be a non-negative number",
        },
    },

    usageLimit: {
        optional: true,
        isInt: {
            options: { min: 1 },
            errorMessage: "Usage limit must be an integer of 1 or more",
        },
    },

    usedCount: {
        optional: true,
        isInt: {
            options: { min: 0 },
            errorMessage: "Used count must be a non-negative integer",
        },
    },

    isActive: {
        optional: true,
        isBoolean: {
            errorMessage: "isActive must be a boolean value",
        },
        toBoolean: true,
    },

    validFrom: {
        optional: true,
        isISO8601: {
            errorMessage: "validFrom must be a valid date",
        },
        toDate: true,
    },

    validTill: {
        notEmpty: {
            errorMessage: "validTill is required",
        },
        isISO8601: {
            errorMessage: "validTill must be a valid date",
        },
        toDate: true,
    },

    applicableTo: {
        optional: true,
        isArray: {
            errorMessage: "applicableTo must be an array",
        },
        custom: {
            options: (value) => {
                if (value.every(tag => typeof tag === "string")) return true;
                throw new Error("Each applicableTo value must be a string");
            },
        },
    },

    createdBy: {
        optional: true,
        custom: {
            options: (value) => {
                if (!Types.ObjectId.isValid(value)) {
                throw new Error("Invalid user ID in 'createdBy'");
                }
                return true;
            },
        },
    },
};

module.exports = couponValidationSchema;
