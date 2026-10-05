String? readPendingIntent() => null;

String? readPendingState() => null;

void clearPendingIntent() {}

void removeCallbackParameters() {}

void savePendingIntent(String intent, {String? state}) {}

Future<void> navigateTo(String url) async {
  throw UnsupportedError('Google sign-in is available on web only.');
}
