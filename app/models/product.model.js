const { Schema, model } =  require("mongoose")
const AutoIncrement = require('mongoose-sequence')(require('mongoose'));

const productSchema = new Schema({
    name: { 
        type: String, 
        required: true 
    },
    description: String,
    // Multi-language support
    translations: {
        type: Map,
        of: {
            name: String,
            description: String
        },
        default: new Map()
    },
    price: { 
        type: Number, 
        required: true
    },
    offerPrice: { 
        type: Number, 
        default: 0 // or null if no offer
    },
    discountPercentage: {
        type: Number, // Example: 15 for 15%
        default: 0
    },
    discountExpiry: Date,
    categoryId: {
        type: Schema.Types.ObjectId,
        ref: "Category",
        required: true
    },
    restaurantId: {
        type: Schema.Types.ObjectId,
        ref: "Restaurant",
        required: true
    },
    tags: [String],
    // images: [String],
    images: [
        {
            url: String,
            publicId: String,
            hash: String,
        }
    ],
    isAvailable: { 
        type: Boolean, 
        default: true 
    },
    isFeatured: { 
        type: Boolean, 
        default: false 
    },
    // Size variants (e.g., Small, Medium, Large for juice; Half, Full for chicken)
    sizes: [
        {
            name: {
                type: String,
                required: true
            },
            price: {
                type: Number,
                required: true
            },
            isDefault: {
                type: Boolean,
                default: false
            },
            isAvailable: {
                type: Boolean,
                default: true
            },
            translations: {
                type: Map,
                of: String, // Just the name translation
                default: new Map()
            }
        }
    ],
    // Product-specific addOns (e.g., Spicy, Dynamites for French Fries)
    addOns: [
        {
            name: {
                type: String,
                required: true
            },
            price: {
                type: Number,
                default: 0 // Can be free
            },
            isAvailable: {
                type: Boolean,
                default: true
            },
            translations: {
                type: Map,
                of: String, // Just the name translation
                default: new Map()
            }
        }
    ],
    // Allow common addOns to be applied to this product
    allowCommonAddOns: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

const Product = model('Product', productSchema)
module.exports = Product