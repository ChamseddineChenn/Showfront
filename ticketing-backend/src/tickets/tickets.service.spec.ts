import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { Types } from 'mongoose';
import { TicketsService } from './tickets.service';
import { TicketStatus } from './ticket.schema';

// Minimal stand-in for a Mongoose query: chainable populate/lean, async exec.
const query = <T>(run: () => Promise<T>) => {
  const q: any = {
    populate: () => q,
    lean: () => q,
    exec: run,
  };
  return q;
};

// Yield to the event loop so concurrent requests interleave like real I/O.
const io = () => new Promise((resolve) => setImmediate(resolve));

/**
 * In-memory ticket collection. findOneAndUpdate applies its filter and update
 * in one step, which is the guarantee MongoDB gives for a single-document
 * conditional update.
 */
function createTicketModel(tickets: any[]) {
  const store = new Map(tickets.map((t) => [t._id.toString(), t]));
  const matches = (t: any, filter: any) =>
    Object.entries(filter).every(([key, value]) =>
      key === '_id'
        ? t._id.toString() === (value as Types.ObjectId | string).toString()
        : t[key] === value,
    );
  const find = (filter: any) =>
    [...store.values()].find((t) => matches(t, filter)) ?? null;

  return {
    store,
    findOne: jest.fn((filter: any) =>
      query(async () => {
        await io();
        const t = find(filter);
        return t ? { ...t } : null;
      }),
    ),
    findById: jest.fn((id: string) =>
      query(async () => {
        await io();
        const t = store.get(String(id));
        return t ? { ...t } : null;
      }),
    ),
    find: jest.fn((filter: any) =>
      query(async () =>
        [...store.values()].filter(
          (t) => t.paymentId?.toString() === filter.paymentId?.toString(),
        ),
      ),
    ),
    findOneAndUpdate: jest.fn((filter: any, update: any) =>
      query(async () => {
        await io();
        const t = find(filter);
        if (!t) return null;
        Object.assign(t, update.$set);
        return { ...t };
      }),
    ),
    findByIdAndUpdate: jest.fn(),
    exists: jest.fn(async (filter: any) => (find(filter) ? { _id: 1 } : null)),
  };
}

describe('TicketsService', () => {
  const ownerId = new Types.ObjectId().toString();
  const paymentId = new Types.ObjectId();
  const owner = { userId: ownerId, email: 'o@x.test', userType: 'User' };
  const stranger = {
    userId: new Types.ObjectId().toString(),
    email: 's@x.test',
    userType: 'User',
  };
  const organizer = {
    userId: new Types.ObjectId().toString(),
    email: 'org@x.test',
    userType: 'Organizer',
  };
  const admin = {
    userId: new Types.ObjectId().toString(),
    email: 'a@x.test',
    userType: 'Admin',
  };

  let service: TicketsService;
  let ticketModel: ReturnType<typeof createTicketModel>;
  let paymentModel: { exists: jest.Mock };
  let ticket: any;
  let encryptedToken: string;

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    process.env.QR_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

    // Payment ids are Mixed paths: stored as ObjectIds, never cast from strings
    paymentModel = {
      exists: jest.fn(async (filter: any) =>
        filter._id instanceof Types.ObjectId &&
        filter._id.equals(paymentId) &&
        filter.userId instanceof Types.ObjectId &&
        filter.userId.equals(ownerId)
          ? { _id: paymentId }
          : null,
      ),
    };

    // Build with an empty store first so we can use the service's own QR
    // token generation for the fixture.
    ticketModel = createTicketModel([]);
    service = new TicketsService(
      ticketModel as any,
      paymentModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const qr = (service as any).generateQrToken();
    encryptedToken = qr.encryptedToken;
    ticket = {
      _id: new Types.ObjectId(),
      paymentId,
      ticketNumber: 'TKTEST0001',
      qrToken: qr.token,
      status: TicketStatus.VALID,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      metadata: { userId: ownerId },
    };
    ticketModel.store.set(ticket._id.toString(), ticket);
  });

  describe('atomic redemption', () => {
    it('lets exactly one of two concurrent ticket-number validations succeed', async () => {
      const results = await Promise.all([
        service.validateTicketByNumber('TKTEST0001'),
        service.validateTicketByNumber('TKTEST0001'),
      ]);

      expect(results.filter((r) => r.success)).toHaveLength(1);
      expect(results.filter((r) => !r.success)).toHaveLength(1);
      expect(results.find((r) => !r.success).message).toMatch(
        /already been used/,
      );
      expect(ticketModel.store.get(ticket._id.toString()).status).toBe(
        TicketStatus.USED,
      );
      // Both requests read the ticket while it was still valid
      expect(ticketModel.findOne).toHaveBeenCalledTimes(2);
      expect(ticketModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('lets exactly one of two concurrent QR validations succeed', async () => {
      const results = await Promise.all([
        service.validateByQRToken(encryptedToken),
        service.validateByQRToken(encryptedToken),
      ]);

      expect(results.filter((r) => r.success)).toHaveLength(1);
      expect(ticketModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ticket._id, status: TicketStatus.VALID },
        expect.objectContaining({
          $set: expect.objectContaining({ status: TicketStatus.USED }),
        }),
        { new: true },
      );
    });

    it('lets exactly one succeed when a QR scan and a manual entry race', async () => {
      const results = await Promise.all([
        service.validateByQRToken(encryptedToken),
        service.validateTicketByNumber('TKTEST0001'),
      ]);

      expect(results.filter((r) => r.success)).toHaveLength(1);
    });

    it('rejects a later validation of an already used ticket', async () => {
      await service.validateTicketByNumber('TKTEST0001');
      const second = await service.validateByQRToken(encryptedToken);

      expect(second.success).toBe(false);
      expect(second.message).toMatch(/already been used/);
    });

    it('makes concurrent staff mark-used calls conflict instead of double-redeeming', async () => {
      const results = await Promise.allSettled([
        service.markAsUsed(ticket._id.toString()),
        service.markAsUsed(ticket._id.toString()),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected.reason).toBeInstanceOf(ConflictException);
    });

    it('returns 404 when marking a missing ticket as used', async () => {
      await expect(
        service.markAsUsed(new Types.ObjectId().toString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('still rejects a forged QR token', async () => {
      const result = await service.validateByQRToken('00:11:22');
      expect(result.success).toBe(false);
      expect(ticketModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('ticket lookups - ownership', () => {
    it('returns a ticket to the user who paid for it', async () => {
      const found = await service.findByIdForUser(ticket._id.toString(), owner);
      expect(found.ticketNumber).toBe('TKTEST0001');
    });

    it.each([
      ['an organizer', organizer],
      ['an admin', admin],
    ])('returns any ticket to %s', async (_label, user) => {
      const found = await service.findByIdForUser(ticket._id.toString(), user);
      expect(found.ticketNumber).toBe('TKTEST0001');
    });

    it("hides another user's ticket behind the same 404 as a missing ticket", async () => {
      const notOwned = service.findByIdForUser(ticket._id.toString(), stranger);
      const missing = service.findByIdForUser(
        new Types.ObjectId().toString(),
        stranger,
      );

      await expect(notOwned).rejects.toBeInstanceOf(NotFoundException);
      await expect(missing).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 rather than a server error for malformed ids', async () => {
      await expect(
        service.findByIdForUser('not-an-id', owner),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.findByPaymentIdForUser('not-an-id', owner),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists tickets for a payment only after verifying payment ownership', async () => {
      await expect(
        service.findByPaymentIdForUser(paymentId.toString(), owner),
      ).resolves.toHaveLength(1);
      expect(paymentModel.exists).toHaveBeenCalledWith({
        _id: paymentId,
        userId: new Types.ObjectId(ownerId),
      });

      await expect(
        service.findByPaymentIdForUser(paymentId.toString(), stranger),
      ).rejects.toThrow(new NotFoundException('Payment not found'));
      await expect(
        service.findByPaymentIdForUser(
          new Types.ObjectId().toString(),
          stranger,
        ),
      ).rejects.toThrow(new NotFoundException('Payment not found'));
    });

    it('lets staff list tickets for any payment', async () => {
      await expect(
        service.findByPaymentIdForUser(paymentId.toString(), admin),
      ).resolves.toHaveLength(1);
    });
  });
});
