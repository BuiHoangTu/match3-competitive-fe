/// T-v0.6-F01 · Shell matchmaking HTTP client
///
/// Talks to the backend matchmaking endpoints defined in
/// [system-design.md § 2.4](../../../specification/system-design.md#24-matchmaking-endpoint):
///
/// - POST /matchmaking/join   — find an opponent, receive a room token
/// - POST /matchmaking/resume — reissue a token for an existing slot
///
/// Auth: Firebase idToken in `Authorization: Bearer <idToken>` header. The
/// idToken **never** crosses the shell/game bridge (AR-3) — this client is
/// the only place the idToken meets the network.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../errors/matchmaking_errors.dart';
import '../models/matchmaking_result.dart';

/// Result shape of GET /matchmaking/status.
///
/// Returned when the user has an active server-side room. Used by the shell
/// to decide whether to allow starting a fresh solo match — if active, we
/// surface a snackbar; if null, solo can launch.
class ActiveSession {
  const ActiveSession({required this.mode, required this.roomId});
  final String mode;
  final String roomId;

  factory ActiveSession.fromJson(Map<String, dynamic> json) =>
      ActiveSession(
        mode: json['mode'] as String,
        roomId: json['roomId'] as String,
      );
}

/// Mode selector for [MatchmakingClient.join].
///
/// `solo` is intentionally absent: solo matches are now driven entirely
/// client-side (no server room). The shell sends [StartLocalMatchMessage]
/// over the bridge instead of calling /matchmaking/join.
enum MatchmakingMode {
  turnBased('turn_based'),
  pve('pve');

  const MatchmakingMode(this.wire);

  /// Wire-format string sent to the server.
  final String wire;
}

/// Inject-for-tests signature matching `package:http`'s `Client.post`.
typedef HttpPoster = Future<http.Response> Function(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
});

/// Inject-for-tests signature matching `package:http`'s `Client.get`.
typedef HttpGetter = Future<http.Response> Function(
  Uri url, {
  Map<String, String>? headers,
});

class MatchmakingClient {
  MatchmakingClient({
    required this.baseUrl,
    HttpPoster? postFn,
    HttpGetter? getFn,
  })  : _post = postFn ?? _defaultPost,
        _get = getFn ?? _defaultGet;

  /// Backend origin, e.g. `http://localhost:3001` for local dev or
  /// `https://api.match3.app` in prod. No trailing slash.
  final String baseUrl;
  final HttpPoster _post;
  final HttpGetter _get;

  static Future<http.Response> _defaultPost(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
  }) =>
      http.post(url, headers: headers, body: body);

  static Future<http.Response> _defaultGet(
    Uri url, {
    Map<String, String>? headers,
  }) =>
      http.get(url, headers: headers);

  /// Find a match. Resolves when the backend returns a room token (either
  /// paired with a human or fallen back to bot).
  ///
  /// Throws [MatchmakingAuthRejected] on 401, [MatchmakingActiveRoom] on 409,
  /// [MatchmakingBadRequest] on 400, [MatchmakingTransportError] otherwise.
  Future<MatchmakingResult> join({
    required String idToken,
    required MatchmakingMode mode,
  }) async {
    final uri = Uri.parse('$baseUrl/matchmaking/join');
    return _send(
      uri: uri,
      idToken: idToken,
      body: {'mode': mode.wire},
    );
  }

  /// Request a fresh room token for an existing room the user is already a
  /// slot in. Used after an `authTokenRejected` event from the game view.
  ///
  /// Throws [MatchmakingAuthRejected] on 401, [MatchmakingForbidden] on 403,
  /// [MatchmakingRoomGone] on 410.
  Future<MatchmakingResult> resume({
    required String idToken,
    required String roomId,
  }) async {
    final uri = Uri.parse('$baseUrl/matchmaking/resume');
    return _send(
      uri: uri,
      idToken: idToken,
      body: {'roomId': roomId},
    );
  }

  /// GET /matchmaking/status — query the backend for the user's currently
  /// active server-side match (if any).
  ///
  /// Used by the shell before launching a solo (client-side) match: if the
  /// user is mid-game in a turn_based or pve room, we block solo-launch and
  /// surface a snackbar instead of silently abandoning the live match.
  ///
  /// Returns null when the user has no active room. Returns an
  /// [ActiveSession] when the server reports `{ active: true, mode, roomId }`.
  ///
  /// Throws:
  ///   - [MatchmakingAuthRejected] on 401.
  ///   - [MatchmakingTransportError] on network failure or unexpected status.
  ///
  /// The caller's responsibility: on transport error, treat as "no active
  /// session" and proceed with the local launch (be permissive when offline).
  Future<ActiveSession?> getActiveSession({
    required String idToken,
  }) async {
    final uri = Uri.parse('$baseUrl/matchmaking/status');
    late http.Response response;
    try {
      response = await _get(uri, headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer $idToken',
      });
    } on Exception catch (e) {
      throw MatchmakingTransportError('Network error: $e');
    }

    Map<String, dynamic> decoded = const {};
    if (response.body.isNotEmpty) {
      try {
        final parsed = jsonDecode(response.body);
        if (parsed is Map<String, dynamic>) decoded = parsed;
      } catch (_) {
        // Non-JSON body — fall through to status-based handling.
      }
    }

    switch (response.statusCode) {
      case 200:
        if (decoded['active'] == true) {
          return ActiveSession.fromJson(decoded);
        }
        return null;
      case 401:
        throw MatchmakingAuthRejected(
          decoded['code']?.toString() ?? 'AUTH_REJECTED',
        );
      default:
        throw MatchmakingTransportError(
          'Unexpected status ${response.statusCode}: ${response.body}',
        );
    }
  }

  Future<MatchmakingResult> _send({
    required Uri uri,
    required String idToken,
    required Map<String, Object?> body,
  }) async {
    late http.Response response;
    try {
      response = await _post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $idToken',
        },
        body: jsonEncode(body),
      );
    } on Exception catch (e) {
      throw MatchmakingTransportError('Network error: $e');
    }

    Map<String, dynamic> decoded = const {};
    if (response.body.isNotEmpty) {
      try {
        final parsed = jsonDecode(response.body);
        if (parsed is Map<String, dynamic>) decoded = parsed;
      } catch (_) {
        // Non-JSON body — leave decoded empty.
      }
    }

    switch (response.statusCode) {
      case 200:
        try {
          return MatchmakingResult.fromJson(decoded);
        } catch (e) {
          throw MatchmakingTransportError('Bad success payload: $e');
        }
      case 400:
        throw MatchmakingBadRequest(
          decoded['code']?.toString() ?? 'BAD_REQUEST',
        );
      case 401:
        throw MatchmakingAuthRejected(
          decoded['code']?.toString() ?? 'AUTH_REJECTED',
        );
      case 403:
        throw MatchmakingForbidden(decoded['code']?.toString() ?? 'FORBIDDEN');
      case 409:
        throw MatchmakingActiveRoom(
          decoded['code']?.toString() ?? 'ACTIVE_ROOM',
          roomId: decoded['roomId']?.toString() ?? '',
        );
      case 410:
        throw MatchmakingRoomGone(decoded['code']?.toString() ?? 'ROOM_GONE');
      default:
        throw MatchmakingTransportError(
          'Unexpected status ${response.statusCode}: ${response.body}',
        );
    }
  }
}
