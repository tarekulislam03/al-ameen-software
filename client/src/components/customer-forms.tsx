import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import {
  Btn,
  Chips,
  DatePicker,
  Dialog,
  Field,
  Input,
  InputRef,
  money,
  ProgressStatusBar,
  Select,
  T,
  today,
} from '@/components/erp-ui';
import { ERP } from '@/constants/erp';
import { api, Customer, Payment } from '@/services/api';

export const CATEGORIES = ['New DL', 'Renew LL', 'Renew DL', 'Training', 'TO', 'HPT', 'RR', 'Miscellaneous'];
export const DOC_STATUSES = ['Pending', 'Submitted', 'Verified', 'LL Issued', 'DL Issued'];
export const PAY_MODES = ['Cash', 'UPI', 'Card'];

const emptyForm = () => ({
  name: '',
  phone: '',
  address: '',
  dob: '',
  category: '',
  enrollmentDate: today(),
  totalFee: '',
  notes: '',
  documentStatus: 'Pending',
});

/** Add (customer = null) or edit a customer. Paid/balance/status are never part of the form. */
export function CustomerFormDialog({
  visible,
  customer,
  isMobile,
  onClose,
  onSaved,
}: {
  visible: boolean;
  customer: Customer | null;
  isMobile: boolean;
  onClose: () => void;
  onSaved: (saved: Customer) => void;
}) {
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneRef = useRef<InputRef>(null);
  const dobRef = useRef<any>(null);
  const enrollRef = useRef<any>(null);
  const categoryRef = useRef<any>(null);
  const totalFeeRef = useRef<InputRef>(null);
  const addressRef = useRef<InputRef>(null);
  const notesRef = useRef<InputRef>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setForm(
      customer
        ? {
            name: customer.name,
            phone: customer.phone,
            address: customer.address,
            dob: customer.dob,
            category: customer.category,
            enrollmentDate: customer.enrollmentDate,
            totalFee: String(customer.totalFee ?? ''),
            notes: customer.notes,
            documentStatus: customer.documentStatus || 'Pending',
          }
        : emptyForm()
    );
  }, [visible, customer]);

  const set = (k: keyof ReturnType<typeof emptyForm>) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const h = isMobile ? { minHeight: 44 } : undefined;

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Name and phone are required.');
      return;
    }
    try {
      setBusy(true);
      setError(null);
      const payload = { ...form, totalFee: Number(form.totalFee) || 0 };
      const saved = customer ? await api.updateCustomer(customer.id, payload) : await api.createCustomer(payload);
      onSaved(saved);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      visible={visible}
      title={customer ? `Edit customer ${customer.id}` : 'New customer'}
      onClose={onClose}
      isMobile={isMobile}>
      <View style={s.grid}>
        <Field label="Name *">
          <Input
            value={form.name}
            onChangeText={set('name')}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => phoneRef.current?.focus()}
            style={h}
          />
        </Field>
        <Field label="Phone *">
          <Input
            ref={phoneRef}
            value={form.phone}
            onChangeText={set('phone')}
            keyboardType="phone-pad"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => (Platform.OS === 'web' ? dobRef.current?.focus() : totalFeeRef.current?.focus())}
            style={h}
          />
        </Field>
        <Field label="Date of birth">
          <DatePicker
            value={form.dob}
            onChange={set('dob')}
            mobile={isMobile}
            maxDate={today()}
            inputRef={dobRef}
            onEnter={() => enrollRef.current?.focus()}
          />
        </Field>
        <Field label="Enrollment date">
          <DatePicker
            value={form.enrollmentDate}
            onChange={set('enrollmentDate')}
            mobile={isMobile}
            inputRef={enrollRef}
            onEnter={() => categoryRef.current?.focus()}
          />
        </Field>
        <Field label="Category" zIndex={100}>
          <Select
            value={form.category}
            options={CATEGORIES}
            onChange={set('category')}
            placeholder="Select category"
            mobile={isMobile}
            selectRef={categoryRef}
            onEnter={() => totalFeeRef.current?.focus()}
          />
        </Field>
        <Field label="Total fee (₹)">
          <Input
            ref={totalFeeRef}
            value={form.totalFee}
            onChangeText={set('totalFee')}
            keyboardType="numeric"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => addressRef.current?.focus()}
            style={h}
          />
        </Field>
        <Field label="Address" full>
          <Input
            ref={addressRef}
            value={form.address}
            onChangeText={set('address')}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => notesRef.current?.focus()}
            style={h}
          />
        </Field>
        <Field label="Document status" full>
          <Chips options={DOC_STATUSES} value={form.documentStatus} onChange={set('documentStatus')} mobile={isMobile} />
        </Field>
        <Field label="Notes" full>
          <Input
            ref={notesRef}
            value={form.notes}
            onChangeText={set('notes')}
            returnKeyType="done"
            onSubmitEditing={save}
            style={h}
          />
        </Field>
      </View>
      <T style={{ color: ERP.textMuted, fontSize: 12 }}>
        Paid amount, balance and status are calculated from the Payments tab.
      </T>
      <ProgressStatusBar
        active={busy}
        message={customer ? 'Editing customer in database...' : 'Saving customer to database...'}
      />
      {error && <T style={{ color: ERP.danger }}>{error}</T>}
      <View style={s.btnRow}>
        <Btn label={busy ? 'Saving...' : 'Save'} primary onPress={save} disabled={busy} mobile={isMobile} />
        <Btn label="Cancel" onPress={onClose} mobile={isMobile} />
      </View>
    </Dialog>
  );
}

/** Add a payment (payment = null) or edit an existing one. Total paid can never exceed the total fee. */
export function PaymentFormDialog({
  visible,
  customer,
  payment,
  isMobile,
  onClose,
  onSaved,
}: {
  visible: boolean;
  customer: Customer | null;
  payment: Payment | null;
  isMobile: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pay, setPay] = useState({ amount: '', date: today(), mode: 'Cash', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<InputRef>(null);
  const noteRef = useRef<InputRef>(null);

  // The most this payment may be: the balance due, plus the old amount when editing.
  const maxAmount = customer ? Math.max(0, customer.balance + (payment ? Number(payment.amount) : 0)) : 0;

  useEffect(() => {
    if (!visible || !customer) return;
    setError(null);
    setPay(
      payment
        ? { amount: String(payment.amount), date: payment.date, mode: payment.mode, note: payment.note }
        : { amount: customer.balance > 0 ? String(customer.balance) : '', date: today(), mode: 'Cash', note: '' }
    );
  }, [visible, customer, payment]);

  const h = isMobile ? { minHeight: 44 } : undefined;

  const save = async () => {
    if (!customer) return;
    const amount = Number(pay.amount);
    if (!amount || amount <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (amount > maxAmount) {
      setError(`Amount cannot exceed the balance due (max ${money(maxAmount)}).`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pay.date)) {
      setError('Date must be YYYY-MM-DD.');
      return;
    }
    try {
      setBusy(true);
      setError(null);
      const body = { amount, date: pay.date, mode: pay.mode, note: pay.note };
      if (payment) await api.updatePayment(payment.paymentId, body);
      else await api.createPayment(customer.id, body);
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Payment failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      visible={visible}
      title={`${payment ? 'Edit payment' : 'Add payment'} - ${customer?.name ?? ''}`}
      onClose={onClose}
      isMobile={isMobile}
      maxWidth={460}>
      <T style={{ color: ERP.textMuted }}>
        Total fee {money(customer?.totalFee ?? 0)} | Max for this payment {money(maxAmount)}
      </T>
      <View style={s.grid}>
        <Field label="Date (YYYY-MM-DD) *">
          <Input
            value={pay.date}
            onChangeText={(v) => setPay({ ...pay, date: v })}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => amountRef.current?.focus()}
            style={h}
          />
        </Field>
        <Field label="Amount (₹) *">
          <Input
            ref={amountRef}
            value={pay.amount}
            onChangeText={(v) => setPay({ ...pay, amount: v })}
            keyboardType="numeric"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => noteRef.current?.focus()}
            style={h}
          />
        </Field>
        <Field label="Mode" full>
          <Chips options={PAY_MODES} value={pay.mode} onChange={(v) => setPay({ ...pay, mode: v })} mobile={isMobile} />
        </Field>
        <Field label="Note" full>
          <Input
            ref={noteRef}
            value={pay.note}
            onChangeText={(v) => setPay({ ...pay, note: v })}
            returnKeyType="done"
            onSubmitEditing={save}
            style={h}
          />
        </Field>
      </View>
      <ProgressStatusBar
        active={busy}
        message={payment ? 'Editing payment in database...' : 'Saving payment to database...'}
      />
      {error && <T style={{ color: ERP.danger }}>{error}</T>}
      <View style={s.btnRow}>
        <Btn
          label={busy ? 'Saving...' : payment ? 'Save changes' : 'Save payment'}
          primary
          onPress={save}
          disabled={busy}
          mobile={isMobile}
        />
        <Btn label="Cancel" onPress={onClose} mobile={isMobile} />
      </View>
    </Dialog>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
