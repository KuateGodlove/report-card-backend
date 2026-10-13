const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    const existingAdmin = await prisma.teacher.findFirst({ where: { role: 'ADMIN' } });
    if (!existingAdmin) {
      throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set before the first database seed.');
    }
    console.log('Administrator already exists; skipping administrator seed.');
    return;
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.teacher.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      fullName: 'System Administrator',
      email: adminEmail,
      passwordHash: hashedPassword,
      role: 'ADMIN',
    },
  });

  const academicYear = await prisma.academicYear.upsert({
    where: { id: 'seed-year-2026' },
    update: {},
    create: {
      id: 'seed-year-2026',
      name: '2025/2026',
      isActive: true,
    },
  });

  console.log(`Admin account ready: ${admin.email}`);
  console.log('Academic year:', academicYear);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
