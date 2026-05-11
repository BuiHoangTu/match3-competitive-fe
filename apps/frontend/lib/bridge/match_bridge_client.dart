/// T-v0.6-B04 · Shell → game `startMatch` helper
///
/// Provides [sendStartMatch] — the single call-site for emitting the
/// [StartMatchMessage] to the game view via a [BridgeTransport].
///
/// Security rules:
///   - The raw [roomToken] value is never logged; only [expiresAt] and a
///     short hash prefix are logged for correlation.
///   - The app session token MUST NOT be passed to this function — it accepts
///     only the shape [{roomToken, expiresAt}] as returned by the matchmaking
///     endpoint.
library;

import 'dart:convert';

import 'package:crypto/crypto.dart';

import 'bridge_messages.dart';
import 'bridge_transport.dart';

/// Sends the [StartMatchMessage] to the embedded game view.
///
/// [transport] — the active [BridgeTransport] for the current game view.
/// [roomToken] — server-issued room-scoped JWT (opaque to the shell).
/// [expiresAt] — Unix timestamp in seconds when the token expires.
///
/// Emits exactly one [StartMatchMessage]. Call once per match (or once after
/// a token refresh following [AuthTokenRejectedMessage]).
///
/// Type note: this function accepts [roomToken] as a plain [String], not a
/// session/user credential shape — passing an object with a `userId` field is a
/// compile-time error because [String] does not have that field.
void sendStartMatch(
  BridgeTransport transport, {
  required String roomToken,
  required int expiresAt,
}) {
  // Log only the short hash prefix — never the token value itself.
  final hashPrefix = _shortHashPrefix(roomToken);
  // ignore: avoid_print
  print('[MatchBridgeClient] sending startMatch expiresAt=$expiresAt token#$hashPrefix');

  transport.send(
    StartMatchMessage(roomToken: roomToken, expiresAt: expiresAt),
  );
}

/// Returns the first 8 hex characters of the SHA-256 hash of [token].
/// Used for log correlation without leaking the token value.
String _shortHashPrefix(String token) {
  final bytes = utf8.encode(token);
  final digest = sha256.convert(bytes);
  return digest.toString().substring(0, 8);
}
