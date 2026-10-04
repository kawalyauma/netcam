-- Management IP used to probe chained routers (repeaters/APs behind the root
-- router share its flat LAN, so the network-agent can't heartbeat them).
ALTER TABLE "Router" ADD COLUMN "ipAddress" TEXT;
