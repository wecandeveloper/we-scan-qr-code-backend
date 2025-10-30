const { default: mongoose } = require('mongoose');
const Restaurant = require('../models/restaurant.model');
const slugify = require('slugify');
const { processMultipleImageBuffers, deleteCloudinaryImages, uploadImageBuffer } = require('../services/cloudinaryService/cloudinary.uploader');
const User = require('../models/user.model');
const Table = require('../models/table.model');
const { generateQRCodeURL } = require('../services/generateQRCode/generateQrCode');
const { websiteUrl } = require('../apis/api');
const { isApproved, isBlocked } = require('../validators/restaurant.validator');

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
    const existingTables = await Table.find({ restaurantId }).sort({ tableNumber: 1 });
    const currentCount = existingTables.length;

    if (newCount === currentCount) {
        return 'No change needed';
    }

    if (newCount === 0) {
        await Table.deleteMany({ restaurantId });
        return 'All tables removed';
    }

    if (newCount > currentCount) {
        // Add new tables
        const tablesToAdd = newCount - currentCount;
        const newTables = [];

        for (let i = 1; i <= tablesToAdd; i++) {
            const newTableNumber = `T${currentCount + i}`;
            newTables.push({
                restaurantId,
                tableNumber: newTableNumber
            });
        }

        await Table.insertMany(newTables);
        return 'Tables increased';
    }

    if (newCount < currentCount) {
        // Remove last N tables
        const tablesToRemove = await Table.find({ restaurantId })
            .sort({ tableNumber: -1 })
            .limit(currentCount - newCount);

        const idsToRemove = tablesToRemove.map(t => t._id);
        await Table.deleteMany({ _id: { $in: idsToRemove } });

        return 'Tables decreased';
    }
};

const restaurantCtlr = {}

// Create Store
restaurantCtlr.create = async ({ body, files, user }) => {
    // console.log("Restaurant", body)
    if (!files || files.length === 0) {
        throw { status: 400, message: "At least one image is required" };
    }

    const userData = await User.findById(user.id);
    const userRestaurantId = userData.restaurantId;
    const existingRestaurant = await Restaurant.findById(userRestaurantId);
    if (existingRestaurant) {
        throw { status: 400, message: "Restaurant already exists for this Admin" };
    }
    // console.log(files)

    // Upload and process image files with duplicate hash check
    const uploadedImages = await processMultipleImageBuffers(files, Restaurant);

    const restaurant = new Restaurant({
        ...body,
        adminId: user.id,
        slug: slugify(body.name, { lower: true }),
        images: uploadedImages,
        // location: {
        //     type: "Point",
        //     coordinates: [parseFloat(body.longitude), parseFloat(body.latitude)]
        // }
    });

    if (body.tableCount && body.tableCount > 0) {
        await generateTablesForRestaurant(restaurant._id, body.tableCount);
    }

    const restaurantUrl = `${websiteUrl}/restaurant/${restaurant.slug}`;
    const qrBuffer = await generateQRCodeURL(restaurantUrl); // returns image buffer
    const uploadedQR = await uploadImageBuffer(qrBuffer, null, "We-QrCode/Qr-Code");    // returns { secure_url: "..." }

    restaurant.qrCodeURL = uploadedQR.secure_url;

    await restaurant.save();

    // 🔄 Update the user with restaurantId
    await User.findByIdAndUpdate(user.id, {
        restaurantId: restaurant._id,
    });

    return { message: "Store created successfully", data: restaurant };
};

// Get All Stores
restaurantCtlr.list = async () => {
    const stores = await Restaurant.find().sort({restaurantId: 1}).populate('adminId', 'firstName lastName email');
    if (!stores) {
        throw { status: 404, message: "Store not found" };
    }
    return { data: stores };
};

// Get My Restaurant
restaurantCtlr.myRestaurant = async ({ user }) => {
    const userData = await User.findById(user.id);
    const userRestaurantId = userData.restaurantId;
    if (!userRestaurantId || !mongoose.Types.ObjectId.isValid(userRestaurantId)) {
        throw { status: 400, message: "Valid Restaurant ID is required" };
    }

    const restaurant = await Restaurant.findById(userRestaurantId)
        .populate('adminId', 'firstName lastName email')
    if (!restaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }

    return { data: restaurant };
};

// Get One Store by ID
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

// List Store by City
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

// Update Store
restaurantCtlr.update = async ({ params: { restaurantId }, body, files, user }) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: "Valid Restaurant ID is required" };
    }

    const userData = await User.findById(user.id);
    const userRestaurantId = userData.restaurantId;
    if(String(restaurantId) !== String(userRestaurantId)){
        throw { status: 403, message: "You are not authorized to Update this Product" }
    }

    const existingRestaurant = await Restaurant.findById(restaurantId);
    if (!existingRestaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }

    const isRestaurantNameExist = await Restaurant.findOne({ name: body.name });
    if (isRestaurantNameExist && isRestaurantNameExist._id.toString() !== restaurantId) {
        throw { status: 400, message: "Restaurant name already exists" };
    }

    let newImages = [];

    // Process and upload new images if files exist
    if (files && files.length > 0) {
        // Optional: Delete previous images before upload (uncomment if you want to replace)
        const oldPublicIds = existingRestaurant.images.map(img => img.publicId);
        await deleteCloudinaryImages(oldPublicIds);

        newImages = await processMultipleImageBuffers(files, Restaurant);
    }

    const updateData = {
        ...body,
        slug: body.name ? slugify(body.name, { lower: true }) : existingRestaurant.slug, // update slug if name changes
        // adminId: user.id,
    };

    if (newImages.length > 0) {
        updateData.images = newImages // append to existing images
    }

    if (body.latitude && body.longitude) {
        updateData.location = {
        type: 'Point',
        coordinates: [parseFloat(body.longitude), parseFloat(body.latitude)],
        };
    }

    if (body.tableCount) {
        await updateRestaurantTables(restaurantId, body.tableCount);
    }

    const updatedRestaurant = await Restaurant.findByIdAndUpdate(restaurantId, updateData, { new: true });

    const newRestaurant = await Restaurant.findById(updatedRestaurant._id).populate('adminId', 'firstName lastName email');

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


// Delete Store
restaurantCtlr.delete = async ({ params: { restaurantId }, user }) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw { status: 400, message: "Valid Restaurant ID is required" };
    }

    const userData = await User.findById(user.id);
    const userRestaurantId = userData.restaurantId;
    if(String(restaurantId) !== String(userRestaurantId)){
        throw { status: 403, message: "You are not authorized to Delete this Product" }
    }

    const deletedRestaurant = await Restaurant.findByIdAndDelete(restaurantId);
    if (!deletedRestaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }

    await User.findByIdAndUpdate(user.id, {
        restaurantId: null,
    });

    await deleteCloudinaryImages(deletedRestaurant.images.map(img => img.publicId));

    return { message: "Restaurant Deleted successfully", data: deletedRestaurant };
};

module.exports = restaurantCtlr