# CORS and QR Code Validation Deployment Fix

## Problem Summary

The deployed frontend at `https://showfront-web.vercel.app` was unable to call the QR validation endpoint due to two CORS issues:

1. **Frontend Issue**: The frontend was hardcoding `http://localhost:3002` instead of using the deployed backend URL
2. **Backend Issue**: The backend CORS was only allowing `http://localhost:3000` and didn't include the Vercel domain

**Error Message:**
```
Access to fetch at 'http://localhost:3002/tickets/validate-qr' from origin 'https://showfront-web.vercel.app' 
has been blocked by CORS policy: Response to preflight request doesn't pass access control check: 
The 'Access-Control-Allow-Origin' header has a value 'http://localhost:3000' that is not equal to the supplied origin.
```

## Changes Made

### 1. Backend CORS Configuration
**File**: [ticketing-backend/src/main.ts](ticketing-backend/src/main.ts#L34-L52)

**What Changed:**
- Updated from single-origin string to dynamic origin whitelist
- Added support for multiple development and production origins
- Implemented origin callback function for flexible CORS validation

**New Configuration:**
```typescript
const allowedOrigins = [
  'http://localhost:3000',              // Local development
  'http://localhost:3001',              // Alternative local dev
  'https://showfront-web.vercel.app', // Production frontend
];

// Add any additional origins from environment variable
const envOrigin = configService.get<string>('cors.origin');
if (envOrigin && !allowedOrigins.includes(envOrigin)) {
  allowedOrigins.push(envOrigin);
}

app.enableCors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Set-Cookie'],
});
```

**Benefits:**
- ✅ Hardcoded support for Vercel production domain
- ✅ Still respects `FRONTEND_URL` environment variable
- ✅ Allows mobile apps and CLI requests (no origin requirement)
- ✅ Extensible for future deployments

### 2. Frontend API URL Resolution
**File**: [ticketing-platform/lib/api/axios.ts](ticketing-platform/lib/api/axios.ts#L1-L20)

**What Changed:**
- Exported `getAPIBaseURL()` function for use in other components
- Now publicly available for direct fetch() calls in addition to axios client

**Updated Function:**
```typescript
// Now exported for use throughout the app
export const getAPIBaseURL = () => {
  if (typeof window === 'undefined') {
    // Server-side rendering
    return process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3002';
  }

  // Client-side: replace localhost with the actual host
  let baseURL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3002';

  if (baseURL.includes('localhost') || baseURL.includes('127.0.0.1')) {
    // Replace localhost/127.0.0.1 with actual hostname for mobile compatibility
    const hostname = window.location.hostname;
    const port = 3002;
    baseURL = `http://${hostname}:${port}`;
  }

  return baseURL;
};
```

### 3. Admin Page QR Validation
**File**: [ticketing-platform/app/admin/page.tsx](ticketing-platform/app/admin/page.tsx#L860-L870) (2 locations)

**What Changed:**
- Replaced hardcoded `http://localhost:3002` with dynamic `getAPIBaseURL()`
- Updated both camera scanner locations (real-time scan and manual image upload)

**Before:**
```typescript
const apiUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3002';
const response = await fetch(`${apiUrl}/tickets/validate-qr`, {
  // ...
});
```

**After:**
```typescript
const { getAPIBaseURL } = await import('@/lib/api/axios');
const apiUrl = getAPIBaseURL();
const response = await fetch(`${apiUrl}/tickets/validate-qr`, {
  // ...
});
```

## Environment Variables Required

### For Local Development
No additional setup needed - defaults use localhost:

```bash
# These are optional (code has fallbacks)
NEXT_PUBLIC_BACKEND_URL=http://localhost:3002
FRONTEND_URL=http://localhost:3000
```

### For Production Deployment

#### Backend Environment Variables
```bash
# .env file for ticketing-backend
FRONTEND_URL=https://showfront-web.vercel.app
# OR
FRONTEND_URL=https://your-frontend-domain.com
```

#### Frontend Environment Variables  
```bash
# .env.local or deployment settings for ticketing-platform
NEXT_PUBLIC_BACKEND_URL=https://your-backend-url.com
# Example if using Render or similar:
# NEXT_PUBLIC_API_URL=https://<your-vercel-backend-host>
```

## Deployment Instructions

### 1. Backend Deployment (Render, Railway, Heroku, etc.)

**Step 1:** Identify your deployed backend URL
- Example: the Vercel backend origin, set as `NEXT_PUBLIC_API_URL`

**Step 2:** Set environment variables in your deployment platform:
```
FRONTEND_URL=https://showfront-web.vercel.app
```

**Step 3:** Redeploy the backend
- For Render: Push to main branch (auto-deploys)
- For Railway/Heroku: Use their CLI or dashboard to redeploy

### 2. Frontend Deployment (Already on Vercel)

**Step 1:** Set Vercel environment variable:
```
NEXT_PUBLIC_BACKEND_URL=https://your-backend-url.com
```

**Step 2:** Redeploy in Vercel dashboard (or trigger with git push)

### 3. Verify the Fix

**Test QR Code Validation:**
1. Navigate to `https://showfront-web.vercel.app/admin`
2. Open QR Scanner
3. Scan a valid QR code
4. Verify **no CORS errors** appear in browser console
5. Verify **API response is successful** (should show ticket details)

**Test Admin Event Editing:**
- Verify admin edits to events still work (uses different endpoints)

## How It Works

### Before Fix
```
Frontend (Vercel) → tries to call http://localhost:3002
↑ CORS Error: "localhost" not in whitelist
Backend CORS only allows http://localhost:3000
```

### After Fix
```
Frontend (Vercel) → calls getAPIBaseURL() → https://deployed-backend.com
↓
Backend CORS whitelist:
  ✓ https://showfront-web.vercel.app (new)
  ✓ http://localhost:3000 (dev)
  ✓ http://localhost:3001 (dev)
  ✓ Any FRONTEND_URL env var (flexible)
↓
Success! API responds with proper CORS headers
```

## Troubleshooting

### Still Getting CORS Errors?

1. **Check Frontend URL**
   ```javascript
   // Open browser console and run:
   console.log(process.env.NEXT_PUBLIC_BACKEND_URL);
   ```
   Should show your deployed backend URL, NOT localhost

2. **Check Backend Logs**
   ```
   Look for CORS error messages
   Verify backend received requests from Vercel domain
   ```

3. **Verify Backend Redeployed**
   - Check deployment timestamp
   - Confirm new code with CORS changes is live
   - Test with curl: `curl -H "Origin: https://showfront-web.vercel.app" http://your-backend/tickets/validate-qr -v`

4. **Clear Browser Cache**
   - Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
   - Or clear application cache in DevTools

### Backend is Different Domain?

If your backend is deployed to a different domain than `your-backend-url.com`:

**Update [ticketing-backend/src/main.ts](ticketing-backend/src/main.ts#L36):**
```typescript
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://showfront-web.vercel.app',
  'https://your-actual-backend-domain.com', // Add here
];
```

Then redeploy the backend.

## Commits

All changes are committed and ready for deployment:
- Frontend CORS fix: Updated axios getAPIBaseURL export
- Backend CORS config: Updated main.ts with whitelist-based CORS
- Admin page: Updated QR validation to use dynamic API URL

## Testing Checklist

- [ ] Backend redeployed with new CORS configuration
- [ ] Frontend has `NEXT_PUBLIC_BACKEND_URL` set to deployed backend
- [ ] QR code scan works on admin page (no console errors)
- [ ] API response displays ticket details correctly
- [ ] Admin event editing still works
- [ ] Works on both desktop and mobile browsers
