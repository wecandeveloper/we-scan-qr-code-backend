const { Types } = require('mongoose');
const Restaurant = require('../models/restaurant.model');
const Table = require('../models/table.model');
const Product = require('../models/product.model');
const CommonAddOn = require('../models/commonAddOn.model');

const orderValidationSchema = {
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
    // tableId: {
    //     notEmpty: {
    //         errorMessage: "Table ID is required",
    //     },
    //     custom: {
    //         options: async (value) => {
    //             if (!Types.ObjectId.isValid(value)) {
    //                 throw new Error("Invalid Table ID");
    //             }

    //             const table = await Table.findById(value);
    //             if (!table) {
    //                 throw new Error("Table not found");
    //             }
    //             return true;
    //         },
    //     },
    // },
    lineItems: {
        optional: true, // Optional since we can have addOnsLineItems only
        isArray: {
            errorMessage: "Line items must be an array",
        },
        custom: {
            options: async (lineItems, { req }) => {
                // If lineItems is provided, validate it
                if (lineItems && lineItems.length > 0) {
                    for (const item of lineItems) {
                        // Validate quantity for all items
                        if (typeof item.quantity !== 'number' || item.quantity <= 0) {
                            throw new Error("Quantity must be a positive number");
                        }

                        // All items in lineItems must be products (no common addOns here)
                        if (!Types.ObjectId.isValid(item.productId)) {
                            throw new Error("Invalid product ID in line items");
                        }

                        const product = await Product.findById(item.productId);
                        if (!product) {
                            throw new Error(`Product not found for ID: ${item.productId}`);
                        }
                    }
                }
                
                // Check that at least one of lineItems or addOnsLineItems has items
                const addOnsLineItems = req.body.addOnsLineItems || [];
                if ((!lineItems || lineItems.length === 0) && (!addOnsLineItems || addOnsLineItems.length === 0)) {
                    throw new Error("At least one item is required (either in lineItems or addOnsLineItems)");
                }

                return true;
            },
        },
    },
    addOnsLineItems: {
        optional: true, // Optional since we can have lineItems only
        isArray: {
            errorMessage: "Add-ons line items must be an array",
        },
        custom: {
            options: async (addOnsLineItems) => {
                // If addOnsLineItems is provided, validate it
                if (addOnsLineItems && addOnsLineItems.length > 0) {
                    for (const item of addOnsLineItems) {
                        // Validate quantity
                        if (typeof item.quantity !== 'number' || item.quantity <= 0) {
                            throw new Error("Quantity must be a positive number for add-on items");
                        }

                        // Validate common addOn name
                        if (!item.commonAddOnName || typeof item.commonAddOnName !== 'string') {
                            throw new Error("Common addOn name is required for add-on items");
                        }
                        
                        const commonAddOn = await CommonAddOn.findOne({ 
                            name: item.commonAddOnName, 
                            isAvailable: true 
                        });
                        
                        if (!commonAddOn) {
                            throw new Error(`Invalid or unavailable common addOn "${item.commonAddOnName}"`);
                        }
                    }
                }

                return true;
            },
        },
    },
    status: {
        optional: true, // Allow default to work if not passed
        isIn: {
            options: [[
                // Take Away statuses
                'Order Received', 'Preparing', 'Ready for Collection', 'Collected',
                // Dining statuses  
                'Ready to Serve', 'Served',
                // Home Delivery statuses
                'Out for Delivery', 'Delivered',
                // Common statuses
                'Cancelled'
            ]],
            errorMessage: "Status must be one of the valid order statuses",
        },
    }
};

const changeOrderValidationShcema = {
    status: {
        optional: true, // Allow default to work if not passed
        isIn: {
            options: [[
                // Take Away statuses
                'Order Received', 'Preparing', 'Ready for Collection', 'Collected',
                // Dining statuses  
                'Ready to Serve', 'Served',
                // Home Delivery statuses
                'Out for Delivery', 'Delivered',
                // Common statuses
                'Cancelled'
            ]],
            errorMessage: "Status must be one of the valid order statuses",
        },
    },
    cancellationReason: {
        optional: true,
        isString: {
            errorMessage: "Cancellation reason must be a string",
        },
        isLength: {
            options: { min: 1, max: 500 },
            errorMessage: "Cancellation reason must be between 1 and 500 characters",
        },
        custom: {
            options: (value, { req }) => {
                // If status is 'Cancelled', cancellationReason is required
                if (req.body.status === 'Cancelled' && (!value || value.trim().length === 0)) {
                    throw new Error("Cancellation reason is required when cancelling an order");
                }
                return true;
            },
        },
    }
}

const adminCancelValidationSchema = {
    cancellationReason: {
        notEmpty: {
            errorMessage: "Cancellation reason is required",
        },
        isString: {
            errorMessage: "Cancellation reason must be a string",
        },
        isLength: {
            options: { min: 5, max: 500 },
            errorMessage: "Cancellation reason must be between 5 and 500 characters",
        },
    },
};

module.exports = {
    orderValidationSchema,
    changeOrderValidationShcema,
    adminCancelValidationSchema
};