import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentsService } from './payments.service';
import { TicketsService } from '../tickets/tickets.service';
import { SeatUnavailableException } from '../common/exceptions/custom-exceptions';

const inOneWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

const ticketTypes = {
  Free: { enabled: true, price: 0 },
  Standard: { enabled: true, price: 50 },
  VIP: { enabled: true, price: 120 },
  EarlyBird: { enabled: false, price: 30, limit: 0 },
};

function standingEvent(overrides: any = {}) {
  return {
    _id: new Types.ObjectId(),
    name: 'Standing Gala',
    date: inOneWeek(),
    seatingLayout: { enabled: false, sections: [] },
    ticketTypes,
    earlyBirdCount: 0,
    ...overrides,
  };
}

function seatedEvent(overrides: any = {}) {
  return standingEvent({
    name: 'Seated Gala',
    seatingLayout: {
      enabled: true,
      sections: [
        {
          id: 'A',
          priceModifier: 10,
          seats: [
            { seatId: 'A1', status: 'reserving' },
            { seatId: 'A2', status: 'available' },
            { seatId: 'A3', status: 'unavailable' },
          ],
        },
      ],
    },
    ...overrides,
  });
}

class FakePaymentModel {
  static instances: FakePaymentModel[] = [];
  static findById = jest.fn();
  static findOne = jest.fn();

  _id = new Types.ObjectId();
  save = jest.fn().mockResolvedValue(this);
  [key: string]: any;

  constructor(data: any) {
    Object.assign(this, data);
    FakePaymentModel.instances.push(this);
  }
}

describe('PaymentsService', () => {
  const userId = new Types.ObjectId().toString();
  let service: PaymentsService;
  let eventsService: { findById: jest.Mock };
  let ticketsService: {
    calculatePaymentTicketPrice: (...args: any[]) => number;
    createTicketsFromPayment: jest.Mock;
    findByPaymentId: jest.Mock;
  };
  let stripeCreate: jest.Mock;

  beforeAll(() => {
    Logger.overrideLogger(false);
    process.env.STRIPE_SECRET_KEY =
      process.env.STRIPE_SECRET_KEY || 'sk_test_unit';
  });

  beforeEach(() => {
    FakePaymentModel.instances = [];
    FakePaymentModel.findById.mockReset();
    FakePaymentModel.findOne.mockReset();

    eventsService = { findById: jest.fn() };
    ticketsService = {
      // The real pricing formula, so tests exercise what production charges
      calculatePaymentTicketPrice: (...args: [any, string, any[]]) =>
        TicketsService.prototype.calculatePaymentTicketPrice.call(
          null,
          ...args,
        ),
      createTicketsFromPayment: jest.fn(),
      findByPaymentId: jest.fn(),
    };

    service = new PaymentsService(
      FakePaymentModel as any,
      ticketsService as any,
      eventsService as any,
    );

    stripeCreate = jest
      .fn()
      .mockResolvedValue({ id: 'pi_test_123', client_secret: 'cs_test' });
    (service as any).stripe = { paymentIntents: { create: stripeCreate } };
  });

  describe('createCheckoutSession - server-side amount', () => {
    it('ignores a manipulated totalAmount and charges the stored price', async () => {
      const event = standingEvent();
      eventsService.findById.mockResolvedValue(event);

      const result = await service.createCheckoutSession(userId, {
        eventId: event._id.toString(),
        ticketIds: ['auto-assigned'],
        totalAmount: 0.01,
        ticketType: 'VIP',
      } as any);

      expect(stripeCreate).toHaveBeenCalledTimes(1);
      expect(stripeCreate.mock.calls[0][0].amount).toBe(12000);
      expect(FakePaymentModel.instances[0].amount).toBe(12000);
      expect(result.amount).toBe(12000);
    });

    it('prices seated purchases with the same formula used for ticket issuance', async () => {
      const event = seatedEvent();
      eventsService.findById.mockResolvedValue(event);

      await service.createCheckoutSession(userId, {
        eventId: event._id.toString(),
        ticketIds: [
          { sectionId: 'A', seatId: 'A1' },
          { sectionId: 'A', seatId: 'A2' },
        ],
        totalAmount: 1,
        ticketType: 'Standard',
      } as any);

      // 2 x 50 base + section A modifier (10) once = 110.00
      expect(stripeCreate.mock.calls[0][0].amount).toBe(11000);
      expect(FakePaymentModel.instances[0].ticketIds).toEqual([
        { sectionId: 'A', seatId: 'A1' },
        { sectionId: 'A', seatId: 'A2' },
      ]);
    });

    it('works without totalAmount in the request', async () => {
      const event = standingEvent();
      eventsService.findById.mockResolvedValue(event);

      await service.createCheckoutSession(userId, {
        eventId: event._id.toString(),
        ticketIds: ['auto-assigned'],
        ticketType: 'Standard',
      } as any);

      expect(stripeCreate.mock.calls[0][0].amount).toBe(5000);
    });

    const invalidRequests: Array<[string, () => any, any, any]> = [
      [
        'a disabled ticket type',
        () => standingEvent(),
        ['auto-assigned'],
        'EarlyBird',
      ],
      [
        'an unknown ticket type',
        () => standingEvent(),
        ['auto-assigned'],
        'Platinum',
      ],
      [
        'a past event',
        () => standingEvent({ date: new Date('2020-01-01') }),
        ['auto-assigned'],
        'Standard',
      ],
      [
        'a free ticket type on the paid endpoint',
        () => standingEvent(),
        ['auto-assigned'],
        'Free',
      ],
      [
        'multiple auto-assigned tickets',
        () => standingEvent(),
        ['auto-assigned', 'auto-assigned'],
        'Standard',
      ],
      [
        'seat objects for an event without seating',
        () => standingEvent(),
        [{ sectionId: 'A', seatId: 'A1' }],
        'Standard',
      ],
      [
        'auto-assigned for a seated event',
        () => seatedEvent(),
        ['auto-assigned'],
        'Standard',
      ],
      [
        'a seat that does not exist',
        () => seatedEvent(),
        [{ sectionId: 'A', seatId: 'Z9' }],
        'Standard',
      ],
      [
        'a duplicated seat',
        () => seatedEvent(),
        [
          { sectionId: 'A', seatId: 'A1' },
          { sectionId: 'A', seatId: 'A1' },
        ],
        'Standard',
      ],
      [
        'more than 10 seats',
        () => seatedEvent(),
        Array.from({ length: 11 }, (_, i) => ({
          sectionId: 'A',
          seatId: `A${i}`,
        })),
        'Standard',
      ],
    ];

    it.each(invalidRequests)(
      'rejects %s with a 400 and never calls Stripe',
      async (_label, makeEvent, ticketIds, ticketType) => {
        const event = makeEvent();
        eventsService.findById.mockResolvedValue(event);

        await expect(
          service.createCheckoutSession(userId, {
            eventId: event._id.toString(),
            ticketIds,
            ticketType,
            totalAmount: 999,
          } as any),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(stripeCreate).not.toHaveBeenCalled();
        expect(FakePaymentModel.instances).toHaveLength(0);
      },
    );

    it('rejects an already sold seat', async () => {
      const event = seatedEvent();
      eventsService.findById.mockResolvedValue(event);

      await expect(
        service.createCheckoutSession(userId, {
          eventId: event._id.toString(),
          ticketIds: [{ sectionId: 'A', seatId: 'A3' }],
          ticketType: 'Standard',
        } as any),
      ).rejects.toBeInstanceOf(SeatUnavailableException);
      expect(stripeCreate).not.toHaveBeenCalled();
    });

    it('rejects an invalid eventId without querying the event', async () => {
      await expect(
        service.createCheckoutSession(userId, {
          eventId: 'not-an-id',
          ticketIds: ['auto-assigned'],
          ticketType: 'Standard',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(eventsService.findById).not.toHaveBeenCalled();
    });
  });

  describe('createFreeTicket - server-side amount', () => {
    it('refuses to issue a priced ticket type through the free endpoint', async () => {
      const event = standingEvent();
      eventsService.findById.mockResolvedValue(event);

      await expect(
        service.createFreeTicket(userId, {
          eventId: event._id.toString(),
          ticketIds: ['auto-assigned'],
          ticketType: 'VIP',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(ticketsService.createTicketsFromPayment).not.toHaveBeenCalled();
      expect(FakePaymentModel.instances).toHaveLength(0);
    });

    it('issues a genuinely free ticket', async () => {
      const event = standingEvent();
      eventsService.findById.mockResolvedValue(event);
      FakePaymentModel.findOne.mockResolvedValue(null);
      ticketsService.createTicketsFromPayment.mockResolvedValue([
        { _id: new Types.ObjectId(), ticketNumber: 'TKFREE001' },
      ]);

      const result = await service.createFreeTicket(userId, {
        eventId: event._id.toString(),
        ticketIds: ['auto-assigned'],
        ticketType: 'Free',
      });

      expect(result.ticketNumber).toBe('TKFREE001');
      expect(FakePaymentModel.instances[0].amount).toBe(0);
    });
  });

  describe('payment lookups - ownership', () => {
    const ownerId = new Types.ObjectId().toString();
    const strangerId = new Types.ObjectId().toString();
    const owner = { userId: ownerId, email: 'o@x.test', userType: 'User' };
    const stranger = {
      userId: strangerId,
      email: 's@x.test',
      userType: 'User',
    };
    const admin = {
      userId: new Types.ObjectId().toString(),
      email: 'a@x.test',
      userType: 'Admin',
    };
    const organizer = {
      userId: new Types.ObjectId().toString(),
      email: 'org@x.test',
      userType: 'Organizer',
    };

    const payment = {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(ownerId),
      stripePaymentIntentId: 'pi_owned',
    };

    beforeEach(() => {
      FakePaymentModel.findById.mockImplementation(async (id: string) =>
        id === payment._id.toString() ? payment : null,
      );
      FakePaymentModel.findOne.mockImplementation(async (filter: any) =>
        filter.stripePaymentIntentId === payment.stripePaymentIntentId
          ? payment
          : null,
      );
    });

    it('returns the payment to its owner by id and by intent', async () => {
      await expect(
        service.getPaymentById(payment._id.toString(), owner),
      ).resolves.toBe(payment);
      await expect(service.getPaymentById('pi_owned', owner)).resolves.toBe(
        payment,
      );
      await expect(service.getPaymentByIntent('pi_owned', owner)).resolves.toBe(
        payment,
      );
    });

    it('lets an admin read any payment', async () => {
      await expect(
        service.getPaymentById(payment._id.toString(), admin),
      ).resolves.toBe(payment);
      await expect(service.getPaymentByIntent('pi_owned', admin)).resolves.toBe(
        payment,
      );
    });

    it.each([
      ['another user', stranger],
      ['an organizer', organizer],
    ])(
      'hides the payment from %s with the same 404 as a missing payment',
      async (_label, user) => {
        const byId = service.getPaymentById(payment._id.toString(), user);
        const byIntentFallback = service.getPaymentById('pi_owned', user);
        const byIntent = service.getPaymentByIntent('pi_owned', user);
        const missing = service.getPaymentByIntent('pi_missing', user);

        for (const lookup of [byId, byIntentFallback, byIntent, missing]) {
          await expect(lookup).rejects.toThrow(
            new NotFoundException('Payment not found'),
          );
        }
      },
    );
  });
});
