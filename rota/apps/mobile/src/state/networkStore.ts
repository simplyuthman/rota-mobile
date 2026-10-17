/**
 * =============================================================================
 * Rota Mobile — Network & Offline Connectivity State (Zustand)
 * =============================================================================
 * AGENTS.md §2.1 (Zustand for transient UI state ONLY).
 * Tracks online status, manual offline simulation (for demos), and last sync.
 * =============================================================================
 */

import { create } from 'zustand';

export interface NetworkState {
  isOnline: boolean;
  isSimulatedOffline: boolean;
  lastSyncTime: string | null;
  setOnline: (online: boolean) => void;
  toggleSimulatedOffline: () => void;
  setLastSyncTime: (time: string) => void;
  effectiveIsOnline: () => boolean;
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  isOnline: true,
  isSimulatedOffline: false,
  lastSyncTime: null,
  setOnline: (online) => set({ isOnline: online }),
  toggleSimulatedOffline: () =>
    set((state) => ({ isSimulatedOffline: !state.isSimulatedOffline })),
  setLastSyncTime: (time) => set({ lastSyncTime: time }),
  effectiveIsOnline: () => {
    const { isOnline, isSimulatedOffline } = get();
    return isOnline && !isSimulatedOffline;
  },
}));
