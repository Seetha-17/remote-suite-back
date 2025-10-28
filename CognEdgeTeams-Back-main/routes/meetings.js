import express from 'express'
import jwt from 'jsonwebtoken'
import { supabase } from '../services/supabaseClient.js'

// Development bypass - Use real authentication if token exists
const devBypass = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  
  if (token && token !== 'null' && token !== 'undefined') {
    try {
      // Try to verify with Supabase first (since that's what we're using)
      const { data: { user }, error } = await supabase.auth.getUser(token)
      
      if (!error && user) {
        req.user = user
        console.log('✅ Authenticated user via Supabase:', user.email)
        return next()
      }
      
      console.log('⚠️ Supabase auth failed, trying JWT fallback:', error?.message)
      
      // Fallback to JWT verification
      if (process.env.JWT_SECRET) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        req.user = decoded
        console.log('✅ Authenticated user via JWT:', decoded.email)
        return next()
      }
    } catch (error) {
      console.log('⚠️ Token verification failed:', error.message)
    }
  }
  
  // Fallback to dev bypass for development
  console.log('🔧 Using dev bypass - no valid token found')
  req.user = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'dev@example.com',
    user_metadata: { full_name: 'Dev User' }
  }
  next()
}

const router = express.Router()

// Test endpoint to verify authentication
router.get('/test-auth', devBypass, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.user_metadata?.full_name
    }
  })
})

// Generate unique meeting ID
function generateMeetingId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Create a new meeting
router.post('/', devBypass, async (req, res) => {
  try {
    console.log('📝 CREATE MEETING REQUEST')
    console.log('User:', req.user?.email, req.user?.id)
    console.log('Body:', req.body)
    
    const {
      title,
      description,
      password,
      scheduled_start,
      scheduled_end,
      max_participants = 100,
      waiting_room_enabled = false,
      chat_enabled = true,
      screen_share_enabled = true,
      whiteboard_enabled = true,
      file_sharing_enabled = true
    } = req.body

    if (!title) {
      console.error('❌ No title provided')
      return res.status(400).json({ error: 'Meeting title is required' })
    }
    
    if (!req.user?.id) {
      console.error('❌ No user ID found')
      return res.status(401).json({ error: 'Authentication required' })
    }

    // Generate unique meeting ID
    let meetingId
    let isUnique = false
    let attempts = 0
    
    while (!isUnique && attempts < 10) {
      meetingId = generateMeetingId()
      const { data: existing } = await supabase
        .from('meetings')
        .select('id')
        .eq('meeting_id', meetingId)
        .single()
      
      if (!existing) {
        isUnique = true
      }
      attempts++
    }

    if (!isUnique) {
      return res.status(500).json({ error: 'Failed to generate unique meeting ID' })
    }

    // Prepare meeting data with proper null handling
    const meetingData = {
      meeting_id: meetingId,
      title,
      description: description || null,
      host_id: req.user.id,
      password: password || null,
      is_password_protected: !!password,
      max_participants,
      waiting_room_enabled,
      chat_enabled,
      screen_share_enabled,
      meeting_status: (scheduled_start && scheduled_start.trim()) ? 'scheduled' : 'active',
      meeting_type: (scheduled_start && scheduled_start.trim()) ? 'scheduled' : 'instant'
    }

    // Only add timestamp fields if they have valid values
    if (scheduled_start && scheduled_start.trim()) {
      meetingData.scheduled_start = scheduled_start
    }
    if (scheduled_end && scheduled_end.trim()) {
      meetingData.scheduled_end = scheduled_end
    }

    console.log('Creating meeting with data:', meetingData)
    
    const { data: meeting, error } = await supabase
      .from('meetings')
      .insert(meetingData)
      .select()
      .single()
    if (error) {
      console.error('Supabase error creating meeting:', error)
      throw error
    }

    console.log('✅ Meeting created successfully:', meeting.meeting_id)
    res.status(201).json({ meeting })
  } catch (error) {
    console.error('❌ ERROR CREATING MEETING:')
    console.error('Message:', error.message)
    console.error('Details:', error.details)
    console.error('Hint:', error.hint)
    console.error('Code:', error.code)
    console.error('Stack:', error.stack)
    
    res.status(500).json({ 
      error: 'Failed to create meeting',
      details: error.message,
      code: error.code,
      hint: error.hint
    })
  }
})

// Get meeting by ID
router.get('/:meetingId', devBypass, async (req, res) => {
  try {
    const { meetingId } = req.params

    const { data: meeting, error } = await supabase
      .from('meetings')
      .select(`
        *,
        meeting_participants (
          id,
          user_id,
          user_name,
          user_email,
          role,
          joined_at,
          left_at,
          is_muted,
          is_video_on,
          is_screen_sharing,
          is_hand_raised,
          connection_quality
        )
      `)
      .eq('meeting_id', meetingId)
      .single()

    if (error) throw error

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }

    // Check if user has access to this meeting
    const isHost = meeting.host_id === req.user.id
    const isParticipant = meeting.meeting_participants.some(p => p.user_id === req.user.id)
    
    if (!isHost && !isParticipant && meeting.password) {
      // Return limited info for password-protected meetings
      console.log('🔐 Returning password-protected meeting info for:', meetingId)
      return res.json({
        meeting: {
          id: meeting.id,
          meeting_id: meeting.meeting_id,
          title: meeting.title,
          description: meeting.description,
          requires_password: true,
          is_password_protected: true,  // Also include this for consistency
          waiting_room_enabled: meeting.waiting_room_enabled,
          max_participants: meeting.max_participants
        }
      })
    }

    // Add requires_password flag for all responses
    meeting.requires_password = !!meeting.password
    
    console.log('📋 Returning meeting info:', {
      meeting_id: meeting.meeting_id,
      has_password: !!meeting.password,
      is_password_protected: meeting.is_password_protected,
      requires_password: meeting.requires_password
    })
    
    res.json({ meeting })
  } catch (error) {
    console.error('Error fetching meeting:', error)
    res.status(500).json({ error: 'Failed to fetch meeting' })
  }
})

// Join meeting
router.post('/:meetingId/join', devBypass, async (req, res) => {
  try {
    const { meetingId } = req.params
    const { password, user_name } = req.body

    // Get meeting details
    const { data: meetings, error: meetingError } = await supabase
      .from('meetings')
      .select('*')
      .eq('meeting_id', meetingId)
    
    if (meetingError) {
      console.error('Error fetching meeting:', meetingError)
      return res.status(500).json({ error: 'Database error' })
    }
    
    if (!meetings || meetings.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' })
    }
    
    // Take the first meeting if multiple exist (shouldn't happen but handle gracefully)
    const meeting = meetings[0]

    // Check meeting status
    if (meeting.meeting_status === 'ended') {
      return res.status(400).json({ error: 'Meeting has ended' })
    }

    // Check password if required
    if (meeting.password && meeting.password !== password) {
      return res.status(401).json({ error: 'Incorrect meeting password' })
    }

    // Check participant limit
    const { count: participantCount } = await supabase
      .from('meeting_participants')
      .select('*', { count: 'exact', head: true })
      .eq('meeting_id', meeting.id)
      .is('left_at', null)

    if (participantCount >= meeting.max_participants) {
      return res.status(400).json({ error: 'Meeting is full' })
    }

    // Determine role
    let role = 'participant'
    if (meeting.host_id === req.user.id) {
      role = 'host'
    }

    // Clean up any existing participants first (more robust)
    const { error: deleteError } = await supabase
      .from('meeting_participants')
      .delete()
      .eq('meeting_id', meeting.id)
      .eq('user_id', req.user.id)
    
    // Log any delete errors but don't fail (record might not exist)
    if (deleteError) {
      console.log('Note: No existing participant to delete:', deleteError.message)
    }
    
    // Now insert the participant fresh
    const { data: newParticipants, error: insertError } = await supabase
      .from('meeting_participants')
      .insert({
        meeting_id: meeting.id,
        user_id: req.user.id,
        user_name: user_name || req.user.user_metadata?.full_name || req.user.email.split('@')[0],
        user_email: req.user.email,
        role,
        joined_at: new Date().toISOString(),
        left_at: null,
        is_muted: false,
        is_video_on: true,
        is_screen_sharing: false,
        is_hand_raised: false,
        connection_quality: 'good'
      })
      .select()
    
    if (insertError) throw insertError
    const participant = newParticipants?.[0]

    // participantError variable no longer exists after refactor

    // Update meeting status to active if it was scheduled
    if (meeting.meeting_status === 'scheduled') {
      await supabase
        .from('meetings')
        .update({ 
          meeting_status: 'active',
          actual_start: new Date().toISOString()
        })
        .eq('id', meeting.id)
    }

    res.json({ participant, meeting })
  } catch (error) {
    console.error('Error joining meeting:', error)
    console.error('Error details:', error.message)
    console.error('Error stack:', error.stack)
    res.status(500).json({ error: 'Failed to join meeting: ' + error.message })
  }
})

// Leave meeting
router.post('/:meetingId/leave', devBypass, async (req, res) => {
  try {
    const { meetingId } = req.params

    const { data: meeting } = await supabase
      .from('meetings')
      .select('id')
      .eq('meeting_id', meetingId)
      .single()

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }

    // Mark participant as left
    const { error } = await supabase
      .from('meeting_participants')
      .update({ left_at: new Date().toISOString() })
      .eq('meeting_id', meeting.id)
      .eq('user_id', req.user.id)
      .is('left_at', null)

    if (error) throw error

    res.json({ message: 'Left meeting successfully' })
  } catch (error) {
    console.error('Error leaving meeting:', error)
    res.status(500).json({ error: 'Failed to leave meeting' })
  }
})

// Update participant status
router.patch('/:meetingId/participants/:participantId', devBypass, async (req, res) => {
  try {
    const { meetingId, participantId } = req.params
    const updates = req.body

    const { data: meeting } = await supabase
      .from('meetings')
      .select('id, host_id')
      .eq('meeting_id', meetingId)
      .single()

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }

    // Check if user can update this participant
    const { data: participant } = await supabase
      .from('meeting_participants')
      .select('user_id, role')
      .eq('id', participantId)
      .single()

    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' })
    }

    const isHost = meeting.host_id === req.user.id
    const isSelf = participant.user_id === req.user.id
    const isCoHost = participant.role === 'co-host'

    if (!isSelf && !isHost && !isCoHost) {
      return res.status(403).json({ error: 'Not authorized to update this participant' })
    }

    // Update participant
    const { data: updatedParticipant, error } = await supabase
      .from('meeting_participants')
      .update(updates)
      .eq('id', participantId)
      .select()
      .single()

    if (error) throw error

    res.json({ participant: updatedParticipant })
  } catch (error) {
    console.error('Error updating participant:', error)
    res.status(500).json({ error: 'Failed to update participant' })
  }
})

// End meeting (host only)
router.post('/:meetingId/end', devBypass, async (req, res) => {
  try {
    const { meetingId } = req.params

    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('id, host_id')
      .eq('meeting_id', meetingId)
      .single()

    if (meetingError || !meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }

    // Check if user is host
    if (meeting.host_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the host can end the meeting' })
    }

    // End meeting using the database function
    const { error } = await supabase.rpc('end_meeting', {
      p_meeting_id: meeting.id
    })

    if (error) throw error

    res.json({ message: 'Meeting ended successfully' })
  } catch (error) {
    console.error('Error ending meeting:', error)
    res.status(500).json({ error: 'Failed to end meeting' })
  }
})

// Get user's meetings
router.get('/user/meetings', devBypass, async (req, res) => {
  try {
    const { status = 'all', limit = 50, offset = 0 } = req.query

    let query = supabase
      .from('meetings')
      .select(`
        *,
        meeting_participants!inner (
          id,
          role,
          joined_at,
          left_at
        )
      `)
      .eq('meeting_participants.user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status !== 'all') {
      query = query.eq('meeting_status', status)
    }

    const { data: meetings, error } = await query

    if (error) throw error

    res.json({ meetings })
  } catch (error) {
    console.error('Error fetching user meetings:', error)
    res.status(500).json({ error: 'Failed to fetch meetings' })
  }
})

// Send chat message
router.post('/:meetingId/chat', devBypass, async (req, res) => {
  try {
    const { meetingId } = req.params
    const { content, message_type = 'text', file_url, file_name, file_size, is_private = false, recipient_id } = req.body

    if (!content) {
      return res.status(400).json({ error: 'Message content is required' })
    }

    const { data: meeting } = await supabase
      .from('meetings')
      .select('id')
      .eq('meeting_id', meetingId)
      .single()

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }

    // Check if user is participant
    const { data: participant } = await supabase
      .from('meeting_participants')
      .select('id')
      .eq('meeting_id', meeting.id)
      .eq('user_id', req.user.id)
      .is('left_at', null)
      .single()

    if (!participant) {
      return res.status(403).json({ error: 'You are not a participant in this meeting' })
    }

    const { data: message, error } = await supabase
      .from('meeting_chat')
      .insert({
        meeting_id: meeting.id,
        sender_id: req.user.id,
        sender_name: req.user.user_metadata?.full_name || req.user.email.split('@')[0],
        message_type,
        content,
        file_url,
        file_name,
        file_size,
        is_private,
        recipient_id
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ message })
  } catch (error) {
    console.error('Error sending chat message:', error)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// Get chat messages
router.get('/:meetingId/chat', devBypass, async (req, res) => {
  try {
    const { meetingId } = req.params
    const { limit = 100, offset = 0 } = req.query

    const { data: meeting } = await supabase
      .from('meetings')
      .select('id')
      .eq('meeting_id', meetingId)
      .single()

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }

    const { data: messages, error } = await supabase
      .from('meeting_chat')
      .select('*')
      .eq('meeting_id', meeting.id)
      .or(`is_private.eq.false,and(is_private.eq.true,recipient_id.eq.${req.user.id})`)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) throw error

    res.json({ messages })
  } catch (error) {
    console.error('Error fetching chat messages:', error)
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
})

// Send reaction
router.post('/:meetingId/reactions', devBypass, async (req, res) => {
  try {
    const { meetingId } = req.params
    const { reaction_type } = req.body

    if (!reaction_type) {
      return res.status(400).json({ error: 'Reaction type is required' })
    }

    const { data: meeting } = await supabase
      .from('meetings')
      .select('id')
      .eq('meeting_id', meetingId)
      .single()

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }

    // Check if user is participant
    const { data: participant } = await supabase
      .from('meeting_participants')
      .select('id')
      .eq('meeting_id', meeting.id)
      .eq('user_id', req.user.id)
      .is('left_at', null)
      .single()

    if (!participant) {
      return res.status(403).json({ error: 'You are not a participant in this meeting' })
    }

    const { data: reaction, error } = await supabase
      .from('meeting_reactions')
      .insert({
        meeting_id: meeting.id,
        participant_id: participant.id,
        reaction_type
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ reaction })
  } catch (error) {
    console.error('Error sending reaction:', error)
    res.status(500).json({ error: 'Failed to send reaction' })
  }
})

// Send meeting invitations via email
router.post('/:meetingId/invite', devBypass, async (req, res) => {
  try {
    const { meetingId } = req.params
    const { emails, meetingLink, password } = req.body

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Email addresses are required' })
    }

    const { data: meeting } = await supabase
      .from('meetings')
      .select('title, host_id')
      .eq('meeting_id', meetingId)
      .single()

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }

    // Get host info
    const hostEmail = req.user.email
    const hostName = req.user.user_metadata?.full_name || hostEmail.split('@')[0]

    // Prepare email content
    const emailContent = {
      subject: `You're invited to join: ${meeting.title}`,
      body: `
Hello,

${hostName} has invited you to join a video meeting.

Meeting Details:
- Title: ${meeting.title}
- Meeting ID: ${meetingId}
- Link: ${meetingLink}
${password ? `- Password: ${password}` : ''}

Join the meeting by clicking the link above or entering the Meeting ID on CognEdge.

Best regards,
CognEdge Team
      `
    }

    // In a real application, you would use an email service like SendGrid, AWS SES, or Nodemailer
    // For now, we'll log the emails and return success
    console.log('📧 Sending meeting invitations to:', emails)
    console.log('Email Content:', emailContent)

    // Simulate email sending
    const sentEmails = emails.filter(email => {
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailRegex.test(email)
    })

    // Store invitations in database (optional)
    const invitations = sentEmails.map(email => ({
      meeting_id: meeting.id,
      email,
      sent_at: new Date().toISOString(),
      sent_by: req.user.id
    }))

    // You could store these in a meeting_invitations table if needed
    console.log('📨 Invitations sent to:', sentEmails)

    res.json({
      message: 'Invitations sent successfully',
      sentCount: sentEmails.length,
      failedEmails: emails.filter(e => !sentEmails.includes(e))
    })
  } catch (error) {
    console.error('Error sending invitations:', error)
    res.status(500).json({ error: 'Failed to send invitations' })
  }
})

// Share meeting link
router.post('/:meetingId/share', devBypass, async (req, res) => {
  try {
    const { meetingId } = req.params
    const { method } = req.body // 'email', 'copy', 'sms', etc.

    const { data: meeting } = await supabase
      .from('meetings')
      .select('*')
      .eq('meeting_id', meetingId)
      .single()

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }

    const meetingLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/meet/${meetingId}`

    res.json({
      meetingLink,
      meetingId: meeting.meeting_id,
      title: meeting.title,
      hasPassword: !!meeting.password
    })
  } catch (error) {
    console.error('Error sharing meeting:', error)
    res.status(500).json({ error: 'Failed to share meeting' })
  }
})

export default router
