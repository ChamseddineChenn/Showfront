# Showfront Web Application

The web frontend for **Showfront**, an online event-ticketing platform. It gives visitors a place to discover events, explore ticket options, select seats where supported, and complete a ticket-purchase flow. Account holders can manage their sessions and tickets, while authorized administrators manage platform content and operations.

Built with **Next.js 16, React 19, TypeScript, and Tailwind CSS 4**.

## Features

- Responsive event discovery and event-detail experience
- Ticket types, seat selection, and checkout flows
- Stripe Elements integration for payment
- User registration, login, and OAuth entry points
- Cookie-based authenticated sessions with API-backed refresh handling
- Ticket and receipt views
- QR-code scanning interface for ticket validation
- Administrative interfaces for event and ticket operations

Some capabilities depend on the backend, database records, and provider configuration. OAuth, email delivery, and payment behaviour must be configured in the corresponding services.

## Tech stack

- Next.js 16.1
- React 19
- TypeScript
- Tailwind CSS 4
- Axios
- Stripe.js and React Stripe.js
- Google and Facebook login integrations
- html5-qrcode
- jsPDF and html2canvas

## Requirements

- Node.js 20 or newer
- npm
- A running Showfront API instance

## Local setup

From this directory:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

Set the backend URL in `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3002
```

The application also supports `NEXT_PUBLIC_BACKEND_URL` as a fallback. Use the deployed API origin for a hosted frontend.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |

## Backend connection

The frontend communicates with the separately deployed NestJS API. Configure `NEXT_PUBLIC_API_URL` to the API origin without a trailing slash.

The backend repository directory contains its own setup and deployment documentation:

- [Backend README](../ticketing-backend/README.md)
- [Backend deployment guide](../ticketing-backend/DEPLOY_VERCEL.md)

## Authentication and payment configuration

Authentication relies on the backend's session cookies. Keep credential handling on the server and avoid storing access or refresh tokens in browser local storage.

Stripe's publishable key and the backend's Stripe secret/webhook settings must belong to the same Stripe environment. A deployment configured with test keys processes test payments only.

## Production build

Before deploying:

1. Set `NEXT_PUBLIC_API_URL` to the production API origin.
2. Configure the required OAuth client IDs and provider-side redirect URLs.
3. Confirm the backend's CORS allowlist includes the exact frontend origin.
4. Confirm Stripe keys and webhook settings use the intended test or live environment.
5. Run `npm run build` and resolve build errors before release.

