const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const Datastore = require('nedb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const PORT = process.env.PORT || 60000;
const JWT_SECRET = 'your_jwt_secret_change_in_production'; // In production, use environment variable

// Initialize NeDB database for users
const usersDb = new Datastore({ filename: './data/users.db', autoload: true });
// Initialize NeDB database for conversations
const conversationsDb = new Datastore({ filename: './data/conversations.db', autoload: true });
// Initialize NeDB database for messages
const messagesDb = new Datastore({ filename: './data/messages.db', autoload: true });

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Create HTTP server and Socket.IO instance
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // In production, replace with actual origin
    methods: ["GET", "POST"]
  }
});

// Store online users for presence tracking
const onlineUsers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle user coming online
  socket.on('user-online', (userId) => {
    onlineUsers.set(userId, socket.id);
    // Notify friends that user is online
    socket.broadcast.emit('user-status-changed', { userId, online: true });
  });

  // Handle user going offline
  socket.on('user-offline', (userId) => {
    onlineUsers.delete(userId);
    // Notify friends that user is offline
    socket.broadcast.emit('user-status-changed', { userId, online: false });
  });

  // Handle typing indicator
  socket.on('typing', ({ conversationId, userId, isTyping }) => {
    socket.to(conversationId).emit('typing', { conversationId, userId, isTyping });
  });

  // Handle new message
  socket.on('send-message', async (messageData) => {
    try {
      // Save message to database
      const message = {
        ...messageData,
        _id: Math.random().toString(36).substr(2, 9), // Simple ID generation
        createdAt: new Date(),
        updatedAt: new Date()
      };

      messagesDb.insert(message, (err, savedMessage) => {
        if (err) {
          console.error('Error saving message:', err);
          return;
        }

        // Update conversation's last message and timestamp
        conversationsDb.update(
          { _id: messageData.conversationId },
          {
            $set: {
              lastMessage: savedMessage.text,
              lastMessageAt: new Date(),
              updatedAt: new Date()
            }
          },
          {}, (err) => {
            if (err) console.error('Error updating conversation:', err);
          }
        );

        // Emit message to conversation participants
        io.to(messageData.conversationId).emit('new-message', savedMessage);
      });
    } catch (error) {
      console.error('Error handling send-message:', error);
    }
  });

  // Handle marking messages as read
  socket.on('mark-as-read', ({ conversationId, userId, messageIds }) => {
    // Update messages as read
    messageIds.forEach(messageId => {
      messagesDb.update(
        { _id: messageId },
        { $addToSet: { readBy: userId } },
        {}, (err) => {
          if (err) console.error('Error marking message as read:', err);
        }
      );
    });

    // Notify others in conversation
    socket.to(conversationId).emit('messages-read', { conversationId, userId, messageIds });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Find and remove user from onlineUsers
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        socket.broadcast.emit('user-status-changed', { userId, online: false });
        break;
      }
    }
  });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.sendStatus(403);
    // Find the user by id from token
    usersDb.findOne({ _id: decoded.userId }, (err, user) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      if (!user) return res.sendStatus(404); // User not found
      // Attach user without password to request
      const { password, ...userWithoutPassword } = user;
      req.user = userWithoutPassword;
      next();
    });
  });
};

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'TELAWORK API is running!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Auth routes
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;

  // Check if user already exists
  usersDb.findOne({ $or: [{ username }, { email} ] }, (err, user) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (user) return res.status(400).json({ message: 'User already exists' });

    // Hash password
    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) return res.status(500).json({ message: 'Error hashing password' });

      // Create new user with enhanced profile and friends init
      const newUser = {
        username,
        email,
        password: hashedPassword,
        createdAt: new Date(),
        profile: {
          displayName: username,
          bio: '',
          avatar: '',
          banner: '', // Added banner support
          status: ''  // Added custom status support
        },
        friends: [],
        friendRequests: {
          incoming: [],
          outgoing: []
        },
        blocked: [], // Added block/unblock support
        online: false, // Added online/offline presence
        lastSeen: new Date() // Added last seen timestamp
      };

      usersDb.insert(newUser, (err, user) => {
        if (err) return res.status(500).json({ message: 'Error creating user' });
        // Remove password from user object before sending
        const { password, ...userWithoutPassword } = user;
        // Generate JWT token
        const accessToken = jwt.sign({ userId: user._id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        res.status(201).json({ user: userWithoutPassword, accessToken });
      });
    });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  usersDb.findOne({ username }, (err, user) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) return res.status(500).json({ message: 'Error comparing passwords' });
      if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

      // Update online status and last seen
      usersDb.update({ _id: user._id }, { $set: { online: true, lastSeen: new Date() } }, {}, (err) => {
        if (err) return res.status(500).json({ message: 'Error updating user status' });

        const { password, ...userWithoutPassword } = user;
        // Generate JWT token
        const accessToken = jwt.sign({ userId: user._id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ user: userWithoutPassword, accessToken });
      });
    });
  });
});

app.post('/api/auth/logout', (req, res) => {
  // Update offline status when logging out
  if (req.user) {
    usersDb.update({ _id: req.user._id }, { $set: { online: false, lastSeen: new Date() } }, {}, (err) => {
      if (err) return res.status(500).json({ message: 'Error updating user status' });
    });
  }

  // In a more advanced app, we might invalidate the token on the server side.
  // For simplicity, we just tell the client to delete the token.
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  // req.user is already set by middleware (user without password)
  res.json({ user: req.user });
});

// Profile routes
app.get('/api/users/profile', authenticateToken, (req, res) => {
  // Return the authenticated user's profile
  res.json({ profile: req.user.profile });
});

app.put('/api/users/profile', authenticateToken, (req, res) => {
  const { displayName, bio, avatar, banner, status } = req.body;
  // Update the user's profile
  usersDb.update({ _id: req.user._id }, { $set: {
    'profile.displayName': displayName,
    'profile.bio': bio,
    'profile.avatar': avatar,
    'profile.banner': banner, // Added banner support
    'profile.status': status  // Added custom status support
  } }, {}, (err, numReplaced) => {
    if (err) return res.status(500).json({ message: 'Error updating profile' });
    if (numReplaced === 0) return res.status(404).json({ message: 'User not found' });
    // Fetch updated user to return
    usersDb.findOne({ _id: req.user._id }, (err, user) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      const { password, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword });
    });
  });
});

// Get public profile of any user by username
app.get('/api/users/:username', authenticateToken, (req, res) => {
  const { username } = req.params;
  usersDb.findOne({ username }, (err, user) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!user) return res.status(404).json({ message: 'User not found' });
    // Return only public profile info (hide email, etc.)
    const { _id, username, profile, createdAt, online, lastSeen } = user;
    res.json({ user: { _id, username, profile, createdAt, online, lastSeen } });
  });
});

// Enhanced user search
app.get('/api/users/search', authenticateToken, (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ message: 'Query parameter is required' });

  // Search for users by username or display name
  const searchRegex = new RegExp(query, 'i');
  usersDb.find({
    $or: [
      { username: searchRegex },
      { 'profile.displayName': searchRegex }
    ]
  }, (err, users) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    // Remove passwords and sensitive info from user objects
    const usersSafe = users.map(({ password, ...user }) => {
      // Also hide email and other private info in search results
      const { email, blocked, friendRequests, ...publicUser } = user;
      return publicUser;
    });
    res.json({ users: usersSafe });
  });
});

// Get user's online status
app.get('/api/users/:userId/status', authenticateToken, (req, res) => {
  const { userId } = req.params;
  usersDb.findOne({ _id: userId }, (err, user) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({
      online: user.online,
      lastSeen: user.lastSeen
    });
  });
});

// Friends routes
// Send friend request
app.post('/api/friends/request', authenticateToken, (req, res) => {
  const { username } = req.body; // username of the user to send request to
  if (!username) return res.status(400).json({ message: 'Username is required' });

  // Find the target user
  usersDb.findOne({ username }, (err, targetUser) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    // Check if trying to add oneself
    if (targetUser._id.equals(req.user._id)) {
      return res.status(400).json({ message: 'Cannot send friend request to yourself' });
    }

    // Check if user is blocked
    if (targetUser.blocked && targetUser.blocked.some(blockedId => blockedId.equals(req.user._id))) {
      return res.status(403).json({ message: 'Cannot send friend request to a blocked user' });
    }

    // Check if current user has blocked the target user
    if (req.user.blocked && req.user.blocked.some(blockedId => blockedId.equals(targetUser._id))) {
      return res.status(403).json({ message: 'Cannot send friend request to a user you have blocked' });
    }

    // Check if already friends
    const isAlreadyFriend = req.user.friends.some(friendId => friendId.equals(targetUser._id));
    if (isAlreadyFriend) {
      return res.status(400).json({ message: 'Already friends with this user' });
    }

    // Check if friend request already sent (outgoing) or received (incoming)
    const outgoingRequestExists = req.user.friendRequests.outgoing.some(reqObj => reqObj.toUserId.equals(targetUser._id));
    const incomingRequestExists = targetUser.friendRequests.incoming.some(reqObj => reqObj.fromUserId.equals(req.user._id));
    if (outgoingRequestExists || incomingRequestExists) {
      return res.status(400).json({ message: 'Friend request already exists' });
    }

    // Create friend request objects
    const requestObj = {
      fromUserId: req.user._id,
      fromUsername: req.user.username,
      toUserId: targetUser._id,
      requestedAt: new Date()
    };
    const incomingRequestObj = {
      fromUserId: req.user._id,
      fromUsername: req.user.username,
      requestedAt: new Date()
    };

    // Update target user: add to incoming friend requests
    usersDb.update({ _id: targetUser._id }, { $push: { 'friendRequests.incoming': incomingRequestObj } }, {}, (err) => {
      if (err) return res.status(500).json({ message: 'Error sending friend request' });
      // Update current user: add to outgoing friend requests
      usersDb.update({ _id: req.user._id }, { $push: { 'friendRequests.outgoing': requestObj } }, {}, (err) => {
        if (err) return res.status(500).json({ message: 'Error sending friend request' });
        res.json({ message: 'Friend request sent successfully' });
      });
    });
  });
});

// Accept friend request
app.post('/api/friends/accept', authenticateToken, (req, res) => {
  const { requestId } = req.body; // We'll use the _id of the friend request object in the incoming array
  if (!requestId) return res.status(400).json({ message: 'Request ID is required' });

  // Find the incoming request in the current user's friendRequests.incoming
  usersDb.findOne({ _id: req.user._id }, (err, user) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const incomingRequest = user.friendRequests.incoming.find(reqObj => reqObj._id.equals(requestId));
    if (!incomingRequest) return res.status(404).json({ message: 'Friend request not found' });

    const fromUserId = incomingRequest.fromUserId;
    const fromUsername = incomingRequest.fromUsername;

    // Find the user who sent the request
    usersDb.findOne({ _id: fromUserId }, (err, fromUser) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      if (!fromUser) return res.status(404).json({ message: 'User not found' });

      // Check if either user has blocked the other
      if (fromUser.blocked && fromUser.blocked.some(blockedId => blockedId.equals(req.user._id))) {
        return res.status(403).json({ message: 'Cannot accept friend request from a blocked user' });
      }

      if (user.blocked && user.blocked.some(blockedId => blockedId.equals(fromUserId))) {
        return res.status(403).json({ message: 'Cannot accept friend request to a user you have blocked' });
      }

      // Add each other to friends list
      usersDb.update({ _id: req.user._id }, { $push: { friends: fromUserId } }, {}, (err) => {
        if (err) return res.status(500).json({ message: 'Error accepting friend request' });
        usersDb.update({ _id: fromUserId }, { $push: { friends: req.user._id } }, {}, (err) => {
          if (err) return res.status(500).json({ message: 'Error accepting friend request' });
          // Remove the friend request from both users' request lists
          usersDb.update({ _id: req.user._id }, { $pull: { 'friendRequests.incoming': { _id: requestId } } }, {}, (err) => {
            if (err) return res.status(500).json({ message: 'Error accepting friend request' });
            usersDb.update({ _id: fromUserId }, { $pull: { 'friendRequests.outgoing': { toUserId: req.user._id } } }, {}, (err) => {
              if (err) return res.status(500).json({ message: 'Error accepting friend request' });
              res.json({ message: 'Friend request accepted successfully' });
            });
          });
        });
      });
    });
  });
});

// Reject friend request
app.post('/api/friends/reject', authenticateToken, (req, res) => {
  const { requestId } = req.body;
  if (!requestId) return res.status(400).json({ message: 'Request ID is required' });

  // Remove the friend request from incoming list
  usersDb.findOne({ _id: req.user._id }, (err, user) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!user) {
      return res.json({ message: 'Friend request rejected successfully' });
    }

    const requestObj = user.friendRequests.incoming.find(req => req._id.equals(requestId));
    if (!requestObj) {
      // Request already removed or not found
      return res.json({ message: 'Friend request rejected successfully' });
    }

    const senderId = requestObj.fromUserId;
    // Remove the outgoing request from the sender
    usersDb.update({ _id: senderId }, { $pull: { 'friendRequests.outgoing': { toUserId: req.user._id } } }, {}, (err) => {
      if (err) return res.status(500).json({ message: 'Error rejecting friend request' });
      // Remove the incoming request from current user
      usersDb.update({ _id: req.user._id }, { $pull: { 'friendRequests.incoming': { _id: requestId } } }, {}, (err) => {
        if (err) return res.status(500).json({ message: 'Error rejecting friend request' });
        res.json({ message: 'Friend request rejected successfully' });
      });
    });
  });
});

// Block user
app.post('/api/users/block', authenticateToken, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'User ID is required' });

  // Check if trying to block oneself
  if (userId.equals(req.user._id)) {
    return res.status(400).json({ message: 'Cannot block yourself' });
  }

  // Check if target user exists
  usersDb.findOne({ _id: userId }, (err, targetUser) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    // Add to blocked list
    usersDb.update({ _id: req.user._id }, { $addToSet: { blocked: userId } }, {}, (err) => {
      if (err) return res.status(500).json({ message: 'Error blocking user' });

      // If they were friends, remove from friends list
      usersDb.update({ _id: req.user._id }, { $pull: { friends: userId } }, {}, (err) => {
        if (err) return res.status(500).json({ message: 'Error blocking user' });

        // If they were friends, remove from friend's friends list too
        usersDb.update({ _id: userId }, { $pull: { friends: req.user._id } }, {}, (err) => {
          if (err) return res.status(500).json({ message: 'Error blocking user' });

          // Cancel any pending friend requests
          usersDb.update({ _id: req.user._id }, { $pull: { 'friendRequests.incoming': { fromUserId: userId } } }, {}, (err) => {
            if (err) return res.status(500).json({ message: 'Error blocking user' });
            usersDb.update({ _id: req.user._id }, { $pull: { 'friendRequests.outgoing': { toUserId: userId } } }, {}, (err) => {
              if (err) return res.status(500).json({ message: 'Error blocking user' });

              // Also cancel requests from the other direction
              usersDb.update({ _id: userId }, { $pull: { 'friendRequests.incoming': { fromUserId: req.user._id } } }, {}, (err) => {
                if (err) return res.status(500).json({ message: 'Error blocking user' });
                usersDb.update({ _id: userId }, { $pull: { 'friendRequests.outgoing': { toUserId: req.user._id } } }, {}, (err) => {
                  if (err) return res.status(500).json({ message: 'Error blocking user' });
                  res.json({ message: 'User blocked successfully' });
                });
              });
            });
          });
        });
      });
    });
  });
});

// Unblock user
app.post('/api/users/unblock', authenticateToken, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'User ID is required' });

  // Remove from blocked list
  usersDb.update({ _id: req.user._id }, { $pull: { blocked: userId } }, {}, (err) => {
    if (err) return res.status(500).json({ message: 'Error unblocking user' });
    res.json({ message: 'User unblocked successfully' });
  });
});

// Get blocked users list
app.get('/api/users/blocked', authenticateToken, (req, res) => {
  const blockedIds = req.user.blocked || [];
  if (blockedIds.length === 0) {
    return res.json({ blockedUsers: [] });
  }

  // Get the actual user objects for blocked users (without sensitive info)
  usersDb.find({ _id: { $in: blockedIds } }, (err, blockedUsers) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    // Remove passwords and sensitive info
    const blockedUsersSafe = blockedUsers.map(({ password, email, blocked, friendRequests, ...user }) => user);
    res.json({ blockedUsers: blockedUsersSafe });
  });
});

// Remove friend
app.post('/api/friends/remove', authenticateToken, (req, res) => {
  const { userId } = req.body; // userId of the friend to remove
  if (!userId) return res.status(400).json({ message: 'User ID is required' });

  // Remove from current user's friends list
  usersDb.update({ _id: req.user._id }, { $pull: { friends: userId } }, {}, (err) => {
    if (err) return res.status(500).json({ message: 'Error removing friend' });
    // Also remove from the friend's friends list
    usersDb.update({ _id: userId }, { $pull: { friends: req.user._id } }, {}, (err) => {
      if (err) return res.status(500).json({ message: 'Error removing friend' });
      res.json({ message: 'Friend removed successfully' });
    });
  });
});

// Get friends list
app.get('/api/friends', authenticateToken, (req, res) => {
  // We have the list of friend IDs in req.user.friends, but we need to get the user objects for each friend
  const friendIds = req.user.friends;
  if (friendIds.length === 0) {
    return res.json({ friends: [] });
  }
  // Use $in to find all friends
  usersDb.find({ _id: { $in: friendIds } }, (err, friends) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    // Remove passwords from friend objects
    const friendsSafe = friends.map(({ password, ...friend }) => friend);
    res.json({ friends: friendsSafe });
  });
});

// Get incoming friend requests
app.get('/api/friend-requests/incoming', authenticateToken, (req, res) => {
  // We need to populate the incoming requests with the sender's user info (without password)
  const incomingRequests = req.user.friendRequests.incoming;
  if (incomingRequests.length === 0) {
    return res.json({ friendRequests: [] });
  }
  // Extract sender IDs
  const senderIds = incomingRequests.map(req => req.fromUserId);
  usersDb.find({ _id: { $in: senderIds } }, (err, senders) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    // Create a map of senderId -> sender user info (without password)
    const senderMap = {};
    senders.forEach(sender => {
      const { password, ...senderSafe } = sender;
      senderMap[sender._id.toString()] = senderSafe;
    });
    // Build the friend requests list with sender info
    const friendRequests = incomingRequests.map(req => ({
      ...req,
      sender: senderMap[req.fromUserId.toString()] || null
    }));
    res.json({ friendRequests });
  });
});

// Get outgoing friend requests
app.get('/api/friend-requests/outgoing', authenticateToken, (req, res) => {
  // We need to populate the outgoing requests with the receiver's user info (without password)
  const outgoingRequests = req.user.friendRequests.outgoing;
  if (outgoingRequests.length === 0) {
    return res.json({ friendRequests: [] });
  }
  // Extract receiver IDs
  const receiverIds = outgoingRequests.map(req => req.toUserId);
  usersDb.find({ _id: { $in: receiverIds } }, (err, receivers) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    // Create a map of receiverId -> receiver user info (without password)
    const receiverMap = {};
    receivers.forEach(receiver => {
      const { password, ...receiverSafe } = receiver;
      receiverMap[receiver._id.toString()] = receiverSafe;
    });
    // Build the friend requests list with receiver info
    const friendRequests = outgoingRequests.map(req => ({
      ...req,
      receiver: receiverMap[req.toUserId.toString()] || null
    }));
    res.json({ friendRequests });
  });
});

// Conversations routes
// Get or create conversation between two users
app.get('/api/conversations/:userId', authenticateToken, (req, res) => {
  const { userId } = req.params;

  // Validate that the requested userId matches the authenticated user (for security)
  // In a more complex app, you might allow accessing other users' conversations with proper permissions
  if (!userId.equals(req.user._id)) {
    // For now, we'll allow users to only access their own conversations
    // In a full implementation, you'd check if they're participants in the conversation
    return res.status(403).json({ message: 'Access denied' });
  }

  // Find all conversations where the user is a participant
  conversationsDb.find({ participantIds: { $in: [req.user._id] } }, (err, conversations) => {
    if (err) return res.status(500).json({ message: 'Database error' });

    // Populate conversation with participant info (without passwords)
    const conversationsWithParticipants = conversations.map(conversation => {
      const participantIds = conversation.participantIds;
      return {
        ...conversation,
        participantIds // We'll keep IDs for now, could populate with user info if needed
      };
    });

    res.json({ conversations: conversationsWithParticipants });
  });
});

// Get conversation by ID (with access control)
app.get('/api/conversation/:conversationId', authenticateToken, (req, res) => {
  const { conversationId } = req.params;

  conversationsDb.findOne({ _id: conversationId }, (err, conversation) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    // Check if the authenticated user is a participant in this conversation
    if (!conversation.participantIds.includes(req.user._id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get messages for this conversation
    messagesDb.find({ conversationId }, (err, messages) => {
      if (err) return res.status(500).json({ message: 'Database error' });

      // Sort messages by creation time
      const sortedMessages = messages.sort((a, b) => a.createdAt - b.createdAt);

      res.json({
        conversation: {
          ...conversation,
          participantIds: conversation.participantIds // Keep IDs for now
        },
        messages: sortedMessages
      });
    });
  });
});

// Start conversation with a friend
app.post('/api/conversations/start', authenticateToken, (req, res) => {
  const { friendId } = req.body;
  if (!friendId) return res.status(400).json({ message: 'Friend ID is required' });

  // Check if the friend exists
  usersDb.findOne({ _id: friendId }, (err, friend) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!friend) return res.status(404).json({ message: 'Friend not found' });

    // Check if they are actually friends
    const isFriend = req.user.friends.some(friendIds => friendIds.equals(friendId));
    if (!isFriend) {
      return res.status(403).json({ message: 'Can only start conversations with friends' });
    }

    // Check if conversation already exists between these two users
    conversationsDb.findOne({
      participantIds: { $all: [req.user._id, friendId] }
    }, (err, existingConversation) => {
      if (err) return res.status(500).json({ message: 'Database error' });

      if (existingConversation) {
        // Conversation already exists, return it
        return res.json({ conversation: existingConversation });
      }

      // Create new conversation
      const newConversation = {
        participantIds: [req.user._id, friendId],
        createdAt: new Date(),
        updatedAt: new Date(),
        lastMessage: '',
        lastMessageAt: null,
        isGroup: false,
        groupName: null,
        groupAvatar: null
      };

      conversationsDb.insert(newConversation, (err, conversation) => {
        if (err) return res.status(500).json({ message: 'Error creating conversation' });
        res.json({ conversation });
      });
    });
  });
});

// Messages routes
// Send a message
app.post('/api/messages/send', authenticateToken, (req, res) => {
  const { conversationId, text, replyToId } = req.body;

  if (!conversationId || !text) {
    return res.status(400).json({ message: 'Conversation ID and text are required' });
  }

  // Verify that the conversation exists and user is a participant
  conversationsDb.findOne({ _id: conversationId }, (err, conversation) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    // Check if user is a participant
    if (!conversation.participantIds.includes(req.user._id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Create new message
    const newMessage = {
      conversationId,
      senderId: req.user._id,
      text,
      replyToId: replyToId || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      readBy: [req.user._id], // Sender has read their own message
      reactions: {}, // Empty reactions object
      edited: false,
      deleted: false,
      attachments: [] // Empty attachments array (for future implementation)
    };

    messagesDb.insert(newMessage, (err, message) => {
      if (err) return res.status(500).json({ message: 'Error sending message' });

      // Update conversation's last message and timestamp
      conversationsDb.update(
        { _id: conversationId },
        {
          $set: {
            lastMessage: text,
            lastMessageAt: new Date(),
            updatedAt: new Date()
          }
        },
        {}, (err) => {
          if (err) console.error('Error updating conversation:', err);
        }
      );

      res.json({ message });
    });
  });
});

// Edit a message
app.put('/api/messages/:messageId/edit', authenticateToken, (req, res) => {
  const { messageId } = req.params;
  const { text } = req.body;

  if (!text) return res.status(400).json({ message: 'Text is required' });

  // Find the message
  messagesDb.findOne({ _id: messageId }, (err, message) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!message) return res.status(404).json({ message: 'Message not found' });

    // Check if the authenticated user is the sender
    if (!message.senderId.equals(req.user._id)) {
      return res.status(403).json({ message: 'Can only edit your own messages' });
    }

    // Check if message is already deleted
    if (message.deleted) {
      return res.status(400).json({ message: 'Cannot edit a deleted message' });
    }

    // Update the message
    messagesDb.update(
      { _id: messageId },
      {
        $set: {
          text,
          edited: true,
          updatedAt: new Date()
        }
      },
      {}, (err, numReplaced) => {
        if (err) return res.status(500).json({ message: 'Error editing message' });
        if (numReplaced === 0) return res.status(404).json({ message: 'Message not found' });

        // Get updated message
        messagesDb.findOne({ _id: messageId }, (err, updatedMessage) => {
          if (err) return res.status(500).json({ message: 'Database error' });

          // Notify conversation participants about the edit
          // In a real implementation with Socket.IO, we would emit this
          // For now, we'll just return the updated message
          res.json({ message: updatedMessage });
        });
      }
    );
  });
});

// Delete a message
app.delete('/api/messages/:messageId/delete', authenticateToken, (req, res) => {
  const { messageId } = req.params;

  // Find the message
  messagesDb.findOne({ _id: messageId }, (err, message) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!message) return res.status(404).json({ message: 'Message not found' });

    // Check if the authenticated user is the sender
    if (!message.senderId.equals(req.user._id)) {
      return res.status(403).json({ message: 'Can only delete your own messages' });
    }

    // Soft delete the message
    messagesDb.update(
      { _id: messageId },
      { $set: { deleted: true, updatedAt: new Date() } },
      {}, (err, numReplaced) => {
        if (err) return res.status(500).json({ message: 'Error deleting message' });
        if (numReplaced === 0) return res.status(404).json({ message: 'Message not found' });

        res.json({ message: 'Message deleted successfully' });
      }
    );
  });
});

// Add reaction to a message
app.post('/api/messages/:messageId/react', authenticateToken, (req, res) => {
  const { messageId } = req.params;
  const { reaction } = req.body; // e.g., "👍", "❤️", etc.

  if (!reaction) return res.status(400).json({ message: 'Reaction is required' });

  // Find the message
  messagesDb.findOne({ _id: messageId }, (err, message) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!message) return res.status(404).json({ message: 'Message not found' });

    // Check if the authenticated user is a participant in the conversation
    conversationsDb.findOne({ _id: message.conversationId }, (err, conversation) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      if (!conversation) return res.status(500).json({ message: 'Conversation not found' });

      if (!conversation.participantIds.includes(req.user._id)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Update reactions
      const reactions = { ...message.reactions };
      if (!reactions[reaction]) {
        reactions[reaction] = [];
      }

      // Add user to reaction if not already there, remove if they are (toggle)
      const userIndex = reactions[reaction].indexOf(req.user._id.toString());
      if (userIndex >= 0) {
        reactions[reaction].splice(userIndex, 1); // Remove reaction
        // Remove reaction type if no users left
        if (reactions[reaction].length === 0) {
          delete reactions[reaction];
        }
      } else {
        reactions[reaction].push(req.user._id.toString()); // Add reaction
      }

      // Update message
      messagesDb.update(
        { _id: messageId },
        { $set: { reactions, updatedAt: new Date() } },
        {}, (err, numReplaced) => {
          if (err) return res.status(500).json({ message: 'Error adding reaction' });
          if (numReplaced === 0) return res.status(404).json({ message: 'Message not found' });

          res.json({ message: 'Reaction updated successfully' });
        }
      );
    });
  });
});

// Pin/unpin a message
app.post('/api/messages/:messageId/pin', authenticateToken, (req, res) => {
  const { messageId } = req.params;
  const { pinned } = req.body; // boolean

  if (pinned === undefined) return res.status(400).json({ message: 'Pinned status is required' });

  // Find the message
  messagesDb.findOne({ _id: messageId }, (err, message) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!message) return res.status(404).json({ message: 'Message not found' });

    // Check if the authenticated user is a participant in the conversation
    conversationsDb.findOne({ _id: message.conversationId }, (err, conversation) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      if (!conversation) return res.status(500).json({ message: 'Conversation not found' });

      if (!conversation.participantIds.includes(req.user._id)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      // Update pin status
      messagesDb.update(
        { _id: messageId },
        { $set: { pinned: Boolean(pinned), updatedAt: new Date() } },
        {}, (err, numReplaced) => {
          if (err) return res.status(500).json({ message: 'Error updating pin status' });
          if (numReplaced === 0) return res.status(404).json({ message: 'Message not found' });

          res.json({ message: `Message ${pinned ? 'pinned' : 'unpinned'} successfully` });
        }
      );
    });
  });
});

// Search messages in a conversation
app.get('/api/conversations/:conversationId/messages/search', authenticateToken, (req, res) => {
  const { conversationId } = req.params;
  const { query } = req.query;

  if (!query) return res.status(400).json({ message: 'Query parameter is required' });

  // Verify conversation exists and user is participant
  conversationsDb.findOne({ _id: conversationId }, (err, conversation) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    if (!conversation.participantIds.includes(req.user._id)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Search messages by text content
    const searchRegex = new RegExp(query, 'i');
    messagesDb.find({
      conversationId,
      text: searchRegex,
      deleted: false
    }, (err, messages) => {
      if (err) return res.status(500).json({ message: 'Database error' });

      // Sort by creation time (newest first)
      const sortedMessages = messages.sort((a, b) => b.createdAt - a.createdAt);

      res.json({ messages: sortedMessages });
    });
  });
});

// Start server
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;