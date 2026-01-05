const { default: mongoose } = require('mongoose');
const Coupon = require('../models/coupon.model');
const couponCtlr = {}

couponCtlr.create = async ({ body }) => {
    // console.log(body)
    const existingCoupon = await Coupon.findOne({ code: body.code.toUpperCase() });
    if (existingCoupon) {
        throw { status: 400, message: "Coupon code already exists" };
    }

    const coupon = new Coupon({
        ...body,
        code: body.code.toUpperCase()
    });

    await coupon.save();

    return {
        message: "Coupon created successfully",
        data: coupon
    };
};

couponCtlr.list = async () => {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    if(coupons.length === 0){
        throw { status: 404, message: "No coupons found" };
    }
    return {
        message: "Coupons fetched successfully",
        data: coupons
    };
};

couponCtlr.show = async ({ params: { couponId } }) => {
    if (!couponId || !mongoose.Types.ObjectId.isValid(couponId)) {
        throw { status: 400, message: "Valid Product ID is required" };
    }
    const coupon = await Coupon.findById(couponId);
    if (!coupon) {
        throw { status: 404, message: "Coupon not found" };
    }

    return {
        message: "Coupon fetched successfully",
        data: coupon
    };
};

couponCtlr.update = async ({ body, params: { couponId } }) => {
    const now = new Date();
    if (!couponId || !mongoose.Types.ObjectId.isValid(couponId)) {
        throw { status: 400, message: "Valid Product ID is required" };
    }
    const coupon = await Coupon.findById(couponId);
    if (!coupon) {
        throw { status: 404, message: "Coupon not found" };
    }

    const validFrom = body.validFrom || existing.validFrom;
    const validTill = body.validTill || existing.validTill;

    const isActive = validFrom <= now && validTill >= now;

    // Update only the fields that are present in body
    Object.assign(coupon, {
        ...body,
        code: body.code?.toUpperCase() || coupon.code,
        isActive
    });

    await coupon.save();

    return {
        message: "Coupon updated successfully",
        data: coupon
    };
};

couponCtlr.delete = async ({ params: { couponId } }) => {
    if (!couponId || !mongoose.Types.ObjectId.isValid(couponId)) {
        throw { status: 400, message: "Valid Product ID is required" };
    }
    const coupon = await Coupon.findByIdAndDelete(couponId);
    if (!coupon) {
        throw { status: 404, message: "Coupon not found" };
    }

    return {
        message: "Coupon deleted successfully",
        data: coupon
    };
};

module.exports = couponCtlr;