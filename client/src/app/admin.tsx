import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  Btn,
  DatePicker,
  Dialog,
  Field,
  formatDate,
  Input,
  money,
  ProgressStatusBar,
  StatusBadge,
  T,
} from '@/components/erp-ui';
import { ERP } from '@/constants/erp';
import { AdminDashboardResponse, api, CounterSummary } from '@/services/api';
import { useAuth } from '@/services/auth';

type DatePreset = 'today' | '7days' | 'month' | 'all' | 'custom';

function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysAgoStr(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateStr(d);
}

function monthStartStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function CounterCard({
  counter,
  presetLabel,
  activeFilter,
  onFilterPress,
  onEditPress,
}: {
  counter: CounterSummary;
  presetLabel: string;
  activeFilter: boolean;
  onFilterPress: () => void;
  onEditPress?: () => void;
}) {
  const count = counter.customerCount ?? 0;
  const collected = counter.periodStats?.paymentCollectedAmount ?? 0;
  const paymentCount = counter.periodStats?.paymentsCreated ?? 0;

  return (
    <View style={[styles.counterCard, activeFilter && styles.counterCardActive]}>
      <View style={styles.counterHeader}>
        <View style={{ flex: 1 }}>
          <T style={styles.counterTitle}>
            {counter.counter || counter.name}
            {counter.name && counter.counter && counter.name !== counter.counter ? ` · ${counter.name}` : ''}
          </T>
          <T style={styles.counterSub}>
            Username: {counter.username} · {counter.role === 'admin' ? 'Admin' : 'Staff'}
          </T>
        </View>
        <View style={styles.counterHeaderBtns}>
          {onEditPress && <Btn label="Edit Staff" onPress={onEditPress} />}
          <Btn
            label={activeFilter ? 'Showing' : 'View Customers'}
            primary={activeFilter}
            onPress={onFilterPress}
          />
        </View>
      </View>

      <View style={styles.counterBody}>
        <View style={styles.metricRow}>
          <View style={styles.metricBox}>
            <T style={styles.metricLabel}>Total Customers</T>
            <T style={styles.metricValue}>{count}</T>
          </View>
          <View style={styles.metricBox}>
            <T style={styles.metricLabel}>Collected ({presetLabel})</T>
            <T style={styles.metricValue}>{money(collected)}</T>
            <T style={styles.metricHint}>{paymentCount} payment(s)</T>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function AdminDashboardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < ERP.mobileBreakpoint;

  const [preset, setPreset] = useState<DatePreset>('today');
  const [from, setFrom] = useState(localDateStr());
  const [to, setTo] = useState(localDateStr());
  const [counterFilter, setCounterFilter] = useState('All');
  const [search, setSearch] = useState('');

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    if (p === 'today') {
      const t = localDateStr();
      setFrom(t);
      setTo(t);
    } else if (p === '7days') {
      setFrom(daysAgoStr(6));
      setTo(localDateStr());
    } else if (p === 'month') {
      setFrom(monthStartStr());
      setTo(localDateStr());
    } else if (p === 'all') {
      setFrom('');
      setTo('');
    }
  };

  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Staff edit modal state
  const [editingStaff, setEditingStaff] = useState<CounterSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editCounter, setEditCounter] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const openEditStaff = (counter: CounterSummary) => {
    setEditingStaff(counter);
    setEditName(counter.name || '');
    setEditCounter(counter.counter || '');
    setEditUsername(counter.username || '');
    setEditPassword('');
    setEditError(null);
  };

  const saveStaffEdit = async () => {
    if (!editingStaff?.id) return;
    if (!editName.trim() || !editCounter.trim() || !editUsername.trim()) {
      setEditError('Staff name, counter name, and username are required.');
      return;
    }
    try {
      setEditBusy(true);
      setEditError(null);
      await api.updateStaffAccount(editingStaff.id, {
        name: editName.trim(),
        counter: editCounter.trim(),
        username: editUsername.trim(),
        ...(editPassword ? { password: editPassword } : {}),
      });
      setEditingStaff(null);
      await load();
    } catch (e: any) {
      setEditError(e?.message || 'Failed to update staff account');
    } finally {
      setEditBusy(false);
    }
  };

  const load = useCallback(async () => {
    if (user?.role !== 'admin') {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await api.getAdminDashboard({
        from: from || undefined,
        to: to || undefined,
      });
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Failed to load counter dashboard');
    } finally {
      setLoading(false);
    }
  }, [user?.role, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const staffCounters = useMemo(
    () => (data?.counters || []).filter((c) => c.role === 'staff'),
    [data]
  );

  const filterOptions = useMemo(() => {
    const list = ['All'];
    for (const c of data?.counters || []) {
      if (c.role === 'staff' || (c.customerCount ?? 0) > 0) {
        list.push(c.username);
      }
    }
    return list;
  }, [data]);

  const counterLabel = (uname: string) => {
    if (uname === 'All') return 'All Counters';
    const found = data?.counters.find((c) => c.username === uname);
    return found ? found.counter || found.name : uname;
  };

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.customers || []).filter((c) => {
      if (counterFilter !== 'All' && c.staffUsername !== counterFilter) return false;
      if (q) {
        const hay = `${c.name} ${c.phone} ${c.id} ${c.category} ${c.counterName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data?.customers, counterFilter, search]);

  if (user?.role !== 'admin') {
    return (
      <View style={styles.restrictedWrap}>
        <View style={styles.restrictedBox}>
          <T style={styles.restrictedTitle}>Admin Access Only</T>
          <T style={styles.restrictedText}>
            This counter dashboard is only visible to the admin account.
          </T>
          <Btn label="Back to Customers" primary onPress={() => router.replace('/' as Href)} />
        </View>
      </View>
    );
  }

  const presetLabel =
    preset === 'today'
      ? 'Today'
      : preset === '7days'
      ? 'Last 7 Days'
      : preset === 'month'
      ? 'This Month'
      : preset === 'all'
      ? 'All Time'
      : from || to
      ? `${from || '...'} to ${to || '...'}`
      : 'Selected';

  return (
    <View style={styles.page}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarLeft}>
          <T style={styles.pageTitle}>Counter Dashboard</T>
          <View style={styles.presetRow}>
            <Btn label="Today" primary={preset === 'today'} onPress={() => applyPreset('today')} />
            <Btn label="7 Days" primary={preset === '7days'} onPress={() => applyPreset('7days')} />
            <Btn label="This Month" primary={preset === 'month'} onPress={() => applyPreset('month')} />
            <Btn label="All Time" primary={preset === 'all'} onPress={() => applyPreset('all')} />
          </View>
        </View>
        <View style={styles.toolbarRight}>
          <View style={styles.dateRangeRow}>
            <T style={styles.dateLbl}>From</T>
            <DatePicker
              value={from}
              onChange={(v) => {
                setPreset('custom');
                setFrom(v);
              }}
              mobile={isMobile}
            />
            <T style={styles.dateLbl}>To</T>
            <DatePicker
              value={to}
              onChange={(v) => {
                setPreset('custom');
                setTo(v);
              }}
              mobile={isMobile}
            />
          </View>
          <Btn label={loading ? 'Refreshing...' : 'Refresh'} onPress={load} disabled={loading} />
        </View>
      </View>

      <ProgressStatusBar active={loading} message="Loading counters and customers..." />

      {error && (
        <View style={styles.errorBanner}>
          <T style={styles.errorText}>{error}</T>
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Two Counters Side-by-Side */}
        <View style={[styles.countersGrid, isMobile && styles.countersGridMobile]}>
          {staffCounters.map((counter) => (
            <CounterCard
              key={counter.id || counter.username}
              counter={counter}
              presetLabel={presetLabel}
              activeFilter={counterFilter === counter.username}
              onFilterPress={() =>
                setCounterFilter((prev) => (prev === counter.username ? 'All' : counter.username))
              }
              onEditPress={counter.id ? () => openEditStaff(counter) : undefined}
            />
          ))}
        </View>

        {/* Customers by Counter */}
        <View style={styles.listSection}>
          <View style={styles.listHeader}>
            <T style={styles.sectionTitle}>Customers ({filteredCustomers.length})</T>
            <Input
              value={search}
              onChangeText={setSearch}
              placeholder="Search name, phone, ID, or counter..."
              style={[styles.searchInput, isMobile && { width: '100%' }]}
            />
          </View>

          <View style={styles.filterRow}>
            <T style={styles.filterLabel}>Counter:</T>
            <View style={styles.chipWrap}>
              {filterOptions.map((opt) => (
                <Pressable
                  key={opt}
                  onPress={() => setCounterFilter(opt)}
                  style={[styles.chip, counterFilter === opt && styles.chipActive]}>
                  <T style={[styles.chipText, counterFilter === opt && styles.chipTextActive]}>
                    {counterLabel(opt)}
                  </T>
                </Pressable>
              ))}
            </View>
          </View>

          {filteredCustomers.length === 0 ? (
            <View style={styles.emptyBox}>
              <T style={styles.emptyText}>
                {loading ? 'Loading customers...' : 'No customers found for the selected counter.'}
              </T>
            </View>
          ) : (
            <View style={styles.customerList}>
              {filteredCustomers.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => router.push(`/customers/${encodeURIComponent(c.id)}` as Href)}
                  style={styles.customerRow}>
                  <View style={styles.customerMain}>
                    <View style={styles.customerTop}>
                      <View style={styles.counterTag}>
                        <T style={styles.counterTagText}>{c.counterName}</T>
                      </View>
                      <T style={styles.customerName}>{c.name}</T>
                      <T style={styles.customerId}>{c.id}</T>
                    </View>
                    <T style={styles.customerSub}>
                      {c.phone} · {c.category || 'No category'} · Enrolled {formatDate(c.enrollmentDate)}
                    </T>
                  </View>

                  <View style={styles.customerRight}>
                    <View style={styles.feeCol}>
                      <T style={styles.feeText}>
                        Fee {money(c.totalFee)} · Paid {money(c.paidAmount)} · Bal {money(c.balance)}
                      </T>
                    </View>
                    <StatusBadge status={c.paymentStatus} />
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <Dialog
        visible={Boolean(editingStaff)}
        isMobile={isMobile}
        maxWidth={420}
        title={`Manage Staff (${editingStaff?.counter || editingStaff?.name || ''})`}
        onClose={() => {
          if (!editBusy) setEditingStaff(null);
        }}>
        <View style={{ gap: 8 }}>
          <Field label="Staff Name *" full>
            <Input value={editName} onChangeText={setEditName} placeholder="e.g. Rahul" />
          </Field>
          <Field label="Counter Name *" full>
            <Input value={editCounter} onChangeText={setEditCounter} placeholder="e.g. Counter 1" />
          </Field>
          <Field label="Username *" full>
            <Input
              value={editUsername}
              onChangeText={setEditUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. staff1"
            />
          </Field>
          <Field label="New Password (leave blank to keep current)" full>
            <Input
              value={editPassword}
              onChangeText={setEditPassword}
              secureTextEntry
              placeholder="Enter new password"
            />
          </Field>
          {editError && <T style={styles.errorText}>{editError}</T>}
          <View style={styles.dialogBtns}>
            <Btn label="Cancel" onPress={() => setEditingStaff(null)} disabled={editBusy} />
            <Btn
              label={editBusy ? 'Saving...' : 'Save Changes'}
              primary
              onPress={saveStaffEdit}
              disabled={editBusy}
            />
          </View>
        </View>
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: ERP.pageBg },
  toolbar: {
    backgroundColor: ERP.panelBg,
    borderBottomWidth: 1,
    borderBottomColor: ERP.border,
    padding: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  toolbarLeft: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  toolbarRight: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  dateRangeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  dateLbl: { fontSize: 12, color: ERP.textMuted },
  pageTitle: { fontSize: 14, fontWeight: '700', color: ERP.navy },

  errorBanner: {
    backgroundColor: '#FBE9E9',
    borderBottomWidth: 1,
    borderBottomColor: ERP.danger,
    padding: 8,
  },
  errorText: { color: ERP.danger, fontSize: 12 },

  scroll: { flex: 1 },
  scrollContent: { padding: 10, gap: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: ERP.navy },

  countersGrid: { flexDirection: 'row', gap: 10 },
  countersGridMobile: { flexDirection: 'column' },
  counterCard: {
    flex: 1,
    backgroundColor: ERP.white,
    borderWidth: 1,
    borderColor: ERP.border,
  },
  counterCardActive: {
    borderColor: ERP.navy,
    borderWidth: 2,
  },
  counterHeader: {
    backgroundColor: ERP.panelBg,
    borderBottomWidth: 1,
    borderBottomColor: ERP.borderLight,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  counterHeaderBtns: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  counterTitle: { fontSize: 14, fontWeight: '700', color: ERP.navy },
  counterSub: { fontSize: 11, color: ERP.textMuted },
  counterBody: { padding: 10 },
  metricRow: { flexDirection: 'row', gap: 8 },
  metricBox: {
    flex: 1,
    backgroundColor: ERP.panelBg,
    borderWidth: 1,
    borderColor: ERP.borderLight,
    padding: 8,
  },
  metricLabel: { fontSize: 11, color: ERP.textMuted },
  metricValue: { fontSize: 18, fontWeight: '700', color: ERP.text, marginTop: 2 },
  metricHint: { fontSize: 11, color: ERP.textMuted, marginTop: 2 },

  listSection: {
    backgroundColor: ERP.white,
    borderWidth: 1,
    borderColor: ERP.border,
    padding: 10,
    gap: 8,
  },
  listHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  searchInput: { width: 280 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: ERP.borderLight,
  },
  filterLabel: { fontSize: 12, fontWeight: '700', color: ERP.textMuted },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: {
    borderWidth: 1,
    borderColor: ERP.border,
    backgroundColor: ERP.panelBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipActive: { backgroundColor: ERP.navy, borderColor: ERP.navy },
  chipText: { fontSize: 12, color: ERP.text },
  chipTextActive: { color: ERP.white, fontWeight: '700' },

  emptyBox: { padding: 20, alignItems: 'center' },
  emptyText: { color: ERP.textMuted },

  customerList: { gap: 6 },
  customerRow: {
    borderWidth: 1,
    borderColor: ERP.borderLight,
    backgroundColor: ERP.panelBg,
    padding: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  customerMain: { flex: 1, minWidth: 220, gap: 3 },
  customerTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  counterTag: {
    backgroundColor: ERP.navy,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  counterTagText: { color: ERP.white, fontSize: 11, fontWeight: '700' },
  customerName: { fontSize: 13, fontWeight: '700', color: ERP.text },
  customerId: { fontSize: 11, color: ERP.textMuted },
  customerSub: { fontSize: 12, color: ERP.textMuted },
  customerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  feeCol: { alignItems: 'flex-end' },
  feeText: { fontSize: 12, color: ERP.text },

  dialogBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },

  restrictedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  restrictedBox: {
    maxWidth: 380,
    width: '100%',
    backgroundColor: ERP.white,
    borderWidth: 1,
    borderColor: ERP.border,
    padding: 16,
    gap: 10,
    alignItems: 'flex-start',
  },
  restrictedTitle: { fontSize: 15, fontWeight: '700', color: ERP.danger },
  restrictedText: { fontSize: 13, color: ERP.text },
});
