# Authentication System

## Backend (`/auth`)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/auth/register` | Register + send email OTP |
| POST | `/auth/login` | Login (locks after 5 failures) |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Revoke refresh token |
| GET | `/auth/me` | Current user profile |
| PATCH | `/auth/profile` | Update full name |
| POST | `/auth/verify-email` | Verify 6-digit OTP |
| POST | `/auth/resend-otp` | Resend OTP |
| POST | `/auth/forgot-password` | Send reset OTP |
| POST | `/auth/reset-password` | Reset with OTP |

## User model (PostgreSQL)

- `id`, `full_name`, `email`, `password_hash`
- `role` — `free` | `premium` | `admin`
- `conversions_used`, `email_verified`
- `failed_login_attempts`, `locked_until`
- `created_at`, `updated_at`

## Tokens

- **Access token**: JWT, default `15m` (`JWT_ACCESS_EXPIRES_IN`)
- **Refresh token**: JWT stored hashed in `refresh_tokens` table, default `7d`
- Mobile storage: **expo-secure-store** (AsyncStorage fallback on web)

## Environment variables

### Backend (`backend/.env`)

```env
JWT_SECRET=long-random-secret
JWT_REFRESH_SECRET=long-random-refresh-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/converter
```

### Mobile (`.env`)

```env
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:4000
```

## Setup

```bash
cd backend
npm install
npm run migrate   # runs schema.sql + auth-schema.sql
npm run dev       # API
npm run worker    # optional queue worker
```

```bash
# project root
npm install
npm run start
```

## Dev OTP codes

In development, OTP codes are logged to the API console:

```
[email:dev] { to: 'user@email.com', subject: '...', text: 'Your verification code is: 123456' }
```

Register/OTP responses may also include `devCode` in non-production.

## Roles

| Role | Access |
|------|--------|
| `free` | Daily conversion limit, PDF watermark |
| `premium` | Unlimited conversions, no watermark |
| `admin` | Full access + analytics |

## Example requests

```bash
# Register
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Sam","email":"sam@test.com","password":"password123"}'

# Login
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"sam@test.com","password":"password123"}'

# Refresh
curl -X POST http://localhost:4000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"..."}'
```

## Frontend structure

```
src/
├── store/authStore.js       # Zustand auth state
├── services/
│   ├── authApi.js           # API + auto refresh
│   └── secureStorage.js     # Token storage
├── screens/auth/
│   ├── LoginScreen.js
│   ├── RegisterScreen.js
│   ├── ForgotPasswordScreen.js
│   ├── VerifyOtpScreen.js
│   └── ProfileScreen.js
└── navigation/
    ├── AuthStack.js
    └── RootNavigator.js     # Auth guard
```

## Social login

| Method | Route | Mobile |
|--------|-------|--------|
| Google | `POST /auth/google` | `expo-auth-session` + ID token |
| Apple | `POST /auth/apple` | `expo-apple-authentication` (iOS) |

### Google setup

1. Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com)
2. Add to mobile `.env`:
   ```env
   EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID=...
   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...
   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...
   ```
3. Add matching IDs to `backend/.env` (`GOOGLE_CLIENT_ID`, etc.)

### Apple setup

1. Enable **Sign in with Apple** in Apple Developer portal for your bundle ID
2. `app.json` already includes `"usesAppleSignIn": true`
3. Set `APPLE_CLIENT_ID=com.anonymous.documentscanner` on backend

## Biometric unlock

- Enable in **Profile → Biometric unlock**
- On next app open, Face ID / fingerprint required before session restore
- Tokens stay in **expo-secure-store**
- Tap **Use password instead** to disable biometric and sign in normally

## Security features

- bcrypt password hashing (12 rounds)
- Rate limiting on auth routes
- Account lockout (5 failed logins → 15 min)
- Refresh token rotation
- Secure token storage on device
- Session expiry with automatic refresh
