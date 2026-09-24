import type { Garment } from './types';
import { GARMENT_SPECS } from './data';

/**
 * React Native catalog: the shared specs with bundled artwork attached.
 *
 * Metro resolves `require()` at build time, so the map has to be written out
 * literally - a computed path would not be bundled.
 */
const IMAGES: Record<string, number> = {
  'tee-white': require('../../assets/garments/tee-white.png'),
  'tee-navy': require('../../assets/garments/tee-navy.png'),
  'henley-olive': require('../../assets/garments/henley-olive.png'),
  'oxford-sky': require('../../assets/garments/oxford-sky.png'),
  'knit-rust': require('../../assets/garments/knit-rust.png'),
  'bomber-black': require('../../assets/garments/bomber-black.png'),
  'trench-camel': require('../../assets/garments/trench-camel.png'),
  'dress-emerald': require('../../assets/garments/dress-emerald.png'),
};

export const GARMENTS: Garment[] = GARMENT_SPECS.map((spec) => {
  const image = IMAGES[spec.id];
  if (image == null) {
    throw new Error(`No bundled artwork for garment "${spec.id}"`);
  }
  return { ...spec, image };
});

export function garmentById(id: string): Garment | undefined {
  return GARMENTS.find((g) => g.id === id);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}
