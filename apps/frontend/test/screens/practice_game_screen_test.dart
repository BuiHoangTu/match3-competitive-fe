import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../lib/game_core/generator.dart';
import '../../lib/screens/practice_game_screen.dart';

void main() {
  testWidgets('Practice screen is score-only and has no result language',
      (tester) async {
    var left = false;
    await tester.pumpWidget(MaterialApp(
      home: PracticeGameScreen(
        characterId: 'cat',
        generator: SequenceTileGenerator([0, 1, 2, 3, 4, 2, 1, 0]),
        onLeave: () => left = true,
      ),
    ));

    expect(find.byKey(const Key('practice_score')), findsOneWidget);
    expect(find.textContaining('WIN'), findsNothing);
    expect(find.textContaining('LOSE'), findsNothing);
    expect(find.textContaining('DRAW'), findsNothing);

    await tester.tap(find.byTooltip('Leave practice'));
    expect(left, true);
  });
}
