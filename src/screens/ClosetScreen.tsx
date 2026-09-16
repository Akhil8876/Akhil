import React, { useMemo } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GARMENTS, formatPrice, garmentById } from '../catalog/garments';
import { useCloset, type SavedLook } from '../state/useCloset';
import { colors, radius, spacing, type } from '../theme';

export function ClosetScreen() {
  const insets = useSafeAreaInsets();
  const { looks, favorites, removeLook, setActiveGarment } = useCloset();

  const favoriteGarments = useMemo(
    () => GARMENTS.filter((g) => favorites.includes(g.id)),
    [favorites],
  );

  const renderLook = ({ item }: ListRenderItemInfo<SavedLook>) => {
    const garment = garmentById(item.garmentId);
    return (
      <Pressable
        style={styles.lookCard}
        onLongPress={() => removeLook(item.id)}
        onPress={() => garment && setActiveGarment(garment.id)}
        accessibilityRole="button"
        accessibilityHint="Long press to delete this look."
      >
        <Image source={{ uri: item.uri }} style={styles.lookImage} />
        <View style={styles.lookMeta}>
          <Text style={type.caption} numberOfLines={1}>
            {garment ? `${garment.name} - ${garment.colorway}` : 'Removed garment'}
          </Text>
          {item.sizeLabel ? <Text style={styles.sizeTag}>{item.sizeLabel}</Text> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <Text style={[type.title, styles.title]}>Closet</Text>

      {favoriteGarments.length > 0 ? (
        <View style={styles.section}>
          <Text style={[type.label, styles.sectionLabel]}>SAVED PIECES</Text>
          <FlatList
            horizontal
            data={favoriteGarments}
            keyExtractor={(g) => g.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
            renderItem={({ item }) => (
              <Pressable
                style={styles.favoriteCard}
                onPress={() => setActiveGarment(item.id)}
                accessibilityRole="button"
              >
                <Image source={item.image} style={styles.favoriteThumb} resizeMode="contain" />
                <Text style={type.caption} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={type.caption}>{formatPrice(item.priceCents)}</Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}

      <Text style={[type.label, styles.sectionLabel]}>YOUR LOOKS</Text>
      <FlatList
        data={looks}
        keyExtractor={(l) => l.id}
        renderItem={renderLook}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Nothing saved yet. Try something on and tap the shutter to keep the look.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  section: { marginBottom: spacing.lg },
  sectionLabel: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  row: { paddingHorizontal: spacing.lg, gap: spacing.md },
  grid: { padding: spacing.lg, gap: spacing.md },
  favoriteCard: {
    width: 110,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  favoriteThumb: { width: 94, height: 94 },
  lookCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  lookImage: { width: '100%', aspectRatio: 0.75, backgroundColor: colors.surfaceRaised },
  lookMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  sizeTag: {
    ...type.caption,
    color: colors.accentText,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  empty: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
});
