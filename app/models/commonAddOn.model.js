const { Schema, model } = require("mongoose");

const commonAddOnSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ""
    },
    price: {
        type: Number,
        default: 0 // Can be free (e.g., Extra Ice, Extra Sugar)
    },
    isAvailable: {
        type: Boolean,
        default: true
    },
    // Multi-language support
    translations: {
        type: Map,
        of: {
            name: String,
            description: String
        },
        default: new Map()
    }
    // Note: No restaurantId - these are global across all restaurants
}, { timestamps: true });

const CommonAddOn = model('CommonAddOn', commonAddOnSchema);
module.exports = CommonAddOn;

