const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../lib/middleware');
const { hashPassword } = require('../lib/auth');

router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { fullName, email, password } = req.body;
    if (!fullName || !email || !password) return res.status(400).json({ error: 'Full name, email, and password are required' });
    const parent = await prisma.parentAccount.create({
      data: { fullName, email, passwordHash: await hashPassword(password) },
      select: { id: true, fullName: true, email: true },
    });
    res.status(201).json(parent);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'That email is already in use' });
    res.status(500).json({ error: 'Failed to create parent account' });
  }
});

router.post('/:parentId/children', authenticate, requireAdmin, async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });
    const link = await prisma.parentStudent.create({ data: { parentId: req.params.parentId, studentId } });
    res.status(201).json(link);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Student is already linked to this parent' });
    res.status(500).json({ error: 'Failed to link student to parent' });
  }
});

module.exports = router;