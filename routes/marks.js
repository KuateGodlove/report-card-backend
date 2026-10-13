const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../lib/middleware');

async function ensureMarkAccess({ user, classId, subjectId, sequenceId }) {
  const [schoolClass, sequence, classSubject] = await Promise.all([
    prisma.class.findUnique({ where: { id: classId }, select: { academicYearId: true } }),
    prisma.sequence.findUnique({
      where: { id: sequenceId },
      include: { semester: { select: { academicYearId: true } } },
    }),
    prisma.classSubject.findUnique({ where: { classId_subjectId: { classId, subjectId } } }),
  ]);

  if (!schoolClass || !sequence || !classSubject) {
    return 'The selected class, subject, or sequence is invalid.';
  }

  if (schoolClass.academicYearId !== sequence.semester.academicYearId) {
    return 'The selected sequence does not belong to this class academic year.';
  }

  if (user.role !== 'ADMIN') {
    const assignment = await prisma.teacherAssignment.findUnique({
      where: { teacherId_subjectId_classId: { teacherId: user.id, subjectId, classId } },
    });
    if (!assignment) return 'You are not assigned to enter marks for this subject and class.';
  }

  return null;
}

async function unpublishSemesterReports(classId, sequenceId) {
  const [sequence, students] = await Promise.all([
    prisma.sequence.findUnique({ where: { id: sequenceId }, select: { semesterId: true } }),
    prisma.student.findMany({ where: { classId }, select: { id: true } }),
  ]);

  if (!sequence) return;
  await prisma.studentSemesterSummary.updateMany({
    where: {
      semesterId: sequence.semesterId,
      studentId: { in: students.map((student) => student.id) },
    },
    data: { published: false },
  });
}

// GET marks for a specific subject + class + sequence (used to load the roster with existing scores)
router.get('/', authenticate, async (req, res) => {
  try {
    const { classId, subjectId, sequenceId } = req.query;

    if (!classId || !subjectId || !sequenceId) {
      return res.status(400).json({ error: 'classId, subjectId, and sequenceId are required' });
    }

    const accessError = await ensureMarkAccess({ user: req.user, classId, subjectId, sequenceId });
    if (accessError) return res.status(403).json({ error: accessError });

    // Get every student in the class
    const students = await prisma.student.findMany({
      where: { classId },
      orderBy: { fullName: 'asc' },
    });

    // Get existing marks for this subject+sequence for these students
    const existingMarks = await prisma.mark.findMany({
      where: {
        subjectId,
        sequenceId,
        studentId: { in: students.map((s) => s.id) },
      },
    });

    // Merge: each student gets their existing mark (if any) attached
    const roster = students.map((student) => {
      const mark = existingMarks.find((m) => m.studentId === student.id);
      return {
        studentId: student.id,
        fullName: student.fullName,
        matricule: student.matricule,
        score: mark ? mark.score : null,
        markId: mark ? mark.id : null,
        isLocked: mark ? mark.isLocked : false,
      };
    });

    res.json(roster);
  } catch (error) {
    console.error('Get marks error:', error);
    res.status(500).json({ error: 'Failed to fetch marks' });
  }
});

// POST submit/update a mark for one student
router.post('/', authenticate, async (req, res) => {
  try {
    const { studentId, subjectId, sequenceId, score } = req.body;
    const teacherId = req.user.id; // comes from the JWT token, not the request body

    if (!studentId || !subjectId || !sequenceId || score === undefined) {
      return res.status(400).json({ error: 'studentId, subjectId, sequenceId, and score are required' });
    }

    if (score < 0 || score > 20) {
      return res.status(400).json({ error: 'Score must be between 0 and 20' });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { classId: true },
    });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const accessError = await ensureMarkAccess({
      user: req.user,
      classId: student.classId,
      subjectId,
      sequenceId,
    });
    if (accessError) return res.status(403).json({ error: accessError });

    // Check if a mark already exists for this student+subject+sequence
    const existingMark = await prisma.mark.findUnique({
      where: {
        studentId_subjectId_sequenceId: { studentId, subjectId, sequenceId },
      },
    });

    if (existingMark) {
      if (existingMark.isLocked) {
        return res.status(403).json({ error: 'This mark is locked and cannot be edited. Contact admin to unlock it.' });
      }

      // Log the change before overwriting
      await prisma.markEditLog.create({
        data: {
          markId: existingMark.id,
          oldScore: existingMark.score,
          newScore: score,
          changedBy: teacherId,
        },
      });

      const updatedMark = await prisma.mark.update({
        where: { id: existingMark.id },
        data: { score, teacherId },
      });

      await unpublishSemesterReports(student.classId, sequenceId);

      return res.json({ ...updatedMark, reportsNeedRegeneration: true });
    }

    // Create a new mark
    const newMark = await prisma.mark.create({
      data: { studentId, subjectId, sequenceId, score, teacherId },
    });

    await unpublishSemesterReports(student.classId, sequenceId);

    res.status(201).json({ ...newMark, reportsNeedRegeneration: true });
  } catch (error) {
    console.error('Submit mark error:', error);
    res.status(500).json({ error: 'Failed to submit mark' });
  }
});

// PUT admin unlocks a specific mark for correction
router.put('/:id/unlock', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const mark = await prisma.mark.update({
      where: { id },
      data: { isLocked: false },
    });

    res.json(mark);
  } catch (error) {
    console.error('Unlock mark error:', error);
    res.status(500).json({ error: 'Failed to unlock mark' });
  }
});

// PUT admin locks all marks for a class+subject+sequence (used during report generation)
router.put('/lock', authenticate, requireAdmin, async (req, res) => {
  try {
    const { classId, sequenceId } = req.body;

    if (!classId || !sequenceId) {
      return res.status(400).json({ error: 'classId and sequenceId are required' });
    }

    const students = await prisma.student.findMany({ where: { classId } });

    const result = await prisma.mark.updateMany({
      where: {
        sequenceId,
        studentId: { in: students.map((s) => s.id) },
      },
      data: { isLocked: true },
    });

    res.json({ message: `${result.count} marks locked` });
  } catch (error) {
    console.error('Lock marks error:', error);
    res.status(500).json({ error: 'Failed to lock marks' });
  }
});

module.exports = router;
