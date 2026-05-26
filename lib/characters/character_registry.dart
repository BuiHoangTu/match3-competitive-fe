library;

export 'character.dart';

import 'character.dart';
import 'cat/cat_character.dart';

const Map<String, CharacterData> characterRegistry = {
  'cat': catCharacter,
};

CharacterData characterById(String? characterId) =>
    characterRegistry[characterId] ?? catCharacter;
