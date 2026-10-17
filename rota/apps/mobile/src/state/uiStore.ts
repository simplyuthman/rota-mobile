/**
 * =============================================================================
 * Rota Mobile — Transient UI State Store (Zustand)
 * =============================================================================
 * AGENTS.md §2.1 & L-08:
 * Zustand is used for transient UI state ONLY (e.g. active modal, filter drawer).
 * Never store server data (shifts, members, subscriptions) in Zustand.
 */

import { create } from 'zustand';

export interface UIState {
  isFilterSheetOpen: boolean;
  selectedShiftId: string | null;
  selectedTeamId: string | null;
  highlightedShiftId: string | null;
  highlightedSwapId: string | null;
  openBillingModal: boolean;
  pushDeviceToken: string | null;
  setFilterSheetOpen: (open: boolean) => void;
  setSelectedShiftId: (id: string | null) => void;
  setSelectedTeamId: (id: string | null) => void;
  setHighlightedShiftId: (id: string | null) => void;
  setHighlightedSwapId: (id: string | null) => void;
  setOpenBillingModal: (open: boolean) => void;
  setPushDeviceToken: (token: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isFilterSheetOpen: false,
  selectedShiftId: null,
  selectedTeamId: null,
  highlightedShiftId: null,
  highlightedSwapId: null,
  openBillingModal: false,
  pushDeviceToken: null,
  setFilterSheetOpen: (open) => set({ isFilterSheetOpen: open }),
  setSelectedShiftId: (id) => set({ selectedShiftId: id }),
  setSelectedTeamId: (id) => set({ selectedTeamId: id }),
  setHighlightedShiftId: (id) => set({ highlightedShiftId: id }),
  setHighlightedSwapId: (id) => set({ highlightedSwapId: id }),
  setOpenBillingModal: (open) => set({ openBillingModal: open }),
  setPushDeviceToken: (token) => set({ pushDeviceToken: token }),
}));
