import express from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { supabase } from '../lib/supabaseClient.js'

const router = express.Router()

// DEBUG: Test Supabase connection and list all users
router.get('/debug-users', authenticateToken, async (req, res) => {
  try {
    console.log('Testing Supabase connection...')
    const { data: { users }, error } = await supabase.auth.admin.listUsers()
    
    if (error) {
      console.error('Supabase error:', error)
      return res.status(500).json({ error: 'Supabase connection failed', details: error })
    }

    console.log(`Found ${users.length} users in Supabase auth`)
    
    // Return complete user data including metadata
    const userList = users.map(u => ({ 
      email: u.email, 
      id: u.id, 
      created_at: u.created_at,
      raw_user_meta_data: u.raw_user_meta_data || {},
      email_confirmed_at: u.email_confirmed_at
    }))
    
    res.json({
      success: true,
      totalUsers: users.length,
      users: userList
    })
  } catch (error) {
    console.error('Debug users error:', error)
    res.status(500).json({ error: 'Failed to fetch users', details: error.message })
  }
})

// GET /api/users/search?email=someone@example.com
router.get('/search', authenticateToken, async (req, res) => {
  const { email } = req.query
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }

  const trimmedEmail = email.trim().toLowerCase()
  
  if (!trimmedEmail) {
    return res.status(400).json({ error: 'Valid email is required' })
  }

  try {
    console.log(`Searching for user with email: ${trimmedEmail}`)
    
    // Search for user in Supabase auth
    const { data: { users }, error } = await supabase.auth.admin.listUsers()
    
    if (error) {
      console.error('Error fetching users from Supabase auth:', error)
      return res.status(500).json({ error: 'Failed to search users in authentication system' })
    }

    console.log(`Found ${users.length} total users in auth system`)
    
    // Case-insensitive email search
    const foundUser = users.find(user => 
      user.email && user.email.toLowerCase() === trimmedEmail
    )
    
    if (!foundUser) {
      console.log(`User with email ${trimmedEmail} not found in Supabase auth`)
      return res.status(404).json({ 
        error: 'User not found',
        message: `User with email "${email}" is not registered on CognEdge`
      })
    }

    console.log(`User found: ${foundUser.email} (ID: ${foundUser.id})`)

    // Return user data (excluding sensitive information)
    res.json({
      user: {
        id: foundUser.id,
        email: foundUser.email,
        raw_user_meta_data: foundUser.raw_user_meta_data || {},
        created_at: foundUser.created_at,
        email_confirmed_at: foundUser.email_confirmed_at
      }
    })
  } catch (error) {
    console.error('Search user error:', error)
    res.status(500).json({ error: 'Internal server error while searching for user' })
  }
})

// GET /api/users/lookup?email=someone@example.com (legacy endpoint)
router.get('/lookup', authenticateToken, async (req, res) => {
  const { email } = req.query
  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }
  try {
    // Search for user in Supabase auth
    const { data: { users }, error } = await supabase.auth.admin.listUsers()
    
    if (error) {
      return res.status(500).json({ error: 'Failed to search users' })
    }

    const foundUser = users.find(user => user.email === email.trim())
    
    if (!foundUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({
      id: foundUser.id,
      email: foundUser.email,
      full_name: foundUser.raw_user_meta_data?.full_name || foundUser.email
    })
  } catch (err) {
    console.error('Lookup user error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
