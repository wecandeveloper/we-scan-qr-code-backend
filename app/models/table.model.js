const { Schema, model } = require('mongoose')
// const AutoIncrement = require("mongoose-sequence")(require("mongoose"))

const tableSchema = new Schema({
    // tableId: {
    //     type: Number,
    //     unique: true,
    // },
    restaurantId: {
        type: Schema.Types.ObjectId,
        ref: 'Restaurant'
    },
    tableNumber: String,
    // qrCodeURL: String, // generated from backend
    status: {
        type: String,
        enum: ['available', 'occupied', 'reserved', 'cleaning'],
        default: 'available'
    }
}, { timestamps: true });

// tableSchema.plugin(AutoIncrement, { inc_field: 'tableId' });

const Table = model('Table', tableSchema)
module.exports = Table