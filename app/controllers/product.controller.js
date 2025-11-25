const { default: mongoose } = require("mongoose");
const Product = require("../models/product.model");
const Store = require("../models/restaurant.model");
const Category = require("../models/category.model");
const { processMultipleImageBuffers, deleteImages, getBufferHash, uploadImageBuffer } = require("../services/unifiedUploader/unified.uploader");
const User = require("../models/user.model");
const Restaurant = require("../models/restaurant.model");

const checkAndResetOffer = async (product) => {
    const today = new Date();

    if (product.discountExpiry && new Date(product.discountExpiry) <= today) {
        if (product.offerPrice > 0 || product.discountPercentage > 0) {
            await Product.findByIdAndUpdate(product._id, {
                offerPrice: 0,
                discountPercentage: 0,
            });
            product.offerPrice = 0;
            product.discountPercentage = 0;
        }
    }
    return product;
};

const productCtlr = {}

// Create Products
productCtlr.create = async ({ body, files, user }) => {
    const userData = await User.findById(user.id);
    const restaurantId = userData.restaurantId;
    if(String(restaurantId) !== String(body.restaurantId)){
        throw { status: 403, message: "RestauratId Mismatch or You are not the owner of this Restaurant" };
    }
    const isProductNameExist = await Product.findOne({ name: body.name, restaurantId: body.restaurantId });
    if (isProductNameExist) {
        throw { status: 400, message: "Product name already exists" };
    }

    if (!files || files.length === 0) {
        throw { status: 400, message: "At least one image is required" };
    }

    const category = await Category.findById(body.categoryId);
    if (!category) {
        throw { status: 400, message: "Category not found" };
    }

    const restaurantCategory = await Category.findOne({ _id: body.categoryId, restaurantId: body.restaurantId });
    if (!restaurantCategory) {
        throw { status: 400, message: "Category not found in the Restaurant" };
    }

    const restaurant = await Restaurant.findById(body.restaurantId);
    // console.log(files);

    const uploadedImages = await processMultipleImageBuffers(files, Product, `${restaurant.folderKey}/Products`);

    let price = parseFloat(body.price);
    let discountPercentage = parseFloat(body.discountPercentage) || 0;
    let offerPrice = 0;

    if (discountPercentage > 0 && price > 0) {
        offerPrice = price - (price * discountPercentage / 100);
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

    // Parse sizes if provided
    let sizes = [];
    if (body.sizes) {
        try {
            const sizesArray = typeof body.sizes === 'string' 
                ? JSON.parse(body.sizes) 
                : body.sizes;
            
            sizes = sizesArray.map(size => {
                const sizeTranslations = new Map();
                if (size.translations) {
                    for (const [lang, name] of Object.entries(size.translations)) {
                        sizeTranslations.set(lang, name);
                    }
                }
                return {
                    name: size.name,
                    price: parseFloat(size.price) || 0,
                    isDefault: size.isDefault || false,
                    isAvailable: size.isAvailable !== undefined ? size.isAvailable : true,
                    translations: sizeTranslations
                };
            });
        } catch (error) {
            console.error('Error parsing sizes:', error);
        }
    }

    // Parse addOns if provided
    let addOns = [];
    if (body.addOns) {
        try {
            const addOnsArray = typeof body.addOns === 'string' 
                ? JSON.parse(body.addOns) 
                : body.addOns;
            
            addOns = addOnsArray.map(addOn => {
                const addOnTranslations = new Map();
                if (addOn.translations) {
                    for (const [lang, name] of Object.entries(addOn.translations)) {
                        addOnTranslations.set(lang, name);
                    }
                }
                return {
                    name: addOn.name,
                    price: parseFloat(addOn.price) || 0,
                    isAvailable: addOn.isAvailable !== undefined ? addOn.isAvailable : true,
                    translations: addOnTranslations
                };
            });
        } catch (error) {
            console.error('Error parsing addOns:', error);
        }
    }

    const product = new Product({
        ...body,
        translations,
        sizes,
        addOns,
        price,
        discountPercentage,
        offerPrice,
        images: uploadedImages
    });

    await product.save()

    const populatedProduct = await Product.findById(product._id)
        .populate('categoryId', 'name')
        .populate('categoryId', 'name')
        .populate('restaurantId', 'name address contactNumber');

    return {
        message: "Product created successfully",
        data: populatedProduct
    };
};

// Get All Products
productCtlr.list = async () => {
    const products = await Product.find()
        .sort({ productId: 1 })
        .populate('categoryId', 'name translations')
        .populate('restaurantId', 'name address contactNumber');
    
    for (let i = 0; i < products.length; i++) {
        await checkAndResetOffer(products[i]);
    }

    return { data: products };    
}

// Get All Product for Admin
// productCtlr.listByRestaurantForAdmin = async ({ user }) => {
//     const userData = await User.findById(user.id);
//     const restaurantId = userData.restaurantId;
//     const products = await Product.find({restaurantId: restaurantId}).populate('categoryId', 'name').populate('restaurantId', 'name address contactNumber');
//     for (let i = 0; i < products.length; i++) {
//         await checkAndResetOffer(products[i])
//     }
//     return { data: products };
// };

// List Product by Restaurant
productCtlr.listByRestaurant = async ({ params: { restaurantSlug } }) => {
    const restaurant = await Restaurant.findOne({slug: restaurantSlug});
    if(!restaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }
    const restaurantId = restaurant._id;
    const products = await Product.find({restaurantId: restaurantId})
        .populate('categoryId', 'name translations')
        .populate('restaurantId', 'name address contactNumber')
    return { data: products };
};

// List Product by Category
productCtlr.listByCategory = async ({ params: { categoryId } }) => {
    if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
        throw { status: 400, message: "Valid Category ID is required" };
    }

    const category = await Category.findById(categoryId);
    if (!category) {
        throw { status: 400, message: "Category not found" };
    }

    // const restaurantCategory = await Category.findOne({ _id: categoryId, restaurantId: body.restaurantId });
    // if (!restaurantCategory) {
    //     throw { status: 400, message: "Category not found in the Restaurant" };
    // }

    const products = await Product.find({ categoryId: categoryId })
        .sort({ productId: 1 })
        .populate('categoryId', 'name translations')
        .populate('restaurantId', 'name address contactNumber');
    
    // console.log(products)

    if (!products || products.length === 0) {
        throw { status: 404, message: "No Products on the Selected Category" };
    }

    for (let i = 0; i < products.length; i++) {
        await checkAndResetOffer(products[i]);
    }

    return { data: products };
};

// Get One Product by ID
productCtlr.show = async ({ params: { productId } }) => {
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        throw { status: 400, message: "Valid Product ID is required" };
    }

    const product = await Product.findById(productId)
        .populate('categoryId', 'name translations')
        .populate('restaurantId', 'name address ');
    
    if (!product) {
        throw { status: 404, message: "Product not found" };
    }
    const updatedProduct = await checkAndResetOffer(product);

    return { data: updatedProduct };   
};

// Update Product
productCtlr.update = async ({ params: { productId }, body, files, user }) => {
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        throw { status: 400, message: "Valid Product ID is required" };
    }
    const userData = await User.findById(user.id);
    const restaurantId = userData.restaurantId;
    if(String(restaurantId) !== String(body.restaurantId)){
        throw { status: 403, message: "You are not authorized to update this Product" }
    }
    const existingProduct = await Product.findOne({ _id: productId, restaurantId: restaurantId });
    if (!existingProduct) {
        throw { status: 404, message: "Product not found" };
    }

    // Validate product name uniqueness per restaurant
    const isProductNameExist = await Product.findOne({
        name: body.name,
        restaurantId: existingProduct.restaurantId,
        _id: { $ne: productId },
    });

    if (isProductNameExist) {
        throw { status: 400, message: "Product name already exists in this restaurant" };
    }

    // Parse translations if provided
    let translations = existingProduct.translations || new Map();
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

    // Parse sizes if provided
    let sizes = existingProduct.sizes || [];
    if (body.sizes !== undefined) {
        try {
            if (body.sizes === null || body.sizes === '') {
                sizes = [];
            } else {
                const sizesArray = typeof body.sizes === 'string' 
                    ? JSON.parse(body.sizes) 
                    : body.sizes;
                
                sizes = sizesArray.map(size => {
                    const sizeTranslations = new Map();
                    if (size.translations) {
                        for (const [lang, name] of Object.entries(size.translations)) {
                            sizeTranslations.set(lang, name);
                        }
                    }
                    return {
                        name: size.name,
                        price: parseFloat(size.price) || 0,
                        isDefault: size.isDefault || false,
                        isAvailable: size.isAvailable !== undefined ? size.isAvailable : true,
                        translations: sizeTranslations
                    };
                });
            }
        } catch (error) {
            console.error('Error parsing sizes:', error);
        }
    }

    // Parse addOns if provided
    let addOns = existingProduct.addOns || [];
    if (body.addOns !== undefined) {
        try {
            if (body.addOns === null || body.addOns === '') {
                addOns = [];
            } else {
                const addOnsArray = typeof body.addOns === 'string' 
                    ? JSON.parse(body.addOns) 
                    : body.addOns;
                
                addOns = addOnsArray.map(addOn => {
                    const addOnTranslations = new Map();
                    if (addOn.translations) {
                        for (const [lang, name] of Object.entries(addOn.translations)) {
                            addOnTranslations.set(lang, name);
                        }
                    }
                    return {
                        name: addOn.name,
                        price: parseFloat(addOn.price) || 0,
                        isAvailable: addOn.isAvailable !== undefined ? addOn.isAvailable : true,
                        translations: addOnTranslations
                    };
                });
            }
        } catch (error) {
            console.error('Error parsing addOns:', error);
        }
    }

    const updateData = { 
        ...body,
        translations,
        sizes,
        addOns
    };

    // Optional: Handle Category validation if provided
    if (body.categoryId) {
        const category = await Category.findOne({
            _id: body.categoryId,
            restaurantId: existingProduct.restaurantId
        });
        if (!category) {
            throw { status: 404, message: "Category not found for this restaurant" };
        }
        updateData.categoryId = category._id;
    }

    const restaurant = await Restaurant.findById(existingProduct.restaurantId);

    // Handle image update if files are uploaded
    if (files && files.length > 0) {

        const newImages = await processMultipleImageBuffers(files, Product, `${restaurant.folderKey}/Products`);

        // Delete old images (automatically handles both Cloudinary and S3)
        if (newImages.length > 0 && existingProduct.images?.length > 0) {
            // Use image URLs for better detection, fallback to publicId
            const itemsToDelete = existingProduct.images.map(img => img.url || img.publicId);
            await deleteImages(itemsToDelete);
            updateData.images = newImages;
        }
    }

    // Parse & update price
    const price = parseFloat(body.price);
    updateData.price = !isNaN(price) ? price : existingProduct.price;

    // Parse & update discount
    const discount = parseFloat(body.discountPercentage);
    updateData.discountPercentage = !isNaN(discount) ? discount : existingProduct.discountPercentage;

    // Offer Price Calculation
    updateData.offerPrice = 0;
    if (updateData.discountPercentage > 0 && updateData.price > 0) {
        updateData.offerPrice = updateData.price - (updateData.price * updateData.discountPercentage / 100);
    }

    const updatedProduct = await Product.findByIdAndUpdate(productId, updateData, {
        new: true,
        runValidators: true,
    }).populate('categoryId', 'name');

    // Reset expired offers if needed
    await checkAndResetOffer(updatedProduct);

    return {
        message: "Product updated successfully",
        data: updatedProduct
    };
};

// Delete Product
productCtlr.delete = async ({ params: { productId }, user }) => {
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        throw { status: 400, message: "Valid Product ID is required" };
    }
    const userData = await User.findById(user.id);
    const restaurantId = userData.restaurantId;
    const product = await Product.findOneAndDelete({ _id: productId, restaurantId });
    if (!product) {
        throw { status: 404, message: "Product not found or You are not authorized to delete this Product" };
    }
    // Use image URLs for better detection, fallback to publicId
    const itemsToDelete = product.images.map(img => img.url || img.publicId);
    await deleteImages(itemsToDelete);
    
    return { message: "Product deleted successfully", data: product };
};

// Bulk Delete Products
productCtlr.bulkDelete = async ({ body, user }) => {
    const { productIds } = body;
    
    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
        throw { status: 400, message: "Product IDs array is required" };
    }
    
    // Validate all product IDs
    const invalidIds = productIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
        throw { status: 400, message: "Invalid Product IDs found" };
    }
    
    const userData = await User.findById(user.id);
    const restaurantId = userData.restaurantId;
    
    // Find products that belong to the user's restaurant
    const products = await Product.find({ 
        _id: { $in: productIds }, 
        restaurantId 
    });
    
    if (products.length === 0) {
        throw { status: 404, message: "No products found or you are not authorized to delete these products" };
    }
    
    // Collect all image URLs or publicIds for deletion (prefer URLs for better detection)
    const allImageItems = products.flatMap(product => 
        product.images.map(img => img.url || img.publicId)
    );
    
    // Delete products from database
    const deletedProducts = await Product.deleteMany({ 
        _id: { $in: productIds }, 
        restaurantId 
    });
    
    // Delete images (automatically handles both Cloudinary and S3)
    if (allImageItems.length > 0) {
        await deleteImages(allImageItems);
    }
    
    return { 
        message: `${deletedProducts.deletedCount} products deleted successfully`, 
        data: { deletedCount: deletedProducts.deletedCount, products: products.map(p => ({ id: p._id, name: p.name })) }
    };
};

module.exports = productCtlr