# Netlify deployment

Deploy from the repository root (the root netlify.toml selects cutis2), or use cutis2 as the project root with its own netlify.toml. Do not use static drag-and-drop: the API requires Netlify Functions.
1. Connect the repository in Netlify or run Netlify CLI from cutis2.
2. In Netlify, set `MONGODB_URI` to your Atlas Drivers connection string with the database name. URL-encode special characters in the database password. Set `JWT_SECRET` to a long random secret and `CUTIS_GOOGLE_ONLY=false`. Scope these variables to Functions at runtime.
3. In Atlas, create a database user with readWrite permission for this database and configure network access for the deployment. Standard serverless outbound addresses can vary; use an appropriate Atlas network configuration for your hosting plan.
4. Create or select a Google OAuth **Web application** client. Add the final HTTPS site origin under **Authorized JavaScript origins** and set `GOOGLE_CLIENT_ID` in Netlify's Functions environment. For a local browser test, also authorize `http://localhost:4000`. If the Google app is restricted to test users, add the review accounts there. See [Google's setup instructions](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
5. For email signup, configure `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASS` and optionally `EMAIL_FROM` in the Functions environment. Production creates email accounts only after verification by code. Google accounts can still be created when email delivery is pending.
6. Deploy and confirm that `/api/health` reports `dbConnected: true`, `googleConfigured: true` and `passwordAuth: true`. Test account creation, email verification, and repeat sign-in. Save a location and weather, complete the skin profile, then save a scan and reminders. Reload to confirm the saved data returns.

The frontend uses its own origin for the API on hosted sites. Local development uses `npm ci` and `npm start`. With a blank `MONGODB_URI`, local startup reopens the persistent database in `backend/.local_mongo_data`. Production uses the configured MongoDB server.

Product matches require a selected skin type and a saved scan from the same account. The engine checks estimated redness at 55 or above, hydration below 50, and shine at 55 or above, in that order. These thresholds are application heuristics. Test the empty states for a missing profile choice, missing scan and a scan outside those ranges.

## Analysis model

The browser loads the pretrained TensorFlow.js MediaPipe short-range face detector (face-detection 1.0.3, TensorFlow.js 4.22.0). It requires one face, rejects tiny faces, and crops the detected face before computing image estimates. Photos stay in the browser. Loading model assets requires internet access. A model failure offers retry instead of invented scan values.

The face detector does not classify skin conditions. Hydration, oil, redness and skin-type outputs remain unvalidated image heuristics. The optional MobileNetV2 skin classifier in ml/train.py requires labelled training data and validation before claims about its accuracy can be made. No trained skin classifier weights are included. If supplied, its result is applied before saving the scan.

## Verification before publishing

Run `npm test` from the project root. Google sign-in, Atlas connectivity and camera permission still need to be checked with the deployed HTTPS origin.

## Legacy mobile OTP

Older installations using mobile OTP can continue to use the existing API with `CUTIS_GOOGLE_ONLY=false`. The website exposes email/password and Google account flows.
