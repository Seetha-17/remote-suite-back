import express from 'express'
import pool from '../db/database.js'
import { authenticateToken } from '../middleware/auth.js'

const router = express.Router()

// Get all tasks
router.get('/', authenticateToken, async (req, res) => {
  if (!pool) {
    return res.json([
      {
        id: '1',
        title: 'Sample Task 1',
        description: 'This is a sample task',
        status: 'todo',
        priority: 'medium',
        created_by: req.user.id,
        created_by_name: req.user.user_metadata?.full_name || 'Dev User',
        created_at: new Date().toISOString(),
        note: 'Database not configured - using mock data'
      }
    ])
  }

  try {
    const result = await pool.query(
      `SELECT t.*, 
              creator.email as created_by_email,
              creator.raw_user_meta_data->>'full_name' as created_by_name,
              assignee.email as assigned_to_email,
              assignee.raw_user_meta_data->>'full_name' as assigned_to_name
       FROM tasks t
       LEFT JOIN auth.users creator ON t.created_by = creator.id
       LEFT JOIN auth.users assignee ON t.assigned_to = assignee.id
       ORDER BY t.created_at DESC`
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get tasks error:', error)
    res.status(500).json({ error: 'Failed to fetch tasks' })
  }
})

// Create a new task
router.post('/', authenticateToken, async (req, res) => {
  const { title, description, status = 'todo', priority = 'medium', assigned_to } = req.body
  
  if (!title) {
    return res.status(400).json({ error: 'Title is required' })
  }

  if (!pool) {
    return res.status(201).json({
      id: Date.now().toString(),
      title,
      description,
      status,
      priority,
      assigned_to,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
      note: 'Database not configured - task not persisted'
    })
  }

  try {
    const created_by = req.user.id

    const result = await pool.query(
      `INSERT INTO tasks (title, description, status, priority, assigned_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [title, description, status, priority, assigned_to, created_by]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Create task error:', error)
    res.status(500).json({ error: 'Failed to create task' })
  }
})

// Update a task
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { title, description, status, priority, assigned_to } = req.body

    const result = await pool.query(
      `UPDATE tasks 
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           priority = COALESCE($4, priority),
           assigned_to = COALESCE($5, assigned_to),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [title, description, status, priority, assigned_to, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Update task error:', error)
    res.status(500).json({ error: 'Failed to update task' })
  }
})

// Delete a task
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      'DELETE FROM tasks WHERE id = $1 RETURNING *',
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' })
    }

    res.json({ message: 'Task deleted successfully' })
  } catch (error) {
    console.error('Delete task error:', error)
    res.status(500).json({ error: 'Failed to delete task' })
  }
})

export default router
