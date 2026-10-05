# Google OAuth

The active web flow is implemented by `google_auth_client.dart`. The browser
navigates to the backend's Google start endpoint, then exchanges its one-time
callback code for a backend-issued app session. For account linking, the client
posts an explicit `link` intent with the signed-in session and navigates to the
authorization URL returned by the backend. Link state is bound per tab and
validated before code exchange. Callback query parameters are removed from
browser history before processing; callbacks without the originating tab flow
or with a missing/mismatched link state fail closed without code exchange.

The backend callback's generic error codes are rendered as safe, flow-specific
messages; the account-link-required error directs users to sign in locally and
connect Google from Account settings. Provider and account details are never
shown by the client.

`google_sign_in_service.dart` is a legacy native token collector and is not used
by the web auth-code flow. Provider tokens are never stored as app sessions.
