import express from 'express'
import pool from '../db/database.js'
import { authenticateToken } from '../middleware/auth.js'

const router = express.Router()

// Get all documents
router.get('/', authenticateToken, async (req, res) => {
  if (!pool) {
    return res.json([
      {
        id: '1',
        title: 'Sample Document',
        content: 'This is a sample document content',
        user_id: req.user.id,
        user_name: req.user.user_metadata?.full_name || 'Dev User',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        note: 'Database not configured - using mock data'
      }
    ])
  }

  try {
    const result = await pool.query(
      `SELECT d.*, 
              u.email as user_email,
              u.raw_user_meta_data->>'full_name' as user_name
       FROM documents d
       LEFT JOIN auth.users u ON d.user_id = u.id
       ORDER BY d.updated_at DESC`
    )

    res.json(result.rows)
  } catch (error) {
    console.error('Get documents error:', error)
    res.status(500).json({ error: 'Failed to fetch documents' })
  }
})

// Get a single document
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      `SELECT d.*, 
              u.email as user_email,
              u.raw_user_meta_data->>'full_name' as user_name
       FROM documents d
       LEFT JOIN auth.users u ON d.user_id = u.id
       WHERE d.id = $1`,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Get document error:', error)
    res.status(500).json({ error: 'Failed to fetch document' })
  }
})

// Create a new document
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, content = '' } = req.body
    const user_id = req.user.id

    if (!title) {
      return res.status(400).json({ error: 'Title is required' })
    }

    const result = await pool.query(
      `INSERT INTO documents (title, content, user_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title, content, user_id]
    )

    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Create document error:', error)
    res.status(500).json({ error: 'Failed to create document' })
  }
})

// Update a document
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params
    const { title, content } = req.body

    const result = await pool.query(
      `UPDATE documents 
       SET title = COALESCE($1, title),
           content = COALESCE($2, content),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [title, content, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.error('Update document error:', error)
    res.status(500).json({ error: 'Failed to update document' })
  }
})

// Delete a document
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    const result = await pool.query(
      'DELETE FROM documents WHERE id = $1 RETURNING *',
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' })
    }

    res.json({ message: 'Document deleted successfully' })
  } catch (error) {
    console.error('Delete document error:', error)
    res.status(500).json({ error: 'Failed to delete document' })
  }
})

export default router
