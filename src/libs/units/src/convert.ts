import { DEFAULT_UNITS, type Dimension, type UnitDefinition } from './registry.js';

/** Profile setting per dimension (FR-PRF-06). */
export type UnitPreferences = Partial<Record<Dimension, 'METRIC' | 'IMPERIAL'>>;

/** Tracker display units: "<activity>.<param>" or "*.<dimension>" → unit code (FR-TRK-09). */
export type DisplayUnits = Record<string, string>;

/** Canonical values are stored with this many decimals (LLD §3.1) so round trips are exact on screen. */
export const CANONICAL_DECIMALS = 6;

export class UnitRegistry {
  private readonly byCode: Map<string, UnitDefinition>;

  constructor(units: readonly UnitDefinition[] = DEFAULT_UNITS) {
    this.byCode = new Map(units.map((x) => [x.code, x]));
  }

  get(code: string): UnitDefinition | undefined {
    return this.byCode.get(code);
  }

  /** Units a picker may offer for a canonical unit: every unit of the same dimension. */
  alternatives(code: string): UnitDefinition[] {
    const dim = this.byCode.get(code)?.dimension;
    return dim ? [...this.byCode.values()].filter((x) => x.dimension === dim) : [];
  }

  isConvertible(from: string, to: string): boolean {
    const a = this.byCode.get(from);
    const b = this.byCode.get(to);
    return !!a?.dimension && a.dimension === b?.dimension && a.toBase !== null && b.toBase !== null;
  }

  /** Linear conversion; identity when both codes are equal. Throws on cross-dimension requests. */
  convert(value: number, from: string, to: string): number {
    if (from === to) return value;
    if (!this.isConvertible(from, to)) throw new Error(`Cannot convert ${from} to ${to}`);
    return (value * this.byCode.get(from)!.toBase!) / this.byCode.get(to)!.toBase!;
  }

  /** Display → canonical, rounded to CANONICAL_DECIMALS before it is stored. */
  toCanonical(value: number, displayUnit: string, canonicalUnit: string): number {
    return round(this.convert(value, displayUnit, canonicalUnit), CANONICAL_DECIMALS);
  }

  /** Canonical → display, rounded to the display unit's decimals. */
  toDisplay(value: number, canonicalUnit: string, displayUnit: string): number {
    return round(this.convert(value, canonicalUnit, displayUnit), this.byCode.get(displayUnit)?.decimals ?? 2);
  }

  /** Converts a min/max range for display, rounding inwards so any shown value is valid. */
  rangeToDisplay(min: number | undefined, max: number | undefined, canonical: string, display: string) {
    const d = this.byCode.get(display)?.decimals ?? 2;
    const f = 10 ** d;
    return {
      min: min === undefined ? undefined : Math.ceil(this.convert(min, canonical, display) * f - 1e-9) / f,
      max: max === undefined ? undefined : Math.floor(this.convert(max, canonical, display) * f + 1e-9) / f,
    };
  }

  /**
   * Picks the unit shown for a parameter (LLD §3.1): tracker parameter choice → tracker dimension
   * choice → profile METRIC/IMPERIAL via counterpart → canonical unit.
   */
  resolveDisplayUnit(args: {
    canonicalUnit: string;
    activityCode: string;
    paramKey: string;
    displayUnits?: DisplayUnits;
    preferences?: UnitPreferences;
  }): string {
    const canonical = this.byCode.get(args.canonicalUnit);
    if (!canonical?.dimension) return args.canonicalUnit;
    const pick = (code: string | undefined) =>
      code && this.isConvertible(args.canonicalUnit, code) ? code : undefined;
    const explicit =
      pick(args.displayUnits?.[`${args.activityCode}.${args.paramKey}`]) ??
      pick(args.displayUnits?.[`*.${canonical.dimension}`]);
    if (explicit) return explicit;
    const system = args.preferences?.[canonical.dimension];
    if (system === 'IMPERIAL' && canonical.system !== 'IMPERIAL' && canonical.counterpart) return canonical.counterpart;
    if (system === 'METRIC' && canonical.system === 'IMPERIAL' && canonical.counterpart) return canonical.counterpart;
    return args.canonicalUnit;
  }
}

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
