import { stripe } from '@/lib/stripe';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  try {
    const body = await request.text();
    const event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;

        // Update user subscription
        if (session.client_reference_id) {
          const plan = session.metadata?.plan || 'pro';
          const planData: any = {
            pro: { credits: 100, plan: 'pro' },
            agency: { credits: 500, plan: 'agency' },
          };

          await prisma.user.update({
            where: { id: session.client_reference_id },
            data: {
              subscriptionPlan: planData[plan]?.plan || 'pro',
              creditsLimit: planData[plan]?.credits || 100,
            },
          });

          // Log payment
          await prisma.payment.create({
            data: {
              userId: session.client_reference_id,
              stripePaymentId: session.id,
              amount: session.amount_total || 0,
              plan: planData[plan]?.plan || 'pro',
              credits: planData[plan]?.credits || 100,
              status: 'completed',
            },
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        console.error('Payment failed:', invoice);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook error' },
      { status: 400 }
    );
  }
}
