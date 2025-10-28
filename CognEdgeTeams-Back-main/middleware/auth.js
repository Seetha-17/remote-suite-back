import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'

// Create Supabase client only if env vars exist
const hasSupabaseEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
const supabase = hasSupabaseEnv
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null

export const authenticateToken = async (req, res, next) => {
  // Optional dev bypass: allow anonymous access when explicitly enabled
  if (!supabase) {
    if (process.env.ALLOW_ANON === 'true') {
      req.user = {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'anon@example.com',
        user_metadata: { full_name: 'Anonymous Dev' },
        created_at: new Date().toISOString()
      }
      return next()
    }
    return res.status(500).json({
      error: 'Server auth is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or enable ALLOW_ANON=true for local dev.'
    })
  }

  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  try {
    // Verify the Supabase JWT token
    const { data: { user }, error } = await supabase.auth.getUser(token)
    
    if (error || !user) {
      return res.status(403).json({ error: 'Invalid or expired token' })
    }

    req.user = user
    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    return res.status(403).json({ error: 'Invalid token' })
  }
}

export const authenticateSocket = async (socket, next) => {
  // Optional dev bypass for sockets
  if (!supabase) {
    if (process.env.ALLOW_ANON === 'true') {
      socket.user = {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'anon@example.com',
        user_metadata: { full_name: 'Anonymous Dev' },
        created_at: new Date().toISOString()
      }
      return next()
    }
    return next(new Error('Server auth not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or enable ALLOW_ANON=true'))
  }

  try {
    const token = socket.handshake.auth.token
    
    if (!token) {
      return next(new Error('Authentication error'))
    }

    const { data: { user }, error } = await supabase.auth.getUser(token)
    
    if (error || !user) {
      return next(new Error('Authentication error'))
    }

    socket.user = user
    next()
  } catch (error) {
    next(new Error('Authentication error'))
  }
}
