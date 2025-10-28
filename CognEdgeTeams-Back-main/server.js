import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createServer } from 'http'
import { Server } from 'socket.io'
// Redis import removed - using only Supabase

// Import routes
import tasksRouter from './routes/tasks.js'
import documentsRouter from './routes/documents.js'
import teamsRouter from './routes/teams.js'
import usersRouter from './routes/users.js'
import voiceRouter from './routes/voice.js'
import meetingsRouter from './routes/meetings.js'

// Import database and middleware
import { initDatabase } from './db/database.js'
import { authenticateToken, authenticateSocket } from './middleware/auth.js'

const app = express()

// Security middleware
app.use(helmet())
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'https://cogn-edge-teams-front.vercel.app',
    'http://127.0.0.1:52292',
    'http://localhost:52292',
    /^http:\/\/127\.0\.0\.1:\d+$/,
    /^http:\/\/localhost:\d+$/
  ],
  credentials: true
}))

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
})
app.use(limiter)

// Stricter rate limiting for debug endpoints
const debugLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5 // limit each IP to 5 requests per minute for debug endpoints
})
app.use('/api/users/debug-users', debugLimiter)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Initialize database
await initDatabase()

// Redis removed - using Supabase for all data storage
let redis = null
console.log('ℹ️  Using Supabase for all data storage')

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    database: 'supabase',
    redis: 'disabled'
  })
})

// API Routes
app.use('/api/tasks', tasksRouter)
app.use('/api/documents', documentsRouter)
app.use('/api/teams', teamsRouter)
app.use('/api/users', usersRouter)
app.use('/api/voice', voiceRouter)
app.use('/api/meetings', meetingsRouter)

// User profile endpoint
app.get('/api/profile', authenticateToken, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    user_metadata: req.user.user_metadata,
    created_at: req.user.created_at
  })
})

// HTTP server + Socket.io
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5173',
      'https://cogn-edge-teams-front.vercel.app',
      'http://127.0.0.1:52292',
      'http://localhost:52292',
      /^http:\/\/127\.0\.0\.1:\d+$/,
      /^http:\/\/localhost:\d+$/
    ],
    credentials: true
  }
})

// Socket.io authentication middleware
io.use(authenticateSocket)

// Store online users in memory
const onlineUsers = new Map()

// Main namespace for general real-time features
io.on('connection', (socket) => {
  console.log(`User ${socket.user.email} connected`)

  // Add user to online users list
  onlineUsers.set(socket.user.id, {
    id: socket.user.id,
    email: socket.user.email,
    socketId: socket.id,
    connectedAt: new Date()
  })

  // Broadcast user online status to all connected clients
  socket.broadcast.emit('user-online', {
    userId: socket.user.id,
    userEmail: socket.user.email
  })

  // Send current online users list to the newly connected user (including themselves)
  socket.emit('online-users-list', {
    users: Array.from(onlineUsers.values()).map(u => ({
      id: u.id,
      email: u.email
    }))
  })
  
  console.log(`Online users count: ${onlineUsers.size}`)
  console.log('Online users:', Array.from(onlineUsers.values()).map(u => u.email))

  // User presence (legacy Redis support)
  socket.on('join-presence', async (data) => {
    if (redis) {
      await redis.setex(`presence:${socket.user.id}`, 300, JSON.stringify({
        user_id: socket.user.id,
        email: socket.user.email,
        status: 'online',
        last_seen: new Date().toISOString()
      }))
    }
  })

  socket.on('disconnect', async () => {
    console.log(`User ${socket.user.email} disconnected`)
    
    // Remove user from online users list
    onlineUsers.delete(socket.user.id)
    
    // Broadcast user offline status to all connected clients
    socket.broadcast.emit('user-offline', {
      userId: socket.user.id,
      userEmail: socket.user.email
    })
    
    if (redis) {
      await redis.del(`presence:${socket.user.id}`)
    }
  })
})


// WebRTC signaling namespace
const signaling = io.of('/signaling')
signaling.use(authenticateSocket)

signaling.on('connection', (socket) => {
  socket.on('join-room', (roomId) => {
    socket.join(roomId)
    socket.to(roomId).emit('user-joined', {
      user_id: socket.user.id,
      user_name: socket.user.user_metadata?.full_name || socket.user.email
    })
  })

  socket.on('leave-room', (roomId) => {
    socket.leave(roomId)
    socket.to(roomId).emit('user-left', {
      user_id: socket.user.id
    })
  })

  socket.on('offer', (data) => {
    socket.to(data.roomId).emit('offer', {
      offer: data.offer,
      from: socket.user.id
    })
  })

  socket.on('answer', (data) => {
    socket.to(data.roomId).emit('answer', {
      answer: data.answer,
      from: socket.user.id
    })
  })

  socket.on('disconnect', () => {
    console.log(`WebRTC signaling: User ${socket.user.email} disconnected`)
  })
})

// Tasks real-time updates namespace
const tasks = io.of('/tasks')
tasks.use(authenticateSocket)

tasks.on('connection', (socket) => {
  socket.on('task-updated', (data) => {
    socket.broadcast.emit('task-updated', data)
  })

  socket.on('task-created', (data) => {
    socket.broadcast.emit('task-created', data)
  })

  socket.on('task-deleted', (data) => {
    socket.broadcast.emit('task-deleted', data)
  })
})

// Documents collaboration namespace (for Yjs integration)
const docs = io.of('/docs')
docs.use(authenticateSocket)

docs.on('connection', (socket) => {
  socket.on('join-document', (docId) => {
    socket.join(`doc:${docId}`)
    console.log(`User ${socket.user.email} joined document: ${docId}`)
  })

  socket.on('leave-document', (docId) => {
    socket.leave(`doc:${docId}`)
    console.log(`User ${socket.user.email} left document: ${docId}`)
  })

  socket.on('document-update', (data) => {
    socket.to(`doc:${data.docId}`).emit('document-update', data)
  })

  socket.on('cursor-update', (data) => {
    socket.to(`doc:${data.docId}`).emit('cursor-update', {
      user_id: socket.user.id,
      user_name: socket.user.user_metadata?.full_name || socket.user.email,
      ...data
    })
  })
})

// Video Conference namespace for WebRTC signaling
const videoConference = io.of('/video-conference')
videoConference.use(authenticateSocket) // ✅ ENABLED for real user authentication

// Store meeting participants with their peer IDs (persistent across connections)
const meetingParticipants = new Map()

videoConference.on('connection', (socket) => {
  // Real user from authentication
  console.log('========================================')
  console.log('📹 NEW VIDEO CONFERENCE CONNECTION')
  console.log('User ID:', socket.user.id)
  console.log('User Email:', socket.user.email)
  console.log('User Name:', socket.user.user_metadata?.full_name)
  console.log('========================================')
  
  if (!socket.user.email || socket.user.email === 'anon@example.com' || socket.user.email === 'dev@example.com') {
    console.warn('⚠️ WARNING: Dev/Anon user detected! Real authentication may not be working.')
  }

  socket.on('join-meeting', async (data) => {
    const { meetingId } = data
    socket.join(`meeting:${meetingId}`)
    
    // Store participant info
    if (!meetingParticipants.has(meetingId)) {
      meetingParticipants.set(meetingId, new Map())
    }
    
    const participants = meetingParticipants.get(meetingId)
    participants.set(socket.id, {
      id: socket.id,
      user_id: socket.user.id,
      user_name: socket.user.user_metadata?.full_name || socket.user.email.split('@')[0],
      user_email: socket.user.email,
      peer_id: null  // Will be set when peer connects
    })
    
    // Send existing participants to the new user
    const existingParticipants = Array.from(participants.values()).filter(p => p.id !== socket.id)
    socket.emit('existing-participants', existingParticipants)
    
    // Broadcast to other participants in the meeting
    socket.to(`meeting:${meetingId}`).emit('participant-joined', {
      id: socket.id,
      user_id: socket.user.id,
      user_name: socket.user.user_metadata?.full_name || socket.user.email.split('@')[0],
      user_email: socket.user.email,
      peer_id: null
    })
    
    console.log(`User ${socket.user.email} joined meeting: ${meetingId}`)
    console.log(`Meeting ${meetingId} now has ${participants.size} participants`)
  })
  
  socket.on('peer-connected', (data) => {
    const { meetingId, participantId, peerId } = data
    console.log(`Peer connected: ${peerId} for participant ${participantId} in meeting ${meetingId}`)
    
    // Update participant with peer ID
    if (meetingParticipants.has(meetingId)) {
      const participants = meetingParticipants.get(meetingId)
      const participant = participants.get(socket.id)
      if (participant) {
        participant.peer_id = peerId
      }
    }
    
    // Broadcast peer ID to all other participants
    socket.to(`meeting:${meetingId}`).emit('peer-connected', {
      participantId: socket.id,
      peerId
    })
  })
  
  socket.on('get-participants', (data) => {
    const { meetingId } = data
    console.log(`📋 get-participants request for meeting: ${meetingId}`)
    
    if (meetingParticipants.has(meetingId)) {
      const participants = meetingParticipants.get(meetingId)
      const participantsList = Array.from(participants.values())
        .filter(p => p.id !== socket.id) // Don't send back the requester
      
      console.log(`📋 Sending ${participantsList.length} existing participants`)
      participantsList.forEach(p => {
        console.log(`   - ${p.user_name} (peer_id: ${p.peer_id})`)
      })
      
      socket.emit('existing-participants', participantsList)
    } else {
      console.log(`📋 No participants found for meeting: ${meetingId}`)
      socket.emit('existing-participants', [])
    }
  })

  socket.on('leave-meeting', (data) => {
    const { meetingId } = data
    socket.leave(`meeting:${meetingId}`)
    
    // Broadcast to other participants
    socket.to(`meeting:${meetingId}`).emit('participant-left', {
      id: socket.id,
      user_id: socket.user.id
    })
    
    console.log(`User ${socket.user.email} left meeting: ${meetingId}`)
  })

  // WebRTC signaling
  socket.on('webrtc-offer', (data) => {
    const { offer, to, toParticipantId, meetingId } = data
    socket.to(`meeting:${meetingId}`).emit('webrtc-offer', {
      offer,
      from: socket.user.user_metadata?.full_name || socket.user.email.split('@')[0],
      fromParticipantId: socket.id
    })
  })

  socket.on('webrtc-answer', (data) => {
    const { answer, to, toParticipantId, meetingId } = data
    socket.to(`meeting:${meetingId}`).emit('webrtc-answer', {
      answer,
      from: socket.user.user_metadata?.full_name || socket.user.email.split('@')[0],
      fromParticipantId: socket.id
    })
  })

  socket.on('webrtc-ice-candidate', (data) => {
    const { candidate, to, toParticipantId, meetingId } = data
    socket.to(`meeting:${meetingId}`).emit('webrtc-ice-candidate', {
      candidate,
      from: socket.user.user_metadata?.full_name || socket.user.email.split('@')[0],
      fromParticipantId: socket.id
    })
  })

  // Participant updates
  socket.on('participant-update', (data) => {
    const { participantId, meetingId, ...updates } = data
    socket.to(`meeting:${meetingId}`).emit('participant-updated', {
      id: participantId,
      ...updates
    })
  })

  // Speaking status
  socket.on('speaking-status', (data) => {
    const { participantId, isSpeaking, meetingId } = data
    socket.to(`meeting:${meetingId}`).emit('speaking-status', {
      participantId,
      isSpeaking
    })
  })

  // Chat messages
  socket.on('chat-message', (data) => {
    const { meetingId, ...message } = data
    socket.to(`meeting:${meetingId}`).emit('chat-message', message)
  })

  // Reactions
  socket.on('reaction', (data) => {
    const { meetingId, ...reaction } = data
    socket.to(`meeting:${meetingId}`).emit('reaction', {
      ...reaction,
      user_name: socket.user.user_metadata?.full_name || socket.user.email.split('@')[0]
    })
  })

  // Raise hand
  socket.on('raise-hand', (data) => {
    const { meetingId } = data
    socket.to(`meeting:${meetingId}`).emit('hand-raised', data)
  })

  // Participant update
  socket.on('participant-update', (data) => {
    const { meetingId } = data
    socket.to(`meeting:${meetingId}`).emit('participant-updated', data)
  })

  // Mute participant
  socket.on('mute-participant', (data) => {
    const { meetingId } = data
    socket.to(`meeting:${meetingId}`).emit('participant-muted', data)
  })

  // Remove participant
  socket.on('remove-participant', (data) => {
    const { meetingId } = data
    socket.to(`meeting:${meetingId}`).emit('participant-removed', data)
  })

  // Chat message
  socket.on('chat-message', (data) => {
    const { meetingId } = data
    socket.to(`meeting:${meetingId}`).emit('chat-message', data)
  })

  socket.on('disconnect', () => {
    console.log(`User ${socket.user.email} disconnected from video conference`)
    
    // Clean up participant from all meetings
    meetingParticipants.forEach((participants, meetingId) => {
      if (participants.has(socket.id)) {
        participants.delete(socket.id)
        
        // Notify others in the meeting
        socket.to(`meeting:${meetingId}`).emit('participant-left', {
          id: socket.id,
          user_id: socket.user.id
        })
        
        // Clean up empty meeting rooms
        if (participants.size === 0) {
          meetingParticipants.delete(meetingId)
        }
      }
    })
  })
})

// Chat namespace
const chat = io.of('/chat')
chat.use(authenticateSocket)

// Main namespace for general real-time features
io.on('connection', (socket) => {
  console.log(`User ${socket.user.email} connected`)

  // Add user to online users list
  onlineUsers.set(socket.user.id, {
    id: socket.user.id,
    email: socket.user.email,
    socketId: socket.id,
    connectedAt: new Date()
  })

  socket.on('send-message', (data) => {
    const { conversationId, message } = data
    // Broadcast to all users in the conversation except sender
    socket.to(`conversation:${conversationId}`).emit('new-message', message)
  })

  socket.on('typing', (data) => {
    const { conversationId } = data
    console.log(`User ${socket.user.email} started typing in conversation ${conversationId}`)
    socket.to(`conversation:${conversationId}`).emit('user-typing', {
      userId: socket.user.id,
      userEmail: socket.user.email
    })
  })

  socket.on('stop-typing', (data) => {
    const { conversationId } = data
    console.log(`User ${socket.user.email} stopped typing in conversation ${conversationId}`)
    socket.to(`conversation:${conversationId}`).emit('user-stop-typing', {
      userId: socket.user.id,
      userEmail: socket.user.email
    })
  })

  socket.on('messages-read', (data) => {
    const { conversationId, messageIds, readAt } = data
    console.log(`User ${socket.user.email} read messages in conversation ${conversationId}`)
    // Broadcast to other participants that messages have been read
    socket.to(`conversation:${conversationId}`).emit('messages-read', {
      conversationId,
      messageIds,
      readAt,
      readBy: socket.user.id
    })
  })

  socket.on('disconnect', () => {
    console.log(`User ${socket.user.email} disconnected from chat`)
  })
})

const PORT = process.env.PORT || 4000
httpServer.listen(PORT, () => {
  console.log(`🚀 CognEdge API Server running on port ${PORT}`)
  console.log(`📊 Health check: http://localhost:${PORT}/health`)
})
