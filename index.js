require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const classRoutes = require('./routes/classes');
const subjectRoutes = require('./routes/subjects');
const teacherRoutes = require('./routes/teachers');
const studentRoutes = require('./routes/students');
const academicRoutes = require('./routes/academics');
const markRoutes = require('./routes/marks');
const reportRoutes = require('./routes/reports');
const dashboardRoutes = require('./routes/dashboard');
const portalRoutes = require('./routes/portal');
const parentRoutes = require('./routes/parents');
const { uploadsDirectory } = require('./lib/uploads');

const app = express();
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.use(cors({
  origin(origin, callback) {
    // Health checks and command-line requests generally have no Origin header.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('This origin is not allowed by CORS.'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/assets/student-photos', express.static(uploadsDirectory));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/academics', academicRoutes);
app.use('/api/marks', markRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/parents', parentRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
