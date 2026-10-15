import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../src/theme';

export default function SettingsScreen() {
  const { colors, spacing, textStyles } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, padding: spacing.base }]}>
      <Text style={[textStyles.headlineSmall, { color: colors.onSurface }]}>Settings</Text>
      <Text style={[textStyles.bodyMedium, { color: colors.onSurfaceVariant, marginTop: spacing.small }]}>
        User preferences and quiet hours settings.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
