import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:shell/services/character_preference.dart';

void main() {
  group('CharacterPreference', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('defaults to cat when no preference exists', () async {
      const service = CharacterPreference();

      expect(await service.getDefaultCharacter(), 'cat');
    });

    test('persists the selected character id', () async {
      const service = CharacterPreference();

      await service.setDefaultCharacter('cat');

      expect(await service.getDefaultCharacter(), 'cat');
    });
  });
}
