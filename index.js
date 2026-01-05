require ('dotenv').config()
const express = require('express');
const cors = require('cors');
const configureDB = require('./app/config/db');
const router = require('./app/routes/common.routes');
const app = express();
const PORT = 5030;
const http = require("http");
const { Server } = require("socket.io");
const socketService = require('./app/services/socketService/socketService');

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Initialize socket service
socketService.initSocket(io);

// // ----- TEST SOCKET CONNECTION -----
// io.on("connection", (socket) => {
//   console.log("Client connected:", socket.id); // Logs when a client connects
//   // Send a test message to the client
//   socket.emit("test", { message: "Hello from backend" });

//   socket.on("disconnect", () => {
//     console.log("Client disconnected:", socket.id);
//   });
// });
// // ----- END TEST -----

configureDB()
app.use(cors());

// Stripe webhooks require raw body for signature verification
app.use('/api/payment/stripe/webhook', express.raw({ type: 'application/json' }));
// All other routes use JSON
app.use(express.json());

app.use('/api', router)

app.get('/', (req, res) => {
  res.send('API Running');
});

app.use("/health", (req, res) => {
    res.status(200).send("Welcome to Backend of Dine-OS Application");
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});