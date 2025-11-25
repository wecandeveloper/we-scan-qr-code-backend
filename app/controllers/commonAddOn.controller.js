const CommonAddOn = require("../models/commonAddOn.model");
const mongoose = require("mongoose");

const commonAddOnCtlr = {};

// Create Common AddOn
commonAddOnCtlr.create = async ({ body }) => {
    // Check if name already exists (global uniqueness)
    const existingAddOn = await CommonAddOn.findOne({ name: body.name });
    if (existingAddOn) {
        throw { status: 400, message: "Common addOn name already exists" };
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

    const commonAddOn = new CommonAddOn({
        name: body.name,
        description: body.description || "",
        price: parseFloat(body.price) || 0,
        isAvailable: body.isAvailable !== undefined ? body.isAvailable : true,
        translations
    });

    await commonAddOn.save();

    return {
        message: "Common addOn created successfully",
        data: commonAddOn
    };
};

// Get All Common AddOns
commonAddOnCtlr.list = async () => {
    const commonAddOns = await CommonAddOn.find().sort({ createdAt: -1 });
    return { data: commonAddOns };
};

// Get All Available Common AddOns (for frontend)
commonAddOnCtlr.listAvailable = async () => {
    const commonAddOns = await CommonAddOn.find({ isAvailable: true }).sort({ name: 1 });
    return { data: commonAddOns };
};

// Get Single Common AddOn
commonAddOnCtlr.show = async ({ params: { commonAddOnId } }) => {
    if (!commonAddOnId || !mongoose.Types.ObjectId.isValid(commonAddOnId)) {
        throw { status: 400, message: "Valid Common AddOn ID is required" };
    }

    const commonAddOn = await CommonAddOn.findById(commonAddOnId);
    if (!commonAddOn) {
        throw { status: 404, message: "Common addOn not found" };
    }

    return { data: commonAddOn };
};

// Update Common AddOn
commonAddOnCtlr.update = async ({ params: { commonAddOnId }, body }) => {
    if (!commonAddOnId || !mongoose.Types.ObjectId.isValid(commonAddOnId)) {
        throw { status: 400, message: "Valid Common AddOn ID is required" };
    }

    const existingAddOn = await CommonAddOn.findById(commonAddOnId);
    if (!existingAddOn) {
        throw { status: 404, message: "Common addOn not found" };
    }

    // Check if name is being changed and if new name already exists
    if (body.name && body.name !== existingAddOn.name) {
        const nameExists = await CommonAddOn.findOne({ 
            name: body.name, 
            _id: { $ne: commonAddOnId } 
        });
        if (nameExists) {
            throw { status: 400, message: "Common addOn name already exists" };
        }
    }

    // Parse translations if provided
    let translations = existingAddOn.translations || new Map();
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
        ...body,
        translations
    };

    if (body.price !== undefined) {
        updateData.price = parseFloat(body.price) || 0;
    }

    const updatedAddOn = await CommonAddOn.findByIdAndUpdate(
        commonAddOnId,
        updateData,
        { new: true }
    );

    return {
        message: "Common addOn updated successfully",
        data: updatedAddOn
    };
};

// Delete Common AddOn
commonAddOnCtlr.delete = async ({ params: { commonAddOnId } }) => {
    if (!commonAddOnId || !mongoose.Types.ObjectId.isValid(commonAddOnId)) {
        throw { status: 400, message: "Valid Common AddOn ID is required" };
    }

    const commonAddOn = await CommonAddOn.findByIdAndDelete(commonAddOnId);
    if (!commonAddOn) {
        throw { status: 404, message: "Common addOn not found" };
    }

    return { message: "Common addOn deleted successfully", data: commonAddOn };
};

// Bulk Delete Common AddOns
commonAddOnCtlr.bulkDelete = async ({ body: { commonAddOnIds } }) => {
    if (!commonAddOnIds || !Array.isArray(commonAddOnIds) || commonAddOnIds.length === 0) {
        throw { status: 400, message: "Common AddOn IDs array is required" };
    }

    // Validate all IDs
    const invalidIds = commonAddOnIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
        throw { status: 400, message: "Invalid Common AddOn IDs provided" };
    }

    const deleteResult = await CommonAddOn.deleteMany({ _id: { $in: commonAddOnIds } });

    return {
        message: `${deleteResult.deletedCount} common addOn(s) deleted successfully`,
        data: { deletedCount: deleteResult.deletedCount }
    };
};

module.exports = commonAddOnCtlr;

