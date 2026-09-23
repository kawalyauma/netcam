import { ForbiddenException } from "@nestjs/common";
import { VoucherStatus } from "@netcam/shared";
import { VouchersService } from "./vouchers.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { NetworkAgentBridgeService } from "../network-agent-bridge/network-agent-bridge.service";

type MockDevice = { id: string; macAddress: string; isBlocked: boolean };

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
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
    },
    session: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;

  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const networkAgent = {
    admit: jest.fn().mockResolvedValue(undefined),
    revoke: jest.fn().mockResolvedValue(undefined),
  } as unknown as NetworkAgentBridgeService;

  return { service: new VouchersService(prisma, audit, networkAgent), prisma, audit, networkAgent };
}

describe("VouchersService.redeem — device-limit enforcement (anti phone-sharing)", () => {
  const NEW_MAC = "BB:BB:BB:BB:BB:BB";
  const EXISTING_MAC = "AA:AA:AA:AA:AA:AA";

  it("rejects a new device once the voucher's device limit is reached", async () => {
    const voucher = makeVoucher({
      devices: [{ id: "d1", macAddress: EXISTING_MAC, isBlocked: false }],
      package: { ...makeVoucher().package, deviceLimit: 1 },
    });
    const { service } = makeService(voucher);

    await expect(service.redeem({ voucherCode: voucher.code, macAddress: NEW_MAC })).rejects.toThrow(ForbiddenException);
  });

  it("allows a device that's already registered on the voucher to reconnect, even at the cap", async () => {
    const voucher = makeVoucher({
      devices: [{ id: "d1", macAddress: EXISTING_MAC, isBlocked: false }],
      package: { ...makeVoucher().package, deviceLimit: 1 },
    });
    const { service, prisma } = makeService(voucher);

    const result = await service.redeem({ voucherCode: voucher.code, macAddress: EXISTING_MAC });

    expect(result.ok).toBe(true);
    expect(prisma.device.create).not.toHaveBeenCalled();
    expect(prisma.device.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "d1" } }));
  });

  it("rejects a blocked device even though it's already registered on the voucher", async () => {
    const voucher = makeVoucher({ devices: [{ id: "d1", macAddress: EXISTING_MAC, isBlocked: true }] });
    const { service } = makeService(voucher);

    await expect(service.redeem({ voucherCode: voucher.code, macAddress: EXISTING_MAC })).rejects.toThrow(
      /blocked/i,
    );
  });

  it("does not count a blocked device against the device limit, freeing a slot for a new one", async () => {
    const voucher = makeVoucher({
      devices: [{ id: "d1", macAddress: EXISTING_MAC, isBlocked: true }],
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
