const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../lib/middleware');

// GET all classes
router.get('/', authenticate, async (req, res) => {
  try {
    const { academicYearId } = req.query;
    let where = {};

    if (academicYearId) {
      where = { academicYearId };
    } else {
      const activeYear = await prisma.academicYear.findFirst({
        where: { isActive: true },
      });
      if (activeYear) where = { academicYearId: activeYear.id };
    }

    const classes = await prisma.class.findMany({
      where,
      include: { academicYear: true },
      orderBy: { name: 'asc' },
    });
    res.json(classes);
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

// POST create a new class (admin only)
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, level, stream, academicYearId } = req.body;

    if (!name || !level || !academicYearId) {
      return res.status(400).json({ error: 'Name, level, and academic year are required' });
    }

    const newClass = await prisma.class.create({
      data: { name, level, stream: stream || null, academicYearId },
    });

    res.status(201).json(newClass);
  } catch (error) {
    console.error('Create class error:', error);
    res.status(500).json({ error: 'Failed to create class' });
  }
});

// PUT update a class (admin only)
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, level, stream } = req.body;

    const updatedClass = await prisma.class.update({
      where: { id },
      data: { name, level, stream: stream || null },
    });

    res.json(updatedClass);
  } catch (error) {
    console.error('Update class error:', error);
    res.status(500).json({ error: 'Failed to update class' });
  }
});

// DELETE a class (admin only)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.class.delete({ where: { id } });
    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ error: 'Failed to delete class' });
  }
});

module.exports = router;