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

export interface Garment {
  id: string;
  name: string;
  brand: string;
  category: GarmentCategory;
  priceCents: number;
  colorway: string;
  /** require()'d artwork with a transparent background. */
  image: number;
  anchors: GarmentAnchors;
  /**
   * Cut allowance. 1.0 tracks the body exactly; an oversized coat sits wider
   * than the wearer's shoulders and a fitted tee sits slightly narrower.
   */
  shoulderEase: number;
  /** Hem allowance along the torso axis, same idea as `shoulderEase`. */
  lengthEase: number;
  sizes: SizeChartEntry[];
}
