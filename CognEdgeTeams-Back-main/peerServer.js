import { PeerServer } from 'peer'
import 'dotenv/config'

/**
 * PeerJS Signaling Server for Video Conferencing
 * Handles WebRTC P2P connections for video/audio streaming
 */

const PORT = process.env.PEER_PORT || 9000

const peerServer = PeerServer({
  port: PORT,
  path: '/peerjs',
  
  // CORS configuration
  allow_discovery: true,
  
  // Connection limits
  alive_timeout: 60000, // 60 seconds
  
  // Enable detailed logging
  debug: true,
  
  // Custom configuration
  generateClientId: () => {
    // Generate unique client IDs
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
})

peerServer.on('connection', (client) => {
  console.log(`✅ Peer connected: ${client.getId()}`)
})

peerServer.on('disconnect', (client) => {
  console.log(`❌ Peer disconnected: ${client.getId()}`)
})

peerServer.on('error', (error) => {
  console.error('❗ PeerJS Server Error:', error)
})

console.log(`🎥 PeerJS Server running on port ${PORT}`)
console.log(`📡 Signaling path: http://localhost:${PORT}/peerjs`)

export default peerServer
