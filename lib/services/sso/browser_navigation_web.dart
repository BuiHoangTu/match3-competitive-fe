// ignore_for_file: deprecated_member_use

import 'package:web/web.dart' as web;

const _pendingIntentKey = 'googleAuth.pendingIntent';
const _pendingStateKey = 'googleAuth.pendingState';

String? readPendingIntent() =>
    web.window.sessionStorage.getItem(_pendingIntentKey);

String? readPendingState() =>
    web.window.sessionStorage.getItem(_pendingStateKey);

void clearPendingIntent() {
  web.window.sessionStorage.removeItem(_pendingIntentKey);
  web.window.sessionStorage.removeItem(_pendingStateKey);
}

void savePendingIntent(String intent, {String? state}) {
  web.window.sessionStorage.setItem(_pendingIntentKey, intent);
  if (state == null) {
    web.window.sessionStorage.removeItem(_pendingStateKey);
  } else {
    web.window.sessionStorage.setItem(_pendingStateKey, state);
  }
}

void removeCallbackParameters() {
  final current = Uri.parse(web.window.location.href);
  if (current.fragment.startsWith('/')) {
    final route = Uri.parse(current.fragment);
    final cleanRoute = route.replace(query: '', fragment: '').toString();
    web.window.history.replaceState(
      web.window.history.state,
      '',
      current.replace(query: '', fragment: cleanRoute).toString(),
    );
    return;
  }
  web.window.history.replaceState(
    web.window.history.state,
    '',
    current.replace(query: '', fragment: '').toString(),
  );
}

Future<void> navigateTo(String url) async {
  web.window.location.assign(url);
}
