import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { PaymentsController } from './payments.controller';
import { TicketsController } from '../tickets/tickets.controller';

describe('Route access', () => {
  const reflector = new Reflector();
  const isPublic = (controller: any, handler: string) =>
    reflector.get<boolean>(IS_PUBLIC_KEY, controller.prototype[handler]) ===
    true;

  it.each([
    [PaymentsController, 'createCheckoutSession'],
    [PaymentsController, 'createFreeTicket'],
    [PaymentsController, 'getPayment'],
    [PaymentsController, 'getPaymentByIntent'],
    [TicketsController, 'findById'],
    [TicketsController, 'findByPaymentId'],
  ])('%p.%s requires authentication', (controller, handler) => {
    expect(isPublic(controller, handler)).toBe(false);
  });

  it('keeps the Stripe webhook public (protected by signature check)', () => {
    expect(isPublic(PaymentsController, 'handleWebhook')).toBe(true);
  });
});

describe('PaymentsController.createCheckoutSession', () => {
  it('passes the authenticated user id and never forwards totalAmount', async () => {
    const paymentsService = {
      createCheckoutSession: jest.fn().mockResolvedValue({}),
    };
    const controller = new PaymentsController(paymentsService as any);
    const user = { userId: 'user-1', email: 'u@x.test', userType: 'User' };

    await controller.createCheckoutSession(user, {
      body: {
        eventId: 'event-1',
        ticketIds: ['auto-assigned'],
        totalAmount: 0.01,
        ticketType: 'VIP',
      },
    });

    const [userId, dto] = paymentsService.createCheckoutSession.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(dto).not.toHaveProperty('totalAmount');
    expect(dto.ticketType).toBe('VIP');
  });
});
