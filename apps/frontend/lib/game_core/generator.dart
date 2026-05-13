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

class TileStreamGenerator implements TileGenerator {
  TileStreamGenerator(this.values);

  final List<int> values;
  int _index = 0;

  int get consumed => _index;
  int get remaining => values.length - _index;
  bool get isExhausted => _index >= values.length;

  @override
  int nextTile(int symbolCount) {
    if (_index >= values.length) {
      throw StateError('generated tile stream is exhausted');
    }
    final value = values[_index];
    _index += 1;
    return value % symbolCount;
  }
}
