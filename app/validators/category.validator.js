const { Types } = require('mongoose');
const Category = require('../models/category.model');  // Adjust path as per your project structure
const Restaurant = require('../models/restaurant.model');
const User = require('../models/user.model');

const categoryValidationSchema = {
    name: {
        notEmpty: {
            errorMessage: "Category name is required",
        },
        trim: true,
        },
    restaurantId: {
        notEmpty: {
            errorMessage: "Restaurant ID is required",
        },
        custom: {
            options: async (value) => {
                if (!Types.ObjectId.isValid(value)) {
                    throw new Error("Invalid Restaurant ID");
                }
                
                const restaurant = await Restaurant.findById(value);
                if (!restaurant) {
                    throw new Error("Restaurant not found");
                }
                
                return true;
            },
        },
    },
    description: {
        // optional: true, // Description is not required
        isString: {
            errorMessage: "Description must be a string",
        },
        trim: true,
    },

    // image: String,  // Single image URL

    // image: {
    //     notEmpty: {
    //         errorMessage: "Product Category Image is required",
    //     },
    //     // optional: true,
    //     isString: {
    //         errorMessage: "Image must be a string URL",
    //     },
    // },
};

module.exports = categoryValidationSchema;