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
  setFilterSheetOpen: (open: boolean) => void;
  setSelectedShiftId: (id: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isFilterSheetOpen: false,
  selectedShiftId: null,
  setFilterSheetOpen: (open) => set({ isFilterSheetOpen: open }),
  setSelectedShiftId: (id) => set({ selectedShiftId: id }),
}));
