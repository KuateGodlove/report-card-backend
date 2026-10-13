const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/middleware');

router.get('/summary', authenticate, async (req, res) => {
  try {
    const activeYear = await prisma.academicYear.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    const assignedClasses = req.user.role === 'ADMIN'
      ? null
      : await prisma.teacherAssignment.findMany({
          where: { teacherId: req.user.id },
          select: { classId: true, subjectId: true },
        });

    const classIds = assignedClasses ? [...new Set(assignedClasses.map((item) => item.classId))] : null;
    const classFilter = {
      ...(activeYear ? { academicYearId: activeYear.id } : {}),
      ...(classIds ? { id: { in: classIds } } : {}),
    };

    const classes = await prisma.class.findMany({
      where: classFilter,
      select: {
        id: true,
        name: true,
        students: { select: { id: true } },
        classSubjects: {
          select: {
            subjectId: true,
            subject: { select: { name: true } },
          },
        },
        teacherAssignments: {
          select: {
            teacherId: true,
            subjectId: true,
            teacher: { select: { fullName: true } },
          },
        },
      },
    });

    const semesters = await prisma.semester.findMany({
      where: activeYear ? { academicYearId: activeYear.id } : {},
      select: { id: true, name: true, order: true, sequences: { select: { id: true, name: true } } },
    });
    const sequenceIds = semesters.flatMap((semester) => semester.sequences.map((sequence) => sequence.id));
    const studentIds = classes.flatMap((schoolClass) => schoolClass.students.map((student) => student.id));
    const subjectIds = assignedClasses ? [...new Set(assignedClasses.map((item) => item.subjectId))] : null;

    const marks = sequenceIds.length && studentIds.length
      ? await prisma.mark.findMany({
          where: {
            sequenceId: { in: sequenceIds },
            studentId: { in: studentIds },
            ...(subjectIds ? { subjectId: { in: subjectIds } } : {}),
          },
          select: { studentId: true, subjectId: true, sequenceId: true },
        })
      : [];

    const enteredMarks = new Set(marks.map((mark) => `${mark.studentId}:${mark.subjectId}:${mark.sequenceId}`));
    const pendingSubmissions = classes.reduce((total, schoolClass) => {
      const classSubjectIds = schoolClass.classSubjects
        .map((classSubject) => classSubject.subjectId)
        .filter((subjectId) => !subjectIds || subjectIds.includes(subjectId));
      const expected = schoolClass.students.length * classSubjectIds.length * sequenceIds.length;
      const completed = schoolClass.students.reduce((count, student) =>
        count + classSubjectIds.reduce((subjectCount, subjectId) =>
          subjectCount + sequenceIds.filter((sequenceId) => enteredMarks.has(`${student.id}:${subjectId}:${sequenceId}`)).length, 0), 0);
      return total + Math.max(expected - completed, 0);
    }, 0);

    const marksByAssignment = new Set(marks.map((mark) => `${mark.studentId}:${mark.subjectId}:${mark.sequenceId}`));
    const markCompletion = classes.flatMap((schoolClass) =>
      schoolClass.classSubjects
        .filter((classSubject) => !subjectIds || subjectIds.includes(classSubject.subjectId))
        .flatMap((classSubject) => {
          const matchingAssignments = schoolClass.teacherAssignments.filter((assignment) =>
            assignment.subjectId === classSubject.subjectId &&
            (!assignedClasses || assignment.teacherId === req.user.id)
          );
          const teacherNames = matchingAssignments.map((assignment) => assignment.teacher.fullName);

          return sequenceIds.map((sequenceId) => {
            const submitted = schoolClass.students.filter((student) =>
              marksByAssignment.has(`${student.id}:${classSubject.subjectId}:${sequenceId}`)
            ).length;
            const expected = schoolClass.students.length;

            return {
              classId: schoolClass.id,
              className: schoolClass.name,
              subjectId: classSubject.subjectId,
              subjectName: classSubject.subject.name,
              sequenceId,
              sequenceName: semesters
                .flatMap((semester) => semester.sequences)
                .find((sequence) => sequence.id === sequenceId)?.name || 'Sequence',
              teacherNames,
              submitted,
              expected,
              pending: Math.max(expected - submitted, 0),
              completionRate: expected ? Math.round((submitted / expected) * 100) : null,
            };
          });
        })
    );

    const latestReportedSemester = studentIds.length
      ? await prisma.semester.findFirst({
          where: {
            ...(activeYear ? { academicYearId: activeYear.id } : {}),
            semesterSummaries: { some: { studentId: { in: studentIds } } },
          },
          orderBy: { order: 'desc' },
          select: { id: true, name: true },
        })
      : null;
    const atRiskSummaries = latestReportedSemester
      ? await prisma.studentSemesterSummary.findMany({
          where: {
            semesterId: latestReportedSemester.id,
            studentId: { in: studentIds },
            moyenneGenerale: { lt: 10 },
          },
          select: {
            studentId: true,
            moyenneGenerale: true,
            classRank: true,
            student: { select: { fullName: true, class: { select: { name: true } } } },
          },
          orderBy: { moyenneGenerale: 'asc' },
        })
      : [];
    const weakRecords = latestReportedSemester && atRiskSummaries.length
      ? await prisma.studentSemesterRecord.findMany({
          where: {
            semesterId: latestReportedSemester.id,
            studentId: { in: atRiskSummaries.map((summary) => summary.studentId) },
            semesterAverage: { lt: 10 },
          },
          select: { studentId: true, subject: { select: { name: true } } },
        })
      : [];
    const weakSubjectsByStudent = weakRecords.reduce((subjects, record) => {
      const studentSubjects = subjects.get(record.studentId) || [];
      studentSubjects.push(record.subject.name);
      subjects.set(record.studentId, studentSubjects);
      return subjects;
    }, new Map());
    const atRiskStudents = atRiskSummaries.map((summary) => ({
      studentId: summary.studentId,
      fullName: summary.student.fullName,
      className: summary.student.class.name,
      average: summary.moyenneGenerale,
      classRank: summary.classRank,
      weakSubjects: weakSubjectsByStudent.get(summary.studentId) || [],
    }));
    const classPerformance = latestReportedSemester
      ? await prisma.classSemesterStats.findMany({
          where: {
            semesterId: latestReportedSemester.id,
            classId: { in: classes.map((schoolClass) => schoolClass.id) },
          },
          select: {
            classAverage: true,
            successRate: true,
            numberAdmitted: true,
            highestAverage: true,
            class: { select: { id: true, name: true } },
          },
          orderBy: { successRate: 'asc' },
        })
      : [];

    res.json({
      totalStudents: studentIds.length,
      activeClasses: classes.length,
      pendingSubmissions,
      markCompletion,
      atRiskSemesterName: latestReportedSemester?.name || null,
      atRiskStudents,
      classPerformance,
      activeAcademicYear: activeYear ? activeYear.id : null,
    });
  } catch (error) {
    console.error('Get dashboard summary error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

module.exports = router;
