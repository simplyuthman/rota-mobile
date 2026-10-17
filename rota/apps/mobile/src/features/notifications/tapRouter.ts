/**
 * =============================================================================
 * Rota Mobile — Tap-To-Open Router (Rule P-05)
 * =============================================================================
 * Pure JavaScript routing logic for handling notification taps.
 * Has ZERO native module dependencies so it can safely be imported anywhere
 * without triggering native module initialization.
 *
 * Routes:
 *   - shift    -> /(tabs) with target shift highlighted
 *   - swap     -> /(tabs) with target swap highlighted
 *   - billing  -> /(tabs)/settings with billing modal auto-opened
 *   - activity -> /(tabs)/activity
 *   - security -> /(tabs)/settings
 * =============================================================================
 */

import { useUIStore } from '../../state/uiStore';

export interface PushNotificationData {
  type?: 'shift' | 'swap' | 'billing' | 'activity' | 'security' | string;
  teamId?: string;
  entityId?: string;
}

/**
 * Handle notification tap routing (Rule P-05)
 * Switches active team context if needed, then navigates to the target screen.
 */
export function handlePushTap(
  data: PushNotificationData,
  router: { push: (href: any) => void; replace: (href: any) => void }
) {
  if (!data || !data.type) return;

  const {
    setSelectedTeamId,
    setHighlightedShiftId,
    setHighlightedSwapId,
    setOpenBillingModal,
  } = useUIStore.getState();

  // 1. If payload carries teamId, switch active team context first
  if (data.teamId) {
    setSelectedTeamId(data.teamId);
  }

  // 2. Route based on type to exact screen
  switch (data.type) {
    case 'shift': {
      if (data.entityId) {
        setHighlightedShiftId(data.entityId);
      }
      router.push('/(tabs)');
      break;
    }

    case 'swap': {
      if (data.entityId) {
        setHighlightedSwapId(data.entityId);
      }
      router.push('/(tabs)');
      break;
    }

    case 'billing': {
      setOpenBillingModal(true);
      router.push('/(tabs)/settings');
      break;
    }

    case 'activity': {
      router.push('/(tabs)/activity');
      break;
    }

    case 'security': {
      router.push('/(tabs)/settings');
      break;
    }

    default: {
      router.push('/(tabs)');
      break;
    }
  }
}
