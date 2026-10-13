const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../lib/middleware');
const { hashPassword } = require('../lib/auth');
const { uploadsDirectory } = require('../lib/uploads');

const photoStorage = multer.diskStorage({
  destination: (req, file, callback) => {
    const directory = uploadsDirectory;
    fs.mkdirSync(directory, { recursive: true });
    callback(null, directory);
  },
  filename: (req, file, callback) => {
    callback(null, `${req.params.id}-${Date.now()}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

// GET all students (optionally filter by class)
router.get('/', authenticate, async (req, res) => {
  try {
    const { classId, academicYearId } = req.query;
    let where = {};

    if (classId) {
      where.classId = classId;
    }

    if (academicYearId) {
      where.class = { academicYearId };
    } else {
      const activeYear = await prisma.academicYear.findFirst({
        where: { isActive: true },
      });
      if (activeYear) {
        where.class = { academicYearId: activeYear.id };
      }
    }

    const students = await prisma.student.findMany({
      where,
      include: { class: true },
      orderBy: { fullName: 'asc' },
    });

    res.json(students);
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// POST create a new student (admin only)
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      fullName,
      matricule,
      gender,
      dateOfBirth,
      placeOfBirth,
      classId,
      repeater,
      regime,
      guardianContact,
    } = req.body;

    if (!fullName || !matricule || !gender || !dateOfBirth || !classId) {
      return res.status(400).json({
        error: 'fullName, matricule, gender, dateOfBirth, and classId are required',
      });
    }

    const newStudent = await prisma.student.create({
      data: {
        fullName,
        matricule,
        gender,
        dateOfBirth: new Date(dateOfBirth),
        placeOfBirth: placeOfBirth || null,
        classId,
        repeater: repeater || false,
        regime: regime || null,
        guardianContact: guardianContact || null,
      },
    });

    res.status(201).json(newStudent);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'A student with this matricule already exists' });
    }
    console.error('Create student error:', error);
    res.status(500).json({ error: 'Failed to create student' });
  }
});

// PUT update a student (admin only) — e.g. transfer to another class
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, classId, repeater, regime, guardianContact } = req.body;

    const updatedStudent = await prisma.student.update({
      where: { id },
      data: { fullName, classId, repeater, regime, guardianContact },
    });

    res.json(updatedStudent);
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

router.post('/:id/photo', authenticate, requireAdmin, uploadPhoto.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'A JPG, PNG, or WEBP image is required' });
    const student = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const updatedStudent = await prisma.student.update({
      where: { id: student.id },
      data: { photoUrl: `/assets/student-photos/${req.file.filename}` },
      select: { id: true, fullName: true, photoUrl: true },
    });
    res.json(updatedStudent);
  } catch (error) {
    console.error('Upload student photo error:', error);
    res.status(500).json({ error: 'Failed to upload student photo' });
  }
});

// DELETE a student (admin only)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.student.delete({ where: { id } });
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

router.post('/:id/account', authenticate, requireAdmin, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const student = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const account = await prisma.studentAccount.upsert({
      where: { studentId: student.id },
      update: { email, passwordHash: await hashPassword(password) },
      create: { email, passwordHash: await hashPassword(password), studentId: student.id },
      select: { id: true, email: true, studentId: true },
    });
    res.status(201).json(account);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'That email is already in use' });
    console.error('Create student account error:', error);
    res.status(500).json({ error: 'Failed to create student account' });
  }
});

module.exports = router;
