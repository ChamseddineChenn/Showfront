# Deploy the API on Vercel

The frontend stays on its current Vercel project. Create a second Vercel project for this folder (`ticketing-backend`). MongoDB Atlas stays the database. Stripe stays in test mode.

## Backend project

1. Import `ChamseddineChenn/Showfront` and set the root directory to `ticketing-backend`.
2. Framework preset: Other. Build command: `npm run build`. Output is not a static site; `vercel.json` routes every path to `api/index.js`.
3. Copy the keys from `.env.example` into the Vercel environment. Use placeholders only in git. Set at least:
   - `MONGODB_URI`
   - `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (long random strings; the API refuses to start without them)
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (test keys)
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
   - `FRONTEND_URL=https://showfront-web.vercel.app`
   - `NODE_ENV=production`
   - `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` for signup, password reset, and ticket receipts. `SENDGRID_BASE_URL` defaults to `https://app.mailroomly.com/`. The from address must be verified at that host.
   - Mail (`SMTP_*` or `MAIL_*`) only if the older SMTP path should also run, and OAuth values if those logins should work
4. Deploy, then copy the backend origin (no trailing slash).

## Frontend project

Set `NEXT_PUBLIC_API_URL` to that backend origin and redeploy the frontend. `NEXT_PUBLIC_BACKEND_URL` is only a fallback.

## Stripe

In the Stripe test dashboard, point the webhook to `https://<backend-host>/payments/webhook` and put the new signing secret in `STRIPE_WEBHOOK_SECRET`.

## Portfolio events

From `ticketing-backend`, with `MONGODB_URI` in `.env` (never commit that file):

```bash
npm run seed:portfolio
```

This upserts 96 published events, one date in each category for each of the next 24 months. `SEED_RESET=true` deletes only events marked `portfolioDemo` before writing them again. A demo admin is created only when both `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set.

## After it answers

Open `https://<backend-host>/diagnostic/health` and expect `{ "status": "ok" }`. Then open the frontend and confirm events load. Pause the old Render service only after that works. Hobby cold starts are a few seconds, not the old idle shutdown.
