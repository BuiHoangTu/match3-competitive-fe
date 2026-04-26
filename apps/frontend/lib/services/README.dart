// services/ — Abstract service interfaces and stub implementations consumed by screens.
// Auth, analytics, and other integrations are declared here as interfaces.
// Concrete implementations (firebase_auth, etc.) are provided by other agents and
// wired via dependency injection at the app root.
//
// DO NOT import firebase_auth, google_sign_in, or any native plugin here —
// those belong to sub-track C (auth agent).
