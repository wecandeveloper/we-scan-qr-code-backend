const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
    restaurantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Restaurant",
        required: true,
        unique: true
    },
    seq: { type: Number, default: 0 }
}, { 
    collection: 'orderCounters' // Use different collection to avoid conflict with mongoose-sequence's 'counters' collection
});

module.exports = mongoose.model("Counter", counterSchema);