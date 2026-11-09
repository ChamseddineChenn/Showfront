# Showfront

**Showfront** is an online event-ticketing platform designed to let people discover events, choose ticket options, and book their place online. It combines a Next.js web application with a separately deployed NestJS API and a MongoDB data layer.

**Live application:** https://showfront.vercel.app/  
**Source code:** https://github.com/ChamseddineChenn/Showfront

The project brings together event discovery, account management, ticket inventory, checkout, payment integration, digital ticket delivery, QR-based validation, and administrative tools.

## Project highlights

- Event catalogue with categories, event details, and upcoming-event listings
- Ticket types and seat-selection flows
- Checkout and Stripe payment integration
- User accounts, email verification, and Google/Facebook authentication integrations
- Digital ticket records with QR-code generation and receipt support
- QR scanning interface for ticket validation
- Administrative workflows for managing events and ticketing operations
- Separate frontend and backend deployments

## Architecture

| Application | Directory | Technology |
| --- | --- | --- |
| Web frontend | [`ticketing-platform/`](./ticketing-platform) | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| API backend | [`ticketing-backend/`](./ticketing-backend) | NestJS 11, TypeScript, MongoDB/Mongoose |

The frontend communicates with the API through the configured API origin. MongoDB stores application data. Stripe, Cloudinary, mail delivery, and OAuth are external integrations configured through environment variables.

## Repository layout

```
Showfront/
├── ticketing-platform/   # Next.js web application
└── ticketing-backend/    # NestJS API and deployment configuration
```

## Getting started

Each application has its own dependencies and environment configuration. Follow the setup instructions in the relevant directory:

- [Frontend setup and scripts](./ticketing-platform/README.md)
- [Backend setup, environment variables, and scripts](./ticketing-backend/README.md)
- [Backend deployment guide](./ticketing-backend/DEPLOY_VERCEL.md)

For local development, start the backend and frontend in separate terminals. The backend defaults to port `3002`; the frontend development server defaults to port `3000`. Configure the frontend's `NEXT_PUBLIC_API_URL` to point to the backend.

## Configuration and security

Do not commit real `.env` files, API keys, signing secrets, OAuth secrets, or database credentials. Use the supplied environment example files as templates and configure production values in the relevant hosting and provider dashboards.

Payment confirmation, ticket ownership, seat availability, and QR validation must be enforced by the backend. Stripe webhook signatures must be verified before a payment is considered successful.

## Project status

The web application is deployed at [showfront.vercel.app](https://showfront.vercel.app/), with the API hosted separately. Integrations such as payment processing, email delivery, and social login depend on environment-specific configuration. Refer to the deployment guide for the current backend deployment procedure and health-check route.
