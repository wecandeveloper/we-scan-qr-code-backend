const Table = require("../models/table.model");
const socketService = require("../services/socketService/socketService");

const tableCtlr = {}

tableCtlr.listAll = async () => {
    const tables = await Table.find().populate('restaurantId', 'name address');
    if (!tables) {
        throw { status: 404, message: "Table not found" };
    }
    return { data: tables };
};

tableCtlr.listByRestaurant = async ({ params: { restaurantId } }) => {
    const tables = await Table.find({restaurantId: restaurantId}).populate('restaurantId', 'name address');
    if (!tables) {
        throw { status: 404, message: "Table not found" };
    }
    return { data: tables };
};

tableCtlr.callWaiter = async ({ body }) => {
    const { tableId, restaurantId, orderType, deliveryAddress } = body;

    if (!restaurantId) {
        throw new Error("Restaurant ID is required");
    }

    if (orderType === 'Dine-In') {
        if (!tableId) {
            throw new Error("Table ID is required for Dine-In waiter call");
        }

        // Verify table exists in DB
        const table = await Table.findOne({ _id: tableId, restaurantId: restaurantId });
        if (!table) {
            throw new Error("Table not found");
        }

        const data = {
            orderType: 'Dine-In',
            tableNo: table.tableNumber,
            restaurantId,
            message: `Waiter requested at Table ${table.tableNumber}`,
            timestamp: new Date(),
        };

        socketService.emitCallWaiter(data);

        return {
            success: true,
            message: "Waiter called successfully",
            data,
        };
    }

    if (orderType === 'Take-Away') {
        // Expect deliveryAddress with name, phone, and optionally vehicleNo
        const customerName = deliveryAddress?.name;
        const customerPhone = deliveryAddress?.phone?.countryCode && deliveryAddress?.phone?.number
            ? `${deliveryAddress.phone.countryCode}${deliveryAddress.phone.number}`
            : undefined;
        const vehicleNo = deliveryAddress?.vehicleNo;

        if (!customerName || !customerPhone) {
            throw new Error("Customer name and phone are required for Take-Away waiter call");
        }

        const data = {
            orderType: 'Take-Away',
            restaurantId,
            customerName,
            customerPhone,
            vehicleNo,
            message: `Take-Away customer needs assistance` + (vehicleNo ? ` • Vehicle: ${vehicleNo}` : ''),
            timestamp: new Date(),
        };

        socketService.emitCallWaiter(data);

        return {
            success: true,
            message: "Waiter called successfully",
            data,
        };
    }

    throw new Error("Unsupported order type for waiter call");
};


module.exports = tableCtlr