import { AlphaStrikeSpecialAbilityCollector } from './special-ability-collector';

describe('AlphaStrikeSpecialAbilityCollector', () => {
  it('deduplicates plain abilities and returns deterministic ordering', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();

    collector.add('TAG');
    collector.add('AMS');
    collector.add('TAG');

    expect(collector.toArray()).toEqual(['AMS', 'TAG']);
  });

  it('aggregates numeric abilities without inspecting serialized values', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();

    collector.addNumeric('MHQ', 2);
    collector.addNumeric('MHQ', 3);
    collector.addNumeric('TSEMP', 1);

    expect(collector.toArray()).toEqual(['MHQ5', 'TSEMP1']);
  });

  it('aggregates artillery-style hyphenated counts independently', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();

    collector.addHyphenatedCount('ARTS');
    collector.addHyphenatedCount('ARTS', 2);
    collector.addHyphenatedCount('ARTLT');

    expect(collector.toArray()).toEqual(['ARTLT-1', 'ARTS-3']);
  });

  it('aggregates optional counts and omits a count of one', () => {
    const single = new AlphaStrikeSpecialAbilityCollector();
    single.addOptionalCount('C3M');
    expect(single.toArray()).toEqual(['C3M']);

    const multiple = new AlphaStrikeSpecialAbilityCollector();
    multiple.addOptionalCount('C3M');
    multiple.addOptionalCount('C3M');
    expect(multiple.toArray()).toEqual(['C3M2']);
  });

  it('floors accumulated MHQ only when serialized', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();
    collector.addNumeric('MHQ', 1.5);
    collector.addNumeric('MHQ', 2.5);

    expect(collector.toArray()).toEqual(['MHQ4']);
  });

  it('merges typed values across converter boundaries before serialization', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();
    const first = new AlphaStrikeSpecialAbilityCollector();
    const second = new AlphaStrikeSpecialAbilityCollector();
    first.add('TAG');
    first.addNumeric('MHQ', 1.5);
    first.addHyphenatedCount('ARTS');
    first.addOptionalCount('C3M');
    second.add('TAG');
    second.addNumeric('MHQ', 2);
    second.addHyphenatedCount('ARTS', 2);
    second.addOptionalCount('C3M');

    collector.merge(first);
    collector.merge(second);

    expect(collector.toArray()).toEqual(['ARTS-3', 'C3M2', 'MHQ3', 'TAG']);
  });

  it('serializes canonical one-shot TSEMP names without aliases', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();
    collector.addNumeric('TSEMP-O', 2);

    expect(collector.toArray()).toEqual(['TSEMP-O2']);
  });

  it('does not change a merged source collector', () => {
    const source = new AlphaStrikeSpecialAbilityCollector();
    const target = new AlphaStrikeSpecialAbilityCollector();
    source.addNumeric('DCC', 2);

    target.merge(source);
    target.addNumeric('DCC', 1);

    expect(source.toArray()).toEqual(['DCC2']);
    expect(target.toArray()).toEqual(['DCC3']);
  });

  it('keeps plain, numeric, and hyphenated forms separate', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();

    collector.add('ARTS');
    collector.addNumeric('ARTS', 2);
    collector.addHyphenatedCount('ARTS', 3);

    expect(collector.toArray()).toEqual(['ARTS', 'ARTS-3', 'ARTS2']);
  });

  it('supports membership checks and removal of plain abilities', () => {
    const collector = new AlphaStrikeSpecialAbilityCollector();
    collector.addAll(['CASE', 'CASEII']);

    expect(collector.has('CASE')).toBeTrue();
    collector.delete('CASE');

    expect(collector.has('CASE')).toBeFalse();
    expect(collector.toArray()).toEqual(['CASEII']);
  });
});
