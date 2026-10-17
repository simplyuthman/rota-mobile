/**
 * =============================================================================
 * Rota Mobile — Subscription & Billing Modal
 * =============================================================================
 * AGENTS.md §2.2, §3.1 (M-01 through M-15) & §5:
 * - Strictly uses semantic design tokens from useTheme()
 * - Plan selection with seat limits and ceiling 38 enforcement
 * - Live proration quote display with credit and cost breakdown
 * - Append-only billing ledger history
 * =============================================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Linking,
  type ViewStyle,
} from 'react-native';
import {
  CreditCard,
  Check,
  AlertCircle,
  Clock,
  ShieldCheck,
  Plus,
  Minus,
  ArrowUpRight,
  History,
  X,
  Sparkles,
} from 'lucide-react-native';
import { useTheme, type ThemeContextValue } from '../../theme';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { PrimaryButton } from '../../components/PrimaryButton';
import {
  useSubscription,
  useBillingLedger,
  useCreateBillingQuote,
  useCreateCheckout,
} from './useBilling';
import { PLAN_CONSTANTS, type PlanName } from '@rota/contracts';

interface BillingModalProps {
  visible: boolean;
  onClose: () => void;
  teamId: string;
  teamName: string;
}

export function BillingModal({ visible, onClose, teamId, teamName }: BillingModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { data: subscription, isLoading: isSubLoading, refetch: refetchSub } = useSubscription(teamId);
  const { data: ledger, isLoading: isLedgerLoading } = useBillingLedger(teamId);

  const createQuoteMutation = useCreateBillingQuote(teamId);
  const createCheckoutMutation = useCreateCheckout(teamId);

  // Form selection state
  const [selectedPlan, setSelectedPlan] = useState<PlanName>('starter');
  const [selectedSeats, setSelectedSeats] = useState<number>(5);
  const [activeTab, setActiveTab] = useState<'plans' | 'history'>('plans');

  // Initialize selection when subscription loads
  useEffect(() => {
    if (subscription) {
      setSelectedPlan(subscription.plan);
      setSelectedSeats(subscription.purchasedSeats);
    }
  }, [subscription]);

  // Request new quote when selection changes
  useEffect(() => {
    if (!visible || !subscription) return;

    // Avoid requesting quote if exact match with current active non-trialing state
    if (
      subscription.status === 'active' &&
      selectedPlan === subscription.plan &&
      selectedSeats === subscription.purchasedSeats
    ) {
      return;
    }

    createQuoteMutation.mutate({
      plan: selectedPlan,
      purchasedSeats: selectedSeats,
    });
  }, [selectedPlan, selectedSeats, visible, subscription?.status]);

  const quote = createQuoteMutation.data;

  // Handle Plan selection change with default seats
  const handleSelectPlan = (plan: PlanName) => {
    setSelectedPlan(plan);
    if (plan === 'starter') {
      setSelectedSeats(5);
    } else if (plan === 'team') {
      if (selectedSeats < 15 || selectedSeats > 38) {
        setSelectedSeats(15);
      }
    } else if (plan === 'business') {
      if (selectedSeats < 40) {
        setSelectedSeats(40);
      }
    }
  };

  // Seat Stepper helpers
  const canIncrement = useMemo(() => {
    if (selectedPlan === 'starter') return false;
    if (selectedPlan === 'team') return selectedSeats < 38;
    if (selectedPlan === 'business') return selectedSeats < 100;
    return false;
  }, [selectedPlan, selectedSeats]);

  const canDecrement = useMemo(() => {
    if (selectedPlan === 'starter') return false;
    if (selectedPlan === 'team') return selectedSeats > 15;
    if (selectedPlan === 'business') return selectedSeats > 40;
    return false;
  }, [selectedPlan, selectedSeats]);

  const handleIncrement = () => {
    if (canIncrement) setSelectedSeats((prev) => prev + 1);
  };

  const handleDecrement = () => {
    if (canDecrement) setSelectedSeats((prev) => prev - 1);
  };

  // Handle Checkout / Confirmation
  const handleProceed = async () => {
    if (!quote) return;

    const idempotencyKey = `chk_${teamId}_${Date.now()}`;
    const result = await createCheckoutMutation.mutateAsync({
      quoteId: quote.id,
      idempotencyKey,
    });

    if (result.checkoutUrl) {
      if (result.checkoutUrl.startsWith('http')) {
        await Linking.openURL(result.checkoutUrl);
      }
      refetchSub();
      onClose();
    }
  };

  const formatCents = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        {/* Modal Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Team Subscription</Text>
            <Text style={styles.subtitle}>{teamName}</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close billing modal"
          >
            <X size={20} color={theme.colors.onSurfaceVariant} />
          </Pressable>
        </View>

        {/* Tab Toggle: Plans vs Ledger */}
        <View style={styles.tabsRow}>
          <Pressable
            onPress={() => setActiveTab('plans')}
            style={[styles.tabButton, activeTab === 'plans' && styles.tabButtonActive]}
          >
            <CreditCard
              size={16}
              color={activeTab === 'plans' ? theme.colors.primary : theme.colors.onSurfaceVariant}
            />
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'plans' && { color: theme.colors.primary, fontWeight: '700' },
              ]}
            >
              Plans & Pricing
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('history')}
            style={[styles.tabButton, activeTab === 'history' && styles.tabButtonActive]}
          >
            <History
              size={16}
              color={activeTab === 'history' ? theme.colors.primary : theme.colors.onSurfaceVariant}
            />
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'history' && { color: theme.colors.primary, fontWeight: '700' },
              ]}
            >
              Billing History
            </Text>
          </Pressable>
        </View>

        {isSubLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {activeTab === 'plans' ? (
              <>
                {/* Status Alert Banner */}
                {subscription && (
                  <Card
                    style={styles.statusCard}
                    variant={
                      subscription.status === 'restricted' || subscription.status === 'grace'
                        ? 'outlined'
                        : 'flat'
                    }
                  >
                    <View style={styles.statusRow}>
                      <View style={styles.statusLeft}>
                        {subscription.status === 'trialing' && (
                          <Sparkles size={20} color={theme.colors.primary} />
                        )}
                        {subscription.status === 'active' && (
                          <ShieldCheck size={20} color={theme.colors.primary} />
                        )}
                        {(subscription.status === 'grace' || subscription.status === 'restricted') && (
                          <AlertCircle size={20} color={theme.colors.error} />
                        )}
                        <View style={{ marginLeft: theme.spacing.small }}>
                          <Text style={styles.statusHeading}>
                            {subscription.status === 'trialing' && '14-Day Free Trial Active'}
                            {subscription.status === 'active' && 'Active Subscription'}
                            {subscription.status === 'grace' && '7-Day Grace Period Active'}
                            {subscription.status === 'restricted' && 'Account Restricted (Read-Only)'}
                          </Text>
                          <Text style={styles.statusSubtext}>
                            Current Plan: {subscription.plan.toUpperCase()} • {subscription.purchasedSeats} Seats
                          </Text>
                        </View>
                      </View>
                      <Badge
                        label={subscription.status.toUpperCase()}
                        variant={
                          subscription.status === 'active'
                            ? 'primary'
                            : subscription.status === 'trialing'
                            ? 'secondary'
                            : 'error'
                        }
                      />
                    </View>
                  </Card>
                )}

                {/* Section Title */}
                <Text style={styles.sectionHeader}>Choose Plan</Text>

                {/* Plan Option 1: Starter */}
                <Card
                  style={[
                    styles.planCard,
                    selectedPlan === 'starter' ? styles.selectedPlanCard : undefined,
                  ]}
                  onPress={() => handleSelectPlan('starter')}
                >
                  <View style={styles.planHeader}>
                    <View>
                      <Text style={styles.planName}>{PLAN_CONSTANTS.starter.name}</Text>
                      <Text style={styles.planSub}>{PLAN_CONSTANTS.starter.includedSeats} staff seats included</Text>
                    </View>
                    <Text style={styles.planPrice}>
                      {formatCents(PLAN_CONSTANTS.starter.basePriceCents)}
                      <Text style={styles.perMonth}>/mo</Text>
                    </Text>
                  </View>
                  <Text style={styles.planDesc}>Ideal for intimate cafés and small shift rotations.</Text>
                </Card>

                {/* Plan Option 2: Team */}
                <Card
                  style={[
                    styles.planCard,
                    selectedPlan === 'team' ? styles.selectedPlanCard : undefined,
                  ]}
                  onPress={() => handleSelectPlan('team')}
                >
                  <View style={styles.planHeader}>
                    <View>
                      <Text style={styles.planName}>{PLAN_CONSTANTS.team.name}</Text>
                      <Text style={styles.planSub}>
                        {PLAN_CONSTANTS.team.includedSeats} seats included • +$3/seat extra
                      </Text>
                    </View>
                    <Text style={styles.planPrice}>
                      {formatCents(PLAN_CONSTANTS.team.basePriceCents)}
                      <Text style={styles.perMonth}>/mo</Text>
                    </Text>
                  </View>
                  <Text style={styles.planDesc}>
                    For growing restaurants and bars. Up to 38 seats max capacity.
                  </Text>
                </Card>

                {/* Plan Option 3: Business */}
                <Card
                  style={[
                    styles.planCard,
                    selectedPlan === 'business' ? styles.selectedPlanCard : undefined,
                  ]}
                  onPress={() => handleSelectPlan('business')}
                >
                  <View style={styles.planHeader}>
                    <View>
                      <Text style={styles.planName}>{PLAN_CONSTANTS.business.name}</Text>
                      <Text style={styles.planSub}>
                        {PLAN_CONSTANTS.business.includedSeats} seats included • +$2/seat extra
                      </Text>
                    </View>
                    <Text style={styles.planPrice}>
                      {formatCents(PLAN_CONSTANTS.business.basePriceCents)}
                      <Text style={styles.perMonth}>/mo</Text>
                    </Text>
                  </View>
                  <Text style={styles.planDesc}>
                    For multi-station kitchens and high-volume operations up to 100 seats.
                  </Text>
                </Card>

                {/* Seat Capacity Stepper */}
                <View style={styles.stepperContainer}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stepperLabel}>Purchased Capacity</Text>
                    <Text style={styles.stepperSubtext}>
                      {selectedPlan === 'starter' && 'Fixed at 5 seats for Starter'}
                      {selectedPlan === 'team' && 'Adjust between 15 and 38 seats'}
                      {selectedPlan === 'business' && 'Adjust between 40 and 100 seats'}
                    </Text>
                  </View>

                  <View style={styles.stepperControls}>
                    <Pressable
                      onPress={handleDecrement}
                      disabled={!canDecrement}
                      style={[styles.stepperButton, !canDecrement && styles.stepperButtonDisabled]}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease seats"
                    >
                      <Minus
                        size={18}
                        color={canDecrement ? theme.colors.onSurface : theme.colors.onSurfaceVariant}
                      />
                    </Pressable>

                    <Text style={styles.seatsCountText}>{selectedSeats}</Text>

                    <Pressable
                      onPress={handleIncrement}
                      disabled={!canIncrement}
                      style={[styles.stepperButton, !canIncrement && styles.stepperButtonDisabled]}
                      accessibilityRole="button"
                      accessibilityLabel="Increase seats"
                    >
                      <Plus
                        size={18}
                        color={canIncrement ? theme.colors.onSurface : theme.colors.onSurfaceVariant}
                      />
                    </Pressable>
                  </View>
                </View>

                {/* Live Billing Quote Summary */}
                <Card style={styles.quoteCard}>
                  <Text style={styles.quoteHeader}>Billing Summary</Text>

                  {createQuoteMutation.isPending ? (
                    <View style={styles.quoteLoadingRow}>
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                      <Text style={styles.quoteLoadingText}>Calculating proration...</Text>
                    </View>
                  ) : quote ? (
                    <View style={styles.quoteDetails}>
                      <View style={styles.quoteRow}>
                        <Text style={styles.quoteLabel}>New Recurring Total</Text>
                        <Text style={styles.quoteValue}>{formatCents(quote.newRecurringCents)}/mo</Text>
                      </View>

                      {quote.isImmediate ? (
                        <>
                          {quote.creditCents > 0 && (
                            <View style={styles.quoteRow}>
                              <Text style={styles.quoteSubLabel}>Prorated Credit for Remaining Time</Text>
                              <Text style={[styles.quoteSubValue, { color: theme.colors.primary }]}>
                                -{formatCents(quote.creditCents)}
                              </Text>
                            </View>
                          )}
                          {quote.costCents > 0 && (
                            <View style={styles.quoteRow}>
                              <Text style={styles.quoteSubLabel}>Prorated Cost for New Plan</Text>
                              <Text style={styles.quoteSubValue}>+{formatCents(quote.costCents)}</Text>
                            </View>
                          )}
                          <View style={[styles.quoteRow, styles.quoteTotalRow]}>
                            <Text style={styles.totalLabel}>Due Today</Text>
                            <Text style={styles.totalValue}>{formatCents(quote.amountCents)}</Text>
                          </View>
                        </>
                      ) : (
                        <View style={styles.scheduledNotice}>
                          <Clock size={16} color={theme.colors.primary} />
                          <Text style={styles.scheduledNoticeText}>
                            Change is scheduled for next renewal. No charge today ($0.00).
                          </Text>
                        </View>
                      )}
                    </View>
                  ) : null}
                </Card>

                {/* Action CTA Button */}
                <PrimaryButton
                  label={
                    quote?.isImmediate
                      ? `Proceed to Checkout (${formatCents(quote.amountCents)})`
                      : 'Schedule Plan Change'
                  }
                  onPress={handleProceed}
                  loading={createCheckoutMutation.isPending}
                  disabled={!quote || createQuoteMutation.isPending}
                  leadingIcon={<ArrowUpRight size={18} color={theme.colors.onPrimary} />}
                  style={styles.ctaButton}
                />
              </>
            ) : (
              /* Billing History Tab (Ledger) */
              <View>
                <Text style={styles.sectionHeader}>Billing History (Append-Only Ledger)</Text>
                {isLedgerLoading ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : ledger && ledger.length > 0 ? (
                  ledger.map((entry) => (
                    <Card key={entry.id} style={styles.ledgerCard}>
                      <View style={styles.ledgerRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.ledgerReason}>{entry.reason}</Text>
                          <Text style={styles.ledgerDate}>
                            {new Date(entry.createdAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text
                            style={[
                              styles.ledgerAmount,
                              entry.amountCents > 0 && { color: theme.colors.onSurface },
                              entry.amountCents < 0 && { color: theme.colors.primary },
                            ]}
                          >
                            {entry.amountCents > 0 ? `+${formatCents(entry.amountCents)}` : formatCents(entry.amountCents)}
                          </Text>
                          <Badge
                            label={entry.entryType.toUpperCase()}
                            variant={entry.entryType === 'charge' ? 'primary' : 'neutral'}
                            size="small"
                          />
                        </View>
                      </View>
                    </Card>
                  ))
                ) : (
                  <Text style={styles.emptyText}>No ledger entries recorded yet.</Text>
                )}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const createStyles = (t: ThemeContextValue) => {
  return StyleSheet.create({
    modalContainer: {
      flex: 1,
      backgroundColor: t.colors.surface,
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
    title: {
      ...t.textStyles.titleLarge,
      color: t.colors.onSurface,
      fontWeight: '700',
    },
    subtitle: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
    closeButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabsRow: {
      flexDirection: 'row',
      paddingHorizontal: t.spacing.base,
      paddingVertical: t.spacing.small,
      backgroundColor: t.colors.surfaceContainerLowest,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.surfaceVariant,
      gap: t.spacing.small,
    },
    tabButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: t.spacing.small,
      borderRadius: t.radius.control,
      gap: t.spacing.extraSmall,
    },
    tabButtonActive: {
      backgroundColor: t.colors.surfaceContainer,
    },
    tabButtonText: {
      ...t.textStyles.labelMedium,
      color: t.colors.onSurfaceVariant,
    },
    scrollContent: {
      padding: t.spacing.base,
      paddingBottom: t.spacing.extraLarge * 2,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statusCard: {
      marginBottom: t.spacing.medium,
      backgroundColor: t.colors.surfaceContainerLowest,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    statusLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    statusHeading: {
      ...t.textStyles.titleMedium,
      color: t.colors.onSurface,
      fontWeight: '600',
    },
    statusSubtext: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
    sectionHeader: {
      ...t.textStyles.titleMedium,
      color: t.colors.onSurface,
      fontWeight: '700',
      marginTop: t.spacing.small,
      marginBottom: t.spacing.small,
    },
    planCard: {
      marginBottom: t.spacing.medium,
      padding: t.spacing.base,
      borderColor: t.colors.surfaceVariant,
    },
    selectedPlanCard: {
      borderColor: t.colors.primary,
      borderWidth: 2,
      backgroundColor: t.colors.surfaceContainerLowest,
    },
    planHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: t.spacing.extraSmall,
    },
    planName: {
      ...t.textStyles.titleMedium,
      color: t.colors.onSurface,
      fontWeight: '700',
    },
    planSub: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
    planPrice: {
      ...t.textStyles.titleLarge,
      color: t.colors.primary,
      fontWeight: '800',
    },
    perMonth: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
      fontWeight: '400',
    },
    planDesc: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
    },
    stepperContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.colors.surfaceContainerLowest,
      borderRadius: t.radius.card,
      padding: t.spacing.base,
      borderWidth: 1,
      borderColor: t.colors.surfaceVariant,
      marginBottom: t.spacing.medium,
    },
    stepperLabel: {
      ...t.textStyles.titleMedium,
      color: t.colors.onSurface,
      fontWeight: '600',
    },
    stepperSubtext: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
    stepperControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
    },
    stepperButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperButtonDisabled: {
      opacity: 0.3,
    },
    seatsCountText: {
      ...t.textStyles.titleLarge,
      color: t.colors.onSurface,
      fontWeight: '700',
      minWidth: 32,
      textAlign: 'center',
    },
    quoteCard: {
      backgroundColor: t.colors.surfaceContainerLowest,
      marginBottom: t.spacing.medium,
      padding: t.spacing.base,
    },
    quoteHeader: {
      ...t.textStyles.titleMedium,
      color: t.colors.onSurface,
      fontWeight: '700',
      marginBottom: t.spacing.small,
    },
    quoteLoadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      paddingVertical: t.spacing.small,
    },
    quoteLoadingText: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
    },
    quoteDetails: {
      gap: t.spacing.extraSmall,
    },
    quoteRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    quoteLabel: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurface,
      fontWeight: '600',
    },
    quoteValue: {
      ...t.textStyles.titleMedium,
      color: t.colors.onSurface,
      fontWeight: '700',
    },
    quoteSubLabel: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
    quoteSubValue: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
      fontWeight: '600',
    },
    quoteTotalRow: {
      marginTop: t.spacing.small,
      paddingTop: t.spacing.small,
      borderTopWidth: 1,
      borderTopColor: t.colors.surfaceVariant,
    },
    totalLabel: {
      ...t.textStyles.titleMedium,
      color: t.colors.onSurface,
      fontWeight: '700',
    },
    totalValue: {
      ...t.textStyles.headlineSmall,
      color: t.colors.primary,
      fontWeight: '800',
    },
    scheduledNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.small,
      backgroundColor: t.colors.surfaceContainer,
      padding: t.spacing.small,
      borderRadius: t.radius.control,
      marginTop: t.spacing.small,
    },
    scheduledNoticeText: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
      flex: 1,
    },
    ctaButton: {
      marginTop: t.spacing.small,
    },
    ledgerCard: {
      marginBottom: t.spacing.small,
      padding: t.spacing.base,
    },
    ledgerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    ledgerReason: {
      ...t.textStyles.titleSmall,
      color: t.colors.onSurface,
      fontWeight: '600',
    },
    ledgerDate: {
      ...t.textStyles.bodySmall,
      color: t.colors.onSurfaceVariant,
    },
    ledgerAmount: {
      ...t.textStyles.titleMedium,
      fontWeight: '700',
      marginBottom: t.spacing.extraSmall / 2,
    },
    emptyText: {
      ...t.textStyles.bodyMedium,
      color: t.colors.onSurfaceVariant,
      textAlign: 'center',
      marginTop: t.spacing.large,
    },
  });
};
