# Golden Moment API

The backend for **Golden Moment**, an online event-ticketing platform. It provides the application API for event discovery, accounts and authentication, ticket purchasing, payment processing, ticket delivery, and administrative workflows.

Built with **NestJS 11, TypeScript, MongoDB/Mongoose, and Stripe**.

## Responsibilities

- Event and ticket-type data served to the web application
- User registration, login, OAuth sign-in, email verification, and session handling
- Cookie-based JWT authentication with access and refresh token guards
- Checkout and payment integration through Stripe
- Ticket records, ticket numbers, QR-code generation, and receipt generation
- Cloudinary-backed media handling
- Administrative event and ticket-management endpoints
- Request validation, security headers, CORS configuration, and rate limiting

The API is configured for deployment as a Vercel serverless application. Deployment instructions are maintained in [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md).

## Tech stack

- NestJS 11 / TypeScript
- MongoDB with Mongoose
- Passport and JWT authentication
- Stripe
- Cloudinary
- SendGrid / SMTP mail integrations
- QRCode and PDFKit
- Helmet, class-validator, and Nest throttling

## Requirements

- Node.js 20 or newer
- npm
- MongoDB instance
- Stripe account and API keys
- Cloudinary credentials
- Mail provider credentials for email delivery

## Local setup

From this directory:

```bash
npm install
cp .env.example .env
```

Fill in the required values in `.env`. Never commit real credentials or production environment files.

Start the API in development mode:

```bash
npm run start:dev
```

The default local port is **3002** (the application configuration may override it).

## Environment configuration

Use [.env.example](./.env.example) as the variable reference. Important settings include:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_ACCESS_SECRET` | Access-token signing secret |
| `JWT_REFRESH_SECRET` | Refresh-token signing secret |
| `FRONTEND_URL` | Allowed frontend origin |
| `STRIPE_SECRET_KEY` | Stripe server-side secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Server-side Cloudinary credentials |
| `QR_ENCRYPTION_KEY` | Required. 64 hex characters (32-byte aes-256-gcm key); the API fails to start if missing or malformed. See `.env.example` for generation and migration |
| `MAIL_*` / `SMTP_*` | Email delivery configuration |
| `GOOGLE_CLIENT_ID` / `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | OAuth configuration |

Generate distinct, high-entropy JWT secrets for each environment. Configure secrets in the hosting platform's environment settings rather than in source control.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run start:dev` | Run in watch mode |
| `npm run start` | Start NestJS |
| `npm run build` | Compile the application |
| `npm run start:prod` | Run the compiled application |
| `npm run lint` | Run ESLint with automatic fixes |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run seed:portfolio` | Seed the portfolio event catalogue |

## Portfolio event seed

The seed script creates or updates the portfolio/demo event catalogue:

```bash
npm run seed:portfolio
```

Run it only with a valid database connection configured. The deployment guide documents the seed behaviour and optional reset flag. Review the script before running it against any database containing real customer or event data.

## Deployment

The API is deployed separately from the Next.js frontend. See [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md) for the Vercel project configuration, environment variables, frontend API URL, Stripe webhook, and health-check instructions.

The Stripe keys and webhook configuration determine whether the deployed instance is operating in test or live mode. Do not assume live payment processing from a successful deployment alone.

## Security status and review notes

This repository has security controls such as JWT guards, role checks, request validation, Helmet, CORS restrictions, throttling, hashed refresh tokens, and Stripe webhook signature verification. These controls do **not** by themselves establish production readiness. A source review on 2026-11-07 identified unresolved high-priority issues that should be fixed and tested before handling real customer payments:

- Public signup accepts a `userType` field, and the user-creation service honours `ADMIN`. Public callers may therefore be able to create administrator accounts. Public signup must force the regular user role; administrator provisioning must be restricted to a trusted process.
- QR/ticket-number validation routes are public and perform the check-in mutation. Redemption is now atomic (concurrent scans cannot both be accepted), but check-in should still be restricted to staff/organizer authorization.
- Payment success handling marks a payment succeeded before ticket creation completes. A failure between those operations needs a recoverable state transition and reconciliation strategy; webhook idempotency should also be enforced at the database level.

Resolved since the review: checkout amounts are computed server-side from stored event prices (client `totalAmount` is ignored); checkout and the payment/ticket lookup routes require login and enforce ownership (admins, and organizers for tickets, keep access); `QR_ENCRYPTION_KEY` has no fallback and is validated at startup.

Treat these as audit findings from the inspected source, not as proof that a deployed instance has been exploited. Keep all secrets in environment variables, rotate anything ever exposed, and test fixes against the deployed configuration. Do not use real customer payments until the critical items above are resolved.

## Project structure

```
ticketing-backend/
├── api/                 # Serverless entry point
├── src/
│   ├── auth/            # Authentication, guards, strategies, and DTOs
│   ├── ...              # Application modules and API features
│   ├── main.ts          # Local NestJS bootstrap
│   └── ...
├── scripts/             # Maintenance and seed scripts
├── test/                # Automated tests
├── .env.example         # Placeholder environment template
├── DEPLOY_VERCEL.md     # Deployment guide
└── package.json
```

