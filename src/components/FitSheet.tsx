import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Garment } from '../catalog/types';
import type { BodyMeasurements, SizeRecommendation } from '../fit/measure';
import { colors, radius, spacing, type } from '../theme';

interface Props {
  garment: Garment;
  measurements: BodyMeasurements;
  recommendation: SizeRecommendation | null;
  heightCm: number;
  fitTrim: number;
  onHeightChange: (cm: number) => void;
  onTrimChange: (trim: number) => void;
  onClose: () => void;
}

function Stepper({
  label,
  value,
  onChange,
  step,
  format,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  step: number;
  format: (v: number) => string;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={type.label}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(value - step)}
          style={styles.stepButton}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
        >
          <Text style={styles.stepButtonText}>-</Text>
        </Pressable>
        <Text style={styles.stepValue}>{format(value)}</Text>
        <Pressable
          onPress={() => onChange(value + step)}
          style={styles.stepButton}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
        >
          <Text style={styles.stepButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The sizing panel. Height is the only measurement the user supplies; it is
 * what converts the camera's pixels into centimetres, so it is presented as a
 * setting rather than buried in a profile screen.
 */
export function FitSheet({
  garment,
  measurements,
  recommendation,
  heightCm,
  fitTrim,
  onHeightChange,
  onTrimChange,
  onClose,
}: Props) {
  const measured = measurements.quality !== 'unavailable';

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={type.heading}>{garment.name}</Text>
          <Text style={type.caption}>
            {garment.brand} - {garment.colorway}
          </Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close fit panel">
          <Text style={styles.close}>Done</Text>
        </Pressable>
      </View>

      {recommendation ? (
        <View style={styles.recommendation}>
          <View>
            <Text style={type.label}>RECOMMENDED SIZE</Text>
            <Text style={styles.sizeLabel}>{recommendation.size.label}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.note}>{recommendation.note}</Text>
            {measured ? (
              <Text style={type.caption}>
                Shoulders ~{measurements.shoulderCm.toFixed(0)} cm - chest ~
                {measurements.chestCm.toFixed(0)} cm
              </Text>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.recommendation}>
          <Text style={styles.note}>
            Step into frame so your shoulders and hips are visible to get a size.
          </Text>
        </View>
      )}

      <Stepper
        label="YOUR HEIGHT"
        value={heightCm}
        step={1}
        onChange={onHeightChange}
        format={(v) => `${v} cm`}
      />
      <Stepper
        label="FIT"
        value={fitTrim}
        step={0.05}
        onChange={onTrimChange}
        format={(v) => (v === 1 ? 'As cut' : `${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`)}
      />

      <Text style={styles.disclaimer}>
        Sizes are estimated from a single camera and your stated height. Treat
        them as a starting point, not a tailor&apos;s tape.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  flex: { flex: 1 },
  close: {
    ...type.body,
    color: colors.accent,
    fontWeight: '600',
  },
  recommendation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  sizeLabel: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.accent,
  },
  note: {
    ...type.body,
    marginBottom: spacing.xs,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
  },
  stepButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonText: {
    fontSize: 20,
    color: colors.text,
  },
  stepValue: {
    ...type.body,
    minWidth: 72,
    textAlign: 'center',
  },
  disclaimer: {
    ...type.caption,
    color: colors.textMuted,
  },
});
