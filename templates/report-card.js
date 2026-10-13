function generateReportCardHTML(data) {
  const { student, classInfo, semester, subjectRecords, summary, classStats, schoolName, schoolLogo, sequences = [] } = data;

  const displaySchoolName = schoolName || 'MAISON DOLA INTERNATIONAL<br/>BILINGUAL SCHOOL';

  const logoMarkup = schoolLogo
    ? `<img class="school-logo" src="${schoolLogo}" alt="MAISON DOLA logo" />`
    : '<div class="logo-circle">SCHOOL<br/>SEAL</div>';
  const displaySemesterName = semester && semester.name === 'Semester 1' ? 'First Semester Exam' : (semester ? semester.name : '');
  const densityClass = subjectRecords.length > 18 ? ' ultra-compact' : subjectRecords.length > 12 ? ' compact' : '';

  const subjectRows = subjectRecords
    .map((r) => {
      const mainRow = `
    <tr>
      <td class="subject-name">${r.subject.name}</td>
      ${(r.sequenceMarks || []).map((mark) => `<td class="center">${mark.score === null ? '-' : parseFloat(mark.score).toFixed(2)}</td>`).join('')}
      <td class="center">${parseFloat(r.semesterAverage).toFixed(2)}</td>
      <td class="center">${r.coefficient}</td>
      <td class="center">${parseFloat(r.totalWeighted).toFixed(2)}</td>
      <td class="center grade">${r.grade}</td>
      <td class="center">${parseFloat(r.classAverageForSubject).toFixed(2)}</td>
      <td class="center">${parseFloat(r.classMin).toFixed(2)} / ${parseFloat(r.classMax).toFixed(2)}</td>
      <td class="remarks-inline">${r.appreciation || '-'}</td>
    </tr>
  `;

      return mainRow;
    })
    .join('');

  const totalCoefficients = subjectRecords.reduce((sum, r) => sum + parseFloat(r.coefficient), 0);
  const totalWeighted = subjectRecords.reduce((sum, r) => sum + parseFloat(r.totalWeighted), 0);

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Helvetica', Arial, sans-serif;
        color: #1a1a1a;
        padding: 10mm 12mm;
        font-size: 9.5px;
        page-break-after: avoid;
      }
      @page {
        size: A4 portrait;
        margin: 0;
      }
      body.compact { font-size: 8.5px; }
      body.ultra-compact { font-size: 7.5px; }
      body.compact .header, body.ultra-compact .header { margin-bottom: 6px; gap: 6px; }
      body.compact .section-title, body.ultra-compact .section-title { margin-top: 6px; margin-bottom: 4px; }
      body.compact .info-table td, body.ultra-compact .info-table td { padding: 3px 5px; }
      body.compact table.results th, body.compact table.results td { padding: 3px 4px; font-size: 8px; }
      body.ultra-compact table.results th, body.ultra-compact table.results td { padding: 2px 3px; font-size: 7px; }
      body.compact .summary-grid, body.ultra-compact .summary-grid { margin-top: 6px; gap: 6px; }
      body.compact .info-row-line, body.ultra-compact .info-row-line { padding: 3px 6px; font-size: 7.5px; }
      body.compact .stats-grid, body.ultra-compact .stats-grid { gap: 4px; margin-top: 4px; }
      body.compact .stat-card, body.ultra-compact .stat-card { padding: 3px; }
      body.compact .signatures, body.ultra-compact .signatures { margin-top: 10px; }
      body.compact .signature-line .line, body.ultra-compact .signature-line .line { padding-top: 10px; }
      body.compact .footer-bar, body.ultra-compact .footer-bar { margin-top: 8px; padding: 4px; }
      body.compact .remarks-box, body.ultra-compact .remarks-box { padding: 5px 8px; margin-top: 5px; }
      body.compact .meta-row, body.ultra-compact .meta-row { margin-top: 5px; }
      tr, .summary-grid, .stats-grid, .signatures, .remarks-box { page-break-inside: avoid; }
      .bilingual-block { line-height: 1.15; }
      .bilingual-block .country { font-size: 9px; font-weight: bold; text-transform: uppercase; }
      .bilingual-block .motto { font-size: 8px; font-style: italic; }
      .bilingual-block .ministry { font-size: 7px; margin-top: 3px; }
      .header-center .school-logo { width: 48px; height: 48px; margin-bottom: 2px; }
      .header-center .school-name { font-size: 15px; }
      .header-center .school-motto { font-size: 7px; margin-top: 2px; }
      .header-center .report-title { font-size: 8.5px; padding: 3px 12px; margin-top: 3px; }
      .header-center .report-subtitle { font-size: 8px; margin-top: 2px; }
      .header-side { width: 25%; flex-shrink: 0; text-align: center; color: #1a2b4c; }
      .header-center { width: 50%; flex: none; text-align: center; }
      .header-side.right { text-align: center; }
      .header-side .school-logo { width: 48px; height: 48px; object-fit: contain; margin-top: 4px; }
      .results { page-break-inside: auto; }
      .results thead { display: table-header-group; }
      .results tbody tr { page-break-inside: avoid; }

      /* Header */
      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 14px;
      }
      .logo-circle {
        width: 90px;
        height: 90px;
        border-radius: 50%;
        border: 2px solid #1a2b4c;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        text-align: center;
        font-size: 10px;
        color: #1a2b4c;
        font-weight: bold;
        line-height: 1.2;
        padding: 4px;
      }
      .school-logo {
        width: 48px;
        height: 48px;
        object-fit: contain;
        flex-shrink: 0;
      }

      .right-header { display:flex; flex-direction:column; align-items:center; gap:6px; min-width:120px }
      .ministry-block { display:flex; align-items:center; gap:8px; font-size:10px; color:#1a2b4c; font-weight:bold }
      .ministry-text { font-size:10px; text-align:center }
      .emblem { font-size:20px }
      .school-name {
        font-size: 17px;
        font-weight: bold;
        color: #1a2b4c;
        letter-spacing: 0.3px;
        line-height: 1.1;
      }
      .school-name .line1 { display: block; font-size: 17px }
      .school-name .line2 { display: block; font-size: 15px }
      .header-center { flex: none; width: 50%; text-align: center; }
      .header-right {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        min-width: 140px;
      }
      .school-name {
        font-size: 17px;
        font-weight: bold;
        color: #1a2b4c;
        letter-spacing: 0.3px;
      }
      .school-motto {
        margin-top: 3px;
        font-size: 8.5px;
        font-weight: bold;
        color: #1a2b4c;
        letter-spacing: 0.8px;
        text-transform: uppercase;
      }
      .header-spacer {
        width: 62px;
        flex-shrink: 0;
      }
      .report-title {
        display: inline-block;
        background: #1a2b4c;
        color: white;
        padding: 4px 18px;
        border-radius: 4px;
        font-size: 10.5px;
        font-weight: bold;
        margin-top: 6px;
        letter-spacing: 0.5px;
      }
      .report-subtitle {
        font-size: 12px;
        color: #555;
        margin-top: 4px;
      }

      /* Info table */
      .info-section {
        display: flex;
        gap: 14px;
        margin-bottom: 14px;
      }
      .info-table {
        flex: 1;
        border-collapse: collapse;
      }
      .info-table td {
        padding: 6px 10px;
        font-size: 10.5px;
      }
      .info-label {
        color: #666;
        font-size: 8.5px;
        display: block;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      .info-value {
        font-weight: bold;
        color: #1a1a1a;
      }
      .photo-box {
        width: 100px;
        height: 100px;
        border: 1px solid #999;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        font-size: 8.5px;
        color: #999;
        background: #fafafa;
      }
      .photo-box img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      /* Section titles */
      .section-title {
        color: #1a2b4c;
        font-size: 11.5px;
        font-weight: bold;
        margin: 14px 0 8px 0;
        letter-spacing: 0.3px;
      }

      /* Results table */
      table.results {
        width: 100%;
        border-collapse: collapse;
      }
      table.results th {
        background: #1a2b4c;
        color: white;
        padding: 6px;
        font-size: 9.5px;
        text-align: left;
      }
      table.results td {
        padding: 6px;
        border-bottom: 1px solid #eee;
        font-size: 10px;
      }
      .center { text-align: center; }
      .subject-name { font-weight: bold; color: #1a2b4c; }
      .grade { font-weight: bold; }
      .totals-row td {
        font-weight: bold;
        border-top: 2px solid #1a2b4c;
        background: #f2f2f2;
        font-size: 10.5px;
      }
      .grade-legend {
        font-size: 8.5px;
        color: #777;
        margin-top: 6px;
      }

      /* Summary */
      .summary-grid {
        display: flex;
        gap: 14px;
        margin-top: 14px;
      }
      .summary-left, .summary-right {
        flex: 1;
      }
      .summary-box {
        background: #1a2b4c;
        color: white;
        border-radius: 6px;
        padding: 10px 14px;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .summary-box .label {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        opacity: 0.85;
      }
      .summary-box .value {
        font-size: 15px;
        font-weight: bold;
      }
      .honor-badge {
        display: inline-block;
        background: #A6803C;
        color: white;
        font-size: 8px;
        font-weight: bold;
        padding: 2px 8px;
        border-radius: 3px;
        margin-left: 8px;
        letter-spacing: 0.3px;
      }
      .info-row-line {
        display: flex;
        justify-content: space-between;
        border: 1px solid #ddd;
        border-top: none;
        padding: 7px 12px;
        font-size: 10px;
      }
      .info-row-line:first-of-type {
        border-top: 1px solid #ddd;
      }
      .info-row-line .rlabel {
        color: #666;
      }
      .info-row-line .rvalue {
        font-weight: bold;
        color: #1a1a1a;
      }

      /* Class stats */
      .stats-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }
      .stat-card {
        flex: 1;
        min-width: 90px;
        border: 1px solid #e2e2e2;
        border-radius: 5px;
        padding: 7px;
        text-align: center;
        background: #fafafa;
      }
      .stat-card .label {
        font-size: 7.5px;
        color: #999;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      .stat-card .value {
        font-size: 12.5px;
        font-weight: bold;
        color: #1a2b4c;
        margin-top: 2px;
      }

      /* Remarks + meta */
      .meta-row {
        display: flex;
        justify-content: space-between;
        margin-top: 12px;
        font-size: 10px;
        color: #444;
      }
      .remarks-box {
        border: 1px solid #ccc;
        border-radius: 5px;
        padding: 10px 14px;
        margin-top: 10px;
      }
      .remarks-title {
        font-size: 8.5px;
        font-weight: bold;
        color: #1a2b4c;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        margin-bottom: 5px;
      }
      .remarks-text {
        font-size: 10px;
        line-height: 1.5;
        color: #333;
      }
      .remark-row td {
        padding-top: 0;
        padding-bottom: 6px;
      }
      .remarks-inline {
        font-size: 10px;
        color: #1a1a1a;
        font-weight: 600;
      }

      /* Signatures */
      .signatures {
        display: flex;
        justify-content: space-between;
        margin-top: 36px;
      }
      .signature-line {
        text-align: center;
        font-size: 8.5px;
        color: #444;
        width: 30%;
      }
      .signature-line .line {
        border-top: 1px solid #333;
        margin-bottom: 5px;
        padding-top: 22px;
      }

      /* Footer bar */
      .footer-bar {
        margin-top: 20px;
        background: #1a2b4c;
        color: white;
        text-align: center;
        font-size: 8px;
        padding: 8px;
        border-radius: 4px;
      }
    </style>
  </head>
  <body class="${densityClass.trim()}">
    <div class="header">
      <div class="header-side bilingual-block">
        <div class="country">République du Cameroun</div>
        <div class="motto">Paix — Travail — Patrie</div>
        <div class="ministry">Ministère de l'Éducation Secondaire</div>
      </div>
      <div class="header-center">
        ${logoMarkup}
        <div class="school-name">${displaySchoolName}</div>
        <div class="school-motto">Discipline · Travail · Succès</div>
        <div class="report-title">REPORT CARD</div>
        <div class="report-subtitle">${displaySemesterName} — Academic Year</div>
      </div>
      <div class="header-side right bilingual-block">
        <div class="country">Republic of Cameroon</div>
        <div class="motto">Peace — Work — Fatherland</div>
        <div class="ministry">Ministry of Secondary Education</div>
      </div>
    </div>

    <div class="info-section">
      <table class="info-table">
        <tr>
          <td><span class="info-label">Student</span><span class="info-value">${student.fullName}</span></td>
          <td><span class="info-label">Admission No.</span><span class="info-value">${student.matricule}</span></td>
          <td><span class="info-label">Class</span><span class="info-value">${classInfo.name}</span></td>
        </tr>
        <tr>
          <td><span class="info-label">Gender</span><span class="info-value">${student.gender}</span></td>
          <td><span class="info-label">Date of Birth</span><span class="info-value">${new Date(student.dateOfBirth).toLocaleDateString()}</span></td>
          <td><span class="info-label">Place of Birth</span><span class="info-value">${student.placeOfBirth || '-'}</span></td>
        </tr>
        <tr>
          <td><span class="info-label">Class Size</span><span class="info-value">${summary.classSize || '-'} students</span></td>
          <td><span class="info-label">Repeater</span><span class="info-value">${student.repeater ? 'Yes' : 'No'}</span></td>
          <td><span class="info-label">Regime</span><span class="info-value">${student.regime || '-'}</span></td>
        </tr>
      </table>
      <div class="photo-box">${student.photoDataUrl ? `<img src="${student.photoDataUrl}" alt="Student photo" />` : '4x4<br/>Photo'}</div>
    </div>

    <div class="section-title">ACADEMIC RESULTS — ${displaySemesterName}</div>
    <table class="results">
      <thead>
        <tr>
          <th>Subject</th>
          ${sequences.map((sequence) => `<th class="center">${sequence.name}</th>`).join('')}
          <th class="center">Avg/20</th>
          <th class="center">Coef.</th>
          <th class="center">Total</th>
          <th class="center">Grade</th>
          <th class="center">Class Avg</th>
          <th class="center">Min/Max</th>
          <th>Remark</th>
        </tr>
      </thead>
      <tbody>
        ${subjectRows}
        <tr class="totals-row">
          <td>TOTALS</td>
          <td colspan="${sequences.length}"></td>
          <td class="center">${totalCoefficients}</td>
          <td class="center">${totalWeighted.toFixed(2)}</td>
          <td colspan="4" style="text-align:right;">Overall Average: ${parseFloat(summary.moyenneGenerale).toFixed(2)} / 20</td>
        </tr>
      </tbody>
    </table>
    <div class="grade-legend">A = 16-20 Excellent &nbsp;|&nbsp; B = 12-15.9 Good &nbsp;|&nbsp; C = 10-11.9 Fair &nbsp;|&nbsp; D &lt; 10 Weak</div>

    <div class="summary-grid">
      <div class="summary-left">
        <div class="summary-box">
          <span class="label">Overall Average</span>
          <span class="value">${parseFloat(summary.moyenneGenerale).toFixed(2)} / 20</span>
        </div>
        <div class="info-row-line">
          <span class="rlabel">General Appreciation</span>
          <span class="rvalue">
            ${summary.appreciationGenerale || '-'}
            ${summary.honorRoll ? '<span class="honor-badge">HONOR ROLL</span>' : ''}
          </span>
        </div>
        <div class="info-row-line">
          <span class="rlabel">Class Rank</span>
          <span class="rvalue">${summary.classRank || '-'} of ${summary.classSize || '-'}</span>
        </div>
        <div class="info-row-line">
          <span class="rlabel">Previous Semester Average</span>
          <span class="rvalue">${summary.previousSemesterAverage ? parseFloat(summary.previousSemesterAverage).toFixed(2) + ' / 20' : '-'}</span>
        </div>
      </div>
      <div class="summary-right">
        <div class="info-row-line">
          <span class="rlabel">Justified Absences</span>
          <span class="rvalue">${summary.absencesJustifiees || '0'}</span>
        </div>
        <div class="info-row-line">
          <span class="rlabel">Unjustified Absences</span>
          <span class="rvalue">${summary.absencesNonJustifiees ?? '0'}</span>
        </div>
        <div class="info-row-line">
          <span class="rlabel">Lateness</span>
          <span class="rvalue">${summary.retards ?? '0'}</span>
        </div>
        <div class="info-row-line">
          <span class="rlabel">Conduct</span>
          <span class="rvalue">${summary.conduite || '-'}</span>
        </div>
        <div class="info-row-line">
          <span class="rlabel">Punctuality</span>
          <span class="rvalue">${summary.tenuePonctualite || '-'}</span>
        </div>
      </div>
    </div>

    <div class="section-title">CLASS STATISTICS — ${classInfo.name}</div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">Class Average</div>
        <div class="value">${classStats ? parseFloat(classStats.classAverage).toFixed(2) : '-'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Passed</div>
        <div class="value">${classStats ? classStats.numberAdmitted : '-'} / ${summary.classSize || '-'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Highest Avg</div>
        <div class="value">${classStats ? parseFloat(classStats.highestAverage).toFixed(2) : '-'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Lowest Avg</div>
        <div class="value">${classStats ? parseFloat(classStats.lowestAverage).toFixed(2) : '-'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Success Rate</div>
        <div class="value">${classStats ? parseFloat(classStats.successRate).toFixed(1) : '-'}%</div>
      </div>
      <div class="stat-card">
        <div class="label">Std. Deviation</div>
        <div class="value">${classStats ? parseFloat(classStats.standardDeviation).toFixed(2) : '-'}</div>
      </div>
    </div>

    <div class="meta-row">
      <span>Class Teacher: ${summary.classTeacherName || '-'}</span>
      <span>Number of Subjects: ${subjectRecords.length}</span>
    </div>

    ${summary.observationConseil ? `
    <div class="remarks-box">
      <div class="remarks-title">Class Council Observation</div>
      <div class="remarks-text">${summary.observationConseil}</div>
    </div>
    ` : ''}

    <div class="signatures">
      <div class="signature-line"><div class="line"></div>Parent / Guardian Signature</div>
      <div class="signature-line"><div class="line"></div>Principal Signature</div>
    </div>

    <div class="footer-bar">${displaySchoolName} — ${displaySemesterName} Report Card</div>
  </body>
  </html>
  `;
}

module.exports = { generateReportCardHTML };
