import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:shell/screens/character_select_screen.dart';

Widget _subject({
  Future<String?> Function()? onLoadDefault,
  Future<void> Function(String characterId)? onConfirm,
  VoidCallback? onBack,
}) {
  return MaterialApp(
    home: CharacterSelectScreen(
      onLoadDefault: onLoadDefault ?? () async => 'cat',
      onConfirm: onConfirm ?? (_) async {},
      onBack: onBack ?? () {},
    ),
  );
}

void main() {
  group('CharacterSelectScreen', () {
    testWidgets('renders the cat roster card and skill summaries',
        (tester) async {
      await tester.pumpWidget(_subject());
      await tester.pump();

      expect(find.text('Choose Your Character'), findsOneWidget);
      expect(find.byKey(const Key('character_card_cat')), findsOneWidget);
      expect(find.text('Cat'), findsOneWidget);
      expect(find.text('Scratch'), findsOneWidget);
      expect(find.text('Strong Bite'), findsOneWidget);
      expect(find.text('Board Strike'), findsOneWidget);
    });

    testWidgets('continue calls onConfirm with selected id', (tester) async {
      String? selected;
      await tester.pumpWidget(_subject(
        onConfirm: (characterId) async {
          selected = characterId;
        },
      ));
      await tester.pump();

      await tester.tap(find.byKey(const Key('character_select_continue')));
      await tester.pump();

      expect(selected, 'cat');
    });

    testWidgets('back button calls onBack', (tester) async {
      var called = false;
      await tester.pumpWidget(_subject(onBack: () => called = true));
      await tester.pump();

      await tester.tap(find.byKey(const Key('character_select_back')));
      await tester.pump();

      expect(called, isTrue);
    });

    testWidgets('stale default falls back to cat', (tester) async {
      await tester.pumpWidget(_subject(onLoadDefault: () async => 'missing'));
      await tester.pump();

      expect(find.byIcon(Icons.check_circle), findsOneWidget);
    });
  });
}
