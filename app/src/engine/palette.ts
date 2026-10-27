import { hexToLinear } from './util';

// Irminsul Records palette: night ink for the record's page, bone for type, Celestia gold for the heavens and
// the Heavenly Principles, the seven element colours for the nations and their gods, Abyss violet and Crimson
// Moon red for Khaenri'ah and the Abyss. The engine's legacy keys (signal, ember, blood, acid, sodium, rust,
// tianyi, pink, sea) are kept as aliases so engine code keeps compiling.
export const HEX = {
  ink: '#060912', // the page: blue-black night
  ink2: '#101828', // raised night
  graphite: '#3B4660', // dim lines
  ash: '#8B93A8', // secondary text
  bone: '#EEE6D3', // primary type, engraved lines
  gold: '#E9C47E', // Celestia, the Heavenly Principles, the record's ink
  goldHot: '#FFE6B0',
  anemo: '#62D6B8',
  geo: '#F2B54A',
  electro: '#B48CFF',
  dendro: '#9CD84F',
  hydro: '#4DB6F5',
  pyro: '#FF7240',
  cryo: '#A9E6F4',
  abyss: '#7A3BD6',
  crimson: '#C8243F',
  sea: '#0E2C48',
  // legacy aliases
  signal: '#E9C47E',
  ember: '#FFE6B0',
  blood: '#C8243F',
  acid: '#62D6B8',
  sodium: '#E9C47E',
  rust: '#7A3BD6',
  tianyi: '#4DB6F5',
  pink: '#B48CFF',
} as const;

export type PaletteKey = keyof typeof HEX;
export const ELEMENTS = ['anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo'] as const;
export type Element = (typeof ELEMENTS)[number];

/** Linear RGB triplets for GL uniforms. */
export const LIN: Record<PaletteKey, [number, number, number]> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/** CSS rgba() for Canvas2D. */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Linear colour of a palette key (or a #hex), scaled. */
export function lin(key: PaletteKey | string, k = 1): [number, number, number] {
  const c = (LIN as Record<string, [number, number, number]>)[key] ?? hexToLinear(key);
  return [c[0] * k, c[1] * k, c[2] * k];
}
