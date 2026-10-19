/**
 * =============================================================================
 * Rota Mobile — Push Notifications & Tap Routing Modal (Tier 7 UI)
 * =============================================================================
 * AGENTS.md §3.4 (P-05) & §5:
 * - Displays active push token registered on backend
 * - Simulates tap-to-open routing for all 4 required payload types:
 *     1. Shift -> Schedule screen with shift highlighted
 *     2. Swap -> Schedule screen with swap highlighted
 *     3. Billing -> Settings screen with Billing Modal opened
 *     4. Activity -> Activity Feed tab
 * - Triggers live backend test push via POST /me/push-test
 * =============================================================================
 */

import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Bell,
  X,
  Send,
  Calendar,
  ArrowRightLeft,
  CreditCard,
  Radio,
  Smartphone,
  CheckCircle2,
} from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../theme';
import { Text } from '../../components/Text';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useUIStore } from '../../state/uiStore';
import { handlePushTap } from './tapRouter';
import { apiClient } from '../../api/client';
import { getErrorMessage } from '../../utils/error';

export interface PushNotificationSimulatorModalProps {
  visible: boolean;
  onClose: () => void;
  activeTeamId?: string;
}

export function PushNotificationSimulatorModal({
  visible,
  onClose,
  activeTeamId,
}: PushNotificationSimulatorModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();

  const { pushDeviceToken } = useUIStore();
  const [sendingTestPush, setSendingTestPush] = useState(false);

  const handleSimulateTap = (type: 'shift' | 'swap' | 'billing' | 'activity') => {
    onClose();
    // Dispatch push tap routing directly (Rule P-05)
    setTimeout(() => {
      handlePushTap(
        {
          type,
          teamId: activeTeamId,
          entityId: `simulated-${type}-${Date.now().toString(36)}`,
        },
        router
      );
    }, 150);
  };

  const handleSendBackendPush = async (type: 'shift' | 'swap' | 'billing' | 'activity') => {
    setSendingTestPush(true);
    try {
      const res = await apiClient.post<{ success: boolean; sentCount: number; message?: string }>(
        '/me/push-test',
        {
          type,
          teamId: activeTeamId,
          entityId: `test-push-${Date.now().toString(36)}`,
          title: `Rota Test Push (${type.toUpperCase()})`,
          body: `Live notification delivered via Expo push pipeline for ${type}.`,
        }
      );

      if (res.data.success) {
        Alert.alert(
          'Push Delivered',
          `Successfully dispatched push notification to ${res.data.sentCount} registered device(s).`
        );
      } else {
        Alert.alert('Notice', res.data.message || 'Push test completed.');
      }
    } catch (err: unknown) {
      Alert.alert('Error', getErrorMessage(err, 'Failed to send test push notification'));
    } finally {
      setSendingTestPush(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel="Dismiss modal backdrop"
          accessibilityRole="button"
        />
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.headerIconCircle}>
                <Bell size={20} color={theme.colors.primary} />
              </View>
              <View>
                <Text role="headlineSmall" color="onSurface" style={styles.titleText}>
                  Push Notifications
                </Text>
                <Text role="bodySmall" color="onSurfaceVariant">
                  Tier 7 Delivery & Tap-To-Open Router
                </Text>
              </View>
            </View>

            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close push simulator"
            >
              <X size={20} color={theme.colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {/* Device Token Status Card */}
            <Card variant="outlined" style={styles.tokenCard}>
              <View style={styles.tokenHeader}>
                <View style={styles.tokenTitleLeft}>
                  <Smartphone size={16} color={theme.colors.primary} />
                  <Text role="labelMedium" color="onSurface" style={styles.tokenLabel}>
                    Device Push Registration
                  </Text>
                </View>
                <Badge
                  label={pushDeviceToken ? 'REGISTERED' : 'INITIALIZING'}
                  variant={pushDeviceToken ? 'secondary' : 'neutral'}
                  size="small"
                  icon={pushDeviceToken ? <CheckCircle2 size={12} color={theme.colors.onSecondaryContainer} /> : undefined}
                />
              </View>

              <Text role="bodySmall" color="onSurfaceVariant" numberOfLines={2} style={styles.tokenString}>
                {pushDeviceToken || 'Acquiring Expo push token...'}
              </Text>
              <Text role="bodySmall" color="onSurfaceVariant" style={styles.tokenSubtext}>
                Token upserted on backend `POST /me/push-tokens` and deactivated on sign out.
              </Text>
            </Card>

            {/* Tap-To-Open Route Testing */}
            <Text role="labelLarge" color="onSurface" style={styles.sectionHeader}>
              TEST TAP-TO-OPEN ROUTING
            </Text>
            <Text role="bodySmall" color="onSurfaceVariant" style={styles.sectionSub}>
              Payloads contain only `{'{type, teamId, entityId}'}`. Tapping instantly routes to the exact target screen:
            </Text>

            <View style={styles.routesList}>
              {/* 1. Shift */}
              <Pressable
                onPress={() => handleSimulateTap('shift')}
                style={styles.routeItem}
                accessibilityRole="button"
                accessibilityLabel="Simulate Shift push notification tap"
              >
                <View style={[styles.routeIcon, { backgroundColor: theme.colors.primaryContainer }]}>
                  <Calendar size={18} color={theme.colors.onPrimaryContainer} />
                </View>
                <View style={styles.routeTextCol}>
                  <Text role="labelMedium" color="onSurface">
                    Shift Notification Tap
                  </Text>
                  <Text role="bodySmall" color="onSurfaceVariant">
                    Payload `{'{ type: "shift" }'}` ➔ Opens Schedule
                  </Text>
                </View>
              </Pressable>

              {/* 2. Swap */}
              <Pressable
                onPress={() => handleSimulateTap('swap')}
                style={styles.routeItem}
                accessibilityRole="button"
                accessibilityLabel="Simulate Swap push notification tap"
              >
                <View style={[styles.routeIcon, { backgroundColor: theme.colors.secondaryContainer }]}>
                  <ArrowRightLeft size={18} color={theme.colors.onSecondaryContainer} />
                </View>
                <View style={styles.routeTextCol}>
                  <Text role="labelMedium" color="onSurface">
                    Swap Request Notification Tap
                  </Text>
                  <Text role="bodySmall" color="onSurfaceVariant">
                    Payload `{'{ type: "swap" }'}` ➔ Opens Swap Request
                  </Text>
                </View>
              </Pressable>

              {/* 3. Billing */}
              <Pressable
                onPress={() => handleSimulateTap('billing')}
                style={styles.routeItem}
                accessibilityRole="button"
                accessibilityLabel="Simulate Billing push notification tap"
              >
                <View style={[styles.routeIcon, { backgroundColor: theme.colors.tertiaryContainer }]}>
                  <CreditCard size={18} color={theme.colors.onTertiaryContainer} />
                </View>
                <View style={styles.routeTextCol}>
                  <Text role="labelMedium" color="onSurface">
                    Billing Alert Notification Tap
                  </Text>
                  <Text role="bodySmall" color="onSurfaceVariant">
                    Payload `{'{ type: "billing" }'}` ➔ Opens Settings & Billing
                  </Text>
                </View>
              </Pressable>

              {/* 4. Activity */}
              <Pressable
                onPress={() => handleSimulateTap('activity')}
                style={styles.routeItem}
                accessibilityRole="button"
                accessibilityLabel="Simulate Activity push notification tap"
              >
                <View style={[styles.routeIcon, { backgroundColor: theme.colors.surfaceContainerHigh }]}>
                  <Radio size={18} color={theme.colors.primary} />
                </View>
                <View style={styles.routeTextCol}>
                  <Text role="labelMedium" color="onSurface">
                    Team Activity Notification Tap
                  </Text>
                  <Text role="bodySmall" color="onSurfaceVariant">
                    Payload `{'{ type: "activity" }'}` ➔ Opens Activity Feed
                  </Text>
                </View>
              </Pressable>
            </View>

            {/* Live Backend Push Pipeline Trigger */}
            <Text role="labelLarge" color="onSurface" style={styles.sectionHeader}>
              LIVE BACKEND PIPELINE TEST
            </Text>
            <Card variant="outlined" style={styles.liveTestCard}>
              <Text role="bodySmall" color="onSurfaceVariant">
                Dispatches a notification through the backend Fastify API, BullMQ worker adapter, and Expo push server to this device.
              </Text>

              <PrimaryButton
                label={sendingTestPush ? 'Dispatching...' : 'Send Test Push from Backend'}
                leadingIcon={<Send size={16} color={theme.colors.onPrimary} />}
                onPress={() => handleSendBackendPush('shift')}
                loading={sendingTestPush}
                style={styles.livePushBtn}
              />
            </Card>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (t: ThemeContextValue) =>
  StyleSheet.create({
    modalOverlay: {
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
    modalContainer: {
      backgroundColor: t.colors.surface,
      borderTopLeftRadius: t.radius.card,
      borderTopRightRadius: t.radius.card,
      maxHeight: '90%',
      paddingBottom: t.spacing.extraLarge,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: t.spacing.base,
      paddingVertical: t.spacing.medium,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.surfaceVariant,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
    },
    headerIconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: t.colors.primaryContainer,
      justifyContent: 'center',
      alignItems: 'center',
    },
    titleText: {
      fontWeight: '700',
    },
    closeButton: {
      width: t.touchTarget - 8,
      height: t.touchTarget - 8,
      justifyContent: 'center',
      alignItems: 'center',
    },
    body: {
      flexGrow: 0,
    },
    bodyContent: {
      padding: t.spacing.base,
      gap: t.spacing.base,
    },
    tokenCard: {
      padding: t.spacing.base,
      gap: t.spacing.small,
      backgroundColor: t.colors.surfaceContainer,
    },
    tokenHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    tokenTitleLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.extraSmall,
    },
    tokenLabel: {
      fontWeight: '600',
    },
    tokenString: {
      ...t.textStyles.bodySmall,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    tokenSubtext: {
      ...t.textStyles.labelSmall,
    },
    sectionHeader: {
      fontWeight: '700',
      letterSpacing: 0.5,
      marginTop: t.spacing.extraSmall,
    },
    sectionSub: {
      marginTop: -t.spacing.small,
    },
    routesList: {
      gap: t.spacing.small,
    },
    routeItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: t.spacing.base,
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.card,
      borderWidth: 1,
      borderColor: t.colors.surfaceVariant,
      gap: t.spacing.medium,
      minHeight: t.touchTarget,
    },
    routeIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
    },
    routeTextCol: {
      flex: 1,
      gap: t.spacing.extraSmall / 2,
    },
    liveTestCard: {
      padding: t.spacing.base,
      gap: t.spacing.medium,
    },
    livePushBtn: {
      width: '100%',
    },
  });
