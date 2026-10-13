const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate, requireAdmin } = require('../lib/middleware');
const puppeteer = require('puppeteer');
const { ZipArchive } = require('archiver');
const { generateReportCardHTML } = require('../templates/report-card');
const { uploadsDirectory } = require('../lib/uploads');

const subjectCoefficientMap = {
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

const yearsWithSubjectSpecificCoefficients = ['Form1', 'Form2', 'Form3', 'Form4', 'Form5'];
const sixthFormLevels = ['LowerSixth', 'UpperSixth'];

async function requirePublishedReport(req, res, studentId, semesterId) {
  if (req.user.role === 'ADMIN') return true;

  if (req.user.role === 'STUDENT' && req.user.studentId !== studentId) {
    res.status(403).json({ error: 'You can only access your own reports.' });
    return false;
  }

  if (req.user.role === 'PARENT') {
    const relationship = await prisma.parentStudent.findUnique({
      where: { parentId_studentId: { parentId: req.user.id, studentId } },
    });
    if (!relationship) {
      res.status(403).json({ error: 'You can only access reports for linked students.' });
      return false;
    }
  }

  const summary = await prisma.studentSemesterSummary.findUnique({
    where: { studentId_semesterId: { studentId, semesterId } },
    select: { published: true },
  });

  if (!summary?.published) {
    res.status(403).json({ error: 'This report has not been published yet.' });
    return false;
  }

  return true;
}

function getSubjectCoefficient(classLevel, subjectName) {
  const normalized = (subjectName || '').toLowerCase();

  if (sixthFormLevels.includes(classLevel)) {
    return 5;
  }

  if (yearsWithSubjectSpecificCoefficients.includes(classLevel)) {
    const match = Object.entries(subjectCoefficientMap).find(([keyword]) => normalized.includes(keyword));
    return match ? match[1] : 3;
  }

  return 1;
}

function getSchoolLogo() {
  const logoPath = path.join(__dirname, '..', 'assets', 'maison.jpg');
  if (!fs.existsSync(logoPath)) return null;
  return `data:image/jpeg;base64,${fs.readFileSync(logoPath).toString('base64')}`;
}

function getStudentPhoto(student) {
  if (!student.photoUrl) return null;
  const photoPath = path.join(uploadsDirectory, path.basename(student.photoUrl));
  if (!fs.existsSync(photoPath)) return null;
  const extension = path.extname(photoPath).toLowerCase();
  const mimeType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mimeType};base64,${fs.readFileSync(photoPath).toString('base64')}`;
}

async function getReportSubjectRecords(studentId, semesterId, classLevel) {
  const semester = await prisma.semester.findUnique({
    where: { id: semesterId },
    include: { sequences: { orderBy: { order: 'asc' } } },
  });
  const subjectRecordsRaw = await prisma.studentSemesterRecord.findMany({
    where: { studentId, semesterId },
    include: { subject: true },
  });
  const marks = await prisma.mark.findMany({
    where: { studentId, sequenceId: { in: semester?.sequences.map((sequence) => sequence.id) || [] } },
    select: { subjectId: true, sequenceId: true, score: true },
  });

  return {
    sequences: semester?.sequences || [],
    subjectRecords: subjectRecordsRaw.map((record) => ({
      ...record,
      coefficient: getSubjectCoefficient(classLevel, record.subject.name),
      sequenceMarks: (semester?.sequences || []).map((sequence) => ({
        name: sequence.name,
        score: marks.find((mark) => mark.subjectId === record.subjectId && mark.sequenceId === sequence.id)?.score ?? null,
      })),
      totalWeighted: parseFloat(record.totalWeighted),
    })),
  };
}

function getBrowserLaunchOptions() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ||
    (process.platform === 'win32' && fs.existsSync(edgePath) ? edgePath : undefined);

  const options = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  return executablePath ? { ...options, executablePath } : options;
}

function getGrade(score) {
  if (score >= 16) return 'A';
  if (score >= 12) return 'B';
  if (score >= 10) return 'C';
  return 'D';
}

function getAppreciation(score) {
  if (score >= 16) return 'Excellent';
  if (score >= 12) return 'Good';
  if (score >= 10) return 'Improve';
  return 'Needs support';
}

// POST generate semester report data for an entire class
router.post('/generate-semester', authenticate, requireAdmin, async (req, res) => {
  try {
    const { classId, semesterId } = req.body;

    if (!classId || !semesterId) {
      return res.status(400).json({ error: 'classId and semesterId are required' });
    }

    const semester = await prisma.semester.findUnique({
      where: { id: semesterId },
      include: { sequences: true },
    });

    if (!semester) return res.status(404).json({ error: 'Semester not found' });

    const classInfo = await prisma.class.findUnique({ where: { id: classId } });
    if (!classInfo) return res.status(404).json({ error: 'Class not found' });

    const sequenceIds = semester.sequences.map((s) => s.id);
    if (sequenceIds.length === 0) {
      return res.status(400).json({ error: 'Add the term sequences before generating report cards.' });
    }
    const students = await prisma.student.findMany({ where: { classId } });

    const classSubjects = await prisma.classSubject.findMany({
      where: { classId },
      include: { subject: true },
    });

    const allMarks = await prisma.mark.findMany({
      where: {
        sequenceId: { in: sequenceIds },
        studentId: { in: students.map((s) => s.id) },
      },
    });

    const missingMarks = [];
    for (const student of students) {
      for (const classSubject of classSubjects) {
        const enteredSequenceIds = new Set(
          allMarks
            .filter((mark) => mark.studentId === student.id && mark.subjectId === classSubject.subjectId)
            .map((mark) => mark.sequenceId)
        );
        if (enteredSequenceIds.size !== sequenceIds.length) {
          const missingCount = sequenceIds.length - enteredSequenceIds.size;
          missingMarks.push(`${student.fullName} — ${classSubject.subject.name} (${missingCount} sequence mark${missingCount === 1 ? '' : 's'} missing)`);
        }
      }
    }

    // A semester report is valid only when every configured sequence has a
    // teacher-entered score for every student and subject.
    if (missingMarks.length > 0) {
      return res.status(400).json({
        error: 'Enter all sequence marks before generating report cards.',
        missingMarks,
      });
    }

    const studentSubjectAverages = {};
    const noMarksSubjectIdsByStudent = {};

    for (const student of students) {
      studentSubjectAverages[student.id] = {};
      noMarksSubjectIdsByStudent[student.id] = [];

      for (const cs of classSubjects) {
        const marksForThisSubject = allMarks.filter(
          (m) => m.studentId === student.id && m.subjectId === cs.subjectId
        );

        if (marksForThisSubject.length === 0) {
          noMarksSubjectIdsByStudent[student.id].push(cs.subjectId);
          continue;
        }

        // Missing sequence marks still count as absent only if some marks are entered,
        // but fully empty subjects are excluded from the report and averages.
        const total = marksForThisSubject.reduce((sum, m) => sum + parseFloat(m.score), 0);
        const average = total / sequenceIds.length;
        const coefficient = getSubjectCoefficient(classInfo.level, cs.subject.name);

        studentSubjectAverages[student.id][cs.subjectId] = {
          average,
          coefficient,
          weighted: average * coefficient,
          grade: getGrade(average),
        };
      }
    }

    const subjectClassStats = {};
    for (const cs of classSubjects) {
      const averagesForSubject = students
        .map((s) => studentSubjectAverages[s.id][cs.subjectId]?.average)
        .filter((a) => a !== undefined);

      if (averagesForSubject.length === 0) continue;

      subjectClassStats[cs.subjectId] = {
        classAverage: averagesForSubject.reduce((a, b) => a + b, 0) / averagesForSubject.length,
        min: Math.min(...averagesForSubject),
        max: Math.max(...averagesForSubject),
      };
    }

    for (const student of students) {
      for (const cs of classSubjects) {
        const data = studentSubjectAverages[student.id][cs.subjectId];
        if (!data) continue;

        const stats = subjectClassStats[cs.subjectId];

        await prisma.studentSemesterRecord.upsert({
          where: {
            studentId_subjectId_semesterId: {
              studentId: student.id,
              subjectId: cs.subjectId,
              semesterId,
            },
          },
          update: {
            semesterAverage: data.average,
            totalWeighted: data.weighted,
            grade: data.grade,
            appreciation: getAppreciation(data.average),
            classAverageForSubject: stats.classAverage,
            classMin: stats.min,
            classMax: stats.max,
          },
          create: {
            studentId: student.id,
            subjectId: cs.subjectId,
            semesterId,
            semesterAverage: data.average,
            totalWeighted: data.weighted,
            grade: data.grade,
            appreciation: getAppreciation(data.average),
            classAverageForSubject: stats.classAverage,
            classMin: stats.min,
            classMax: stats.max,
          },
        });
      }

      if (noMarksSubjectIdsByStudent[student.id].length > 0) {
        await prisma.studentSemesterRecord.deleteMany({
          where: {
            studentId: student.id,
            semesterId,
            subjectId: { in: noMarksSubjectIdsByStudent[student.id] },
          },
        });
      }
    }

    const studentOverallAverages = students.map((student) => {
      const subjectData = Object.values(studentSubjectAverages[student.id]);
      const totalWeighted = subjectData.reduce((sum, d) => sum + d.weighted, 0);
      const totalCoefficient = subjectData.reduce((sum, d) => sum + d.coefficient, 0);
      const moyenneGenerale = totalCoefficient > 0 ? totalWeighted / totalCoefficient : 0;

      return { studentId: student.id, fullName: student.fullName, moyenneGenerale };
    });

    const ranked = [...studentOverallAverages].sort((a, b) => b.moyenneGenerale - a.moyenneGenerale);

    for (let i = 0; i < ranked.length; i++) {
      const { studentId, moyenneGenerale } = ranked[i];
      const classRank = i + 1;

      await prisma.studentSemesterSummary.upsert({
        where: { studentId_semesterId: { studentId, semesterId } },
        update: {
          moyenneGenerale,
          classRank,
          classSize: ranked.length,
          published: false,
        },
        create: {
          studentId,
          semesterId,
          moyenneGenerale,
          classRank,
          classSize: ranked.length,
        },
      });
    }

    const allAverages = ranked.map((r) => r.moyenneGenerale);
    let classAverage = 0;
    let numberAdmitted = 0;
    let successRate = 0;
    let standardDeviation = 0;
    let highest = { moyenneGenerale: 0, fullName: '' };
    let lowest = { moyenneGenerale: 0, fullName: '' };

    if (ranked.length > 0) {
      classAverage = allAverages.reduce((a, b) => a + b, 0) / allAverages.length;
      numberAdmitted = allAverages.filter((a) => a >= 10).length;
      successRate = (numberAdmitted / allAverages.length) * 100;
      const variance =
        allAverages.reduce((sum, a) => sum + Math.pow(a - classAverage, 2), 0) / allAverages.length;
      standardDeviation = Math.sqrt(variance);

      highest = ranked[0];
      lowest = ranked[ranked.length - 1];
    }

    await prisma.classSemesterStats.upsert({
      where: { classId_semesterId: { classId, semesterId } },
      update: {
        classAverage,
        numberAdmitted,
        numberRepeaters: 0,
        numberHonorRoll: 0,
        highestAverage: highest.moyenneGenerale,
        highestAverageStudent: highest.fullName,
        lowestAverage: lowest.moyenneGenerale,
        lowestAverageStudent: lowest.fullName,
        successRate,
        standardDeviation,
      },
      create: {
        classId,
        semesterId,
        classAverage,
        numberAdmitted,
        numberRepeaters: 0,
        numberHonorRoll: 0,
        highestAverage: highest.moyenneGenerale,
        highestAverageStudent: highest.fullName,
        lowestAverage: lowest.moyenneGenerale,
        lowestAverageStudent: lowest.fullName,
        successRate,
        standardDeviation,
      },

    });

    res.json({
      message: 'Semester report data generated successfully',
      studentsProcessed: students.length,
      ranked,
      missingMarks,
    });
  } catch (error) {
    console.error('Generate semester report error:', error);
    res.status(500).json({ error: 'Failed to generate semester report' });
  }
});

router.put('/publish-semester', authenticate, requireAdmin, async (req, res) => {
  try {
    const { classId, semesterId, published = true } = req.body;

    if (!classId || !semesterId) {
      return res.status(400).json({ error: 'classId and semesterId are required' });
    }

    const students = await prisma.student.findMany({
      where: { classId },
      select: { id: true },
    });

    const result = await prisma.studentSemesterSummary.updateMany({
      where: { studentId: { in: students.map((student) => student.id) }, semesterId },
      data: { published: Boolean(published) },
    });

    res.json({ published: Boolean(published), summariesUpdated: result.count });
  } catch (error) {
    console.error('Publish semester report error:', error);
    res.status(500).json({ error: 'Failed to update report publication status' });
  }
});

router.put('/summary/:studentId/:semesterId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { studentId, semesterId } = req.params;
    const {
      appreciationGenerale,
      absencesJustifiees,
      absencesNonJustifiees,
      retards,
      conduite,
      tenuePonctualite,
      observationConseil,
      classTeacherName,
    } = req.body;

    const summary = await prisma.studentSemesterSummary.update({
      where: { studentId_semesterId: { studentId, semesterId } },
      data: {
        appreciationGenerale: appreciationGenerale || null,
        absencesJustifiees: absencesJustifiees || null,
        absencesNonJustifiees: absencesNonJustifiees === '' ? null : Number(absencesNonJustifiees || 0),
        retards: retards === '' ? null : Number(retards || 0),
        conduite: conduite || null,
        tenuePonctualite: tenuePonctualite || null,
        observationConseil: observationConseil || null,
        classTeacherName: classTeacherName || null,
        published: false,
      },
    });

    res.json(summary);
  } catch (error) {
    console.error('Update report details error:', error);
    res.status(500).json({ error: 'Failed to update report details' });
  }
});

// GET one student's full semester report (all subjects + summary)
router.get('/student-semester/:studentId/:semesterId', authenticate, async (req, res) => {
  try {
    const { studentId, semesterId } = req.params;

    if (!(await requirePublishedReport(req, res, studentId, semesterId))) return;

    const student = await prisma.student.findUnique({ where: { id: studentId }, include: { class: true } });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { subjectRecords } = await getReportSubjectRecords(studentId, semesterId, student.class.level);

    const summary = await prisma.studentSemesterSummary.findUnique({
      where: { studentId_semesterId: { studentId, semesterId } },
      include: { student: true },
    });

    res.json({ subjectRecords, summary });
  } catch (error) {
    console.error('Get student semester report error:', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// GET generate and download a student's report card as PDF
router.get('/pdf/:studentId/:semesterId', authenticate, async (req, res) => {
  try {
    const { studentId, semesterId } = req.params;

    if (!(await requirePublishedReport(req, res, studentId, semesterId))) return;

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { class: true },
    });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const semester = await prisma.semester.findUnique({ where: { id: semesterId } });
    if (!semester) return res.status(404).json({ error: 'Semester not found' });

    const { sequences, subjectRecords } = await getReportSubjectRecords(studentId, semesterId, student.class.level);

    const summary = await prisma.studentSemesterSummary.findUnique({
      where: { studentId_semesterId: { studentId, semesterId } },
    });

    const classStats = await prisma.classSemesterStats.findUnique({
      where: { classId_semesterId: { classId: student.classId, semesterId } },
    });

    const html = generateReportCardHTML({
      student,
      classInfo: student.class,
      semester,
      subjectRecords,
      summary,
      classStats,
      schoolLogo: getSchoolLogo(),
      student: { ...student, photoDataUrl: getStudentPhoto(student) },
      sequences,
    });

    const browser = await puppeteer.launch(getBrowserLaunchOptions());
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=report-card-${student.matricule}.pdf`,
    });
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// GET generate a ZIP file containing every student's report card PDF for a class
router.get('/download-all/:classId/:semesterId', authenticate, async (req, res) => {
  try {
    const { classId, semesterId } = req.params;

    const students = await prisma.student.findMany({
      where: { classId },
      include: { class: true },
      orderBy: { fullName: 'asc' },
    });

    if (students.length === 0) {
      return res.status(404).json({ error: 'No students found in this class' });
    }

    const semester = await prisma.semester.findUnique({ where: { id: semesterId } });
    if (!semester) return res.status(404).json({ error: 'Semester not found' });

    if (req.user.role !== 'ADMIN') {
      const unpublished = await prisma.studentSemesterSummary.count({
        where: { studentId: { in: students.map((student) => student.id) }, semesterId, published: false },
      });
      if (unpublished > 0) return res.status(403).json({ error: 'These reports have not been published yet.' });
    }

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename=report-cards-${students[0].class.name.replace(/\s+/g, '-')}.zip`,
    });

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.pipe(res);

    const browser = await puppeteer.launch(getBrowserLaunchOptions());

    for (const student of students) {
      const summary = await prisma.studentSemesterSummary.findUnique({
        where: { studentId_semesterId: { studentId: student.id, semesterId } },
      });

      if (!summary) continue;

      const { sequences, subjectRecords } = await getReportSubjectRecords(student.id, semesterId, student.class.level);

      const classStats = await prisma.classSemesterStats.findUnique({
        where: { classId_semesterId: { classId: student.classId, semesterId } },
      });

      const html = generateReportCardHTML({
        student,
        classInfo: student.class,
        semester,
        subjectRecords,
        summary,
        classStats,
        schoolLogo: getSchoolLogo(),
        student: { ...student, photoDataUrl: getStudentPhoto(student) },
        sequences,
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
      await page.close();

      const safeName = student.fullName.replace(/\s+/g, '-');
      const fileName = `${safeName}-${student.matricule}.pdf`;

      archive.append(pdfBuffer, { name: fileName });
    }

    await browser.close();
    await archive.finalize();
  } catch (error) {
    console.error('Download all error:', error);
    res.status(500).json({ error: 'Failed to generate report cards' });
  }
});

module.exports = router;
