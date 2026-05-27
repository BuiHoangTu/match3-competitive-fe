/// T-v0.6-F06 · Shell account HTTP client
///
/// Endpoints:
///   POST /account/delete — anonymise match_history + delete users row.
///                           Auth: app session token.
///   GET  /user/history   — latest completed matches for the caller.
///
/// On success the shell signs out and routes back to /sign-in.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Errors thrown by [AccountClient.delete].
sealed class AccountDeleteError implements Exception {
  const AccountDeleteError(this.message);
  final String message;
  @override
  String toString() => 'AccountDeleteError($message)';
}

/// 401 — app session token invalid or expired.
class AccountDeleteAuthRejected extends AccountDeleteError {
  const AccountDeleteAuthRejected(super.message);
}

/// 409 — caller has an active match (AR-7). Caller must leave the match
/// before deletion is permitted.
class AccountDeleteActiveMatch extends AccountDeleteError {
  const AccountDeleteActiveMatch(super.message);
}

/// 5xx / network failures.
class AccountDeleteTransportError extends AccountDeleteError {
  const AccountDeleteTransportError(super.message);
}

typedef HttpPoster = Future<http.Response> Function(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
});

typedef HttpGetter = Future<http.Response> Function(
  Uri url, {
  Map<String, String>? headers,
});

class AccountMatchHistoryEntry {
  const AccountMatchHistoryEntry({
    required this.matchId,
    required this.p1UserId,
    required this.p2UserId,
    required this.outcome,
    required this.endedAt,
    required this.characterId,
    this.p1CharacterId,
    this.p2CharacterId,
  });

  final String matchId;
  final String? p1UserId;
  final String? p2UserId;
  final String outcome;
  final DateTime endedAt;
  final String characterId;
  final String? p1CharacterId;
  final String? p2CharacterId;

  bool? didUserWin(String userId) {
    if (outcome == 'DRAW') return null;
    if (p1UserId == userId) return outcome == 'P1_WIN';
    if (p2UserId == userId) return outcome == 'P2_WIN';
    return null;
  }

  String characterIdForUser(String userId) {
    if (p1UserId == userId) return p1CharacterId ?? characterId;
    if (p2UserId == userId) return p2CharacterId ?? characterId;
    return characterId;
  }

  factory AccountMatchHistoryEntry.fromJson(Map<String, dynamic> json) {
    final p1UserId = json['p1UserId'] as String?;
    final p2UserId = json['p2UserId'] as String?;
    final p1CharacterId = _readCharacterForUser(json, p1UserId);
    final p2CharacterId = _readCharacterForUser(json, p2UserId);
    final characterId = _readFallbackCharacterId(
      json,
      p1CharacterId,
      p2CharacterId,
    );
    return AccountMatchHistoryEntry(
      matchId: json['matchId'] as String,
      p1UserId: p1UserId,
      p2UserId: p2UserId,
      outcome: json['outcome'] as String,
      endedAt: DateTime.parse(json['endedAt'] as String),
      characterId: characterId,
      p1CharacterId: p1CharacterId,
      p2CharacterId: p2CharacterId,
    );
  }
}

class AccountClient {
  AccountClient({
    required this.baseUrl,
    HttpPoster? postFn,
    HttpGetter? getFn,
  })  : _post = postFn ?? _defaultPost,
        _get = getFn ?? _defaultGet;

  /// Backend origin, e.g. `http://localhost:3001`. No trailing slash.
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

  /// Delete the caller's account.
  ///
  /// Resolves on 200 (account fully deleted or already-deleted idempotent
  /// path). Throws on auth, active-match, or transport errors per the typed
  /// error hierarchy.
  Future<void> delete({required String sessionToken}) async {
    final uri = Uri.parse('$baseUrl/account/delete');
    late http.Response response;
    try {
      response = await _post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $sessionToken',
        },
        body: jsonEncode(const <String, Object?>{}),
      );
    } on Exception catch (e) {
      throw AccountDeleteTransportError('Network error: $e');
    }

    final status = response.statusCode;
    if (status == 200) return;

    if (status == 401) {
      throw const AccountDeleteAuthRejected('sessionToken rejected by server');
    }
    if (status == 409) {
      throw const AccountDeleteActiveMatch(
        'Cannot delete while a match is active',
      );
    }
    throw AccountDeleteTransportError(
      'Unexpected status $status: ${response.body}',
    );
  }

  Future<List<AccountMatchHistoryEntry>> history({
    required String sessionToken,
    int limit = 20,
  }) async {
    final uri = Uri.parse('$baseUrl/user/history')
        .replace(queryParameters: {'limit': '$limit'});
    late http.Response response;
    try {
      response = await _get(
        uri,
        headers: {'Authorization': 'Bearer $sessionToken'},
      );
    } on Exception catch (e) {
      throw AccountDeleteTransportError('Network error: $e');
    }

    final status = response.statusCode;
    if (status == 401) {
      throw const AccountDeleteAuthRejected('sessionToken rejected by server');
    }
    if (status != 200) {
      throw AccountDeleteTransportError(
        'Unexpected status $status: ${response.body}',
      );
    }

    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final rows = decoded['rows'] as List<dynamic>? ?? const [];
    return [
      for (final row in rows)
        AccountMatchHistoryEntry.fromJson(row as Map<String, dynamic>),
    ];
  }
}

String _readFallbackCharacterId(
  Map<String, dynamic> json,
  String? p1CharacterId,
  String? p2CharacterId,
) {
  final direct = json['characterId'] ?? json['character'];
  if (direct is String && direct.isNotEmpty) return direct;

  if (p1CharacterId != null && p1CharacterId.isNotEmpty) return p1CharacterId;
  if (p2CharacterId != null && p2CharacterId.isNotEmpty) return p2CharacterId;

  // Cat is the only playable character in this phase; older history rows do
  // not persist character metadata yet.
  return 'cat';
}

String? _readCharacterForUser(Map<String, dynamic> json, String? userId) {
  if (userId == null) return null;
  final characters = json['characters'];
  if (characters is Map<String, dynamic>) {
    final characterId = characters[userId];
    if (characterId is String && characterId.isNotEmpty) return characterId;
  }
  return null;
}
