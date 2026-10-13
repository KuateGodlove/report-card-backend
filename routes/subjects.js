const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../lib/middleware');

// GET all subjects
router.get('/', authenticate, async (req, res) => {
  try {
    const { academicYearId } = req.query;

    let where = {};
    if (academicYearId) {
      where = {
        classSubjects: {
          some: {
            class: { academicYearId },
          },
        },
      };
    } else {
      const activeYear = await prisma.academicYear.findFirst({
        where: { isActive: true },
      });
      if (activeYear) {
        where = {
          classSubjects: {
            some: {
              class: { academicYearId: activeYear.id },
            },
          },
        };
      }
    }

    const subjects = await prisma.subject.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json(subjects);
  } catch (error) {
    console.error('Get subjects error:', error);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// POST create a new subject (admin only)
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Subject name is required' });
    }

    const newSubject = await prisma.subject.create({
      data: { name },
    });

    res.status(201).json(newSubject);
  } catch (error) {
    console.error('Create subject error:', error);
    res.status(500).json({ error: 'Failed to create subject' });
  }
});

// PUT update a subject (admin only)
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const updatedSubject = await prisma.subject.update({
      where: { id },
      data: { name },
    });

    res.json(updatedSubject);
  } catch (error) {
    console.error('Update subject error:', error);
    res.status(500).json({ error: 'Failed to update subject' });
  }
});

// DELETE a subject (admin only)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.subject.delete({ where: { id } });
    res.json({ message: 'Subject deleted successfully' });
  } catch (error) {
    console.error('Delete subject error:', error);
    res.status(500).json({ error: 'Failed to delete subject' });
  }
});

// POST assign a subject to a class with a coefficient (admin only)
router.post('/assign-to-class', authenticate, requireAdmin, async (req, res) => {
  try {
    const { classId, subjectId, coefficient } = req.body;

    if (!classId || !subjectId || !coefficient) {
      return res.status(400).json({ error: 'classId, subjectId, and coefficient are required' });
    }

    const classSubject = await prisma.classSubject.upsert({
      where: { classId_subjectId: { classId, subjectId } },
      update: { coefficient },
      create: { classId, subjectId, coefficient },
    });

    res.status(201).json(classSubject);
  } catch (error) {
    console.error('Assign subject to class error:', error);
    res.status(500).json({ error: 'Failed to assign subject to class' });
  }
});

router.post('/assign-to-class-bulk', authenticate, requireAdmin, async (req, res) => {
  try {
    const { subjectIds, classIds, coefficient } = req.body;
    if (!Array.isArray(subjectIds) || !subjectIds.length || !Array.isArray(classIds) || !classIds.length || !coefficient) {
      return res.status(400).json({ error: 'subjectIds, classIds, and coefficient are required' });
    }

    const assignments = await prisma.$transaction(
      classIds.flatMap((classId) => subjectIds.map((subjectId) =>
        prisma.classSubject.upsert({
          where: { classId_subjectId: { classId, subjectId } },
          update: { coefficient: parseFloat(coefficient) },
          create: { classId, subjectId, coefficient: parseFloat(coefficient) },
        })
      ))
    );

    res.status(201).json({ assignmentsCreated: assignments.length });
  } catch (error) {
    console.error('Bulk subject assignment error:', error);
    res.status(500).json({ error: 'Failed to assign subjects to classes' });
  }
});

function getDefaultCoefficientForLevel(classLevel, subjectName) {
  const normalized = (subjectName || '').toLowerCase();

  if (['LowerSixth', 'UpperSixth'].includes(classLevel)) {
    return 5;
  }

  if (['Form1', 'Form2', 'Form3', 'Form4', 'Form5'].includes(classLevel)) {
    const rules = {
      math: 5,
      mathematics: 5,
      english: 5,
      french: 5,
      biology: 5,
      chemistry: 5,
      physics: 5,
      geography: 4,
      history: 4,
      economics: 4,
      civics: 3,
      computer: 3,
      'computer science': 3,
      ict: 3,
      literature: 3,
      accounting: 4,
      business: 3,
      religion: 2,
      'religious education': 2,
      arts: 2,
      music: 2,
      sport: 2,
      sports: 2,
      design: 2,
      'physical education': 2,
      'food and nutrition': 2,
      'home economics': 2,
    };

    const match = Object.entries(rules).find(([keyword]) => normalized.includes(keyword));
    return match ? match[1] : 3;
  }

  return 1;
}

// POST apply the school's default coefficient rules to ALL classes and subjects (admin only)
router.post('/apply-coefficient-rules', authenticate, requireAdmin, async (req, res) => {
  try {
    const classes = await prisma.class.findMany();
    const subjects = await prisma.subject.findMany();

    let applied = 0;

    for (const cls of classes) {
      for (const subject of subjects) {
        const coefficient = getDefaultCoefficientForLevel(cls.level, subject.name);

        await prisma.classSubject.upsert({
          where: {
            classId_subjectId: { classId: cls.id, subjectId: subject.id },
          },
          update: { coefficient },
          create: { classId: cls.id, subjectId: subject.id, coefficient },
        });

        applied++;
      }
    }

    res.json({
      message: 'Default coefficient rules applied successfully',
      classesProcessed: classes.length,
      subjectsProcessed: subjects.length,
      assignmentsApplied: applied,
    });
  } catch (error) {
    console.error('Apply coefficient rules error:', error);
    res.status(500).json({ error: 'Failed to apply coefficient rules' });
  }
});

module.exports = router;
