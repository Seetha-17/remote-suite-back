import express from 'express'
import { supabase } from '../services/supabaseClient.js'
import { authenticateToken } from '../middleware/auth.js'

const router = express.Router()

// Get active voice sessions
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from('active_voice_sessions')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    res.json({ sessions })
  } catch (error) {
    console.error('Error fetching voice sessions:', error)
    res.status(500).json({ error: 'Failed to fetch voice sessions' })
  }
})

// Create a new voice session
router.post('/sessions', authenticateToken, async (req, res) => {
  try {
    const { session_name, session_type = 'team', max_participants = 50 } = req.body

    if (!session_name) {
      return res.status(400).json({ error: 'Session name is required' })
    }

    const { data: session, error } = await supabase
      .from('voice_sessions')
      .insert({
        session_name,
        session_type,
        max_participants,
        created_by: req.user.id
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ session })
  } catch (error) {
    console.error('Error creating voice session:', error)
    res.status(500).json({ error: 'Failed to create voice session' })
  }
})

// Join a voice session
router.post('/sessions/:sessionId/join', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params
    const { user_name, user_email } = req.body

    // Check if session exists and is active
    const { data: session, error: sessionError } = await supabase
      .from('voice_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('is_active', true)
      .single()

    if (sessionError || !session) {
      return res.status(404).json({ error: 'Voice session not found or inactive' })
    }

    // Check current participant count
    const { count: participantCount, error: countError } = await supabase
      .from('voice_participants')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .is('left_at', null)

    if (countError) throw countError

    if (participantCount >= session.max_participants) {
      return res.status(400).json({ error: 'Voice session is full' })
    }

    // Add participant (upsert to handle rejoining)
    const { data: participant, error: participantError } = await supabase
      .from('voice_participants')
      .upsert({
        session_id: sessionId,
        user_id: req.user.id,
        user_name: user_name || req.user.user_metadata?.full_name || req.user.email.split('@')[0],
        user_email: user_email || req.user.email,
        is_muted: false,
        is_speaking: false,
        joined_at: new Date().toISOString(),
        left_at: null
      }, {
        onConflict: 'session_id,user_id'
      })
      .select()
      .single()

    if (participantError) throw participantError

    res.json({ participant, session })
  } catch (error) {
    console.error('Error joining voice session:', error)
    res.status(500).json({ error: 'Failed to join voice session' })
  }
})

// Leave a voice session
router.post('/sessions/:sessionId/leave', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params

    const { error } = await supabase
      .from('voice_participants')
      .update({ left_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .eq('user_id', req.user.id)
      .is('left_at', null)

    if (error) throw error

    res.json({ message: 'Left voice session successfully' })
  } catch (error) {
    console.error('Error leaving voice session:', error)
    res.status(500).json({ error: 'Failed to leave voice session' })
  }
})

// Update participant status (mute/unmute, speaking)
router.patch('/sessions/:sessionId/participants/:userId', authenticateToken, async (req, res) => {
  try {
    const { sessionId, userId } = req.params
    const { is_muted, is_speaking } = req.body

    // Only allow users to update their own status or if they're the session creator
    const { data: session } = await supabase
      .from('voice_sessions')
      .select('created_by')
      .eq('id', sessionId)
      .single()

    if (userId !== req.user.id && session?.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to update this participant' })
    }

    const updateData = {}
    if (typeof is_muted === 'boolean') updateData.is_muted = is_muted
    if (typeof is_speaking === 'boolean') updateData.is_speaking = is_speaking

    const { data: participant, error } = await supabase
      .from('voice_participants')
      .update(updateData)
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .is('left_at', null)
      .select()
      .single()

    if (error) throw error

    res.json({ participant })
  } catch (error) {
    console.error('Error updating participant status:', error)
    res.status(500).json({ error: 'Failed to update participant status' })
  }
})

// Get participants in a voice session
router.get('/sessions/:sessionId/participants', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params

    const { data: participants, error } = await supabase
      .from('voice_participants')
      .select('*')
      .eq('session_id', sessionId)
      .is('left_at', null)
      .order('joined_at', { ascending: true })

    if (error) throw error

    res.json({ participants })
  } catch (error) {
    console.error('Error fetching participants:', error)
    res.status(500).json({ error: 'Failed to fetch participants' })
  }
})

// Store WebRTC signaling data
router.post('/signaling', authenticateToken, async (req, res) => {
  try {
    const { session_id, to_user_id, signal_type, signal_data } = req.body

    if (!session_id || !to_user_id || !signal_type || !signal_data) {
      return res.status(400).json({ error: 'Missing required signaling data' })
    }

    const { data: signaling, error } = await supabase
      .from('voice_signaling')
      .insert({
        session_id,
        from_user_id: req.user.id,
        to_user_id,
        signal_type,
        signal_data
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ signaling })
  } catch (error) {
    console.error('Error storing signaling data:', error)
    res.status(500).json({ error: 'Failed to store signaling data' })
  }
})

// Get pending signaling data for user
router.get('/signaling/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params

    if (userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to access signaling data' })
    }

    const { data: signaling, error } = await supabase
      .from('voice_signaling')
      .select('*')
      .eq('to_user_id', userId)
      .eq('processed', false)
      .order('created_at', { ascending: true })

    if (error) throw error

    // Mark as processed
    if (signaling.length > 0) {
      const signalingIds = signaling.map(s => s.id)
      await supabase
        .from('voice_signaling')
        .update({ processed: true })
        .in('id', signalingIds)
    }

    res.json({ signaling })
  } catch (error) {
    console.error('Error fetching signaling data:', error)
    res.status(500).json({ error: 'Failed to fetch signaling data' })
  }
})

// Clean up old signaling data (called periodically)
router.delete('/signaling/cleanup', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .rpc('cleanup_old_signaling_data')

    if (error) throw error

    res.json({ message: 'Signaling data cleaned up successfully' })
  } catch (error) {
    console.error('Error cleaning up signaling data:', error)
    res.status(500).json({ error: 'Failed to clean up signaling data' })
  }
})

// Delete a voice session (only by creator)
router.delete('/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params

    // Check if user is the session creator
    const { data: session, error: sessionError } = await supabase
      .from('voice_sessions')
      .select('created_by')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      return res.status(404).json({ error: 'Voice session not found' })
    }

    if (session.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this session' })
    }

    // Mark session as inactive instead of deleting
    const { error } = await supabase
      .from('voice_sessions')
      .update({ is_active: false })
      .eq('id', sessionId)

    if (error) throw error

    res.json({ message: 'Voice session deleted successfully' })
  } catch (error) {
    console.error('Error deleting voice session:', error)
    res.status(500).json({ error: 'Failed to delete voice session' })
  }
})

export default router
