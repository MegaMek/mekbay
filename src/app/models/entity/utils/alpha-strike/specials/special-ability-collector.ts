/**
 * Collects Alpha Strike special abilities without parsing their serialized text.
 *
 * Each ability family owns its aggregation rule; serialization happens only when
 * the final special list is requested.
 */
type NumericAbilityFormat = Readonly<{
  normalize: (value: number) => number;
}>;

const NUMERIC_ABILITY_FORMATS: Readonly<Partial<Record<string, NumericAbilityFormat>>> = {
  MHQ: { normalize: Math.floor },
};

export class AlphaStrikeSpecialAbilityCollector {
  readonly #abilities = new Set<string>();
  readonly #numericValues = new Map<string, number>();
  readonly #hyphenatedCounts = new Map<string, number>();
  readonly #optionalCounts = new Map<string, number>();

  add(ability: string): void {
    this.#abilities.add(ability);
  }

  addAll(abilities: Iterable<string>): void {
    for (const ability of abilities) this.add(ability);
  }

  merge(other: AlphaStrikeSpecialAbilityCollector): void {
    this.addAll(other.#abilities);
    for (const [ability, value] of other.#numericValues) this.addNumeric(ability, value);
    for (const [ability, count] of other.#hyphenatedCounts) this.addHyphenatedCount(ability, count);
    for (const [ability, count] of other.#optionalCounts) this.addOptionalCount(ability, count);
  }

  addNumeric(ability: string, value: number): void {
    this.#numericValues.set(ability, (this.#numericValues.get(ability) ?? 0) + value);
  }

  addHyphenatedCount(ability: string, count = 1): void {
    this.#hyphenatedCounts.set(ability, (this.#hyphenatedCounts.get(ability) ?? 0) + count);
  }

  /** Adds an ability whose count is omitted when exactly one. */
  addOptionalCount(ability: string, count = 1): void {
    this.#optionalCounts.set(ability, (this.#optionalCounts.get(ability) ?? 0) + count);
  }

  has(ability: string): boolean {
    return this.#abilities.has(ability);
  }

  delete(ability: string): void {
    this.#abilities.delete(ability);
  }

  toArray(): string[] {
    return [
      ...this.#abilities,
      ...[...this.#numericValues].map(([ability, value]) => {
        const normalizedValue = NUMERIC_ABILITY_FORMATS[ability]?.normalize(value) ?? value;
        return `${ability}${normalizedValue}`;
      }),
      ...[...this.#hyphenatedCounts].map(([ability, count]) => `${ability}-${count}`),
      ...[...this.#optionalCounts].map(([ability, count]) => `${ability}${count === 1 ? '' : count}`),
    ].sort();
  }
}
