import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:shell/models/user_profile.dart';
import 'package:shell/router.dart';

class _SignedInAuth implements AuthStateInterface {
  @override
  bool get isSignedIn => true;

  @override
  UserProfile get currentUser =>
      const UserProfile(userId: 'u1', displayName: 'Test Player');

  @override
  String? get sessionToken => 'session-token';

  @override
  Future<void> signOut() async {}
}

void main() {
  group('Router character select flow', () {
    late GoRouter router;

    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    tearDown(() => router.dispose());

    testWidgets('mode selection routes to character select before match',
        (tester) async {
      router = createRouter(auth: _SignedInAuth());
      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('practice_button')));
      await tester.pumpAndSettle();

      expect(find.text('Choose Your Character'), findsOneWidget);
      expect(find.byKey(const Key('character_card_cat')), findsOneWidget);
    });
  });
}
