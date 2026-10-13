const path = require('path');

// In production this should be a mounted persistent volume (for example,
// /app/uploads on Railway). Keeping the old path as the local default avoids
// breaking existing development photos.
const uploadsDirectory = path.resolve(
  process.env.UPLOADS_DIR || path.join(__dirname, '..', 'assets', 'student-photos')
);

module.exports = { uploadsDirectory };
