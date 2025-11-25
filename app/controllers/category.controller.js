const Category = require("../models/category.model");
const mongoose = require("mongoose");
const { getBufferHash, findDuplicateImage, uploadImageBuffer, deleteImages } = require("../services/unifiedUploader/unified.uploader");
const User = require("../models/user.model");
const Restaurant = require("../models/restaurant.model");

const categoryCtlr = {};

categoryCtlr.create = async ({ body, file, user }) => {
    if (!file?.buffer) {
        throw { status: 400, message: "Category image is required" };
    }

    const userData = await User.findById(user.id);
    const restaurantId = userData.restaurantId;
    if(String(restaurantId) !== String(body.restaurantId)){
        throw { status: 403, message: "RestauratId Mismatch or You are not the owner of this Restaurant" };
    }

    const existingCategoryName = await Category.findOne({ name: body.name, restaurantId: body.restaurantId });
    if(existingCategoryName) {
        throw { status: 400, message: "Category name already exists" };
    }

    let imageUrl = '', imageHash = '', imagePublicId = '';

    imageHash = getBufferHash(file.buffer);
    const duplicate = await findDuplicateImage(Category, imageHash, 'imageHash');

    const restaurant = await Restaurant.findById(body.restaurantId);

    if (duplicate) {
        imageUrl = duplicate.image;
        imagePublicId = duplicate.imagePublicId;
    } else {
        const uploaded = await uploadImageBuffer(file.buffer, Category, `${restaurant.folderKey}/Categories`);
        imageUrl = uploaded.secure_url;
        imagePublicId = uploaded.public_id;
    }

    // Parse translations if provided
    let translations = new Map();
    if (body.translations) {
        try {
            const translationsObj = typeof body.translations === 'string' 
                ? JSON.parse(body.translations) 
                : body.translations;
            
            for (const [lang, data] of Object.entries(translationsObj)) {
                translations.set(lang, {
                    name: data.name || '',
                    description: data.description || ''
                });
            }
        } catch (error) {
            console.error('Error parsing translations:', error);
        }
    }

    const category = new Category({
        ...body,
        translations,
        image: imageUrl,
        imagePublicId,
        imageHash
    });

    await category.save();

    const newCategor = await Category.findById(category._id).populate('restaurantId', 'name');

    return {
        message: "Category created successfully",
        data: newCategor
    };
}

// Get All Categories
categoryCtlr.listAll = async ({ user }) => {
    // const userData = await User.findById(user.id);
    // const restaurantId = userData.restaurantId;
    // const categories = await Category.find({restaurantId: restaurantId});
    const categories = await Category.find().populate('restaurantId', 'name');
    return { data: categories };
};

// Get All Categories
// categoryCtlr.listByRestaurantForAdmin = async ({ user }) => {
//     const userData = await User.findById(user.id);
//     const restaurantId = userData.restaurantId;
//     const categories = await Category.find({restaurantId: restaurantId});
//     // const categories = await Category.find().populate('restaurantId', 'name');
//     return { data: categories };
// };

// Get All Categories
categoryCtlr.listByRestaurant = async ({ params: { restaurantSlug } }) => {
    const restaurant = await Restaurant.findOne({slug: restaurantSlug});
    if(!restaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }
    const restaurantId = restaurant._id;
    const categories = await Category.find({restaurantId: restaurantId}).populate('restaurantId', 'name');
    return { data: categories };
};

// Get One Category by ID
categoryCtlr.show = async ({ params: { categoryId } }) => {
    if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
        throw { status: 400, message: "Valid Category ID is required" };
    }
    const category = await Category.findById(categoryId);
    if (!category) {
        throw { status: 404, message: "Category not found" };
    }
    return { data: category };
};

// Update Category
categoryCtlr.update = async ({ params: { categoryId }, user, body, file }) => {
    if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
        throw { status: 400, message: "Valid Category ID is required" };
    }

    const userData = await User.findById(user.id);
    const restaurantId = userData.restaurantId;
    if(String(restaurantId) !== String(body.restaurantId)){
        throw { status: 403, message: "You are not authorized to update this Product" }
    }
    const existingCategory = await Category.findById(categoryId);
    if (!existingCategory) {
        throw { status: 404, message: "Category not found" };
    }

    // Check if name is taken by another category
    const duplicateNameCategory = await Category.findOne({ name: body.name, restaurantId: body.restaurantId });
    if (duplicateNameCategory && duplicateNameCategory._id.toString() !== categoryId) {
        throw { status: 400, message: "Category name already exists" };
    }

    // Parse translations if provided
    let translations = existingCategory.translations || new Map();
    if (body.translations) {
        try {
            const translationsObj = typeof body.translations === 'string' 
                ? JSON.parse(body.translations) 
                : body.translations;
            
            for (const [lang, data] of Object.entries(translationsObj)) {
                translations.set(lang, {
                    name: data.name || '',
                    description: data.description || ''
                });
            }
        } catch (error) {
            console.error('Error parsing translations:', error);
        }
    }

    const updateData = {
        name: body.name,
        description: body.description,
        translations,
    };

    if (file?.buffer) {
        const hash = getBufferHash(file.buffer);

        // Upload only if image is different
        if (existingCategory.imageHash !== hash) {
            if (existingCategory.imagePublicId) {
                // Unified service automatically detects if it's Cloudinary or S3
                // Pass image URL if available for better detection, otherwise use publicId
                const itemToDelete = existingCategory.image || existingCategory.imagePublicId;
                await deleteImages(itemToDelete);
            }

            // Get restaurant for folder structure (consistent with create)
            const restaurant = await Restaurant.findById(existingCategory.restaurantId);
            const uploaded = await uploadImageBuffer(file.buffer, Category, `${restaurant.folderKey}/Categories`);
            updateData.image = uploaded.secure_url;
            updateData.imagePublicId = uploaded.public_id;
            updateData.imageHash = hash;
        }
    }

    const updatedCategory = await Category.findByIdAndUpdate(categoryId, updateData, {
        new: true,
        runValidators: true,
    });

    return { message: "Category updated successfully", data: updatedCategory };
};

// Delete Category
categoryCtlr.delete = async ({ params: { categoryId }, user }) => {
    if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
        throw { status: 400, message: "Valid Category ID is required" };
    }
    const userData = await User.findById(user.id);
    const restaurantId = userData.restaurantId;
    const category = await Category.findOneAndDelete({_id: categoryId, restaurantId});
    if (!category) {
        throw { status: 404, message: "Category not found or You are not authorized to delete this Product" };
    }
    if (category.imagePublicId) {
        // Unified service automatically detects if it's Cloudinary or S3
        // Pass image URL if available for better detection, otherwise use publicId
        const itemToDelete = category.image || category.imagePublicId;
        await deleteImages(itemToDelete);
    }
    return { message: "Category deleted successfully", data: category };
};

// Bulk Delete Categories
categoryCtlr.bulkDelete = async ({ body, user }) => {
    const { categoryIds } = body;
    
    if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
        throw { status: 400, message: "Category IDs array is required" };
    }
    
    // Validate all category IDs
    const invalidIds = categoryIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
        throw { status: 400, message: "Invalid Category IDs found" };
    }
    
    const userData = await User.findById(user.id);
    const restaurantId = userData.restaurantId;
    
    // Find categories that belong to the user's restaurant
    const categories = await Category.find({ 
        _id: { $in: categoryIds }, 
        restaurantId 
    });
    
    if (categories.length === 0) {
        throw { status: 404, message: "No categories found or you are not authorized to delete these categories" };
    }
    
    // Collect all image URLs or publicIds for deletion (prefer URLs for better detection)
    const allImageItems = categories
        .filter(category => category.imagePublicId)
        .map(category => category.image || category.imagePublicId);
    
    // Delete categories from database
    const deletedCategories = await Category.deleteMany({ 
        _id: { $in: categoryIds }, 
        restaurantId 
    });
    
    // Delete images (automatically handles both Cloudinary and S3)
    if (allImageItems.length > 0) {
        await deleteImages(allImageItems);
    }
    
    return { 
        message: `${deletedCategories.deletedCount} categories deleted successfully`, 
        data: { deletedCount: deletedCategories.deletedCount, categories: categories.map(c => ({ id: c._id, name: c.name })) }
    };
};

module.exports = categoryCtlr;