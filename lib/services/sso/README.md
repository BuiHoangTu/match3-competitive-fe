# Optional Google OAuth

The active auth path is local username/password via `../local_auth_service.dart`.
App sessions are backend-issued.

`google_sign_in_service.dart` is kept as a thin Google OAuth token collector for
a future backend exchange endpoint. It does not create an app session by itself:
the backend must verify the Google token and return the normal
`{sessionToken, userId, expiresAt}` payload used by local accounts.

Apple Sign-In and external-auth-backend SSO files were removed from this directory.
