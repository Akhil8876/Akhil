import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { GARMENTS } from '../catalog/garments';

export interface SavedLook {
  id: string;
  garmentId: string;
  /** Local file URI of the captured snapshot. */
  uri: string;
  createdAt: number;
  sizeLabel: string | null;
}

interface ClosetState {
  /** Garment currently being worn in the try-on view. */
  activeGarmentId: string;
  favorites: string[];
  looks: SavedLook[];
  /** Wearer height in cm - the one input that gives the camera absolute scale. */
  heightCm: number;
  /** Manual trim on top of the solved fit, 0.8 to 1.2. */
  fitTrim: number;
  showSkeleton: boolean;

  setActiveGarment: (id: string) => void;
  toggleFavorite: (id: string) => void;
  addLook: (look: SavedLook) => void;
  removeLook: (id: string) => void;
  setHeightCm: (cm: number) => void;
  setFitTrim: (trim: number) => void;
  toggleSkeleton: () => void;
}

const DEFAULT_HEIGHT_CM = 173;

export const useCloset = create<ClosetState>()(
  persist(
    (set) => ({
      activeGarmentId: GARMENTS[0]!.id,
      favorites: [],
      looks: [],
      heightCm: DEFAULT_HEIGHT_CM,
      fitTrim: 1,
      showSkeleton: false,

      setActiveGarment: (id) => set({ activeGarmentId: id }),

      toggleFavorite: (id) =>
        set((state) => ({
          favorites: state.favorites.includes(id)
            ? state.favorites.filter((f) => f !== id)
            : [...state.favorites, id],
        })),

      addLook: (look) => set((state) => ({ looks: [look, ...state.looks] })),

      removeLook: (id) =>
        set((state) => ({ looks: state.looks.filter((l) => l.id !== id) })),

      setHeightCm: (cm) => set({ heightCm: Math.round(Math.max(120, Math.min(220, cm))) }),

      setFitTrim: (trim) => set({ fitTrim: Math.max(0.8, Math.min(1.2, trim)) }),

      toggleSkeleton: () => set((state) => ({ showSkeleton: !state.showSkeleton })),
    }),
    {
      name: 'mirrorfit-closet',
      storage: createJSONStorage(() => AsyncStorage),
      // Snapshots live in the cache directory and can be evicted by the OS,
      // so the look list is rebuilt from disk rather than trusted blindly.
      partialize: (state) => ({
        activeGarmentId: state.activeGarmentId,
        favorites: state.favorites,
        looks: state.looks,
        heightCm: state.heightCm,
        fitTrim: state.fitTrim,
      }),
    },
  ),
);
