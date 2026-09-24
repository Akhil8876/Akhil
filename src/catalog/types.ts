import type { GarmentSpec } from './data';

export type GarmentCategory = 'top' | 'outerwear' | 'dress';

/**
 * Where the garment artwork's own landmarks sit, in the artwork's pixel space.
 *
 * Every garment PNG is authored flat-lay, facing forward, head-up. These three
 * numbers are what let one piece of fitting maths serve a cropped tee and a
 * long coat without per-garment special cases.
 */
export interface GarmentAnchors {
  /** Artwork pixel width. */
  width: number;
  /** Artwork pixel height. */
  height: number;
  /** Point on the artwork that should land on the wearer's shoulder midpoint. */
  shoulderMid: { x: number; y: number };
  /** Distance between the artwork's shoulder seams, in artwork pixels. */
  shoulderWidth: number;
  /** Shoulder line to hem, in artwork pixels. */
  torsoLength: number;
}

export interface SizeChartEntry {
  label: string;
  /** Fits a wearer whose shoulder breadth falls in this range, in cm. */
  shoulderCm: [number, number];
  /** Nominal chest circumference the size is cut for, in cm. */
  chestCm: number;
}

/** A garment as the React Native app sees it: shared spec + bundled artwork. */
export interface Garment extends GarmentSpec {
  /** require()'d artwork with a transparent background. */
  image: number;
}
