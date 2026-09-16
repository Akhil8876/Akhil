import type { Garment, SizeChartEntry } from './types';

/**
 * Anchor numbers below are the output of `scripts/generate_garments.py`, which
 * draws every piece on a 1024x1024 canvas with the shoulder seam at y=240.
 * If you replace the artwork with real product cut-outs, re-measure these
 * three values per garment and the fitting maths needs no other change.
 */
const CANVAS = 1024;
const SHOULDER_Y = 240;

function anchors(shoulderWidth: number, torsoLength: number) {
  return {
    width: CANVAS,
    height: CANVAS,
    shoulderMid: { x: CANVAS / 2, y: SHOULDER_Y },
    shoulderWidth,
    torsoLength,
  };
}

/** Straight-cut unisex sizing, shoulder breadth in cm. */
const STANDARD_SIZES: SizeChartEntry[] = [
  { label: 'XS', shoulderCm: [36, 39], chestCm: 86 },
  { label: 'S', shoulderCm: [39, 42], chestCm: 94 },
  { label: 'M', shoulderCm: [42, 45], chestCm: 102 },
  { label: 'L', shoulderCm: [45, 48], chestCm: 110 },
  { label: 'XL', shoulderCm: [48, 51], chestCm: 118 },
  { label: 'XXL', shoulderCm: [51, 55], chestCm: 126 },
];

/** Outerwear is cut over a layer, so each band sits a little wider. */
const OUTERWEAR_SIZES: SizeChartEntry[] = [
  { label: 'S', shoulderCm: [38, 42], chestCm: 100 },
  { label: 'M', shoulderCm: [42, 46], chestCm: 108 },
  { label: 'L', shoulderCm: [46, 50], chestCm: 116 },
  { label: 'XL', shoulderCm: [50, 54], chestCm: 124 },
];

export const GARMENTS: Garment[] = [
  {
    id: 'tee-white',
    name: 'Heavyweight Tee',
    brand: 'Loom & Co.',
    category: 'top',
    priceCents: 3200,
    colorway: 'Chalk',
    image: require('../../assets/garments/tee-white.png'),
    anchors: anchors(464, 460),
    shoulderEase: 1.06,
    lengthEase: 1.32,
    sizes: STANDARD_SIZES,
  },
  {
    id: 'tee-navy',
    name: 'Heavyweight Tee',
    brand: 'Loom & Co.',
    category: 'top',
    priceCents: 3200,
    colorway: 'Deep Navy',
    image: require('../../assets/garments/tee-navy.png'),
    anchors: anchors(464, 460),
    shoulderEase: 1.06,
    lengthEase: 1.32,
    sizes: STANDARD_SIZES,
  },
  {
    id: 'henley-olive',
    name: 'Long-Sleeve Henley',
    brand: 'Northbound',
    category: 'top',
    priceCents: 5400,
    colorway: 'Field Olive',
    image: require('../../assets/garments/henley-olive.png'),
    anchors: anchors(476, 486),
    shoulderEase: 1.08,
    lengthEase: 1.34,
    sizes: STANDARD_SIZES,
  },
  {
    id: 'oxford-sky',
    name: 'Oxford Shirt',
    brand: 'Northbound',
    category: 'top',
    priceCents: 7800,
    colorway: 'Pale Sky',
    image: require('../../assets/garments/oxford-sky.png'),
    anchors: anchors(488, 502),
    shoulderEase: 1.1,
    lengthEase: 1.38,
    sizes: STANDARD_SIZES,
  },
  {
    id: 'knit-rust',
    name: 'Lambswool Crew',
    brand: 'Atelier Six',
    category: 'top',
    priceCents: 11900,
    colorway: 'Burnt Rust',
    image: require('../../assets/garments/knit-rust.png'),
    anchors: anchors(496, 508),
    shoulderEase: 1.12,
    lengthEase: 1.3,
    sizes: STANDARD_SIZES,
  },
  {
    id: 'bomber-black',
    name: 'MA-1 Bomber',
    brand: 'Atelier Six',
    category: 'outerwear',
    priceCents: 18500,
    colorway: 'Jet Black',
    image: require('../../assets/garments/bomber-black.png'),
    anchors: anchors(552, 460),
    // Outerwear sits over whatever the wearer already has on.
    shoulderEase: 1.18,
    lengthEase: 1.26,
    sizes: OUTERWEAR_SIZES,
  },
  {
    id: 'trench-camel',
    name: 'Belted Trench',
    brand: 'Maison Rue',
    category: 'outerwear',
    priceCents: 32000,
    colorway: 'Camel',
    image: require('../../assets/garments/trench-camel.png'),
    anchors: anchors(564, 652),
    shoulderEase: 1.2,
    // A trench falls well below the hip, so it is cut long against the
    // shoulder-to-hip span the pose gives us.
    lengthEase: 1.95,
    sizes: OUTERWEAR_SIZES,
  },
  {
    id: 'dress-emerald',
    name: 'Column Dress',
    brand: 'Maison Rue',
    category: 'dress',
    priceCents: 24500,
    colorway: 'Emerald',
    image: require('../../assets/garments/dress-emerald.png'),
    anchors: anchors(416, 690),
    shoulderEase: 1.02,
    lengthEase: 2.1,
    sizes: STANDARD_SIZES,
  },
];

export function garmentById(id: string): Garment | undefined {
  return GARMENTS.find((g) => g.id === id);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}
