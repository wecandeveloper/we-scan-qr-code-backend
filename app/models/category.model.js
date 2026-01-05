const { Schema, model } = require("mongoose")
const AutoIncrement = require("mongoose-sequence")(require("mongoose"))

const categorySchema = new Schema({
    name: { 
        type: String, 
        required: true,
        unique: false
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
    restaurantId: {
        type: Schema.Types.ObjectId,
        ref: "Restaurant",
        required: true
    },
    image: String,
    imagePublicId: String,
    imageHash: String,
}, { timestamps: true });


const Category = model("Category", categorySchema);
module.exports = Category