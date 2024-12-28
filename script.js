const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();

// MongoDB connection
const mongoURI = "mongodb://localhost:27017";
const dbName = "chatApp";
let db;

MongoClient.connect(mongoURI)
  .then(client => {
    db = client.db(dbName);
    console.log(`Connected to MongoDB: ${dbName}`);
  })
  .catch(err => {
    console.error("MongoDB connection error:", err);
    setTimeout(() => {
      console.log('Retrying MongoDB connection...');
      MongoClient.connect(mongoURI, { useUnifiedTopology: true }).catch(console.error);
    }, 5000); // Retry after 5 seconds
  });

// CORS settings
app.use(cors({
  origin: '*', // Or restrict to specific origins for production
  methods: ["GET", "POST"],
  credentials: true
}));

// Server setup
const server = app.listen(3002, () => {
  console.log('Server is running on http://localhost:3002');
});

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: '*', // Or restrict to specific origins for production
    methods: ["GET", "POST"],
    credentials: true
  }
});

let users = {}; // Online users

// Save message to MongoDB
const saveMessageToDB = async (messageData) => {
  try {
    await db.collection('messages').insertOne(messageData);
    console.log('Message saved to DB:', messageData);
  } catch (err) {
    console.error("Error saving message:", err);
  }
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('A user connected with socket ID:', socket.id);

  // User joins the chat
  socket.on('join', (username) => {
    if (!username) {
      return socket.disconnect(true); // Disconnect if no username provided
    }

    socket.username = username; // Store the username
    users[socket.id] = username; // Add user to online list
    io.emit('update users', Object.values(users)); // Broadcast updated user list
    console.log(`${username} has joined the chat.`);
  });

  // Send private message
  socket.on('private message', async (data, callback) => {
    const { toUsername, message } = data;
    const fromUsername = socket.username; // Sender's username

    if (!toUsername || !message || !fromUsername) {
      return callback({ status: 'error', message: 'Invalid data.' });
    }

    // Check if recipient is online
    const recipientSocketId = Object.keys(users).find(id => users[id] === toUsername);
    const messageData = {
      from: fromUsername,
      to: toUsername,
      message,
      timestamp: new Date().toISOString()
    };

    if (recipientSocketId && io.sockets.sockets.get(recipientSocketId)) {
      // Send the message to the specific recipient
      io.to(recipientSocketId).emit('chat message', messageData);
      console.log(`Message sent to ${toUsername}`);
      callback({ status: 'success', message: 'Message delivered.' });
      await saveMessageToDB(messageData);
    } else {
      // Save message to DB if recipient is offline
      await saveMessageToDB(messageData);
      console.log(`Message saved for offline user: ${toUsername}`);
      callback({ status: 'success', message: 'Recipient offline. Message saved to database.' });
    }
  });

  // User disconnects from the chat
  socket.on('disconnect', () => {
    if (socket.username) {
      delete users[socket.id]; // Remove user from online list
      io.emit('update users', Object.values(users)); // Broadcast updated user list
      console.log(`${socket.username} has left the chat.`);
    }
  });
});
