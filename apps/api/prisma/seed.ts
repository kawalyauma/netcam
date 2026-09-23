import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@netcam.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await prisma.adminUser.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      role: "SUPER_ADMIN",
      fullName: "Default Admin",
    },
  });
  console.log(`Seeded admin: ${adminEmail} (change the password after first login!)`);

  const packages = [
    { name: "30 Minutes", priceUgx: 500, limitType: "DURATION" as const, durationMinutes: 30, downKbps: 2048, upKbps: 1024, deviceLimit: 1 },
    { name: "1 Hour", priceUgx: 1000, limitType: "DURATION" as const, durationMinutes: 60, downKbps: 4096, upKbps: 2048, deviceLimit: 1 },
    { name: "24 Hours", priceUgx: 3000, limitType: "DURATION" as const, durationMinutes: 1440, downKbps: 4096, upKbps: 2048, deviceLimit: 2 },
    { name: "1GB Data", priceUgx: 2000, limitType: "DATA_CAP" as const, dataCapMb: 1024, downKbps: 8192, upKbps: 4096, deviceLimit: 1 },
    { name: "Weekly Unlimited", priceUgx: 15000, limitType: "DURATION" as const, durationMinutes: 10080, downKbps: 8192, upKbps: 4096, deviceLimit: 3 },
  ];

  for (const pkg of packages) {
    const existing = await prisma.package.findFirst({ where: { name: pkg.name } });
    if (!existing) {
      await prisma.package.create({ data: pkg });
    }
  }
  console.log(`Seeded ${packages.length} sample packages.`);

  const existingChannel = await prisma.outputChannel.findFirst();
  if (!existingChannel) {
    await prisma.outputChannel.create({
      data: { name: "Primary LAN (eth0)", interfaceName: "eth0", type: "ETHERNET", isActive: true },
    });
    console.log("Seeded a default output channel for eth0 — rename/replace to match your hardware.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
