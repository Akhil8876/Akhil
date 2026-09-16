import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { useImage } from '@shopify/react-native-skia';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GarmentCarousel } from '../components/GarmentCarousel';
import { GarmentOverlay } from '../components/GarmentOverlay';
import { PoseDebugOverlay } from '../components/PoseDebugOverlay';
import { PermissionGate } from '../components/PermissionGate';
import { FitSheet } from '../components/FitSheet';
import { GARMENTS, garmentById } from '../catalog/garments';
import { emptyPose, hasTorso, type Pose } from '../pose/keypoints';
import { usePoseDetector } from '../pose/usePoseDetector';
import { measureBody, recommendSize } from '../fit/measure';
import { solveFit } from '../fit/solveFit';
import { composeLook } from '../capture/composeLook';
import { useCloset } from '../state/useCloset';
import { colors, radius, spacing, type } from '../theme';

/**
 * How often the JS thread samples the pose for sizing. The overlay itself runs
 * on the UI thread at frame rate; this slower sample exists only to drive the
 * size recommendation, which does not need to update 30 times a second.
 */
const MEASURE_INTERVAL_MS = 400;

/**
 * The front-camera preview is always mirrored, so landmarks are projected
 * mirrored too and snapshots have to match. VisionCamera mirrors front-camera
 * stills by default for the same reason.
 */
const PREVIEW_MIRRORED = true;

export function TryOnScreen() {
  const insets = useSafeAreaInsets();
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();

  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [sampledPose, setSampledPose] = useState<Pose>(() => emptyPose());

  const cameraRef = useRef<Camera>(null);

  const {
    activeGarmentId,
    favorites,
    heightCm,
    fitTrim,
    showSkeleton,
    setActiveGarment,
    toggleFavorite,
    setHeightCm,
    setFitTrim,
    toggleSkeleton,
    addLook,
  } = useCloset();

  const garment = garmentById(activeGarmentId) ?? GARMENTS[0]!;

  // Decoded once here and handed to both the live overlay and the compositor,
  // so a snapshot never waits on a second decode of the same artwork.
  const garmentImage = useImage(garment.image);

  const detector = usePoseDetector({ view: viewSize, mirrored: PREVIEW_MIRRORED });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewSize({ width, height });
  }, []);

  // Sample the shared pose on a timer instead of pushing every frame across
  // the bridge - sizing only needs a coarse update.
  useEffect(() => {
    const id = setInterval(() => {
      setSampledPose(detector.pose.value);
    }, MEASURE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [detector.pose]);

  const measurements = useMemo(
    () => measureBody(sampledPose, heightCm),
    [sampledPose, heightCm],
  );
  const recommendation = useMemo(
    () => recommendSize(measurements, garment.sizes),
    [measurements, garment.sizes],
  );

  const tracking = hasTorso(sampledPose);

  const onCapture = useCallback(async () => {
    const camera = cameraRef.current;
    if (camera == null || garmentImage == null || capturing) return;

    setCapturing(true);
    try {
      const photo = await camera.takePhoto({ enableShutterSound: false });

      // Solve against the pose as of the shutter rather than the 400ms sizing
      // sample, so the garment lands where it was when the photo was taken.
      const fit = solveFit(detector.pose.value, garment.anchors, {
        shoulderEase: garment.shoulderEase,
        lengthEase: garment.lengthEase,
        userScale: fitTrim,
      });

      const uri = await composeLook({
        photoPath: photo.path,
        photoWidth: photo.width,
        photoHeight: photo.height,
        photoOrientation: photo.orientation,
        photoIsMirrored: photo.isMirrored,
        previewMirrored: PREVIEW_MIRRORED,
        view: viewSize,
        fit,
        garmentImage,
        garmentAnchors: garment.anchors,
      });

      addLook({
        id: `${Date.now()}`,
        garmentId: garment.id,
        uri,
        createdAt: Date.now(),
        sizeLabel: recommendation?.size.label ?? null,
      });
    } catch (error) {
      Alert.alert(
        'Could not save that look',
        error instanceof Error ? error.message : 'Unknown error',
      );
    } finally {
      setCapturing(false);
    }
  }, [addLook, capturing, detector.pose, fitTrim, garment, garmentImage, recommendation, viewSize]);

  if (!hasPermission) {
    return (
      <PermissionGate
        title="Camera access"
        message="MirrorFit shows clothing on you using the front camera. Video is processed entirely on this device and never uploaded."
        actionLabel="Allow camera"
        onAction={requestPermission}
        showSettingsLink
      />
    );
  }

  if (device == null) {
    return (
      <PermissionGate
        title="No front camera"
        message="This device does not expose a front-facing camera, which MirrorFit needs to show clothing on you."
      />
    );
  }

  if (detector.status === 'error') {
    return (
      <PermissionGate
        title="Pose model missing"
        message={
          detector.error?.message ??
          'The MoveNet model could not be loaded. Run `npm run fetch-model` and rebuild the app.'
        }
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.preview} onLayout={onLayout}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
          photo
          frameProcessor={detector.frameProcessor}
          // The model wants RGB, and asking the pipeline for it directly is
          // cheaper than converting YUV on every frame.
          pixelFormat="rgb"
          resizeMode="cover"
          // Pin stills to the preview's orientation. The default follows the
          // device, which would hand us a landscape photo while the overlay
          // coordinates are still portrait.
          outputOrientation="preview"
        />
        {viewSize.width > 0 ? (
          <>
            <GarmentOverlay
              pose={detector.pose}
              garment={garment}
              image={garmentImage}
              fitTrim={fitTrim}
              width={viewSize.width}
              height={viewSize.height}
            />
            {showSkeleton ? (
              <PoseDebugOverlay
                pose={detector.pose}
                width={viewSize.width}
                height={viewSize.height}
              />
            ) : null}
          </>
        ) : null}
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.statusPill}>
          {detector.status === 'loading' ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <View
              style={[
                styles.statusDot,
                { backgroundColor: tracking ? colors.success : colors.warning },
              ]}
            />
          )}
          <Text style={type.caption}>
            {detector.status === 'loading'
              ? 'Loading model'
              : tracking
                ? 'Tracking'
                : 'Step into frame'}
          </Text>
        </View>
        <Pressable
          onPress={toggleSkeleton}
          style={styles.statusPill}
          accessibilityRole="button"
          accessibilityLabel="Toggle skeleton debug overlay"
        >
          <Text style={type.caption}>{showSkeleton ? 'Skeleton on' : 'Skeleton off'}</Text>
        </Pressable>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <GarmentCarousel
          garments={GARMENTS}
          activeId={garment.id}
          favorites={favorites}
          onSelect={setActiveGarment}
          onToggleFavorite={toggleFavorite}
        />

        <View style={styles.actions}>
          <Pressable
            onPress={() => setSheetOpen(true)}
            style={styles.secondaryButton}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>
              {recommendation ? `Size ${recommendation.size.label}` : 'Fit'}
            </Text>
          </Pressable>

          <Pressable
            onPress={onCapture}
            disabled={capturing}
            style={[styles.shutter, capturing && styles.shutterBusy]}
            accessibilityRole="button"
            accessibilityLabel="Save this look"
          >
            {capturing ? <ActivityIndicator color={colors.accentText} /> : null}
          </Pressable>

          <Pressable
            onPress={() => toggleFavorite(garment.id)}
            style={styles.secondaryButton}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>
              {favorites.includes(garment.id) ? 'Saved' : 'Save'}
            </Text>
          </Pressable>
        </View>
      </View>

      <Modal
        visible={sheetOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSheetOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.flex} onPress={() => setSheetOpen(false)} />
          <FitSheet
            garment={garment}
            measurements={measurements}
            recommendation={recommendation}
            heightCm={heightCm}
            fitTrim={fitTrim}
            onHeightChange={setHeightCm}
            onTrimChange={setFitTrim}
            onClose={() => setSheetOpen(false)}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  preview: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  secondaryButton: {
    minWidth: 88,
    alignItems: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  secondaryText: { ...type.body, fontWeight: '600' },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 4,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBusy: { opacity: 0.6 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
});
