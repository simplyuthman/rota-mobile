/**
 * =============================================================================
 * Rota Mobile — CreateShiftModal
 * =============================================================================
 * AGENTS.md §3.2 (A-01, A-07, A-09) & §5 (zero raw literals, accessible).
 * Modal for Owners and Managers to create and optionally assign shifts.
 */

import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  ScrollView,
  StyleSheet,
  Pressable,
} from 'react-native';
import { X, Clock, User, Calendar, AlertCircle } from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../theme';
import { Text } from '../../components/Text';
import { InputField } from '../../components/InputField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Badge } from '../../components/Badge';
import { useCreateShift } from './useShifts';
import { useTeamMembers } from '../teams/useTeam';
import { getErrorCode, getErrorMessage } from '../../utils/error';

export interface CreateShiftModalProps {
  visible: boolean;
  onClose: () => void;
  teamId: string;
}

export function CreateShiftModal({ visible, onClose, teamId }: CreateShiftModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const createShift = useCreateShift(teamId);
  const { data: members = [] } = useTeamMembers(teamId);

  const [title, setTitle] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  // Quick preset days: Today, Tomorrow, In 2 Days
  const [dayOffset, setDayOffset] = useState<number>(1); // default tomorrow
  // Quick time preset: 0=Morning (09-17), 1=Evening (17-01), 2=Lunch (11-15)
  const [timePreset, setTimePreset] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const timePresets = useMemo(
    () => [
      { label: '09:00 – 17:00 (Day)', startHour: 9, endHour: 17 },
      { label: '17:00 – 01:00 (Closing)', startHour: 17, endHour: 25 }, // +1 day overnight
      { label: '11:00 – 15:00 (Lunch)', startHour: 11, endHour: 15 },
    ],
    []
  );

  const dayPresets = useMemo(
    () => [
      { label: 'Today', offset: 0 },
      { label: 'Tomorrow', offset: 1 },
      { label: 'In 2 Days', offset: 2 },
    ],
    []
  );

  const handleSubmit = async () => {
    if (!title.trim()) {
      setErrorMessage('Please enter a shift title');
      return;
    }

    setErrorMessage(null);

    // Compute ISO start and end instants in UTC
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);

    const preset = timePresets[timePreset];
    const startsAt = new Date(targetDate);
    startsAt.setHours(preset.startHour, 0, 0, 0);

    const endsAt = new Date(targetDate);
    if (preset.endHour >= 24) {
      endsAt.setDate(endsAt.getDate() + 1);
      endsAt.setHours(preset.endHour - 24, 0, 0, 0);
    } else {
      endsAt.setHours(preset.endHour, 0, 0, 0);
    }

    try {
      await createShift.mutateAsync({
        title: title.trim(),
        locationLabel: locationLabel.trim() || null,
        notes: notes.trim() || null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        assignMembershipId: selectedMemberId || undefined,
      });

      // Reset and close
      setTitle('');
      setLocationLabel('');
      setNotes('');
      setSelectedMemberId(null);
      onClose();
    } catch (err: unknown) {
      const code = getErrorCode(err);
      if (code === 'OVERLAPPING_SHIFT') {
        setErrorMessage('Cannot assign member: this assignment overlaps with an existing shift.');
      } else {
        setErrorMessage(getErrorMessage(err, 'Failed to create shift. Please check input.'));
      }
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss modal backdrop"
        />
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text role="headlineSmall" color="onSurface" style={styles.headerTitle}>
                New Shift
              </Text>
              <Text role="bodySmall" color="onSurfaceVariant">
                Create a draft schedule item
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close create shift modal"
              onPress={onClose}
              style={styles.closeButton}
            >
              <X size={20} color={theme.colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
            {errorMessage ? (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <AlertCircle size={18} color={theme.colors.error} />
                <Text role="bodySmall" color="onErrorContainer" style={styles.errorBannerText}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            {/* Title */}
            <InputField
              label="Shift Title *"
              placeholder="e.g. Morning Barista, Floor Lead"
              value={title}
              onChangeText={setTitle}
            />

            {/* Location */}
            <InputField
              label="Location"
              placeholder="e.g. Main Dining Room, Espresso Bar"
              value={locationLabel}
              onChangeText={setLocationLabel}
            />

            {/* Day Selector */}
            <View style={styles.sectionContainer}>
              <View style={styles.labelRow}>
                <Calendar size={16} color={theme.colors.primary} />
                <Text role="labelMedium" color="onSurface" style={styles.sectionLabel}>
                  Day
                </Text>
              </View>
              <View style={styles.chipsRow}>
                {dayPresets.map((d) => (
                  <Pressable
                    key={d.label}
                    accessibilityRole="button"
                    accessibilityLabel={d.label}
                    onPress={() => setDayOffset(d.offset)}
                    style={[
                      styles.chip,
                      dayOffset === d.offset && styles.chipSelected,
                    ]}
                  >
                    <Text
                      role="labelMedium"
                      color={dayOffset === d.offset ? 'onPrimary' : 'onSurface'}
                    >
                      {d.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Time Preset */}
            <View style={styles.sectionContainer}>
              <View style={styles.labelRow}>
                <Clock size={16} color={theme.colors.primary} />
                <Text role="labelMedium" color="onSurface" style={styles.sectionLabel}>
                  Time Window
                </Text>
              </View>
              <View style={styles.presetsColumn}>
                {timePresets.map((t, idx) => (
                  <Pressable
                    key={t.label}
                    accessibilityRole="button"
                    accessibilityLabel={t.label}
                    onPress={() => setTimePreset(idx)}
                    style={[
                      styles.timePresetCard,
                      timePreset === idx && styles.timePresetCardSelected,
                    ]}
                  >
                    <Text
                      role="bodyMedium"
                      color={timePreset === idx ? 'primary' : 'onSurface'}
                      style={styles.timePresetText}
                    >
                      {t.label}
                    </Text>
                    {timePreset === idx ? (
                      <Badge label="Selected" variant="primary" size="small" />
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Assign Member */}
            <View style={styles.sectionContainer}>
              <View style={styles.labelRow}>
                <User size={16} color={theme.colors.primary} />
                <Text role="labelMedium" color="onSurface" style={styles.sectionLabel}>
                  Assign Staff (Optional)
                </Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.membersRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Leave shift unassigned"
                  onPress={() => setSelectedMemberId(null)}
                  style={[
                    styles.memberChip,
                    selectedMemberId === null && styles.chipSelected,
                  ]}
                >
                  <Text
                    role="labelSmall"
                    color={selectedMemberId === null ? 'onPrimary' : 'onSurface'}
                  >
                    Unassigned
                  </Text>
                </Pressable>
                {members.map((m) => {
                  const isSelected = selectedMemberId === m.id;
                  const name = m.displayName || m.email || `Member ${m.id.slice(0, 6)}`;
                  return (
                    <Pressable
                      key={m.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Assign to ${name}`}
                      onPress={() => setSelectedMemberId(m.id)}
                      style={[
                        styles.memberChip,
                        isSelected && styles.chipSelected,
                      ]}
                    >
                      <Text
                        role="labelSmall"
                        color={isSelected ? 'onPrimary' : 'onSurface'}
                      >
                        {name} ({m.role})
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Notes (Hidden from staff per A-07) */}
            <InputField
              label="Manager Notes"
              placeholder="Private note (hidden from staff)"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />
          </ScrollView>

          {/* Action buttons */}
          <View style={styles.footer}>
            <PrimaryButton
              label="Cancel"
              variant="secondary"
              onPress={onClose}
              style={styles.footerButton}
            />
            <PrimaryButton
              label="Create Shift"
              loading={createShift.isPending}
              onPress={handleSubmit}
              style={styles.footerButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.colors.inverseSurface,
      opacity: 0.5,
    },
    modalContent: {
      backgroundColor: t.colors.surface,
      borderTopLeftRadius: t.radius.card,
      borderTopRightRadius: t.radius.card,
      maxHeight: '90%',
      paddingTop: t.spacing.base,
      paddingHorizontal: t.spacing.base,
      paddingBottom: t.spacing.large,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: t.spacing.medium,
      paddingBottom: t.spacing.small,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.surfaceVariant,
    },
    headerTitle: {
      fontWeight: '700',
    },
    closeButton: {
      width: t.touchTarget - 8,
      height: t.touchTarget - 8,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: (t.touchTarget - 8) / 2,
      backgroundColor: t.colors.surfaceContainer,
    },
    scrollArea: {
      maxHeight: 480,
    },
    scrollContent: {
      gap: t.spacing.medium,
      paddingBottom: t.spacing.base,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      backgroundColor: t.colors.errorContainer,
      padding: t.spacing.medium,
      borderRadius: t.radius.control,
    },
    errorBannerText: {
      flex: 1,
    },
    sectionContainer: {
      gap: t.spacing.small,
    },
    labelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    sectionLabel: {
      fontWeight: '600',
    },
    chipsRow: {
      flexDirection: 'row',
      gap: t.spacing.small,
    },
    chip: {
      paddingHorizontal: t.spacing.large,
      paddingVertical: t.spacing.small,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceContainer,
      minHeight: t.touchTarget - 8,
      justifyContent: 'center',
      alignItems: 'center',
    },
    chipSelected: {
      backgroundColor: t.colors.primary,
    },
    presetsColumn: {
      gap: t.spacing.small,
    },
    timePresetCard: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: t.spacing.medium,
      paddingVertical: t.spacing.medium,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceContainer,
      borderWidth: 1,
      borderColor: t.colors.surfaceVariant,
      minHeight: t.touchTarget - 4,
    },
    timePresetCardSelected: {
      borderColor: t.colors.primary,
      backgroundColor: t.colors.primaryContainer,
    },
    timePresetText: {
      fontWeight: '600',
    },
    membersRow: {
      flexDirection: 'row',
    },
    memberChip: {
      paddingHorizontal: t.spacing.medium,
      paddingVertical: t.spacing.small,
      borderRadius: t.radius.control,
      backgroundColor: t.colors.surfaceContainer,
      marginRight: t.spacing.small,
      minHeight: t.touchTarget - 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    footer: {
      flexDirection: 'row',
      gap: t.spacing.medium,
      marginTop: t.spacing.medium,
      paddingTop: t.spacing.small,
      borderTopWidth: 1,
      borderTopColor: t.colors.surfaceVariant,
    },
    footerButton: {
      flex: 1,
    },
  });
