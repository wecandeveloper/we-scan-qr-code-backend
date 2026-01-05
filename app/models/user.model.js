const { Schema, model } =  require("mongoose");
const AutoIncrement = require('mongoose-sequence')(require('mongoose'));

const userSchema = new Schema({
    // userId: {
    //     type: Number,
    //     unique: true
    // },
    firstName: String,
    lastName: String,
    email: {
        address: { 
            type: String, 
            unique: true 
        },
        isVerified: { 
            type: Boolean, 
            default: false 
        },
        otp: Number
    },
    password: String,
    phone: {
        number: String,
        countryCode: String,
        isVerified: { type: Boolean, default: false },
        otp: Number
    },
    role: {
        type: String,
        enum: ["restaurantAdmin", "superAdmin"],
        default: "restaurantAdmin"
    },
    restaurantId: {
        type: Schema.Types.ObjectId,
        ref: "Restaurant"
    },
    profilePic: String,
    profilePicPublicId: String,
    profilePicHash: String,
    isBlocked: { type: Boolean, default: false }
}, { timestamps: true });

// userSchema.plugin(AutoIncrement, { inc_field: 'userId' });

const User = model('User', userSchema)
module.exports = User;