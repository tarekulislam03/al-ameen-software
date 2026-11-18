import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { CustomerFormDialog, PaymentFormDialog } from '@/components/customer-forms';
import { Btn, formatDate, money, openUrl, ProgressStatusBar, StatusBadge, T, whatsappNumber } from '@/components/erp-ui';
import { ERP } from '@/constants/erp';
import { api, Customer, Payment } from '@/services/api';

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < ERP.mobileBreakpoint;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('Saving to database...');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      setCustomer(await api.getCustomer(String(id)));
    } catch (e: any) {
      setError(e?.message || 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const goBack = () => router.replace('/' as Href);

  const remove = async () => {
    if (!customer) return;
    try {
      setBusyMessage('Deleting customer from database...');
      setBusy(true);
      await api.deleteCustomer(customer.id);
      goBack();
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
      setBusy(false);
    }
  };

  const removePayment = async (paymentId: string) => {
    try {
      setBusyMessage('Deleting payment from database...');
      setBusy(true);
      await api.deletePayment(paymentId);
      setDeletingPaymentId(null);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not delete payment');
    } finally {
      setBusy(false);
    }
  };

  const callNow = () => customer && openUrl(`tel:${customer.phone.replace(/[^\d+]/g, '')}`);

  const whatsappReminder = () => {
    if (!customer) return;
    const msg =
      `Dear ${customer.name}, this is a gentle reminder from AL AMIN MOTOR TRAINING that ${money(customer.balance)} ` +
      `is pending${customer.category ? ` for ${customer.category}` : ''}. ` +
      `Total fee ${money(customer.totalFee)}, paid ${money(customer.paidAmount)}. ` +
      'Kindly clear the balance at your earliest convenience. Thank you.';
    openUrl(`https://wa.me/${whatsappNumber(customer.phone)}?text=${encodeURIComponent(msg)}`, true);
  };

  if (loading) {
    return (
      <View style={s.page}>
        <ProgressStatusBar active message="Loading customer from database..." />
      </View>
    );
  }
  if (!customer) {
    return (
      <View style={s.page}>
        <Btn label="< Customers" onPress={goBack} mobile={isMobile} />
        <T style={{ color: ERP.danger }}>{error || 'Customer not found'}</T>
      </View>
    );
  }

  const kv = (k: string, v: string, bold?: boolean) => (
    <View style={[s.kv, isMobile ? { width: '100%' } : { width: '50%' }]}>
      <T style={s.kvKey}>{k}</T>
      <T style={[{ flex: 1 }, bold && { fontWeight: '700' }]}>{v || '-'}</T>
    </View>
  );

  const payments = customer.payments ?? [];

  return (
    <ScrollView contentContainerStyle={s.page}>
      <View style={s.topRow}>
        <Btn label="< Customers" onPress={goBack} mobile={isMobile} />
        <T style={s.heading} numberOfLines={1}>
          {customer.name}
        </T>
        <T style={{ color: ERP.textMuted }}>{customer.id}</T>
      </View>

      <ProgressStatusBar active={busy} message={busyMessage} />

      {error && (
        <Pressable onPress={() => setError(null)} style={s.errorBar}>
          <T style={{ color: ERP.danger }}>{error} (tap to dismiss)</T>
        </Pressable>
      )}

      <View style={s.btnRow}>
        <Btn label={`Call ${customer.phone}`} onPress={callNow} mobile={isMobile} />
        {customer.balance > 0 && (
          <Btn label="WhatsApp reminder" onPress={whatsappReminder} mobile={isMobile} />
        )}
        <Btn
          label={customer.balance > 0 ? '+ Add payment' : 'Fully paid'}
          primary
          disabled={customer.balance <= 0}
          onPress={() => {
            setEditingPayment(null);
            setPayOpen(true);
          }}
          mobile={isMobile}
        />
        <Btn label="Edit" onPress={() => setEditOpen(true)} mobile={isMobile} />
        {confirmDelete ? (
          <>
            <Btn label={busy ? 'Deleting...' : 'Confirm delete'} danger onPress={remove} disabled={busy} mobile={isMobile} />
            <Btn label="Cancel" onPress={() => setConfirmDelete(false)} mobile={isMobile} />
          </>
        ) : (
          <Btn label="Delete" danger onPress={() => setConfirmDelete(true)} mobile={isMobile} />
        )}
      </View>
      {confirmDelete && (
        <T style={{ color: ERP.danger }}>
          Delete {customer.name} and all {payments.length} payment record(s)? This cannot be undone.
        </T>
      )}

      <T style={s.section}>Customer record</T>
      <View style={[s.panel, s.kvWrap]}>
        {kv('Name', customer.name, true)}
        {kv('Phone', customer.phone)}
        {kv('Date of birth', formatDate(customer.dob))}
        {kv('Enrolled on', formatDate(customer.enrollmentDate))}
        {kv('Category', customer.category)}
        {kv('Document status', customer.documentStatus, true)}
        {kv('Address', customer.address)}
        {kv('Notes', customer.notes)}
        {kv('Created at', customer.createdAt)}
      </View>

      <T style={s.section}>Fees (calculated from payments)</T>
      <View style={[s.panel, s.feeRow]}>
        <View style={s.feeCell}>
          <T style={s.kvKey}>Total fee</T>
          <T style={s.feeVal}>{money(customer.totalFee)}</T>
        </View>
        <View style={s.feeCell}>
          <T style={s.kvKey}>Paid</T>
          <T style={s.feeVal}>{money(customer.paidAmount)}</T>
        </View>
        <View style={s.feeCell}>
          <T style={s.kvKey}>Balance</T>
          <T style={[s.feeVal, customer.balance > 0 && { color: ERP.danger }]}>{money(customer.balance)}</T>
        </View>
        <View style={s.feeCell}>
          <T style={s.kvKey}>Status</T>
          <StatusBadge status={customer.paymentStatus} />
        </View>
      </View>

      <T style={s.section}>Payment history ({payments.length})</T>
      <View style={s.panel}>
        <View style={s.thRow}>
          <T style={[s.th, { width: 96 }]}>Date</T>
          <T style={[s.th, { width: 70 }]}>Mode</T>
          <T style={[s.th, { flex: 1 }]}>Note</T>
          <T style={[s.th, { width: 90, textAlign: 'right' }]}>Amount</T>
          {!isMobile && <T style={[s.th, { width: 110 }]}>Payment ID</T>}
          <T style={[s.th, { width: isMobile ? 120 : 150 }]}>Actions</T>
        </View>
        {payments.length === 0 && <T style={{ padding: 8, color: ERP.textMuted }}>No payments recorded.</T>}
        {payments.map((p, i) => (
          <View key={p.paymentId} style={[s.tr, { backgroundColor: i % 2 === 0 ? ERP.white : '#EEF1F6' }]}>
            <T style={[s.td, { width: 96 }]}>{formatDate(p.date)}</T>
            <T style={[s.td, { width: 70 }]}>{p.mode}</T>
            <T style={[s.td, { flex: 1 }]}>{p.note}</T>
            <T style={[s.td, { width: 90, textAlign: 'right' }]}>{money(p.amount)}</T>
            {!isMobile && <T style={[s.td, { width: 110, color: ERP.textMuted }]}>{p.paymentId}</T>}
            <View style={[s.td, s.actionCell, { width: isMobile ? 120 : 150 }]}>
              {deletingPaymentId === p.paymentId ? (
                <>
                  <Btn label="Yes, delete" danger disabled={busy} onPress={() => removePayment(p.paymentId)} mobile={isMobile} />
                  <Btn label="No" onPress={() => setDeletingPaymentId(null)} mobile={isMobile} />
                </>
              ) : (
                <>
                  <Btn
                    label="Edit"
                    mobile={isMobile}
                    onPress={() => {
                      setEditingPayment(p);
                      setPayOpen(true);
                    }}
                  />
                  <Btn label="Delete" danger mobile={isMobile} onPress={() => setDeletingPaymentId(p.paymentId)} />
                </>
              )}
            </View>
          </View>
        ))}
        {payments.length > 0 && (
          <View style={[s.tr, { backgroundColor: ERP.panelBg }]}>
            <T style={[s.td, { flex: 1, fontWeight: '700' }]}>Total paid</T>
            <T style={[s.td, { width: 90, textAlign: 'right', fontWeight: '700' }]}>{money(customer.paidAmount)}</T>
            {!isMobile && <View style={{ width: 110 }} />}
            <View style={{ width: isMobile ? 120 : 150 }} />
          </View>
        )}
      </View>

      <CustomerFormDialog
        visible={editOpen}
        customer={customer}
        isMobile={isMobile}
        onClose={() => setEditOpen(false)}
        onSaved={(saved) => {
          setEditOpen(false);
          setCustomer(saved);
        }}
      />
      <PaymentFormDialog
        visible={payOpen}
        customer={customer}
        payment={editingPayment}
        isMobile={isMobile}
        onClose={() => setPayOpen(false)}
        onSaved={() => {
          setPayOpen(false);
          load();
        }}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 8, gap: 8 },
  msg: { padding: 12, color: ERP.textMuted },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  section: { fontWeight: '700', marginTop: 4 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  errorBar: { borderWidth: 1, borderColor: ERP.danger, backgroundColor: '#F6D5D5', padding: 6 },
  panel: { borderWidth: 1, borderColor: ERP.border, backgroundColor: ERP.white },
  kvWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  kv: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: ERP.borderLight },
  kvKey: { width: 110, padding: 5, backgroundColor: ERP.panelBg, color: ERP.textMuted },
  feeRow: { flexDirection: 'row', flexWrap: 'wrap' },
  feeCell: { flexGrow: 1, flexBasis: 130, padding: 8, gap: 4, borderRightWidth: 1, borderRightColor: ERP.borderLight },
  feeVal: { fontSize: 16, fontWeight: '700' },
  thRow: {
    flexDirection: 'row',
    backgroundColor: '#D5DAE3',
    borderBottomWidth: 1,
    borderBottomColor: ERP.border,
  },
  th: { padding: 6, fontWeight: '700' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: ERP.borderLight },
  td: { padding: 6 },
  actionCell: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
});
