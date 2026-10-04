import { ForbiddenException } from "@nestjs/common";
import { VoucherStatus } from "@netcam/shared";
import { VouchersService } from "./vouchers.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { NetworkAgentBridgeService } from "../network-agent-bridge/network-agent-bridge.service";

type MockDevice = { id: string; macAddress: string; isBlocked: boolean; releasedAt: Date | null; lastSeenAt: Date };

function device(id: string, macAddress: string, overrides: Partial<MockDevice> = {}): MockDevice {
  return { id, macAddress, isBlocked: false, releasedAt: null, lastSeenAt: new Date(), ...overrides };
}

function makeVoucher(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "voucher-1",
    code: "AAAA-BBBB-CCCC",
    status: VoucherStatus.ACTIVE,
    expiresAt: null,
    dataUsedMb: 0,
    devices: [] as MockDevice[],
    package: {
      id: "pkg-1",
      deviceLimit: 1,
      durationMinutes: 60,
      dataCapMb: null,
      downKbps: 2048,
      upKbps: 1024,
    },
    ...overrides,
  };
}

function makeService(voucher: ReturnType<typeof makeVoucher>) {
  const prisma = {
    voucher: {
      findUnique: jest.fn().mockResolvedValue(voucher),
      update: jest.fn().mockResolvedValue(voucher),
    },
    device: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "new-device", isBlocked: false, ...data })),
      update: jest.fn().mockImplementation(({ where, data }) => Promise.resolve({ ...where, isBlocked: false, ...data })),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    session: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    payment: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaService;

  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const networkAgent = {
    admit: jest.fn().mockResolvedValue(undefined),
    revoke: jest.fn().mockResolvedValue(undefined),
    // Holders are treated as still on the network unless a test says otherwise.
    isPresent: jest.fn().mockResolvedValue(true),
  } as unknown as NetworkAgentBridgeService;

  return { service: new VouchersService(prisma, audit, networkAgent), prisma, audit, networkAgent };
}

describe("VouchersService.redeem — device-limit enforcement (anti phone-sharing)", () => {
  const NEW_MAC = "BB:BB:BB:BB:BB:BB";
  const EXISTING_MAC = "AA:AA:AA:AA:AA:AA";

  it("rejects a new device once the voucher's device limit is reached", async () => {
    const voucher = makeVoucher({
      devices: [device("d1", EXISTING_MAC)],
      package: { ...makeVoucher().package, deviceLimit: 1 },
    });
    const { service } = makeService(voucher);

    await expect(service.redeem({ voucherCode: voucher.code, macAddress: NEW_MAC })).rejects.toThrow(ForbiddenException);
  });

  it("hands the slot to a new device when the current one has been idle long enough (MAC changed)", async () => {
    const idleSince = new Date(Date.now() - 30 * 60_000);
    const voucher = makeVoucher({
      devices: [device("d1", EXISTING_MAC, { lastSeenAt: idleSince })],
      package: { ...makeVoucher().package, deviceLimit: 1 },
    });
    const { service, prisma, networkAgent } = makeService(voucher);

    const result = await service.redeem({ voucherCode: voucher.code, macAddress: NEW_MAC });

    expect(result.ok).toBe(true);
    expect(prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d1" }, data: expect.objectContaining({ releasedAt: expect.any(Date) }) }),
    );
    expect(networkAgent.revoke).toHaveBeenCalledWith(expect.objectContaining({ macAddress: EXISTING_MAC }));
    expect(prisma.device.create).toHaveBeenCalled();
  });

  it("hands over at once when the recently-active holder has left the network (phone got a new random MAC)", async () => {
    const voucher = makeVoucher({
      devices: [device("d1", EXISTING_MAC)],
      package: { ...makeVoucher().package, deviceLimit: 1 },
    });
    const { service, prisma, networkAgent } = makeService(voucher);
    (networkAgent.isPresent as jest.Mock).mockResolvedValue(false);

    const result = await service.redeem({ voucherCode: voucher.code, macAddress: NEW_MAC });

    expect(result.ok).toBe(true);
    expect(networkAgent.revoke).toHaveBeenCalledWith(expect.objectContaining({ macAddress: EXISTING_MAC }));
    expect(prisma.device.create).toHaveBeenCalled();
  });

  it("keeps the slot when the presence check can't run (agent unreachable)", async () => {
    const voucher = makeVoucher({
      devices: [device("d1", EXISTING_MAC)],
      package: { ...makeVoucher().package, deviceLimit: 1 },
    });
    const { service, networkAgent } = makeService(voucher);
    (networkAgent.isPresent as jest.Mock).mockResolvedValue(null);

    await expect(service.redeem({ voucherCode: voucher.code, macAddress: NEW_MAC })).rejects.toThrow(ForbiddenException);
  });

  it("lets a released device take a free slot back without creating a duplicate", async () => {
    const voucher = makeVoucher({
      devices: [device("d1", EXISTING_MAC, { releasedAt: new Date() })],
      package: { ...makeVoucher().package, deviceLimit: 1 },
    });
    const { service, prisma } = makeService(voucher);

    const result = await service.redeem({ voucherCode: voucher.code, macAddress: EXISTING_MAC });

    expect(result.ok).toBe(true);
    expect(prisma.device.create).not.toHaveBeenCalled();
    expect(prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d1" }, data: expect.objectContaining({ releasedAt: null }) }),
    );
  });

  it("allows a device that's already registered on the voucher to reconnect, even at the cap", async () => {
    const voucher = makeVoucher({
      devices: [device("d1", EXISTING_MAC)],
      package: { ...makeVoucher().package, deviceLimit: 1 },
    });
    const { service, prisma } = makeService(voucher);

    const result = await service.redeem({ voucherCode: voucher.code, macAddress: EXISTING_MAC });

    expect(result.ok).toBe(true);
    expect(prisma.device.create).not.toHaveBeenCalled();
    expect(prisma.device.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "d1" } }));
  });

  it("rejects a blocked device even though it's already registered on the voucher", async () => {
    const voucher = makeVoucher({ devices: [device("d1", EXISTING_MAC, { isBlocked: true })] });
    const { service } = makeService(voucher);

    await expect(service.redeem({ voucherCode: voucher.code, macAddress: EXISTING_MAC })).rejects.toThrow(
      /blocked/i,
    );
  });

  it("does not count a blocked device against the device limit, freeing a slot for a new one", async () => {
    const voucher = makeVoucher({
      devices: [device("d1", EXISTING_MAC, { isBlocked: true })],
      package: { ...makeVoucher().package, deviceLimit: 1 },
    });
    const { service, prisma } = makeService(voucher);

    const result = await service.redeem({ voucherCode: voucher.code, macAddress: NEW_MAC });

    expect(result.ok).toBe(true);
    expect(prisma.device.create).toHaveBeenCalled();
  });

  it("rejects redemption on a suspended voucher", async () => {
    const voucher = makeVoucher({ status: VoucherStatus.SUSPENDED });
    const { service } = makeService(voucher);

    await expect(service.redeem({ voucherCode: voucher.code, macAddress: NEW_MAC })).rejects.toThrow(/suspended/i);
  });

  it("rejects redemption on an expired or depleted voucher", async () => {
    const voucher = makeVoucher({ status: VoucherStatus.EXPIRED });
    const { service } = makeService(voucher);

    await expect(service.redeem({ voucherCode: voucher.code, macAddress: NEW_MAC })).rejects.toThrow(ForbiddenException);
  });

  it("activates an UNUSED voucher on first redemption and computes expiry from the package duration", async () => {
    const voucher = makeVoucher({ status: VoucherStatus.UNUSED, expiresAt: null });
    const { service, prisma, networkAgent } = makeService(voucher);

    const before = Date.now();
    const result = await service.redeem({ voucherCode: voucher.code, macAddress: NEW_MAC });
    const after = Date.now();

    expect(result.ok).toBe(true);
    expect(prisma.voucher.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: VoucherStatus.ACTIVE }),
      }),
    );
    const updateCall = (prisma.voucher.update as jest.Mock).mock.calls[0][0];
    const expiresAt = updateCall.data.expiresAt.getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 60 * 60_000 - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 60 * 60_000 + 1000);

    expect(networkAgent.admit).toHaveBeenCalledWith(
      expect.objectContaining({ macAddress: NEW_MAC, downKbps: 2048, upKbps: 1024 }),
    );
  });
});

describe("VouchersService.autoLogin — logging entitled devices back in without a code", () => {
  const MAC = "AA:AA:AA:AA:AA:AA";

  it("re-admits a device on a still-valid voucher (e.g. after a reboot) and reopens its session", async () => {
    const voucher = makeVoucher({ expiresAt: new Date(Date.now() + 60 * 60_000) });
    const { service, prisma, networkAgent } = makeService(voucher);
    (prisma.device.findMany as jest.Mock).mockResolvedValue([{ ...device("d1", MAC), voucher }]);

    const result = await service.autoLogin({ macAddress: MAC.toLowerCase(), ipAddress: "10.50.10.20", routerId: "router-1" });

    expect(result).toEqual(expect.objectContaining({ authorized: true, voucherCode: voucher.code }));
    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deviceId: "d1", routerId: "router-1" }) }),
    );
    expect(networkAgent.admit).toHaveBeenCalledWith(expect.objectContaining({ macAddress: MAC, routerId: "router-1" }));
  });

  it("keeps an already-open session instead of stacking a new one", async () => {
    const voucher = makeVoucher();
    const { service, prisma } = makeService(voucher);
    (prisma.device.findMany as jest.Mock).mockResolvedValue([{ ...device("d1", MAC), voucher }]);
    (prisma.session.findFirst as jest.Mock).mockResolvedValue({ id: "s1", routerId: "router-1", ipAddress: "10.50.10.20" });

    await service.autoLogin({ macAddress: MAC, ipAddress: "10.50.10.20", routerId: "router-1" });

    expect(prisma.session.create).not.toHaveBeenCalled();
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it("skips a voucher whose data allowance is used up", async () => {
    const voucher = makeVoucher({ dataUsedMb: 1024, package: { ...makeVoucher().package, dataCapMb: 1024 } });
    const { service, prisma, networkAgent } = makeService(voucher);
    (prisma.device.findMany as jest.Mock).mockResolvedValue([{ ...device("d1", MAC), voucher }]);

    const result = await service.autoLogin({ macAddress: MAC });

    expect(result.authorized).toBe(false);
    expect(networkAgent.admit).not.toHaveBeenCalled();
  });

  it("redeems a voucher this device paid for but never redeemed (portal closed mid-payment)", async () => {
    const voucher = makeVoucher({ status: VoucherStatus.UNUSED });
    const { service, prisma, networkAgent } = makeService(voucher);
    (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ routerId: "router-1", voucher });

    const result = await service.autoLogin({ macAddress: MAC });

    expect(result).toEqual(expect.objectContaining({ authorized: true, voucherCode: voucher.code }));
    expect(networkAgent.admit).toHaveBeenCalledWith(expect.objectContaining({ macAddress: MAC, routerId: "router-1" }));
  });

  describe("same device, new random MAC", () => {
    const NEW = "5A:B7:11:7E:C5:EE";
    const tablet = (voucher: ReturnType<typeof makeVoucher>) => ({
      ...device("d1", MAC, { lastSeenAt: new Date(Date.now() - 60_000) }),
      hostname: "Galaxy-Tab-A7-Lite",
      voucherId: voucher.id,
      voucher,
      sessions: [{ ipAddress: "10.50.10.122", routerId: "router-1" }],
    });

    it("moves the login to the new MAC when the old one has left the network", async () => {
      const voucher = makeVoucher({ devices: [device("d1", MAC, { lastSeenAt: new Date(Date.now() - 60_000) })] });
      const { service, prisma, networkAgent, audit } = makeService(voucher);
      (prisma.device.findMany as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([tablet(voucher)]);
      (networkAgent.isPresent as jest.Mock).mockResolvedValue(false);

      const result = await service.autoLogin({ macAddress: NEW, ipAddress: "10.50.10.12", hostname: "Galaxy-Tab-A7-Lite" });

      expect(result).toEqual(expect.objectContaining({ authorized: true, voucherCode: voucher.code }));
      expect(networkAgent.isPresent).toHaveBeenCalledWith(MAC, "10.50.10.122");
      expect(networkAgent.revoke).toHaveBeenCalledWith(expect.objectContaining({ macAddress: MAC }));
      expect(networkAgent.admit).toHaveBeenCalledWith(expect.objectContaining({ macAddress: NEW, routerId: "router-1" }));
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "DEVICE_MAC_HANDOVER" }));
    });

    it("does not take over a device with the same name that is still online", async () => {
      const voucher = makeVoucher();
      const { service, prisma, networkAgent } = makeService(voucher);
      (prisma.device.findMany as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([tablet(voucher)]);
      (networkAgent.isPresent as jest.Mock).mockResolvedValue(true);

      const result = await service.autoLogin({ macAddress: NEW, hostname: "Galaxy-Tab-A7-Lite" });

      expect(result).toEqual({ authorized: false });
      expect(networkAgent.revoke).not.toHaveBeenCalled();
    });

    it("ignores generic device names", async () => {
      const { service, prisma } = makeService(makeVoucher());

      await service.autoLogin({ macAddress: NEW, hostname: "iPhone" });

      expect(prisma.device.findMany).toHaveBeenCalledTimes(1); // only the by-MAC lookup
    });
  });

  it("does nothing for a device that has no entitlement", async () => {
    const { service, networkAgent } = makeService(makeVoucher());

    const result = await service.autoLogin({ macAddress: MAC });

    expect(result).toEqual({ authorized: false });
    expect(networkAgent.admit).not.toHaveBeenCalled();
  });
});

describe("VouchersService.setDeviceBlocked — per-device kill switch", () => {
  it("revokes network access via network-agent when blocking a device", async () => {
    const voucher = makeVoucher();
    const { service, prisma, networkAgent } = makeService(voucher);
    (prisma.device.findUnique as jest.Mock).mockResolvedValue({
      id: "d1",
      voucherId: voucher.id,
      macAddress: "AA:AA:AA:AA:AA:AA",
    });

    await service.setDeviceBlocked(voucher.id, "d1", true, "admin-1");

    expect(networkAgent.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ macAddress: "AA:AA:AA:AA:AA:AA" }),
    );
    expect(prisma.session.updateMany).toHaveBeenCalled();
  });

  it("does not call revoke when unblocking a device", async () => {
    const voucher = makeVoucher();
    const { service, prisma, networkAgent } = makeService(voucher);
    (prisma.device.findUnique as jest.Mock).mockResolvedValue({
      id: "d1",
      voucherId: voucher.id,
      macAddress: "AA:AA:AA:AA:AA:AA",
    });

    await service.setDeviceBlocked(voucher.id, "d1", false, "admin-1");

    expect(networkAgent.revoke).not.toHaveBeenCalled();
  });
});
