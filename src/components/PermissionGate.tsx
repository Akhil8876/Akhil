import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '../theme';

interface Props {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  showSettingsLink?: boolean;
}

/** Full-screen explanation shown whenever the camera cannot run. */
export function PermissionGate({
  title,
  message,
  actionLabel,
  onAction,
  showSettingsLink,
}: Props) {
  return (
    <View style={styles.container}>
      <Text style={type.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
      {showSettingsLink ? (
        <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button">
          <Text style={styles.link}>Open Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  message: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  buttonText: {
    ...type.body,
    color: colors.accentText,
    fontWeight: '600',
  },
  link: {
    ...type.body,
    color: colors.accent,
  },
});
