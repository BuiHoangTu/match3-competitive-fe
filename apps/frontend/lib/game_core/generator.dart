library;

import 'dart:math';

abstract interface class TileGenerator {
  int nextTile(int symbolCount);
}

class RandomTileGenerator implements TileGenerator {
  RandomTileGenerator([Random? random]) : _random = random ?? Random.secure();

  final Random _random;

  @override
  int nextTile(int symbolCount) => _random.nextInt(symbolCount);
}

class SequenceTileGenerator implements TileGenerator {
  SequenceTileGenerator(this.values);

  final List<int> values;
  int _index = 0;

  @override
  int nextTile(int symbolCount) {
    if (values.isEmpty) return 0;
    final value = values[_index % values.length] % symbolCount;
    _index += 1;
    return value;
  }
}
