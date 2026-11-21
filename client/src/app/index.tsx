import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { CATEGORIES, CustomerFormDialog } from '@/components/customer-forms';
import { Btn, Chips, DatePicker, formatDate, Input, InputRef, money, ProgressStatusBar, Select, StatusBadge, T } from '@/components/erp-ui';
import { ERP } from '@/constants/erp';
import { api, Customer } from '@/services/api';

// ---------- grid definition ----------
type SortKey =
  | 'id'
  | 'name'
  | 'phone'
  | 'category'
  | 'totalFee'
  | 'paidAmount'
  | 'balance'
  | 'paymentStatus'
  | 'enrollmentDate';

const COLS: { key: SortKey; label: string; flex: number; min: number; numeric?: boolean }[] = [
  { key: 'id', label: 'ID', flex: 0.9, min: 92 },
  { key: 'name', label: 'Name', flex: 1.6, min: 140 },
  { key: 'phone', label: 'Phone', flex: 1.2, min: 110 },
  { key: 'category', label: 'Category', flex: 2, min: 170 },
  { key: 'totalFee', label: 'Total Fee', flex: 0.9, min: 84, numeric: true },
  { key: 'paidAmount', label: 'Paid', flex: 0.9, min: 84, numeric: true },
  { key: 'balance', label: 'Balance', flex: 0.9, min: 84, numeric: true },
  { key: 'paymentStatus', label: 'Status', flex: 0.8, min: 76 },
  { key: 'enrollmentDate', label: 'Enrolled', flex: 1, min: 92 },
];
const GRID_MIN_WIDTH = COLS.reduce((a, c) => a + c.min, 0);
const PAGE_SIZES = ['25', '50', '100'];

const digits = (v: string) => v.replace(/\D/g, '');

export default function CustomersScreen() {
  const { width } = useWindowDimensions();
  const isMobile = width < ERP.mobileBreakpoint;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // search / filters / sort / paging
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All categories');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('enrollmentDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('25');

  const searchRef = useRef<InputRef>(null);

  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setCustomers(await api.listCustomers());
    } catch (e: any) {
      setError(e?.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // "/" focuses the search box (web only)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const categories = useMemo(
    () => ['All categories', ...Array.from(new Set([...CATEGORIES, ...customers.map((c) => c.category).filter(Boolean)]))],
    [customers]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = digits(q);
    const list = customers.filter((c) => {
      if (q) {
        const nameHit = c.name.toLowerCase().includes(q);
        const phoneHit =
          c.phone.toLowerCase().includes(q) || (qDigits.length > 0 && digits(c.phone).includes(qDigits));
        if (!nameHit && !phoneHit) return false;
      }
      if (statusFilter !== 'All' && c.paymentStatus !== statusFilter) return false;
      if (categoryFilter !== 'All categories' && c.category !== categoryFilter) return false;
      if (dateFrom && (!c.enrollmentDate || c.enrollmentDate < dateFrom)) return false;
      if (dateTo && (!c.enrollmentDate || c.enrollmentDate > dateTo)) return false;
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }, [customers, query, statusFilter, categoryFilter, dateFrom, dateTo, sortKey, sortDir]);

  const size = Number(pageSize);
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * size;
  const rows = filtered.slice(start, start + size);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, categoryFilter, dateFrom, dateTo, sortKey, sortDir, pageSize]);

  const activeFilters =
    (statusFilter !== 'All' ? 1 : 0) +
    (categoryFilter !== 'All categories' ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  const clearFilters = () => {
    setStatusFilter('All');
    setCategoryFilter('All categories');
    setDateFrom('');
    setDateTo('');
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const openDetail = (c: Customer) => router.push(`/customers/${encodeURIComponent(c.id)}` as Href);

  // ---------- render pieces ----------
  const searchBar = (
    <View style={[s.searchWrap, isMobile && s.searchWrapMobile]}>
      <Input
        ref={searchRef}
        value={query}
        onChangeText={setQuery}
        placeholder={isMobile ? 'Search name or phone' : 'Search by name or phone   (press / to focus)'}
        autoCorrect={false}
        autoCapitalize="none"
        style={[s.searchInput, isMobile && { minHeight: 48 }]}
        {...(Platform.OS === 'web'
          ? { onKeyPress: (e: any) => e.nativeEvent.key === 'Escape' && searchRef.current?.blur() }
          : {})}
      />
      {query.length > 0 && (
        <Pressable onPress={() => setQuery('')} style={[s.clearBtn, isMobile && { minHeight: 48, minWidth: 48 }]}>
          <T style={{ fontWeight: '700' }}>X</T>
        </Pressable>
      )}
    </View>
  );

  const filterBar = (
    <View style={s.filterBar}>
      <View style={s.filterField}>
        <T style={s.fieldLabel}>Payment status</T>
        <Chips
          options={['All', 'Paid', 'Partial', 'Unpaid']}
          value={statusFilter}
          onChange={setStatusFilter}
          mobile={isMobile}
        />
      </View>
      <Select label="Category" value={categoryFilter} options={categories} onChange={setCategoryFilter} mobile={isMobile} />
      <View style={s.filterField}>
        <T style={s.fieldLabel}>Enrolled from / to (DD-MM-YYYY)</T>
        <View style={s.dateRow}>
          <View style={{ width: isMobile ? 140 : 136 }}>
            <DatePicker value={dateFrom} onChange={setDateFrom} mobile={isMobile} />
          </View>
          <View style={{ width: isMobile ? 140 : 136 }}>
            <DatePicker value={dateTo} onChange={setDateTo} mobile={isMobile} />
          </View>
        </View>
      </View>
      <View style={[s.filterField, { justifyContent: 'flex-end' }]}>
        <Btn label="Clear filters" onPress={clearFilters} disabled={activeFilters === 0} mobile={isMobile} />
      </View>
    </View>
  );

  const pager = (
    <View style={s.pager}>
      <T>
        {filtered.length === 0 ? '0 rows' : `${start + 1}-${Math.min(start + size, filtered.length)} of ${filtered.length}`}
        {filtered.length !== customers.length ? ` (filtered from ${customers.length})` : ''}
      </T>
      <View style={s.pagerBtns}>
        {!isMobile && (
          <>
            <T>Rows:</T>
            <Chips options={PAGE_SIZES} value={pageSize} onChange={setPageSize} />
          </>
        )}
        <Btn label="Prev" onPress={() => setPage(safePage - 1)} disabled={safePage <= 1} mobile={isMobile} />
        <T>
          {safePage}/{pageCount}
        </T>
        <Btn label="Next" onPress={() => setPage(safePage + 1)} disabled={safePage >= pageCount} mobile={isMobile} />
      </View>
    </View>
  );

  const headerCell = (c: (typeof COLS)[number]) => {
    const active = sortKey === c.key;
    return (
      <Pressable
        key={c.key}
        onPress={() => toggleSort(c.key)}
        style={[s.th, { flex: c.flex, minWidth: c.min }, c.numeric && { alignItems: 'flex-end' }]}>
        <T style={{ fontWeight: '700' }} numberOfLines={1}>
          {c.label}
          {active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
        </T>
      </Pressable>
    );
  };

  const cellText = (c: Customer, key: SortKey): React.ReactNode => {
    switch (key) {
      case 'totalFee':
      case 'paidAmount':
      case 'balance':
        return <T style={{ textAlign: 'right' }}>{money(c[key])}</T>;
      case 'enrollmentDate':
        return <T numberOfLines={1}>{formatDate(c.enrollmentDate)}</T>;
      case 'paymentStatus':
        return <StatusBadge status={c.paymentStatus} />;
      default:
        return <T numberOfLines={1}>{String(c[key] ?? '')}</T>;
    }
  };

  const desktopGrid = (
    <ScrollView horizontal style={s.gridOuter} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ flex: 1, minWidth: GRID_MIN_WIDTH }}>
        <View style={s.thRow}>{COLS.map(headerCell)}</View>
        <ScrollView style={{ flex: 1 }}>
          {rows.map((c, i) => (
            <Pressable
              key={c.id}
              onPress={() => openDetail(c)}
              style={({ hovered }: any) => [
                s.tr,
                { backgroundColor: i % 2 === 0 ? ERP.white : '#EEF1F6' },
                hovered && { backgroundColor: ERP.activeBg },
              ]}>
              {COLS.map((col) => (
                <View
                  key={col.key}
                  style={[s.td, { flex: col.flex, minWidth: col.min }, col.numeric && { alignItems: 'flex-end' }]}>
                  {cellText(c, col.key)}
                </View>
              ))}
            </Pressable>
          ))}
          {rows.length === 0 && <T style={s.empty}>No customers match.</T>}
        </ScrollView>
      </View>
    </ScrollView>
  );

  const mobileList = (
    <ScrollView style={s.gridOuter}>
      {rows.map((c, i) => (
        <Pressable
          key={c.id}
          onPress={() => openDetail(c)}
          style={[s.mRow, { backgroundColor: i % 2 === 0 ? ERP.white : '#EEF1F6' }]}>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '700' }} numberOfLines={1}>
              {c.name}
            </T>
            <T style={{ color: ERP.textMuted }}>{c.phone}</T>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 3 }}>
            <T>Bal {money(c.balance)}</T>
            <StatusBadge status={c.paymentStatus} />
          </View>
        </Pressable>
      ))}
      {rows.length === 0 && <T style={s.empty}>No customers match.</T>}
    </ScrollView>
  );

  return (
    <View style={s.page}>
      {searchBar}

      <View style={s.toolbar}>
        <T style={s.heading}>Customers</T>
        <View style={s.toolbarBtns}>
          {isMobile && (
            <Btn
              label={`Filters${activeFilters ? ` (${activeFilters})` : ''}`}
              onPress={() => setShowFilters((v) => !v)}
              mobile
            />
          )}
          <Btn label="Reload" onPress={load} mobile={isMobile} />
          <Btn label="+ New" onPress={() => setFormOpen(true)} primary mobile={isMobile} />
        </View>
      </View>

      {(!isMobile || showFilters) && filterBar}
      {error && (
        <Pressable onPress={() => setError(null)} style={s.errorBar}>
          <T style={{ color: ERP.danger }}>{error} (tap to dismiss)</T>
        </Pressable>
      )}

      <ProgressStatusBar active={loading} message="Loading customers from database..." />

      <View style={s.gridWrap}>
        {loading && customers.length === 0 ? (
          <T style={s.empty}>Loading...</T>
        ) : isMobile ? (
          mobileList
        ) : (
          desktopGrid
        )}
        {pager}
      </View>

      <CustomerFormDialog
        visible={formOpen}
        customer={null}
        isMobile={isMobile}
        onClose={() => setFormOpen(false)}
        onSaved={(saved) => {
          setFormOpen(false);
          openDetail(saved);
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, padding: 8, gap: 6 },
  searchWrap: { flexDirection: 'row', alignItems: 'stretch', zIndex: 5 },
  searchWrapMobile: { backgroundColor: ERP.pageBg, paddingBottom: 2 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 9, paddingHorizontal: 10 },
  clearBtn: {
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: ERP.border,
    backgroundColor: ERP.panelBg,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  toolbarBtns: { flexDirection: 'row', gap: 6 },
  heading: { fontSize: 15, fontWeight: '700' },
  btn: {
    borderWidth: 1,
    borderColor: ERP.border,
    backgroundColor: ERP.panelBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: {
    borderWidth: 1,
    borderColor: ERP.border,
    backgroundColor: ERP.white,
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: 'center',
  },
  filterBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    borderWidth: 1,
    borderColor: ERP.border,
    backgroundColor: ERP.panelBg,
    padding: 8,
    zIndex: 20,
  },
  filterField: { gap: 3, minWidth: 140 },
  fieldLabel: { color: ERP.textMuted, fontSize: 12 },
  dateRow: { flexDirection: 'row', gap: 4 },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: ERP.border,
    backgroundColor: ERP.white,
    paddingHorizontal: 6,
    paddingVertical: 4,
    minWidth: 190,
  },
  selectList: {
    position: 'absolute',
    top: 44,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderColor: ERP.border,
    backgroundColor: ERP.white,
  },
  selectItem: { paddingHorizontal: 6, paddingVertical: 6, justifyContent: 'center' },
  errorBar: { borderWidth: 1, borderColor: ERP.danger, backgroundColor: '#F6D5D5', padding: 6 },
  gridWrap: { flex: 1, borderWidth: 1, borderColor: ERP.border, backgroundColor: ERP.white },
  gridOuter: { flex: 1 },
  thRow: {
    flexDirection: 'row',
    backgroundColor: '#D5DAE3',
    borderBottomWidth: 1,
    borderBottomColor: ERP.border,
  },
  th: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRightWidth: 1,
    borderRightColor: ERP.borderLight,
    justifyContent: 'center',
  },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: ERP.borderLight },
  td: {
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRightWidth: 1,
    borderRightColor: ERP.borderLight,
    justifyContent: 'center',
  },
  mRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: ERP.borderLight,
  },
  badge: { borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1, alignSelf: 'flex-start' },
  empty: { padding: 12, color: ERP.textMuted },
  pager: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: 6,
    borderTopWidth: 1,
    borderTopColor: ERP.border,
    backgroundColor: ERP.panelBg,
  },
  pagerBtns: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 8 },
  dialog: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '94%',
    borderWidth: 1,
    borderColor: '#000000',
    backgroundColor: ERP.panelBg,
  },
  dialogMobile: { maxWidth: '100%', height: '100%', maxHeight: '100%' },
  dlgHeader: {
    backgroundColor: ERP.navy,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dlgTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  dlgClose: { borderWidth: 1, borderColor: '#8FA3C4', paddingHorizontal: 10, paddingVertical: 3, minHeight: 28, justifyContent: 'center' },
  panel: { borderWidth: 1, borderColor: ERP.border, backgroundColor: ERP.white },
  kvRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: ERP.borderLight },
  kvKey: { width: 96, padding: 5, backgroundColor: ERP.panelBg, color: ERP.textMuted },
  feeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, padding: 7 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  payRow: { flexDirection: 'row', gap: 8, padding: 6, borderBottomWidth: 1, borderBottomColor: ERP.borderLight },
});
