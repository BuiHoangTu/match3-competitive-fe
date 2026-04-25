/// T-v0.6-F06 · Shell account HTTP client
///
/// Single endpoint:
///   POST /account/delete — anonymise match_history + delete users row +
///                           revoke Firebase user. Auth: Firebase idToken.
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

/// 401 — Firebase idToken invalid or expired.
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

class AccountClient {
  AccountClient({
    required this.baseUrl,
    HttpPoster? postFn,
  }) : _post = postFn ?? _defaultPost;

  /// Backend origin, e.g. `http://localhost:3001`. No trailing slash.
  final String baseUrl;
  final HttpPoster _post;

  static Future<http.Response> _defaultPost(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
  }) =>
      http.post(url, headers: headers, body: body);

  /// Delete the caller's account.
  ///
  /// Resolves on 200 (account fully deleted or already-deleted idempotent
  /// path). Throws on auth, active-match, or transport errors per the typed
  /// error hierarchy.
  Future<void> delete({required String idToken}) async {
    final uri = Uri.parse('$baseUrl/account/delete');
    late http.Response response;
    try {
      response = await _post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $idToken',
        },
        body: jsonEncode(const <String, Object?>{}),
      );
    } on Exception catch (e) {
      throw AccountDeleteTransportError('Network error: $e');
    }

    final status = response.statusCode;
    if (status == 200) return;

    if (status == 401) {
      throw const AccountDeleteAuthRejected('idToken rejected by server');
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
}
