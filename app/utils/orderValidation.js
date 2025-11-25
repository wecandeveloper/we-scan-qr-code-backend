const Restaurant = require('../models/restaurant.model');
const Product = require('../models/product.model');
const Table = require('../models/table.model');

/**
 * Validate order details before payment processing
 * @param {Object} guestCart - The guest cart from localStorage
 * @param {String} restaurantId - Restaurant ID
 * @param {String} guestId - Guest ID
 * @param {String} paymentOption - Payment option: 'pay_now', 'pay_later', 'cash_on_delivery'
 * @returns {Object} - Validation result with validated data or error
 */
async function validateOrderBeforePayment(guestCart, restaurantId, guestId, paymentOption) {
    // 1. Validate restaurant exists and has payment enabled
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
        throw { status: 404, message: "Restaurant not found" };
    }

    // Check if restaurant has Advanced subscription
    if (restaurant.subscription !== 'advanced') {
        throw { status: 403, message: "Payment gateway is only available for Advanced subscription restaurants" };
    }

    // Check if payment is enabled
    if (!restaurant.paymentSettings || !restaurant.paymentSettings.isPaymentEnabled) {
        throw { status: 403, message: "Online payment is not enabled for this restaurant" };
    }

    // Check if gateway is configured
    if (!restaurant.paymentSettings.selectedGateway) {
        throw { status: 400, message: "Payment gateway is not configured for this restaurant" };
    }

    // 2. Validate guestCart structure
    if (!guestCart || !guestCart.lineItems || guestCart.lineItems.length === 0) {
        throw { status: 400, message: "Cart is empty" };
    }

    // 3. Validate orderType
    const validOrderTypes = ['Dine-In', 'Home-Delivery', 'Take-Away'];
    if (!guestCart.orderType || !validOrderTypes.includes(guestCart.orderType)) {
        throw { status: 400, message: "Invalid order type" };
    }

    // 4. Validate orderType-specific requirements
    if (guestCart.orderType === 'Dine-In') {
        if (!guestCart.tableId || !guestCart.tableId._id) {
            throw { status: 400, message: "Table selection is required for Dine-In orders" };
        }
        // Validate table exists and belongs to restaurant
        const table = await Table.findOne({ _id: guestCart.tableId._id, restaurantId: restaurantId });
        if (!table) {
            throw { status: 404, message: "Table not found or does not belong to this restaurant" };
        }
    }

    if (guestCart.orderType === 'Home-Delivery' || guestCart.orderType === 'Take-Away') {
        if (!guestCart.deliveryAddress) {
            throw { status: 400, message: "Delivery address is required for " + guestCart.orderType + " orders" };
        }
        if (!guestCart.deliveryAddress.name || !guestCart.deliveryAddress.phone) {
            throw { status: 400, message: "Customer name and phone are required" };
        }
    }

    // 5. Validate payment option based on order type
    const validPaymentOptions = {
        'Dine-In': ['pay_now', 'pay_later'],
        'Home-Delivery': ['pay_now', 'cash_on_delivery'],
        'Take-Away': ['pay_now', 'pay_later']
    };

    if (!paymentOption || !validPaymentOptions[guestCart.orderType].includes(paymentOption)) {
        throw { 
            status: 400, 
            message: `Invalid payment option for ${guestCart.orderType}. Valid options: ${validPaymentOptions[guestCart.orderType].join(', ')}` 
        };
    }

    // If payment option is not 'pay_now', we still need to calculate totals for payment record
    // But we'll skip the payment gateway processing
    let skipPayment = false;
    if (paymentOption !== 'pay_now') {
        skipPayment = true;
    }

    // 6. Validate lineItems and calculate totals (needed for both pay_now and pay_later/cod)
    const productLineItems = [];
    const addOnsLineItems = [];
    let calculatedTotal = 0;

    for (const item of guestCart.lineItems) {
        // Handle common addOns
        if (item.isCommonAddOn) {
            if (!item.commonAddOnName || !item.quantity || item.quantity <= 0) {
                throw { status: 400, message: "Invalid common add-on item" };
            }
            if (!item.price || item.price < 0) {
                throw { status: 400, message: "Invalid price for common add-on: " + item.commonAddOnName };
            }
            const itemTotal = (item.itemTotal !== undefined) ? item.itemTotal : (item.price * item.quantity);
            calculatedTotal += itemTotal;
            addOnsLineItems.push({
                commonAddOnName: item.commonAddOnName,
                quantity: item.quantity,
                price: item.price,
                basePrice: item.basePrice || item.price,
                itemSubtotal: item.itemSubtotal || item.price,
                itemTotal: itemTotal
            });
            continue;
        }

        // Handle product items
        if (!item.productId || !item.productId._id) {
            throw { status: 400, message: "Product ID is required for all line items" };
        }

        if (!item.quantity || item.quantity <= 0) {
            throw { status: 400, message: "Invalid quantity for product" };
        }

        // Validate product exists and belongs to restaurant
        const product = await Product.findById(item.productId._id)
            .populate('categoryId', 'name');
        
        if (!product) {
            throw { status: 404, message: `Product not found: ${item.productId._id}` };
        }

        if (product.restaurantId.toString() !== restaurantId.toString()) {
            throw { status: 403, message: `Product does not belong to this restaurant: ${product.name}` };
        }

        // ✅ Use prices from cart item if available (ensures consistency with frontend calculation)
        // This is important because the frontend may calculate offer prices using discountPercentage
        // or use offerPrice that was valid when the item was added to cart
        let basePrice = 0;
        let itemSubtotal = 0;
        let itemTotal = 0;
        
        // If cart item has pre-calculated values, use them (preferred method)
        if (item.itemTotal !== undefined && item.itemSubtotal !== undefined && item.basePrice !== undefined) {
            // Use the prices already calculated and stored in the cart
            basePrice = item.basePrice;
            itemSubtotal = item.itemSubtotal;
            itemTotal = item.itemTotal;
            calculatedTotal += itemTotal;
        } else {
            // Fallback: Recalculate from product database (for backward compatibility)
            // If product has sizes and selectedSize is provided
            if (item.selectedSize && product.sizes && product.sizes.length > 0) {
                const selectedSizeObj = product.sizes.find(s => s.name === item.selectedSize.name);
                if (!selectedSizeObj) {
                    throw { status: 400, message: `Selected size not found for product: ${product.name}` };
                }
                // Use offer price if available, otherwise regular price
                basePrice = selectedSizeObj.offerPrice && selectedSizeObj.offerPrice > 0 
                    ? selectedSizeObj.offerPrice 
                    : selectedSizeObj.price;
            } else {
                // Use product offer price if available, otherwise regular price
                basePrice = product.offerPrice && product.offerPrice > 0 
                    ? product.offerPrice 
                    : product.price;
            }

            // Add product-specific addOns
            let addOnsTotal = 0;
            if (item.productAddOns && Array.isArray(item.productAddOns) && item.productAddOns.length > 0) {
                if (product.addOns && product.addOns.length > 0) {
                    for (const selectedAddOn of item.productAddOns) {
                        const productAddOn = product.addOns.find(a => a.name === selectedAddOn.name);
                        if (!productAddOn) {
                            throw { status: 400, message: `Add-on not found for product: ${product.name} - ${selectedAddOn.name}` };
                        }
                        addOnsTotal += productAddOn.price || 0;
                    }
                }
            }

            itemSubtotal = basePrice + addOnsTotal;
            itemTotal = itemSubtotal * item.quantity;
            calculatedTotal += itemTotal;
        }

        // Build line item for order
        // Use prices from cart item if available, otherwise use calculated prices
        const lineItem = {
            productId: product._id,
            quantity: item.quantity,
            price: item.basePrice !== undefined ? item.basePrice : basePrice, // Legacy field for backward compatibility
            basePrice: item.basePrice !== undefined ? item.basePrice : basePrice,
            itemSubtotal: item.itemSubtotal !== undefined ? item.itemSubtotal : itemSubtotal,
            itemTotal: item.itemTotal !== undefined ? item.itemTotal : itemTotal
        };

        if (item.comments) lineItem.comments = item.comments;
        if (item.selectedSize) lineItem.selectedSize = item.selectedSize;
        if (item.productAddOns && item.productAddOns.length > 0) {
            lineItem.productAddOns = item.productAddOns;
        }

        productLineItems.push(lineItem);
    }

    // 7. Validate total amount matches
    const cartTotal = guestCart.totalAmount || 0;
    const tolerance = 0.01; // Allow small floating point differences
    
    if (Math.abs(calculatedTotal - cartTotal) > tolerance) {
        throw { 
            status: 400, 
            message: `Total amount mismatch. Calculated: ${calculatedTotal}, Cart total: ${cartTotal}` 
        };
    }

    // 8. Return validated data
    return {
        isValid: true,
        skipPayment: skipPayment,
        paymentOption: paymentOption,
        restaurant: restaurant,
        validatedCart: {
            restaurantId: restaurantId,
            guestId: guestId,
            orderType: guestCart.orderType,
            tableId: guestCart.tableId,
            deliveryAddress: guestCart.deliveryAddress,
            lineItems: productLineItems,
            addOnsLineItems: addOnsLineItems,
            totalAmount: calculatedTotal,
            originalAmount: calculatedTotal, // For now, no discounts applied
            discountAmount: 0,
            shippingCharge: 0
        }
    };
}

module.exports = {
    validateOrderBeforePayment
};

