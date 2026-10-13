const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/middleware');

function portalOnly(req, res, next) {
  if (!['STUDENT', 'PARENT'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Portal access required' });
  }
  next();
}

router.get('/me', authenticate, portalOnly, async (req, res) => {
  const activeAcademicYear = await prisma.academicYear.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  if (req.user.role === 'STUDENT') {
    const account = await prisma.studentAccount.findUnique({
      where: { id: req.user.id },
      include: { student: { include: { class: { include: { academicYear: { select: { id: true, name: true, isActive: true } } } } } } },
    });

    if (!account) return res.status(404).json({ error: 'Student account not found' });

    return res.json({
      role: 'STUDENT',
      activeAcademicYear,
      student: account.student,
      profile: {
        className: account.student?.class?.name || 'Not assigned',
        classLevel: account.student?.class?.level || '—',
      },
    });
  }

  const account = await prisma.parentAccount.findUnique({
    where: { id: req.user.id },
    include: {
      children: {
        include: {
          student: {
            include: { class: { include: { academicYear: { select: { id: true, name: true, isActive: true } } } } },
          },
        },
      },
    },
  });

  if (!account) return res.status(404).json({ error: 'Parent account not found' });

  res.json({
    role: 'PARENT',
    activeAcademicYear,
    parent: { id: account.id, fullName: account.fullName, email: account.email },
    children: account.children.map((link) => link.student),
  });
});

router.get('/reports', authenticate, portalOnly, async (req, res) => {
  const activeAcademicYear = await prisma.academicYear.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const studentIds = req.user.role === 'STUDENT'
    ? [req.user.studentId]
    : (await prisma.parentStudent.findMany({ where: { parentId: req.user.id }, select: { studentId: true } })).map((link) => link.studentId);

  const reports = await prisma.studentSemesterSummary.findMany({
    where: {
      studentId: { in: studentIds },
      published: true,
      ...(activeAcademicYear ? { semester: { academicYearId: activeAcademicYear.id } } : {}),
    },
    include: {
      student: { select: { fullName: true, matricule: true } },
      semester: { select: { name: true, order: true, academicYear: { select: { name: true } } } },
    },
    orderBy: [{ semester: { order: 'desc' } }, { moyenneGenerale: 'desc' }],
  });

  res.json(reports);
});

module.exports = router;