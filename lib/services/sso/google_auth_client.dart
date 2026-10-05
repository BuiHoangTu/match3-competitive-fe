import 'dart:convert';

import 'package:http/http.dart' as http;

import 'browser_navigation_stub.dart'
    if (dart.library.html) 'browser_navigation_web.dart' as browser;

typedef GoogleAuthPoster = Future<http.Response> Function(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
});

class GoogleAuthError implements Exception {
  const GoogleAuthError(this.message);

  final String message;

  @override
  String toString() => 'GoogleAuthError($message)';
}

class GoogleLoginSession {
  const GoogleLoginSession({
    required this.sessionToken,
    required this.userId,
    required this.expiresAt,
  });

  final String sessionToken;
  final String userId;
  final int expiresAt;
}

class GoogleLinkAuthorization {
  const GoogleLinkAuthorization({
    required this.authorizationUrl,
    required this.state,
  });

  final Uri authorizationUrl;
  final String state;
}

class GoogleAuthClient {
  static bool hasMatchingLinkState(String? expected, String? received) =>
      expected != null && expected.isNotEmpty && received == expected;

  GoogleAuthClient({required this.baseUrl, GoogleAuthPoster? postFn})
      : _post = postFn ?? _defaultPost;

  final String baseUrl;
  final GoogleAuthPoster _post;

  Uri get loginStartUri => _startUri('login');
  String? get pendingIntent => browser.readPendingIntent();
  bool get isPendingLink => pendingIntent == 'link';
  String? get pendingState => browser.readPendingState();

  void clearPendingIntent() => browser.clearPendingIntent();
  void removeCallbackParameters() => browser.removeCallbackParameters();

  static Future<http.Response> _defaultPost(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
  }) =>
      http.post(url, headers: headers, body: body);

  Uri _startUri(String intent) => Uri.parse(
        '$baseUrl/auth/google/start',
      ).replace(queryParameters: {'intent': intent});

  /// Starts the browser's top-level OAuth navigation without sending an
  /// application or provider token through the URL.
  Future<void> startLogin() {
    browser.savePendingIntent('login');
    return browser.navigateTo(loginStartUri.toString());
  }

  Future<void> navigateToAuthorizationUrl(
    GoogleLinkAuthorization authorization, {
    required String intent,
  }) {
    browser.savePendingIntent(intent, state: authorization.state);
    return browser.navigateTo(authorization.authorizationUrl.toString());
  }

  /// Explicit linking requires an authenticated POST. The browser cannot
  /// attach a bearer header to a top-level navigation, so the backend returns
  /// its provider authorization URL for the subsequent browser navigation.
  Future<GoogleLinkAuthorization> startLink({
    required String sessionToken,
  }) async {
    late http.Response response;
    try {
      response = await _post(
        Uri.parse('$baseUrl/auth/google/start'),
        headers: {
          'Authorization': 'Bearer $sessionToken',
          'Content-Type': 'application/json',
        },
        body: jsonEncode(const {'intent': 'link'}),
      );
    } on Exception {
      throw const GoogleAuthError(
        'Google could not be connected. Please try again from Account settings.',
      );
    }

    if (response.statusCode != 200) {
      throw const GoogleAuthError(
        'Google could not be connected. Please try again from Account settings.',
      );
    }

    try {
      final payload = jsonDecode(response.body) as Map<String, dynamic>;
      final authorizationUrl = payload['authorizationUrl'];
      if (authorizationUrl is String) {
        final uri = Uri.parse(authorizationUrl);
        final state = payload['state'];
        final urlState = uri.queryParameters['state'];
        final expectedState = state is String ? state : urlState;
        if (uri.scheme == 'https' &&
            expectedState != null &&
            expectedState.isNotEmpty &&
            (urlState == null || urlState == expectedState)) {
          return GoogleLinkAuthorization(
            authorizationUrl: uri,
            state: expectedState,
          );
        }
      }
    } on FormatException {
      // Report the same safe, actionable error as other link failures.
    } on TypeError {
      // Malformed backend payloads must not be treated as a successful start.
    }
    throw const GoogleAuthError(
      'Google could not be connected. Please try again from Account settings.',
    );
  }

  Future<GoogleLoginSession> exchangeLoginCode(String code) async {
    final payload = await _exchange(code);
    final sessionToken = payload['sessionToken'];
    final userId = payload['userId'];
    final expiresAt = _readExpiresAt(payload['expiresAt']);
    if (sessionToken is! String ||
        sessionToken.isEmpty ||
        userId is! String ||
        userId.isEmpty ||
        expiresAt == null ||
        expiresAt <= DateTime.now().millisecondsSinceEpoch) {
      throw const GoogleAuthError(
        'Google sign-in could not be completed. Please try again.',
      );
    }
    return GoogleLoginSession(
      sessionToken: sessionToken,
      userId: userId,
      expiresAt: expiresAt,
    );
  }

  Future<void> exchangeLinkCode({
    required String code,
    required String sessionToken,
    required String userId,
  }) async {
    final payload = await _exchange(code, sessionToken: sessionToken);
    if (payload['linked'] != true || payload['userId'] != userId) {
      throw const GoogleAuthError(
        'Google could not be connected. Please try again from Account settings.',
      );
    }
  }

  Future<Map<String, dynamic>> _exchange(
    String code, {
    String? sessionToken,
  }) async {
    late http.Response response;
    try {
      response = await _post(
        Uri.parse('$baseUrl/auth/google/exchange'),
        headers: {
          'Content-Type': 'application/json',
          if (sessionToken != null) 'Authorization': 'Bearer $sessionToken',
        },
        body: jsonEncode({'code': code}),
      );
    } on Exception {
      throw GoogleAuthError(
        sessionToken == null
            ? 'Google sign-in could not be completed. Please try again. '
                'If you already have an account, sign in with your username '
                'and password, then connect Google from Account settings.'
            : 'Google could not be connected. Please try again from Account settings.',
      );
    }

    if (response.statusCode != 200) {
      throw GoogleAuthError(_exchangeErrorMessage(sessionToken: sessionToken));
    }

    try {
      return jsonDecode(response.body) as Map<String, dynamic>;
    } on FormatException {
      throw GoogleAuthError(
        _exchangeErrorMessage(sessionToken: sessionToken),
      );
    } on TypeError {
      throw GoogleAuthError(
        _exchangeErrorMessage(sessionToken: sessionToken),
      );
    }
  }

  String _exchangeErrorMessage({required String? sessionToken}) {
    if (sessionToken != null) {
      return 'Google could not be connected. Please check that you are signed '
          'in to the account you want to keep, then try again from Account settings.';
    }
    return 'Google sign-in could not be completed. Please try again.';
  }

  int? _readExpiresAt(Object? value) {
    if (value is num) {
      final timestamp = value.toInt();
      return timestamp < 10000000000 ? timestamp * 1000 : timestamp;
    }
    if (value is String) {
      return DateTime.tryParse(value)?.millisecondsSinceEpoch;
    }
    return null;
  }
}
