const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../lib/middleware');
const { hashPassword } = require('../lib/auth');

// GET the signed-in teacher and only the classes/subjects assigned to them
router.get('/me', authenticate, async (req, res) => {
  try {
    const teacher = await prisma.teacher.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        assignments: { include: { subject: true, class: true } },
      },
    });

    if (!teacher) return res.status(404).json({ error: 'Teacher account not found' });
    res.json(teacher);
  } catch (error) {
    console.error('Get current teacher error:', error);
    res.status(500).json({ error: 'Failed to fetch teacher assignments' });
  }
});

// GET all teachers
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { academicYearId } = req.query;
    let classFilter = {};

    if (academicYearId) {
      classFilter = { class: { academicYearId } };
    } else {
      const activeYear = await prisma.academicYear.findFirst({
        where: { isActive: true },
      });
      if (activeYear) classFilter = { class: { academicYearId: activeYear.id } };
    }

    const teachers = await prisma.teacher.findMany({
      where: { role: 'TEACHER' },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        createdAt: true,
        assignments: {
          where: classFilter,
          include: { subject: true, class: true },
        },
      },
      orderBy: { fullName: 'asc' },
    });
    res.json(teachers);
  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({ error: 'Failed to fetch teachers' });
  }
});

// POST create a new teacher (admin only)
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Full name, email, and password are required' });
    }

    const passwordHash = await hashPassword(password);

    const newTeacher = await prisma.teacher.create({
      data: {
        fullName,
        email,
        passwordHash,
        role: 'TEACHER',
      },
    });

    const { passwordHash: _, ...teacherWithoutPassword } = newTeacher;

    res.status(201).json(teacherWithoutPassword);
  } catch (error) {
    console.error('Create teacher error:', error);
    res.status(500).json({ error: 'Failed to create teacher' });
  }
});

// PUT update a teacher (admin only)
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, password } = req.body;
    const data = {};

    if (fullName) data.fullName = fullName;
    if (email) data.email = email;
    if (password) data.passwordHash = await hashPassword(password);

    const updatedTeacher = await prisma.teacher.update({
      where: { id },
      data,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    res.json(updatedTeacher);
  } catch (error) {
    console.error('Update teacher error:', error);
    res.status(500).json({ error: 'Failed to update teacher' });
  }
});

// POST assign a teacher to a subject + class (admin only)
router.post('/assign', authenticate, requireAdmin, async (req, res) => {
  try {
    const { teacherId, subjectId, classId } = req.body;

    if (!teacherId || !subjectId || !classId) {
      return res.status(400).json({ error: 'teacherId, subjectId, and classId are required' });
    }

    // A teacher assignment also makes the subject available in the class.
    // Keep an existing coefficient; use 1 for a newly added subject.
    await prisma.classSubject.upsert({
      where: { classId_subjectId: { classId, subjectId } },
      update: {},
      create: { classId, subjectId, coefficient: 1 },
    });

    const assignment = await prisma.teacherAssignment.create({
      data: { teacherId, subjectId, classId },
    });

    res.status(201).json(assignment);
  } catch (error) {
    console.error('Assign teacher error:', error);
    res.status(500).json({ error: 'Failed to assign teacher' });
  }
});

router.post('/assign-bulk', authenticate, requireAdmin, async (req, res) => {
  try {
    const { teacherIds, subjectIds, classIds } = req.body;
    if (!Array.isArray(teacherIds) || !teacherIds.length || !Array.isArray(subjectIds) || !subjectIds.length || !Array.isArray(classIds) || !classIds.length) {
      return res.status(400).json({ error: 'teacherIds, subjectIds, and classIds are required' });
    }

    const operations = [];
    for (const teacherId of teacherIds) {
      for (const subjectId of subjectIds) {
        for (const classId of classIds) {
          operations.push(prisma.classSubject.upsert({
            where: { classId_subjectId: { classId, subjectId } },
            update: {},
            create: { classId, subjectId, coefficient: 1 },
          }));
          operations.push(prisma.teacherAssignment.upsert({
            where: { teacherId_subjectId_classId: { teacherId, subjectId, classId } },
            update: {},
            create: { teacherId, subjectId, classId },
          }));
        }
      }
    }

    const results = await prisma.$transaction(operations);

    res.status(201).json({ assignmentsCreated: results.length / 2 });
  } catch (error) {
    console.error('Bulk teacher assignment error:', error);
    res.status(500).json({ error: 'Failed to assign teachers' });
  }
});

// DELETE a teacher assignment (admin only)
router.delete('/assign', authenticate, requireAdmin, async (req, res) => {
  try {
    const { teacherId, subjectId, classId } = req.body;

    if (!teacherId || !subjectId || !classId) {
      return res.status(400).json({ error: 'teacherId, subjectId, and classId are required' });
    }

    await prisma.teacherAssignment.delete({
      where: { teacherId_subjectId_classId: { teacherId, subjectId, classId } },
    });

    res.json({ message: 'Teacher assignment removed successfully' });
  } catch (error) {
    console.error('Delete teacher assignment error:', error);
    res.status(500).json({ error: 'Failed to remove teacher assignment' });
  }
});

// DELETE a teacher (admin only)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.teacher.delete({ where: { id } });
    res.json({ message: 'Teacher deleted successfully' });
  } catch (error) {
    console.error('Delete teacher error:', error);
    res.status(500).json({ error: 'Failed to delete teacher' });
  }
});

module.exports = router;
