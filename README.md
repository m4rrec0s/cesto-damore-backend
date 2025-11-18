# 🧺 Cesto d'Amore - Backend API

## Google Drive configuration

The application supports two modes for uploading files to Google Drive:

1. OAuth2 (user account): Use the web flow `/api/oauth/authorize` to authorize a google user. Tokens are saved in `google-drive-token.json` and the service will refresh tokens automatically (if refresh token is available). This is recommended for single-user setups.

2. Service Account (recommended for server-based automated uploads): There are multiple ways to configure Service Account credentials via environment variables:

   - Direct JSON key content: `GOOGLE_SERVICE_ACCOUNT_KEY` (set the full JSON string) OR
   - Path to key JSON file: `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` (path to the downloaded file) OR
   - Individual env vars (helpful for limited env var platforms):
     - `GOOGLE_PRIVATE_KEY` (private key content; `\\n` sequences allowed)
     - `GOOGLE_PRIVATE_KEY_ID`
     - `GOOGLE_CLIENT_EMAIL` or `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`
     - `GOOGLE_SERVICE_ACCOUNT_CLIENT_ID` or `GOOGLE_CLIENT_ID`
     - `GOOGLE_PROJECT_ID`

   To validate your configuration, you can use the following admin endpoints:

   - `GET /api/oauth/status` — shows current auth mode and token state.
   - `POST /api/oauth/clear` — clears stored OAuth tokens (admin-only; re-run `/api/oauth/authorize`).
   - `POST /api/admin/google-drive/test` — attempts to create/delete a test folder to confirm Drive permissions (admin-only).

   When using a service account, make sure to share the target Drive folder with the service account email (found in the key JSON as `client_email`) and give Editor permissions, or use a shared drive where the service account is a member.

Notes:

- To clear OAuth tokens and re-authorize, call `POST /api/oauth/clear` (admin only). For status use `GET /api/oauth/status`.
- Service Account mode avoids token expiration and is recommended for production server instances where you want long-term uploads.
