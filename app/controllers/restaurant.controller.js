const { default: mongoose } = require('mongoose');
const cloudinary = require('../config/cloudinary');
const Restaurant = require('../models/restaurant.model');
const Category = require('../models/category.model');
const Product = require('../models/product.model');
const slugify = require('slugify');
const { processMultipleImageBuffers, deleteCloudinaryImages, uploadImageBuffer, getBufferHash } = require('../services/cloudinaryService/cloudinary.uploader');
const User = require('../models/user.model');
const Table = require('../models/table.model');
const { generateQRCodeURL } = require('../services/generateQRCode/generateQrCode');
const { websiteUrl } = require('../apis/api');
const { sendMailFunc } = require('../services/nodemailerService/nodemailer.service');
const { restaurantCreatedMailTemplate } = require('../services/nodemailerService/restaurantCreatedMailTemplate');

const generateTablesForRestaurant = async (restaurantId, count) => {
    const tables = [];

    for (let i = 1; i <= count; i++) {
        const tableNumber = `T${i}`;
        // const qrCodeURL = await generateQRCodeURL(`${restaurantId}_${tableNumber}`); // implement this

        tables.push({
            restaurantId,
            tableNumber,
            // qrCodeURL
        });
    }

    await Table.insertMany(tables);
};

const updateRestaurantTables = async (restaurantId, newCount) => {
    const existingTables = await Table.find({ restaurantId });

    // Sort existing tables by numeric table number
    const sortedTables = existingTables.sort((a, b) => {
        const numA = parseInt(a.tableNumber.replace('T', ''), 10);
        const numB = parseInt(b.tableNumber.replace('T', ''), 10);
        return numA - numB;
    });

    const currentCount = sortedTables.length;

    if (newCount === currentCount) {
        return 'No change needed';
    }

    if (newCount === 0) {
        await Table.deleteMany({ restaurantId });
        return 'All tables removed';
    }

    if (newCount > currentCount) {
        // ✅ Add new tables sequentially
        const newTables = [];
        for (let i = currentCount + 1; i <= newCount; i++) {
            newTables.push({
                restaurantId,
                tableNumber: `T${i}`
            });
        }
        await Table.insertMany(newTables);
        return 'Tables increased';
    }

    if (newCount < currentCount) {
        // ✅ Remove highest-numbered tables first
        const tablesToRemove = sortedTables.slice(newCount); // take last ones
        const idsToRemove = tablesToRemove.map(t => t._id);

        await Table.deleteMany({ _id: { $in: idsToRemove } });
        return 'Tables decreased';
    }
};

const restaurantCtlr = {}

// Create Restaurant
restaurantCtlr.create = async ({ body, files, user }) => {
    console.log("Restaurant create - body:", body);
    console.log("Contact number fields:", {
        "contactNumber.number": body["contactNumber.number"],
        "contactNumber.countryCode": body["contactNumber.countryCode"],
        "contactNumber": body.contactNumber,
        "countryCode": body.countryCode
    });

    // 🛑 Check if images are provided
    // if (!files || !files.images || files.images.length === 0) {
    //     throw { status: 400, message: "At least one restaurant image is required" };
    // }

    // 🧩 Get the logged-in user & check if they already have a restaurant
    const userData = await User.findById(user.id);
    if (userData.restaurantId) {
        const existingRestaurant = await Restaurant.findById(userData.restaurantId);
        if (existingRestaurant) {
            throw { status: 400, message: "Restaurant already exists for this Admin" };
        }
    }

    // ✅ Separate uploaded files
    const restaurantImages = files.images || [];
    const logoImage = files.logo?.[0] || null;
    const favIconImage = files.favIcon?.[0] || null;
    const bannerImagesFiles = files.bannerImages || [];
    const offerBannerImagesFiles = files.offerBannerImages || [];

    const slug = slugify(body.name, { lower: true })
    const restaurantFolder = `We-QrCode/${slug}`;

    // ✅ Upload images for restaurant gallery
    const uploadedImages = await processMultipleImageBuffers(restaurantImages, null, `${restaurantFolder}/Gallery`);

    // ✅ Upload logo if provided
    let uploadedLogo = null;
    if (logoImage) {
        const hash = getBufferHash(logoImage.buffer);
        const result = await uploadImageBuffer(logoImage.buffer, null, `${restaurantFolder}/Logos`);
        uploadedLogo = {
            url: result.secure_url,
            publicId: result.public_id,
            hash
        };
    }

    // ✅ Upload favIcon if provided
    let uploadedFavIcon = null;
    if (favIconImage) {
        const hash = getBufferHash(favIconImage.buffer);
        const result = await uploadImageBuffer(favIconImage.buffer, null, `${restaurantFolder}/FavIcons`);
        uploadedFavIcon = {
            url: result.secure_url,
            publicId: result.public_id,
            hash
        };
    }

    // ✅ Upload banner images if provided
    let uploadedBannerImages = [];
    if (bannerImagesFiles.length > 0) {
        uploadedBannerImages = await processMultipleImageBuffers(bannerImagesFiles, null, `${restaurantFolder}/Banners`);
    }

    // ✅ Upload offer banner images if provided
    let uploadedOfferBannerImages = [];
    if (offerBannerImagesFiles.length > 0) {
        uploadedOfferBannerImages = await processMultipleImageBuffers(offerBannerImagesFiles, null, `${restaurantFolder}/Offer-Banners`);
    }

    // ✅ Parse location from FormData
    const locationType = body['location.type'] || "Point";
    const coordinates = [
        parseFloat(body['location.coordinates[0]']) || 0,
        parseFloat(body['location.coordinates[1]']) || 0
    ];

    // ✅ Create restaurant object
    const restaurant = new Restaurant({
        name: body.name,
        adminId: user.id,
        slug: slugify(body.name, { lower: true }),
        folderKey: restaurantFolder,
        images: uploadedImages,
        address: {
            street: body["address.street"] || "",
            area: body["address.area"] || "",
            city: body["address.city"] || "",
        },
        contactNumber: {
            number: body["contactNumber.number"] || body.contactNumber || "",
            countryCode: body["contactNumber.countryCode"] || body.countryCode || ""
        },
        location: {
            type: locationType,
            coordinates: coordinates
        },
        tableCount: body.tableCount,
        socialMediaLinks: body.socialMediaLinks || [],
        googleReviewLink: body.googleReviewLink || "",
        theme: {
            primaryColor: body.primaryColor || "#000000",
            secondaryColor: body.secondaryColor || "#ffffff",
            buttonColor: body.buttonColor || body.primaryColor,
            logo: uploadedLogo,
            favIcon: uploadedFavIcon,
            bannerImages: uploadedBannerImages,
            offerBannerImages: uploadedOfferBannerImages,
        },
        isOpen: body.isOpen || true,
        isDineInAvailable: body.isDineInAvailable || true,
        isHomeDeliveryAvailable: body.isHomeDeliveryAvailable || false,
        isTakeAwayAvailable: body.isTakeAwayAvailable || false,
        isCustomerOrderAvailable: body.isCustomerOrderAvailable || true
    });

    // ✅ Auto-generate tables if tableCount is provided
    if (body.tableCount && body.tableCount > 0) {
        await generateTablesForRestaurant(restaurant._id, body.tableCount);
    }

    // ✅ Generate restaurant QR code
    const restaurantUrl = `${websiteUrl}/restaurant/${restaurant.slug}`;
    const qrBuffer = await generateQRCodeURL(restaurantUrl);
    const uploadedQR = await uploadImageBuffer(qrBuffer, null, `${restaurant.folderKey}/Qr-Code`);
    restaurant.qrCodeURL = uploadedQR.secure_url;

    // ✅ Save restaurant
    await restaurant.save();

    // ✅ Update user with restaurantId
    await User.findByIdAndUpdate(user.id, {
        restaurantId: restaurant._id
    });

    const mailData = await sendMailFunc({
        to: "wecanwebdeveloper@gmail.com",
        // cc: ["mohammedsinanchinnu07@gmail.com"], // CC recipients
        cc: ["accounts@wecanuniverse.com"], // CC recipients
        subject: "New Restaurant Registration - Admin Notification",
        html: restaurantCreatedMailTemplate(restaurant, user),
    });

    if (!mailData.isSend) {
        throw returnError(400, "Not able send mail");
    }

    return { message: "Restaurant created successfully", data: restaurant };
};

// Get All Restaurants
restaurantCtlr.list = async () => {
    const stores = await Restaurant.find().sort({restaurantId: 1}).populate('adminId', 'firstName lastName email');
    if (!stores) {
        throw { status: 404, message: "Store not found" };
    }
    return { data: stores };
};

// Get My Restaurant
restaurantCtlr.myRestaurant = async ({ user }) => {
    // Validate user exists and has proper role
    const userData = await User.findById(user.id);
    if (!userData) {
        throw { status: 404, message: "User not found" };
    }

    // Check if user has restaurant admin role
    if (userData.role !== 'restaurantAdmin') {
        throw { status: 403, message: "Access denied. Restaurant admin role required" };
    }

    const userRestaurantId = userData.restaurantId;
    if (!userRestaurantId || !mongoose.Types.ObjectId.isValid(userRestaurantId)) {
        throw { status: 400, message: "Valid Restaurant ID is required" };
    }

    const restaurant = await Restaurant.findById(userRestaurantId)
        .populate('adminId', 'firstName lastName email')
    if (!restaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }

    // Additional security check: Ensure the restaurant belongs to the requesting user
    if (String(restaurant.adminId._id) !== String(user.id)) {
        throw { status: 403, message: "Access denied. You are not authorized to access this restaurant" };
    }

    // Check if restaurant is blocked
    if (restaurant.isBlocked) {
        throw { status: 403, message: "Restaurant is currently blocked. Please contact support" };
    }

    return { data: restaurant };
};

// Get One Restaurant by ID
restaurantCtlr.show = async ({ params: { restaurantSlug } }) => {
    // if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
    //     throw { status: 400, message: "Valid Restaurant ID is required" };
    // }
    if (!restaurantSlug) {
        throw { status: 400, message: "Valid Restaurant Slug is required" };
    }
    const restaurant = await Restaurant.findOne({ slug: restaurantSlug }).select({isApproved: 0, isBlocked: 0, adminId: 0})
    if (!restaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }

    return { data: restaurant };
};

// List Restaurant by City
restaurantCtlr.listByCity = async ({ query: { city } }) => {
    if (!city) {
        throw { status: 400, message: "City name is required" };
    }

    const cleanCity = city.replace(/\s+/g, '').toLowerCase();

    const stores = await Store.find({
        $expr: {
            $eq: [
                { $replaceAll: { input: { $toLower: "$city" }, find: " ", replacement: "" } },
                cleanCity
            ]
        }
    });

    return { data: stores };
};

// List NearBy Store
restaurantCtlr.listNearby = async ({ query: { latitude, longitude, radius } }) => {
    if (!latitude || !longitude) {
        throw { status: 400, message: "Latitude and Longitude are required" };
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    // Approximate radius in kilometers
    const R = 6371; 

    // Simple Haversine-like calculation using aggregation
    const stores = await Store.find({
        location: {
            $nearSphere: {
                $geometry: { type: "Point", coordinates: [lon, lat] },
                $maxDistance: radius * 1000 // radius in meters
            }
        }
    });

    return { data: stores };
};

// Update Restaurant
restaurantCtlr.update = async ({ params: { restaurantId }, body, files, user }) => {
    // console.log(body)
    // 🛑 Validate restaurantId
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: "Valid Restaurant ID is required" };
    }

    // 🛑 Verify if the user owns this restaurant
    const userData = await User.findById(user.id);
    if (String(restaurantId) !== String(userData.restaurantId)) {
        throw { status: 403, message: "You are not authorized to update this restaurant" };
    }

    // 🔍 Check if restaurant exists
    const existingRestaurant = await Restaurant.findById(restaurantId);
    if (!existingRestaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }

    // 🔍 Check if restaurant name is already taken
    if (body.name) {
        // Check if name has been changed before
        if (existingRestaurant.nameChanged && body.name !== existingRestaurant.name) {
            throw { status: 400, message: "Restaurant name can only be changed once. Please contact support if you need to change it again." };
        }
        
        const isRestaurantNameExist = await Restaurant.findOne({ name: body.name });
        if (isRestaurantNameExist && isRestaurantNameExist._id.toString() !== restaurantId) {
            throw { status: 400, message: "Restaurant name already exists" };
        }
    }

    // Before assigning to updateData
    let socialMediaLinks = existingRestaurant.socialMediaLinks || [];

    if (body.socialMediaLinks) {
        try {
            socialMediaLinks = JSON.parse(body.socialMediaLinks);
        } catch (err) {
            console.error("Invalid socialMediaLinks JSON:", body.socialMediaLinks);
            throw { status: 400, message: "Invalid socialMediaLinks format" };
        }
    }

    // ✅ Prepare update data object
    const updateData = {
        ...body,
        theme: {
            primaryColor: body.primaryColor || existingRestaurant.theme.primaryColor,
            secondaryColor: body.secondaryColor || existingRestaurant.theme.secondaryColor,
            buttonColor: body.buttonColor || existingRestaurant.theme.buttonColor || existingRestaurant.theme.primaryColor,
            logo: existingRestaurant.theme.logo,
            favIcon: existingRestaurant.theme.favIcon,
            bannerImages: existingRestaurant.theme.bannerImages,
            offerBannerImages: existingRestaurant.theme.offerBannerImages,
        },
        socialMediaLinks: socialMediaLinks,
        isCustomerOrderAvailable: body.isCustomerOrderAvailable || true,
        folderKey : existingRestaurant.folderKey || `We-QrCode/${existingRestaurant.slug}`

    };

    // ✅ If restaurant name changes, update slug and set nameChanged flag
    if (body.name && body.name !== existingRestaurant.name) {
        updateData.slug = slugify(body.name, { lower: true });
        updateData.nameChanged = true; // Mark that name has been changed
    } else {
        updateData.slug = existingRestaurant.slug;
    }

    // Helper to handle merging images
    const mergeImages = async (existingImagesInDB, existingImagesFromFrontend = [], newFiles = [], folder = "") => {
        // Process new files if any
        const newImages = newFiles.length > 0 ? await processMultipleImageBuffers(newFiles, null, folder) : [];
        
        // Combine frontend existing images + new images
        const updatedImages = [...existingImagesFromFrontend, ...newImages];

        // Delete removed images from Cloudinary
        const removedImages = existingImagesInDB.filter(
            img => !updatedImages.find(i => i.publicId === img.publicId)
        );
        if (removedImages.length > 0) {
            await deleteCloudinaryImages(removedImages.map(img => img.publicId));
        }

        return updatedImages;
    };

    // Parse existing images from JSON if sent from frontend
    const parseJSONImages = (images) => {
        if (!images) return [];
        if (typeof images === "string") return [JSON.parse(images)];
        if (Array.isArray(images)) return images.map((img) => 
            typeof img === "string" ? JSON.parse(img) : img
        );
        return [];
    };

    const existingImagesFromFrontend = parseJSONImages(body.existingImages);
    const existingBannerImagesFromFrontend = parseJSONImages(body.existingBannerImages);
    const existingOfferBannerImagesFromFrontend = parseJSONImages(body.existingOfferBannerImages);
    const existingLogoFromFrontend = body.existingLogo ? JSON.parse(body.existingLogo) : existingRestaurant.theme.logo;
    const existingFavIconFromFrontend = body.existingFavIcon ? JSON.parse(body.existingFavIcon) : existingRestaurant.theme.favIcon;


    // Example usage inside your update controller:

    // 🖼️ Main gallery images
    updateData.images = await mergeImages(
        existingRestaurant.images,
        existingImagesFromFrontend,
        files.images || [],
        `${existingRestaurant.folderKey}/Gallery`
    );

    // 🖼️ Banner images
    updateData.theme.bannerImages = await mergeImages(
        existingRestaurant.theme.bannerImages,
        existingBannerImagesFromFrontend,
        files.bannerImages || [],
        `${existingRestaurant.folderKey}/Banners`
    );

    // 🖼️ Offer banner images
    updateData.theme.offerBannerImages = await mergeImages(
        existingRestaurant.theme.offerBannerImages,
        existingOfferBannerImagesFromFrontend,
        files.offerBannerImages || [],
        `${existingRestaurant.folderKey}/Offer-Banners`
    );

    // 🖼️ Logo
    if (files.logo && files.logo.length > 0) {
        if (existingRestaurant.theme.logo?.publicId) {
            await deleteCloudinaryImages([existingRestaurant.theme.logo.publicId]);
        }
        const logoFile = files.logo[0];
        const hash = getBufferHash(logoFile.buffer);
        const uploadedLogo = await uploadImageBuffer(logoFile.buffer, null, `${existingRestaurant.folderKey}/Logos`);
        updateData.theme.logo = {
            url: uploadedLogo.secure_url,
            publicId: uploadedLogo.public_id,
            hash
        };
    } else {
        // Keep old logo if not replaced
        updateData.theme.logo = existingLogoFromFrontend;
    }

    // 🖼️ FavIcon
    if (files.favIcon && files.favIcon.length > 0) {
        if (existingRestaurant.theme.favIcon?.publicId) {
            await deleteCloudinaryImages([existingRestaurant.theme.favIcon.publicId]);
        }
        const favIconFile = files.favIcon[0];
        const hash = getBufferHash(favIconFile.buffer);
        const uploadedFavIcon = await uploadImageBuffer(favIconFile.buffer, null, `${existingRestaurant.folderKey}/FavIcons`);
        updateData.theme.favIcon = {
            url: uploadedFavIcon.secure_url,
            publicId: uploadedFavIcon.public_id,
            hash
        };
    } else {
        // Keep old favIcon if not replaced
        updateData.theme.favIcon = existingFavIconFromFrontend;
    }

    // 📍 Handle location if latitude & longitude are provided
    if (body.latitude && body.longitude) {
        updateData.location = {
            type: 'Point',
            coordinates: [parseFloat(body.longitude), parseFloat(body.latitude)],
        };
    }

    // 🪑 Handle table count update
    if (body.tableCount) {
        await updateRestaurantTables(restaurantId, body.tableCount);
    }

    // 🔄 If the name changed, regenerate QR code
    if (body.name && body.name !== existingRestaurant.name) {
        const restaurantUrl = `${websiteUrl}/restaurant/${updateData.slug}`;
        const qrBuffer = await generateQRCodeURL(restaurantUrl);
        const uploadedQR = await uploadImageBuffer(qrBuffer, null, `${existingRestaurant.folderKey}/Qr-Code`);
        updateData.qrCodeURL = uploadedQR.secure_url;
    }

    // ✍️ Update restaurant document
    const updatedRestaurant = await Restaurant.findByIdAndUpdate(restaurantId, updateData, { new: true });

    // 📌 Populate admin info in response
    const newRestaurant = await Restaurant.findById(updatedRestaurant._id)
        .populate('adminId', 'firstName lastName email');

    return { message: "Restaurant updated successfully", data: newRestaurant };
};

// Toggle Approve Restaurant
restaurantCtlr.approveRestaurant = async ({ params: { restaurantId } }) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: "Valid Restaurant ID is required" };
    }

    // Check if restaurant exists
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }

    // Toggle isApproved
    const updatedRestaurant = await Restaurant.findByIdAndUpdate(
        restaurantId,
        { $set: { isApproved: !restaurant.isApproved } },
        { new: true }
    ).populate('adminId', 'firstName lastName email');

    return {
        message: `Restaurant has been ${updatedRestaurant.isApproved ? "approved" : "disapproved"} successfully`,
        data: updatedRestaurant
    };
};

// Toggle Block Restaurant
restaurantCtlr.blockRestaurant = async ({ params: { restaurantId } }) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: "Valid Restaurant ID is required" };
    }

    // Check if restaurant exists
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }

    // Toggle isBlocked
    const updatedRestaurant = await Restaurant.findByIdAndUpdate(
        restaurantId,
        { $set: { isBlocked: !restaurant.isBlocked } },
        { new: true }
    ).populate('adminId', 'firstName lastName email');

    return {
        message: `Restaurant has been ${updatedRestaurant.isBlocked ? "blocked" : "unblocked"} successfully`,
        data: updatedRestaurant
    };
};

// restaurantCtlr.restaurantCallWaiter = async ({ body }, res) => {
//     const io = req.app.get("io");
//     const { tableId } = body;

//     const table = await Table.findById(tableId);

//     if (!table) {
//         throw { status: 400, message: "Invalid table ID" };
//     }

//     io.emit("restaurant-notification", {
//         type: "call-waiter",
//         tableNo: table.tableNumber,
//         message: `Waiter Called on Table ${table.tableNumber}`,
//     });

//     return { success: true, message: "Waiter Called!" };
// };


// Delete Store
restaurantCtlr.delete = async ({ params: { restaurantId }, user }) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: "Valid Restaurant ID is required" };
    }

    const userData = await User.findById(user.id);
    const userRestaurantId = userData.restaurantId;
    if(userData.role !== "superAdmin"){
        if(String(restaurantId) !== String(userRestaurantId)) {
            throw { status: 403, message: "You are not authorized to Delete this Product" }
        }
    }

    const deletedRestaurant = await Restaurant.findById(restaurantId);
    if (!deletedRestaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }

    // Collect all images to delete from Cloudinary
    const imagesToDelete = [];
    
    // Main restaurant images
    if (deletedRestaurant.images?.length > 0) {
        imagesToDelete.push(...deletedRestaurant.images.map(img => img.publicId));
    }
    
    // Logo
    if (deletedRestaurant.theme?.logo?.publicId) {
        imagesToDelete.push(deletedRestaurant.theme.logo.publicId);
    }
    
    // FavIcon
    if (deletedRestaurant.theme?.favIcon?.publicId) {
        imagesToDelete.push(deletedRestaurant.theme.favIcon.publicId);
    }
    
    // Banner images
    if (deletedRestaurant.theme?.bannerImages?.length > 0) {
        imagesToDelete.push(...deletedRestaurant.theme.bannerImages.map(img => img.publicId));
    }
    
    // Offer banner images
    if (deletedRestaurant.theme?.offerBannerImages?.length > 0) {
        imagesToDelete.push(...deletedRestaurant.theme.offerBannerImages.map(img => img.publicId));
    }

    // Delete all categories and their images
    const categories = await Category.find({ restaurantId });
    for (const category of categories) {
        if (category.imagePublicId) {
            imagesToDelete.push(category.imagePublicId);
        }
    }
    await Category.deleteMany({ restaurantId });

    // Delete all products and their images
    const products = await Product.find({ restaurantId });
    for (const product of products) {
        if (product.images?.length > 0) {
            imagesToDelete.push(...product.images.map(img => img.publicId));
        }
    }
    await Product.deleteMany({ restaurantId });

    // Delete restaurant
    await Restaurant.findByIdAndDelete(restaurantId);

    // Update user's restaurantId to null
    await User.findByIdAndUpdate(user.id, {
        restaurantId: null,
    });
    
    // Delete all collected images from Cloudinary
    if (imagesToDelete.length > 0) {
        await deleteCloudinaryImages(imagesToDelete);
    }

    return { message: "Restaurant Deleted successfully", data: deletedRestaurant };
};

// Update Restaurant Subscription (Super Admin Only)
restaurantCtlr.updateSubscription = async ({ body, user }) => {
    const { restaurantId, subscription } = body;

    if (!restaurantId || !subscription) {
        throw { status: 400, message: "Restaurant ID and subscription are required" };
    }

    if (!['standard', 'premium'].includes(subscription)) {
        throw { status: 400, message: "Invalid subscription type. Must be 'standard' or 'premium'" };
    }

    // Check if user is super admin
    const userData = await User.findById(user.id);
    if (userData.role !== 'superAdmin') {
        throw { status: 403, message: "Only super admins can update restaurant subscriptions" };
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }

    const updatedRestaurant = await Restaurant.findByIdAndUpdate(
        restaurantId,
        { subscription },
        { new: true, runValidators: true }
    ).populate('adminId', 'firstName lastName email');

    return { 
        message: "Restaurant subscription updated successfully", 
        data: updatedRestaurant 
    };
};

module.exports = restaurantCtlr