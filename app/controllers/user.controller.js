const _ = require("lodash")
const jwt = require('jsonwebtoken')
const User = require('../models/user.model')
const Restaurant = require('../models/restaurant.model')
const Category = require('../models/category.model')
const Product = require('../models/product.model')
const bcrypt = require('bcryptjs')
// const twilio = require('twilio')
// const  redisClient  = require("../../config/redis")
const returnError = require("./dto.service")
const { sendMailFunc } = require("../services/nodemailerService/nodemailer.service")
const { otpMailTemplate } = require("../services/nodemailerService/templates")
const redisClient = require("../config/redis")
const { default: mongoose } = require("mongoose")
const {
    getBufferHash,
    uploadImageBuffer,
    findDuplicateImage,
    deleteImages
} = require('../services/unifiedUploader/unified.uploader');
// const { otpMailTemplate } = require("../nodemailer_service/templates")
// const { sendMailFunc } = require("../nodemailer_service/nodemailer_service")
const userCtlr = {}

userCtlr.register = async ({ body, file }) => {
    const existingRejectedUser = await User.findOne({
        $or: [
            { 'email.address': body.email?.address },
            { 'phone.number': body.phone?.number },
            { 'phone.countryCode': body.phone?.countryCode }
        ],
        isBlocked: true
    });

    let imageUrl = '', imageHash = '', imagePublicId = '';

    if (file?.buffer) {
        imageHash = getBufferHash(file.buffer);
        const sameImage = await findDuplicateImage(User, imageHash);

        if (sameImage) {
            imageUrl = sameImage.profilePic;
            imagePublicId = sameImage.profilePicPublicId;
        } else {
            const uploaded = await uploadImageBuffer(file.buffer, User);
            imageUrl = uploaded.secure_url;
            imagePublicId = uploaded.public_id;
        }
    }

    // Determine role: first user = superAdmin, others = restaurantAdmin
    const isFirstUser = (await User.countDocuments({})) === 0;
    const assignedRole = isFirstUser ? "superAdmin" : "restaurantAdmin";

    let user;
    if (existingRejectedUser) {
        if (
            file?.buffer &&
            existingRejectedUser.profilePicPublicId &&
            existingRejectedUser.profilePicHash !== imageHash
        ) {
            // Use image URL for better detection, fallback to publicId
            const itemToDelete = existingRejectedUser.profilePic || existingRejectedUser.profilePicPublicId;
            await deleteImages([itemToDelete]);
        }

        const salt = await bcrypt.genSalt();
        const encryptedPassword = await bcrypt.hash(body.password, salt);

        const updateData = {
            ...body,
            password: encryptedPassword,
            isBlocked: false,
            isVerified: false,
            profilePic: imageUrl,
            profilePicHash: imageHash,
            profilePicPublicId: imagePublicId,
            role: assignedRole, // assign role here
        };

        user = await User.findByIdAndUpdate(existingRejectedUser._id, updateData, { new: true });
    } else {
        user = new User({
            ...body,
            role: assignedRole, // assign role here
        });

        const salt = await bcrypt.genSalt();
        const encryptedPassword = await bcrypt.hash(user.password, salt);

        user.password = encryptedPassword;
        user.profilePic = imageUrl;
        user.profilePicHash = imageHash;
        user.profilePicPublicId = imagePublicId;

        user = await user.save();
    }

    return { message: "Registration successful", user };
};

userCtlr.login  = async ({
    body,
    res
    })=> {
        let user = await User.findOne({$or:[{'phone.number':body.username}, {'email.address':body.username}]})

        if(!user){
            throw returnError(400, "No such account");
        }
        const checkPassword = await bcrypt.compare(body.password,user.password)
        if (!checkPassword){
            throw returnError(400, "Invalid Credentials");
        }
        await user.save();
        const tokenData = {
            id: user._id, 
            role: user.role,
            userId: user.userId,
            email: user.email.address,
            number: user.phone.number
        }
        const token = jwt.sign(tokenData, process.env.JWT_SECRET,{expiresIn:'7d'})
        user = await User.findOneAndUpdate({$or:[{'phone.number':body.username}, {'email.address':body.username}]},{jwtToken:token},{new:true})
            .populate('restaurantId', 'name')
        // console.log(user)
        // console.log('token:',token)
        return ({token: token, user: user })
    }

userCtlr.account = async ({
    user
    })=>{
        // console.log('hi server')
        const userData = await(User.findById(user.id).select({password:0})).populate('restaurantId', 'name')
        if(!userData) {
            throw returnError(400, "No such account")
        } else {
            return userData
        }
    }

userCtlr.list = async ({}) => {
    const users = await User.find().select({ password:0 }).populate('restaurantId', 'name')

    if(!users) {
        throw returnError(400, "No users found")
    }
    return { data: users}
}

userCtlr.updateUser = async ({ body, file }) => {
    const { _id } = body;

    if (!mongoose.Types.ObjectId.isValid(_id)) {
        throw new Error('Invalid user ID');
    }

    const existingUser = await User.findById(_id);
    if (!existingUser) {
        throw new Error('User not found');
    }

    const updateData = {
        firstName: body.firstName,
        lastName: body.lastName,
        dob: body.dob,
        nationality: body.nationality,
        email: { 
            address: body['email.address'] 
        },
        phone: {
            number: body['phone.number'],
            countryCode: body['phone.countryCode']
        },
        restaurantId: body.restaurantId,
    };

    if (file?.buffer) {
        const hash = getBufferHash(file.buffer);

        if (existingUser.profilePicHash !== hash) {
            if (existingUser.profilePicPublicId) {
                // Use image URL for better detection, fallback to publicId
                const itemToDelete = existingUser.profilePic || existingUser.profilePicPublicId;
                await deleteImages([itemToDelete]);
            }

            const uploaded = await uploadImageBuffer(file.buffer, User);
            updateData.profilePic = uploaded.secure_url;
            updateData.profilePicPublicId = uploaded.public_id;
            updateData.profilePicHash = hash;
        }
    }

    const updatedUser = await User.findByIdAndUpdate(_id, updateData, { new: true }).select({ password: 0 });

    return { message: "Profile updated successfully", data: updatedUser };
};

userCtlr.toggleBlockUser = async ({ params: { userId }, body }) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw { status: 400, message: "Invalid user ID" };
    }

    const user = await User.findById(userId);
    if (!user) {
        throw { status: 404, message: "User not found" };
    }

    // Option 1: Set based on body value (recommended)
    if (typeof body.isBlocked !== 'boolean') {
        throw { status: 400, message: "Missing or invalid isBlocked value in body" };
    }

    user.isBlocked = body.isBlocked;
    await user.save();

    return {
        message: `User has been ${body.isBlocked ? 'blocked' : 'unblocked'} successfully`,
        data: user
    };
};

userCtlr.delete = async ({ params: { userId } }) => {
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        throw { status: 400, message: "Valid User ID is required" };
    }

    const user = await User.findById(userId);
    if (!user) {
        throw { status: 404, message: "User not found" };
    }

    // If user has a restaurant, delete it and all related data
    if (user.restaurantId) {
        const restaurant = await Restaurant.findById(user.restaurantId);
        if (restaurant) {
            // Collect all images to delete from Cloudinary
            const imagesToDelete = [];
            
            // Restaurant images (use URLs for better detection, fallback to publicId)
            if (restaurant.images?.length > 0) {
                imagesToDelete.push(...restaurant.images.map(img => img.url || img.publicId));
            }
            
            // Logo
            if (restaurant.theme?.logo?.publicId) {
                imagesToDelete.push(restaurant.theme.logo.url || restaurant.theme.logo.publicId);
            }
            
            // FavIcon
            if (restaurant.theme?.favIcon?.publicId) {
                imagesToDelete.push(restaurant.theme.favIcon.url || restaurant.theme.favIcon.publicId);
            }
            
            // Banner images
            if (restaurant.theme?.bannerImages?.length > 0) {
                imagesToDelete.push(...restaurant.theme.bannerImages.map(img => img.url || img.publicId));
            }
            
            // Offer banner images
            if (restaurant.theme?.offerBannerImages?.length > 0) {
                imagesToDelete.push(...restaurant.theme.offerBannerImages.map(img => img.url || img.publicId));
            }

            // Delete all categories and their images
            const categories = await Category.find({ restaurantId: user.restaurantId });
            for (const category of categories) {
                if (category.imagePublicId) {
                    imagesToDelete.push(category.image || category.imagePublicId);
                }
            }
            await Category.deleteMany({ restaurantId: user.restaurantId });

            // Delete all products and their images
            const products = await Product.find({ restaurantId: user.restaurantId });
            for (const product of products) {
                if (product.images?.length > 0) {
                    imagesToDelete.push(...product.images.map(img => img.url || img.publicId));
                }
            }
            await Product.deleteMany({ restaurantId: user.restaurantId });

            // Delete restaurant
            await Restaurant.findByIdAndDelete(user.restaurantId);

            // Delete all collected images (automatically handles both Cloudinary and S3)
            if (imagesToDelete.length > 0) {
                await deleteImages(imagesToDelete);
            }
        }
    }

    // Delete user profile image
    if (user.profilePicPublicId) {
        // Use image URL for better detection, fallback to publicId
        const itemToDelete = user.profilePic || user.profilePicPublicId;
        await deleteImages([itemToDelete]);
    }

    // Finally delete the user
    await User.findByIdAndDelete(userId);

    return { message: "User and all related data deleted successfully", data: user };
};

userCtlr.sendPhoneOtp = async ({ body: { countryCode, number } }) => {
    const phoneNumber = countryCode + number;
    
    // Check for existing non-rejected user
    // const isPhoneExist = await User.findOne({ 
    //     'phone.countryCode': countryCode, 
    //     'phone.number': number,
    //     isRejected: { $ne: true }  // Changed to allow rejected users
    // });

    // if (isPhoneExist) {
    //     throw returnError(400, "Phone Number already exists");
    // }

    const redisPhoneData = await redisClient.get(phoneNumber);
    if (redisPhoneData && redisPhoneData.count > 5) {
        throw returnError(400, "Too many requests, try again after some time");
    }

    const otp = Math.floor(Math.random() * 900000) + 100000;

    const response = await redisClient.set(
        phoneNumber,
        JSON.stringify({
            otp,
            count: (redisPhoneData?.count ?? 0) + 1,
            createdAt: redisPhoneData?.createdAt ?? new Date(),
            lastSentAt: new Date(),
        }),
        60 * 10
    );

    // console.log("Response", response)

    // const smsData = await sendSmsFunc({
    //   to: phoneNumber,
    //   message: `Your OTP for SAG signup is: ${otp}`,
    // });

    if (!response) {
        throw returnError(400, "Unable to send OTP to phone");
    }

    return { isSent: true, otp: otp };
};

userCtlr.verifyPhoneOtp = async ({ body: { countryCode, number, otp } }) => {
    const phoneNumber = countryCode + number;
    const storedOtpDataString = await redisClient.get(phoneNumber);
    // console.log("📦 Stored OTP Data from Redis:", storedOtpDataString);

    if (!storedOtpDataString) {
        throw returnError(400, "Phone number not found or OTP expired");
    }

    let storedOtpData;
    try {
        storedOtpData = JSON.parse(storedOtpDataString);
    } catch (err) {
        throw returnError(500, "OTP data corrupted");
    }

    if (storedOtpData.otp != otp) {
        throw returnError(400, "Incorrect OTP");
    }

    // console.log("number", number)
    // console.log("countryCode", countryCode)
    const user = await User.findOneAndUpdate(
        { 'phone.countryCode': countryCode, 'phone.number': number },
        { $set: { 'phone.isVerified': true } },
        { new: true }
    );

    if (!user) {
        throw returnError(404, "User not found");
    }

    await redisClient.del(phoneNumber);

    return {
        isVerified: true,
        verificationToken: jwt.sign(
        { phoneNumber },
        process.env.JWT_SECRET,
        { expiresIn: "10m" }
        ),
        user: user,
    };
};

userCtlr.sendMailOtp = async ({ body: { email } }) => {
    // Check for existing non-rejected user
    // const isEmailExist = await User.findOne({ 
    //     'email.address': email,
    //     isBlocked: { $ne: true }  // Changed to allow rejected users
    // });

    // if (isEmailExist) {
    //     throw returnError(400, "Email already exists");
    // }

    const redisMailData = await redisClient.get(email);
    if (redisMailData && redisMailData.count > 5) {
        throw returnError(400, "Too many request, try again after sometime");
    }

    const otp = Math.floor(Math.random() * 900000) + 100000;
    // console.log('otp:', otp);

    await redisClient.set(
        email,
        {
            otp,
            count: (redisMailData?.count ?? 0) + 1,
            createdAt: redisMailData?.createdAt ?? new Date(),
            lastSentAt: new Date(),
        },
        60 * 10
    );

    const mailData = await sendMailFunc({
        to: email,
        subject: "Crunchies Signup OTP",
        html: otpMailTemplate(otp),
    });

    if (!mailData.isSend) {
        throw returnError(400, "Not able send mail");
    }

    return {
        isSent: true,
    };
};

userCtlr.verifyMailOtp = async ({ body: { email, otp } }) => {
    const storedOtp = await redisClient.get(email);
    if (!storedOtp) {
        throw returnError(400, "Email doesn't exist or OTP expired");
    }
    if (storedOtp.otp !== otp) {
        throw returnError(400, "Incorrect OTP");
    }
    const user = await User.findOneAndUpdate(
        { 'email.address': email },
        { $set: { 'email.isVerified': true } },
        { new: true }
    );

    if (!user) {
        throw returnError(404, "User not found");
    }
    await redisClient.del(email);
    return {
        email: {
            isVerified: true,
        },
        verificationToken: jwt.sign(
            {
                email,
            },
            process.env.JWT_SECRET,
            { expiresIn: "10m" }
        ),
    };
};

userCtlr.changePassword = async ({ body, user })=>{
    const { currentPassword, newPassword } = body
    const salt =  await bcrypt.genSalt()
    const newUser = await User.findById(user.id)
    const checkPassword = await bcrypt.compare(currentPassword, newUser.password)
    if(!checkPassword){
        throw returnError(400, "Current Password is Incorrect");
    }
    const hashedPassword = await bcrypt.hash(newPassword, salt)
    newUser.password = hashedPassword
    await newUser.save()
    return { message: "Password Changed Successfully" }
}

userCtlr.changePasswordByAdmin = async ({ params: { userId }, body }) => {
    const { newPassword } = body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw returnError(400, "Invalid user ID");
    }

    if(!newPassword) {
        throw returnError(400, "New Password is required");
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
        throw returnError(404, "User not found");
    }
    const checkPassword = await bcrypt.compare(newPassword, targetUser.password)
    if(checkPassword) {
        throw returnError(400, "New Password is the same as the current password");
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    targetUser.password = hashedPassword;
    await targetUser.save();

    return { message: "Password changed successfully by Admin" };
};

userCtlr.fPSendOtp= async(req,res)=>{
    const generateOTP = () => {
        return Math.floor(100000 + Math.random() * 900000);
    };
    const accountSid = process.env.TWILIO_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioClient = twilio(accountSid, authToken);
    const twilioPhoneNumber = '+12515720668';
    const user = await User.findOne({'phone.number':req.body.phone})
    if(!user){
        return res.status(404).json({ message : "User not found." });
    }
    const phoneNumber = user.phone.countryCode+user.phone.number
    // console.log('phone:',phoneNumber)

    const otp= generateOTP()
    await User.findOneAndUpdate({'phone.number':req.body.phone},{'phone.otp':otp},{new:true})
    try {
        await twilioClient.messages.create({
          body: `Your OTP for password reset is: ${otp}`,
          from: twilioPhoneNumber,
          to: phoneNumber
        });
        res.status(200).json({ message: 'OTP sent successfully' });
    } catch (error) {
        // console.error('Error sending OTP:', error);
        res.status(500).json({ message: 'Failed to send OTP' });
    }
}

userCtlr.fPVerifyOtpAndChangePassword=async(req,res)=>{
    const {sentOtp,newPassword} = req.body
    const user = await User.findOne({'phone.otp':sentOtp})
    // const storedOtp = user.phone.otp
    if(!user){
        return res.status(400).json({message:"Invalid OTP"});
    }
    try{
        const salt =  await bcrypt.genSalt()
        const hashedPassword = await bcrypt.hash(newPassword,salt)
        // user.password=hashedPassword
        await User.findOneAndUpdate({'phone.otp':sentOtp},{password:hashedPassword,'phone.otp':null},{new:true})
        res.status(201).json({message:"password changed successfully"})
    }catch(err){
        res.status(500).json('internal server error')
    }
}

module.exports = userCtlr