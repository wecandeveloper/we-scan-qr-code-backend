let io;

module.exports = {
    // Initialize Socket.IO
    initSocket: (serverIo) => {
        io = serverIo;
        console.log("Socket.IO initialized successfully ✅");

        io.on("connection", (socket) => {
            console.log("New socket connected:", socket.id);
    
            // ✅ Restaurant joins its room
            socket.on("join-restaurant", (restaurantId) => {
                socket.join(`restaurant_${restaurantId}`);
                const roomSize = io.sockets.adapter.rooms.get(`restaurant_${restaurantId}`)?.size || 0;
                console.log(`Socket ${socket.id} joined room restaurant_${restaurantId}`);
                console.log(`👥 Total clients in restaurant_${restaurantId}: ${roomSize}`);
            });

            // ✅ Guest joins its room
            socket.on("join-guest", (guestId) => {
                socket.join(`guest_${guestId}`);
                console.log(`Socket ${socket.id} joined room guest_${guestId}`);
                console.log(`Total clients in guest_${guestId}:`, io.sockets.adapter.rooms.get(`guest_${guestId}`)?.size || 0);
            });

            // ✅ Test connection handler
            socket.on("test-connection", (data) => {
                console.log(`🧪 Test connection received from socket ${socket.id}:`, data);
                const roomName = `restaurant_${data.restaurantId}`;
                const roomSize = io.sockets.adapter.rooms.get(roomName)?.size || 0;
                console.log(`👥 Current clients in ${roomName}: ${roomSize}`);
            });

            // ✅ Test guest connection handler
            socket.on("test-guest-connection", (data) => {
                console.log(`🧪 Test guest connection received from socket ${socket.id}:`, data);
                const roomName = `guest_${data.guestId}`;
                const roomSize = io.sockets.adapter.rooms.get(roomName)?.size || 0;
                console.log(`👥 Current clients in ${roomName}: ${roomSize}`);
                socket.emit("guest-connection-confirmed", { roomName, roomSize });
            });
    
            // (optional) handle disconnects
            socket.on("disconnect", () => {
                console.log(`Socket ${socket.id} disconnected`);
            });
        });
    },

    // Emit order notifications
    emitOrderNotification: (restaurantId, data) => {
        if (!io) {
            console.warn("Socket.IO not initialized!");
            return;
        }
        
        const roomName = `restaurant_${restaurantId}`;
        const roomSize = io.sockets.adapter.rooms.get(roomName)?.size || 0;
        
        console.log(`📡 Emitting restaurant-order-notification to ${roomName}:`, data);
        console.log(`👥 Clients in room: ${roomSize}`);
        
        if (roomSize === 0) {
            console.warn(`⚠️ No clients in room ${roomName}! Order notification may not be received.`);
        }
        
        io.to(roomName).emit("restaurant-order-notification", data);
    },

    // Emit waiter call notifications
    emitCallWaiter: (data) => {
        if (!io) {
            console.warn("Socket.IO not initialized!");
            return;
        }
        try {
            const roomName = data?.restaurantId ? `restaurant_${data.restaurantId}` : null;
            console.log("📣 Emitting call-waiter:", { roomName, payload: data });
            if (roomName) {
                const roomSize = io.sockets.adapter.rooms.get(roomName)?.size || 0;
                console.log(`👥 Clients in ${roomName}: ${roomSize}`);
                io.to(roomName).emit("call-waiter", data);
            } else {
                io.emit("call-waiter", data);
            }
        } catch (err) {
            console.error("Failed to emit call-waiter:", err);
        }
    },

    // Emit customer notifications
    emitCustomerNotification: (guestId, data) => {
        if (!io) {
            console.warn("Socket.IO not initialized!");
            return;
        }
        console.log(`Emitting customer notification to guest_${guestId}:`, data);
        io.to(`guest_${guestId}`).emit("customer-order-notification", data);
    },

    // Emit to restaurant room (generic function)
    emitToRestaurant: (restaurantId, event, data) => {
        if (!io) {
            console.warn("Socket.IO not initialized!");
            return;
        }
        
        const roomName = `restaurant_${restaurantId}`;
        const roomSize = io.sockets.adapter.rooms.get(roomName)?.size || 0;
        
        console.log(`📡 Emitting ${event} to ${roomName}:`, data);
        console.log(`👥 Clients in room: ${roomSize}`);
        
        if (roomSize === 0) {
            console.warn(`⚠️ No clients in room ${roomName}! Event may not be received.`);
        }
        
        io.to(roomName).emit(event, data);
    },

    // Emit to guest room (for customer notifications)
    emitToGuest: (guestId, event, data) => {
        if (!io) {
            console.warn("Socket.IO not initialized!");
            return;
        }
        
        const roomName = `guest_${guestId}`;
        const roomSize = io.sockets.adapter.rooms.get(roomName)?.size || 0;
        
        console.log(`📡 Emitting ${event} to ${roomName}:`, data);
        console.log(`👥 Clients in room: ${roomSize}`);
        
        if (roomSize === 0) {
            console.warn(`⚠️ No clients in room ${roomName}! Event may not be received.`);
        }
        
        io.to(roomName).emit(event, data);
    },
};
