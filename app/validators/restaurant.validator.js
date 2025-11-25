const Store = require("../models/restaurant.model");

const restaurantValidationSchema = {
    name: {
        notEmpty: {
        errorMessage: "Store name is required",
        },
        // custom: {
        //     options: async function (value) {
        //         const store = await Store.findOne({
        //             name: value,
        //             $or: [
        //                 { isRejected: { $exists: false } },
        //                 { isRejected: false }
        //             ]
        //         });
        //         if (!store) {
        //             return true;
        //         } else {
        //             throw new Error("Store name already exists");
        //         }
        //     },
        // },
    },

    slug: {
        optional: true,
        isSlug: {
        errorMessage: "Slug must be URL friendly (e.g., kebab-case)",
        },
        trim: true,
    },

    // adminId: {
    //     isMongoId: {
    //         errorMessage: "Admin ID must be a valid Mongo ID",
    //     },
    // },

    'address.city': {
        notEmpty: {
            errorMessage: "City is required",
        },
        isString: {
            errorMessage: "City must be a string",
        },
        trim: true,
    },

    'address.area': {
        notEmpty: {
            errorMessage: "Area is required",
        },
        isString: {
            errorMessage: "Area must be a string",
        },
        trim: true,
    },

    'address.street': {
        optional: true,
        isString: {
            errorMessage: "Street must be a string",
        },
        trim: true,
    },

    // longitude: {
    //     notEmpty: {
    //         errorMessage: "Longitude is required",
    //     },
    //     isFloat: {
    //         errorMessage: "Longitude must be a valid number",
    //     },
    //     toFloat: true,
    // },

    // latitude: {
    //     notEmpty: {
    //         errorMessage: "Latitude is required",
    //     },
    //     isFloat: {
    //         errorMessage: "Latitude must be a valid number",
    //     },
    //     toFloat: true,
    // },

    // location: {
    //     notEmpty: {
    //         errorMessage: "Location is required",
    //     },
    //     custom: {
    //         options: (value) => {
    //             if (!value || typeof value !== "object") {
    //                 throw new Error("Location must be an object");
    //             }
    //             if (value.type !== "Point") {
    //                 throw new Error("Location type must be 'Point'");
    //             }
    //             if (!Array.isArray(value.coordinates) || value.coordinates.length !== 2) {
    //                 throw new Error("Coordinates must be an array of [longitude, latitude]");
    //             }

    //             const [longitude, latitude] = value.coordinates;

    //             if (typeof longitude !== "number" || typeof latitude !== "number") {
    //                 throw new Error("Coordinates must be numbers");
    //             }

    //             if (longitude < -180 || longitude > 180) {
    //                 throw new Error("Longitude must be between -180 and 180");
    //             }

    //             if (latitude < -90 || latitude > 90) {
    //                 throw new Error("Latitude must be between -90 and 90");
    //             }

    //             return true;
    //         },
    //     },
    // },

    'contactNumber.number': {
        notEmpty: {
        errorMessage: "Contact number is required",
        },
        isMobilePhone: {
        options: ["any"],
        errorMessage: "Contact number must be a valid phone number",
        },
    },

    'contactNumber.countryCode': {
        notEmpty: {
        errorMessage: "Country code is required",
        },
        isString: {
        errorMessage: "Country code must be a string",
        },
    },

    images: {
        optional: true,
        isArray: {
        errorMessage: "Images must be an array",
        },
        custom: {
        options: (value) => {
            if (value.every((item) => typeof item === "string")) {
            return true;
            }
            throw new Error("Each image must be a string (URL or path)");
        },
        },
    },

    isOpen: {
        optional: true,
        isBoolean: {
        errorMessage: "isOpen must be a boolean value",
        },
        toBoolean: true,
    },

    isApproved: {
        optional: true,
        isBoolean: {
        errorMessage: "isApproved must be a boolean value",
        },
        toBoolean: true,
    },

    isBlocked: {
        optional: true,
        isBoolean: {
        errorMessage: "isBlocked must be a boolean value",
        },
        toBoolean: true,
    },

    'theme.primaryColor': {
        optional: true,
        isString: {
        errorMessage: "Primary color must be a string",
        },
    },

    'theme.secondaryColor': {
        optional: true,
        isString: {
        errorMessage: "Secondary color must be a string",
        },
    },

    'theme.logoURL': {
        optional: true,
        isURL: {
        errorMessage: "Logo URL must be a valid URL",
        },
    },

    'theme.layoutStyle': {
        optional: true,
        isString: {
        errorMessage: "Layout style must be a string",
        },
    },

    subscription: {
        optional: true,
        isIn: {
            options: [['standard', 'premium', 'advanced']],
            errorMessage: "Subscription must be 'standard', 'premium', or 'advanced'",
        },
    },
};

module.exports = restaurantValidationSchema