import type { GarmentSpec } from '@shared/catalog/data';
import { GARMENT_SPECS } from '@shared/catalog/data';

/** A garment as the browser sees it: the shared spec plus an image URL. */
export interface WebGarment extends GarmentSpec {
  imageUrl: string;
}

// Artwork is served from public/garments, named by garment id.
export const GARMENTS: WebGarment[] = GARMENT_SPECS.map((spec) => ({
  ...spec,
  imageUrl: `${import.meta.env.BASE_URL}garments/${spec.id}.png`,
}));

export function garmentById(id: string): WebGarment | undefined {
  return GARMENTS.find((g) => g.id === id);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}
