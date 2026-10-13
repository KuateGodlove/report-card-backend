const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../lib/middleware');

function getNextAcademicYearName(currentName) {
  if (!currentName || !/^\d{4}\/\d{4}$/.test(currentName)) {
    const year = new Date().getFullYear();
    return `${year}/${year + 1}`;
  }

  const [startYear] = currentName.split('/').map((part) => Number(part));
  return `${startYear + 1}/${startYear + 2}`;
}

router.get('/years', authenticate, async (req, res) => {
  try {
    const years = await prisma.academicYear.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(years);
  } catch (error) {
    console.error('Get academic years error:', error);
    res.status(500).json({ error: 'Failed to fetch academic years' });
  }
});

router.get('/years/active', authenticate, async (req, res) => {
  try {
    const year = await prisma.academicYear.findFirst({
      where: { isActive: true },
    });
    res.json(year || null);
  } catch (error) {
    console.error('Get active academic year error:', error);
    res.status(500).json({ error: 'Failed to fetch active academic year' });
  }
});

router.post('/years/rollover', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;

    const previousYear = await prisma.academicYear.findFirst({
      where: { isActive: true },
      include: {
        classes: {
          include: {
            classSubjects: true,
          },
        },
      },
    });

    if (!previousYear) {
      return res.status(400).json({ error: 'No active academic year is available to roll over.' });
    }

    const targetName = name || getNextAcademicYearName(previousYear.name);
    const duplicateYear = await prisma.academicYear.findUnique({
      where: { name: targetName },
    });

    if (duplicateYear) {
      return res.status(400).json({ error: `Academic year "${targetName}" already exists.` });
    }

    const newYear = await prisma.academicYear.create({
      data: {
        name: targetName,
        isActive: true,
      },
    });

    await prisma.academicYear.updateMany({
      where: {
        id: { not: newYear.id },
        isActive: true,
      },
      data: { isActive: false },
    });

    const classMap = new Map();
    let copiedAssignments = 0;

    for (const oldClass of previousYear.classes) {
      const newClass = await prisma.class.create({
        data: {
          name: oldClass.name,
          level: oldClass.level,
          stream: oldClass.stream,
          academicYearId: newYear.id,
        },
      });

      classMap.set(oldClass.id, newClass.id);

      for (const classSubject of oldClass.classSubjects) {
        await prisma.classSubject.create({
          data: {
            classId: newClass.id,
            subjectId: classSubject.subjectId,
            coefficient: classSubject.coefficient,
          },
        });
        copiedAssignments += 1;
      }
    }

    res.status(201).json({
      academicYear: newYear,
      copiedClasses: previousYear.classes.length,
      copiedAssignments,
      message: 'Academic year rolled over successfully.',
    });
  } catch (error) {
    console.error('Rollover academic year error:', error);
    res.status(500).json({ error: 'Failed to create the new academic year.' });
  }
});

// GET all semesters (with their sequences) for an academic year
router.get('/semesters', authenticate, async (req, res) => {
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

    const semesters = await prisma.semester.findMany({
      where,
      include: { sequences: { orderBy: { order: 'asc' } } },
      orderBy: { order: 'asc' },
    });

    res.json(semesters);
  } catch (error) {
    console.error('Get semesters error:', error);
    res.status(500).json({ error: 'Failed to fetch semesters' });
  }
});

// POST create a semester (admin only)
router.post('/semesters', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, order, academicYearId } = req.body;

    if (!name || !order || !academicYearId) {
      return res.status(400).json({ error: 'name, order, and academicYearId are required' });
    }

    const semester = await prisma.semester.create({
      data: { name, order, academicYearId },
    });

    res.status(201).json(semester);
  } catch (error) {
    console.error('Create semester error:', error);
    res.status(500).json({ error: 'Failed to create semester' });
  }
});

// PUT update a semester (admin only)
router.put('/semesters/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, order } = req.body;

    const semester = await prisma.semester.update({
      where: { id },
      data: { name, order },
    });

    res.json(semester);
  } catch (error) {
    console.error('Update semester error:', error);
    res.status(500).json({ error: 'Failed to update semester' });
  }
});

// DELETE a semester (admin only)
router.delete('/semesters/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.sequence.deleteMany({ where: { semesterId: id } });
    await prisma.semester.delete({ where: { id } });
    res.json({ message: 'Semester deleted successfully' });
  } catch (error) {
    console.error('Delete semester error:', error);
    res.status(500).json({ error: 'Failed to delete semester' });
  }
});

// POST create a sequence within a semester (admin only)
router.post('/sequences', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, order, semesterId } = req.body;

    if (!name || !order || !semesterId) {
      return res.status(400).json({ error: 'name, order, and semesterId are required' });
    }

    const sequence = await prisma.sequence.create({
      data: { name, order, semesterId },
    });

    res.status(201).json(sequence);
  } catch (error) {
    console.error('Create sequence error:', error);
    res.status(500).json({ error: 'Failed to create sequence' });
  }
});

// PUT update a sequence (admin only)
router.put('/sequences/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, order } = req.body;

    const sequence = await prisma.sequence.update({
      where: { id },
      data: { name, order },
    });

    res.json(sequence);
  } catch (error) {
    console.error('Update sequence error:', error);
    res.status(500).json({ error: 'Failed to update sequence' });
  }
});

// DELETE a sequence (admin only)
router.delete('/sequences/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.sequence.delete({ where: { id } });
    res.json({ message: 'Sequence deleted successfully' });
  } catch (error) {
    console.error('Delete sequence error:', error);
    res.status(500).json({ error: 'Failed to delete sequence' });
  }
});

module.exports = router;