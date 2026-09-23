#!/bin/sh
set -e

echo "Applying database migrations..."
npx prisma migrate deploy --schema prisma/schema.prisma

if [ "$SEED_ON_START" = "true" ]; then
  echo "Seeding database..."
  npx ts-node prisma/seed.ts || echo "Seed step failed or already applied — continuing."
fi

exec "$@"
