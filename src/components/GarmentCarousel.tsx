import React from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { formatPrice } from '../catalog/garments';
import type { Garment } from '../catalog/types';
import { colors, radius, spacing, type } from '../theme';

interface Props {
  garments: Garment[];
  activeId: string;
  favorites: string[];
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}

const CARD_WIDTH = 96;

export function GarmentCarousel({
  garments,
  activeId,
  favorites,
  onSelect,
  onToggleFavorite,
}: Props) {
  const renderItem = ({ item }: ListRenderItemInfo<Garment>) => {
    const active = item.id === activeId;
    const favorite = favorites.includes(item.id);
    return (
      <Pressable
        onPress={() => onSelect(item.id)}
        onLongPress={() => onToggleFavorite(item.id)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`${item.name}, ${item.colorway}, ${formatPrice(item.priceCents)}`}
        accessibilityHint="Double tap to try on. Long press to save to favourites."
        style={[styles.card, active && styles.cardActive]}
      >
        <Image source={item.image} style={styles.thumb} resizeMode="contain" />
        {favorite ? <View style={styles.favoriteDot} /> : null}
        <Text style={styles.name} numberOfLines={1}>
          {item.colorway}
        </Text>
        <Text style={styles.price}>{formatPrice(item.priceCents)}</Text>
      </Pressable>
    );
  };

  return (
    <FlatList
      horizontal
      data={garments}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  card: {
    width: CARD_WIDTH,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.overlay,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  cardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  thumb: {
    width: CARD_WIDTH - spacing.md,
    height: CARD_WIDTH - spacing.md,
  },
  favoriteDot: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  name: {
    ...type.caption,
    color: colors.text,
    marginTop: spacing.xs,
  },
  price: {
    ...type.caption,
  },
});
