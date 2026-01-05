const { default: mongoose } = require('mongoose')
const User = require('../models/user.model')

const registerValidationSchema = {
    firstName:{
        notEmpty:{
            errorMessage:'firstName is required'
        },
    },
    lastName:{
        notEmpty:{
            errorMessage:'lastName is required'
        },
    },
    // createdBy:{
    //     notEmpty:{
    //         errorMessage:'createdBy is required'
    //     },
    // },
    'email.address':{
        notEmpty:{
            errorMessage:'email is required'
        },
        isEmail:{
            errorMessage:'invalid email'
        },
        custom:{
            options : async function (value){
                const user = await User.findOne({
                    'email.address': value,
                    $or: [
                        { isRejected: { $exists: false } },
                        { isRejected: false }
                    ]
                })
                if(!user){
                    return true
                }else{
                    throw new Error('Email Address already exist')
                }
            }
        },
        trim:true,
        normalizeEmail:true
    },

    'phone.number':{
        notEmpty:{
            errorMessage: "Phone number is required" 
        },
        custom:{
            options : async function (value){
                const user = await User.findOne({
                    'phone.number': value,
                    $or: [
                        { isRejected: { $exists: false } },
                        { isRejected: false }
                    ]
                })
                if(!user){
                    return true
                }else{
                    throw new Error('Phone Number already exist')
                }
            }
        }
    },
    'phone.countryCode':{
        notEmpty:{
            errorMessage: "Country Code is required" 
        }
    },
    password:{
        notEmpty:{
            errorMessage:'password is required'
        },
        isLength:{
            options:{min:6,max:16},
            errorMessage:'password must be between 6 and 16 characters long'
        }
    }
}

const loginValidationSchema={
    username:{
        notEmpty:{
            errorMessage: 'email or phone is required'
        },
        trim:true,
    },
    password:{
        notEmpty:{
            errorMessage:'password is required'
        },
        isLength:{
            options:{min:6,max:16},
            errorMessage:'password must be between 6 and 16 characters long'
        },
        trim:true
    }
}

const updateUserValidationSchema = {
    firstName:{
        notEmpty:{
            errorMessage:'firstName is required'
        },
    },
    lastName:{
        notEmpty:{
            errorMessage:'lastName is required'
        },
    },
    'email.address': {
        notEmpty: {
            errorMessage: 'Email is required'
        },
        isEmail: {
            errorMessage: 'Invalid email address'
        },
        custom: {
            options: async (value, { req }) => {
                const userId = req.body._id;

                if (!mongoose.Types.ObjectId.isValid(userId)) {
                    throw new Error('Invalid user ID');
                }

                const existing = await User.findOne({
                    'email.address': value,
                    _id: { $ne: userId }
                });

                if (existing) {
                    throw new Error('Email address already exists');
                }

                return true;
            }
        }
    },
    'phone.number': {
        notEmpty: {
            errorMessage: 'Phone number is required'
        },
        custom: {
            options: async (value, { req }) => {
                const userId = req.body._id;

                const existing = await User.findOne({
                    'phone.number': value,
                    _id: { $ne: userId }
                });

                if (existing) {
                    throw new Error('Phone number already exists');
                }

                return true;
            }
        }
    },

    dob: {
        optional: true,
        isISO8601: {
            errorMessage: 'Invalid date format'
        },
        toDate: true
    },

    nationality: {
        optional: true,
        isString: {
            errorMessage: 'Nationality must be a string'
        },
        trim: true
    }
}

const changeUsernameValidationSchema = {
    username:{
        notEmpty:{
            errorMessage: 'username is required'
        },
        custom:{
            options : async function (value){
                const user = await User.findOne({'username':value})
                if(!user){
                    return true
                }else{
                    throw new Error('Username already exist')
                }
            }
        }
    }
}

const changeEmailValidationSchema = {
    'email.address': {
        notEmpty: {
            errorMessage: 'Email Address is required'
        },
        trim: true,
        custom: {
            options: async function (value){
                const user = await User.findOne({'email.address': value})
                if(!user){
                    return true
                }else{
                    throw new Error('Email Address already exist')
                }
            }
        }
    }
}

const changePhoneValidationSchema = {
    'phone.number': {
        notEmpty: {
            errorMessage: 'Phone Number is required'
        },
        trim: true,
        custom: {
            options: async function (value){
                const user = await User.findOne({'phone.number': value})
                if(!user){
                    return true
                }else{
                    throw new Error('Phone Number already exist')
                }
            }
        }
    }
}

module.exports ={
    registerValidationSchema,
    loginValidationSchema,
    changeUsernameValidationSchema,
    changeEmailValidationSchema,
    changePhoneValidationSchema,
    updateUserValidationSchema
}