import express from 'express'
import pool from '../db/database.js'
import { authenticateToken } from '../middleware/auth.js'

const router = express.Router()

// Get all teams for the user
router.get('/', authenticateToken, async (req, res) => {
  if (!pool) {
    return res.json([
      {
        id: '1',
        name: 'Sample Team',
        description: 'This is a sample team',
        created_by: req.user.id,
        created_by_name: req.user.user_metadata?.full_name || 'Dev User',
        user_role: 'admin',
        created_at: new Date().toISOString(),
        note: 'Database not configured - using mock data'
      }
    ])
  }

  try {
    const userId = req.user.id

    const result = await pool.query(
      `SELECT DISTINCT t.*, 
              creator.email as created_by_email,
              creator.raw_user_meta_data->>'full_name' as created_by_name,
              tm.role as user_role
       FROM teams t
       LEFT JOIN auth.users creator ON t.created_by = creator.id
       LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = $1
       WHERE t.created_by = $1 OR tm.user_id = $1
       ORDER BY t.created_at DESC`,
      [userId]
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get teams error:', error)
    res.status(500).json({ error: 'Failed to fetch teams' })
  }
})

// Create a new team
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body
    const created_by = req.user.id

    if (!name) {
      return res.status(400).json({ error: 'Team name is required' })
    }

    const result = await pool.query(
      `INSERT INTO teams (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, description, created_by]
    )

    // Add creator as admin member
    await pool.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [result.rows[0].id, created_by]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Create team error:', error)
    res.status(500).json({ error: 'Failed to create team' })
  }
})

// Get team members
router.get('/:id/members', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `SELECT tm.*, 
              u.email as user_email,
              u.raw_user_meta_data->>'full_name' as user_name
       FROM team_members tm
       LEFT JOIN auth.users u ON tm.user_id = u.id
       WHERE tm.team_id = $1
       ORDER BY tm.joined_at ASC`,
      [id]
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get team members error:', error)
    res.status(500).json({ error: 'Failed to fetch team members' })
  }
})

// Add member to team
router.post('/:id/members', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { user_id, role = 'member' } = req.body

    if (!user_id) {
      return res.status(400).json({ error: 'User ID is required' })
    }

    const result = await pool.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, user_id, role]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Add team member error:', error)
    res.status(500).json({ error: 'Failed to add team member' })
  }
})

export default router
