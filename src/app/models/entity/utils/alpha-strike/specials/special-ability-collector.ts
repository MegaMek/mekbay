/**
 * Collects Alpha Strike special abilities without parsing their serialized text.
 *
 * Each ability family owns its aggregation rule; serialization happens only when
 * the final special list is requested.
 */
export class AlphaStrikeSpecialAbilityCollector {
  readonly #abilities = new Set<string>();
  readonly #numericValues = new Map<string, number>();
  readonly #hyphenatedCounts = new Map<string, number>();

  add(ability: string): void {
    this.#abilities.add(ability);
  }

  addAll(abilities: Iterable<string>): void {
    for (const ability of abilities) this.add(ability);
  }

  addNumeric(ability: string, value: number): void {
    this.#numericValues.set(ability, (this.#numericValues.get(ability) ?? 0) + value);
  }

  addHyphenatedCount(ability: string, count = 1): void {
    this.#hyphenatedCounts.set(ability, (this.#hyphenatedCounts.get(ability) ?? 0) + count);
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
      ...[...this.#numericValues].map(([ability, value]) => `${ability}${value}`),
      ...[...this.#hyphenatedCounts].map(([ability, count]) => `${ability}-${count}`),
    ].sort();
  }
}
