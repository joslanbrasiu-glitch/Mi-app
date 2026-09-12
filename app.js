// =============================================================
// ARCHIVO ÚNICO: APP.JS (Backend + Base de datos + Pagos)
// =============================================================

require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const { PrismaClient } = require('@prisma/client');

// Inicializaciones
const app = express();
const prisma = new PrismaClient();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'tu_clave_stripe');

app.use(express.json());

// -------------------------------------------------------------
// 1. REGISTRO DE USUARIOS Y CREADORES CON GEOBLOQUEO
// -------------------------------------------------------------
app.post('/api/users/register', async (req, res) => {
  try {
    const { email, username, role, blockedCountries } = req.body;

    const newUser = await prisma.user.create({
      data: {
        email,
        username,
        role: role || 'USER',
        blockedCountries: blockedCountries || [],
      },
    });

    res.json({ success: true, user: newUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 2. CONECTAR BANCO DEL CREADOR (Stripe Connect)
// -------------------------------------------------------------
app.post('/api/creators/connect', async (req, res) => {
  try {
    const { userId, email } = req.body;

    const account = await stripe.accounts.create({
      type: 'express',
      email: email,
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { stripeAccountId: account.id },
    });

    res.json({ success: true, stripeAccountId: account.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 3. COBRO A LA CARTA Y REGALOS (Split 20% App / 80% Creador)
// -------------------------------------------------------------
app.post('/api/payments/pay-per-view', async (req, res) => {
  try {
    const { userId, postId, amount, creatorStripeAccountId, paymentMethodId } = req.body;

    // Cálculo automático de la comisión (20%)
    const platformFee = Math.round(amount * 0.20);
    const creatorEarnings = amount - platformFee;

    // Procesar pago en Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount, // Monto en centavos (ej: 1000 = $10.00 USD)
      currency: 'usd',
      payment_method: paymentMethodId,
      confirm: true,
      application_fee_amount: platformFee,
      transfer_data: {
        destination: creatorStripeAccountId,
      },
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    });

    // Guardar transacción en la base de datos
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        postId,
        amount,
        platformFee,
        creatorEarnings,
        stripePaymentId: paymentIntent.id,
      },
    });

    res.json({ success: true, transaction });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 4. SUSCRIPCIONES MENSUALES RECURRENTES
// -------------------------------------------------------------
app.post('/api/subscriptions/create', async (req, res) => {
  try {
    const { customerId, priceId } = req.body;

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    res.json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// INICIAR SERVIDOR
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 App corriendo en http://localhost:${PORT}`);
});
 
