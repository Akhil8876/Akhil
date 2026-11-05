/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Extension the pose model is served under; see usePoseTracker.ts. */
  readonly VITE_POSE_MODEL_EXT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
