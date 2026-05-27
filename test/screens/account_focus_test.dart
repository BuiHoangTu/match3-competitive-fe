// T-v0.7-01 · Account screen keyboard focus tests
//
// Verifies account actions and fixed-layout match history behavior.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:shell/models/user_profile.dart';
import 'package:shell/screens/account_screen.dart';
import 'package:shell/services/account_client.dart';

const _kProfile = UserProfile(userId: 'u1', displayName: 'Player');

Widget _buildSubject({VoidCallback? onLogout}) {
  return MaterialApp(
    home: AccountScreen(
      profile: _kProfile,
      onBack: () {},
      onLogout: onLogout ?? () {},
    ),
  );
}

void main() {
  group('AccountScreen — keyboard focus traversal (T-v0.7-01)', () {
    testWidgets('back button renders', (tester) async {
      await tester.pumpWidget(_buildSubject());
      expect(find.byKey(const Key('account_back_button')), findsOneWidget);
    });

    testWidgets('logout button renders and calls onLogout', (tester) async {
      var logoutCalled = false;
      await tester.pumpWidget(
        _buildSubject(onLogout: () => logoutCalled = true),
      );

      await tester.tap(find.byKey(const Key('logout_button')));
      await tester.pump();

      expect(logoutCalled, isTrue);
    });

    testWidgets('latest match history renders character result and time',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: AccountScreen(
          profile: _kProfile,
          onBack: () {},
          onLogout: () {},
          loadMatchHistory: () async => [
            AccountMatchHistoryEntry(
              matchId: 'm1',
              p1UserId: 'u1',
              p2UserId: 'u2',
              outcome: 'P1_WIN',
              endedAt: DateTime.utc(2026, 5, 27, 10, 30),
              characterId: 'cat',
            ),
          ],
        ),
      ));
      await tester.pump();
      await tester.pump();

      expect(find.text('Cat'), findsOneWidget);
      expect(find.text('WIN'), findsOneWidget);
      expect(find.byKey(const Key('match_history_time')), findsOneWidget);
      final rowSize =
          tester.getSize(find.byKey(const Key('match_history_row')));
      expect(rowSize.height, greaterThanOrEqualTo(84));
    });

    testWidgets('long match history scrolls inside fixed account screen',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: AccountScreen(
          profile: _kProfile,
          onBack: () {},
          onLogout: () {},
          loadMatchHistory: () async => [
            for (var i = 0; i < 20; i++)
              AccountMatchHistoryEntry(
                matchId: 'm$i',
                p1UserId: 'u1',
                p2UserId: 'u2',
                outcome: 'P1_WIN',
                endedAt: DateTime.utc(2026, 5, 27, 10, i),
                characterId: 'cat_$i',
              ),
          ],
        ),
      ));
      await tester.pump();
      await tester.pump();

      expect(find.byKey(const Key('logout_button')), findsOneWidget);
      expect(find.byKey(const Key('match_history_list')), findsOneWidget);
      expect(find.text('Cat 19'), findsNothing);

      final historyScrollable = find.descendant(
        of: find.byKey(const Key('match_history_list')),
        matching: find.byType(Scrollable),
      );
      await tester.scrollUntilVisible(
        find.text('Cat 19'),
        220,
        scrollable: historyScrollable,
        maxScrolls: 12,
      );

      expect(find.text('Cat 19'), findsOneWidget);
      expect(find.byKey(const Key('logout_button')), findsOneWidget);
      expect(find.byKey(const Key('delete_account_button')), findsNothing);
    });
  });
}
