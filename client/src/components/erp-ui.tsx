import React, { useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextProps,
} from 'react-native';

import { ERP } from '@/constants/erp';
import type { Customer } from '@/services/api';

// ---------- helpers ----------
export const today = () => new Date().toISOString().slice(0, 10);
export const money = (n: number) => `₹${(Number(n) || 0).toLocaleString()}`;

export function openUrl(url: string, newTab = false) {
  if (Platform.OS === 'web' && newTab) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  Linking.openURL(url);
}

/** Digits only; a bare 10-digit number is assumed to be Indian (+91). */
export function whatsappNumber(phone: string) {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
}

// ---------- primitives ----------
export const T = ({ style, ...p }: TextProps) => (
  <Text {...p} style={[{ fontFamily: ERP.font, fontSize: ERP.fontSize, color: ERP.text }, style]} />
);

export type InputProps = React.ComponentProps<typeof TextInput>;
export type InputRef = React.ComponentRef<typeof TextInput>;

export function Input({ style, ...p }: InputProps) {
  return (
    <TextInput
      placeholderTextColor="#777777"
      {...p}
      style={[
        {
          borderWidth: 1,
          borderColor: ERP.border,
          backgroundColor: ERP.white,
          paddingHorizontal: 6,
          paddingVertical: 4,
          fontFamily: ERP.font,
          fontSize: ERP.fontSize,
          color: ERP.text,
        },
        style,
      ]}
    />
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function DatePicker({
  value,
  onChange,
  mobile,
  maxDate,
}: {
  value: string;
  onChange: (v: string) => void;
  mobile?: boolean;
  maxDate?: string;
}) {
  const [open, setOpen] = useState(false);

  if (Platform.OS === 'web') {
    return (
      <input
        type="date"
        value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''}
        max={maxDate}
        onChange={(e) => onChange(e.target.value)}
        style={{
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: ERP.border,
          backgroundColor: ERP.white,
          paddingLeft: 6,
          paddingRight: 6,
          paddingTop: 4,
          paddingBottom: 4,
          fontFamily: ERP.font,
          fontSize: ERP.fontSize,
          color: ERP.text,
          minHeight: mobile ? 44 : undefined,
          boxSizing: 'border-box',
          width: '100%',
        }}
      />
    );
  }

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').map(Number) : [2000, 1, 1];
  const [yr, setYr] = useState(parsed[0]);
  const [mo, setMo] = useState(parsed[1]);
  const [dy, setDy] = useState(parsed[2]);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => currentYear - i);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const pad = (n: number) => String(n).padStart(2, '0');

  const openPicker = () => {
    const p = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').map(Number) : [2000, 1, 1];
    setYr(p[0]);
    setMo(p[1]);
    setDy(p[2]);
    setOpen(true);
  };

  return (
    <>
      <Pressable
        onPress={openPicker}
        style={[
          {
            borderWidth: 1,
            borderColor: ERP.border,
            backgroundColor: ERP.white,
            paddingHorizontal: 6,
            paddingVertical: 5,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
          mobile && { minHeight: 44 },
        ]}>
        <T style={!value && { color: '#777777' }}>{value || 'Select date'}</T>
        <T style={{ color: ERP.textMuted }}>▾</T>
      </Pressable>
      <Dialog visible={open} title="Select Date" onClose={() => setOpen(false)} isMobile={!!mobile} maxWidth={380}>
        <View style={{ flexDirection: 'row', gap: 6, height: 220 }}>
          <ScrollView style={{ flex: 1, borderWidth: 1, borderColor: ERP.border, backgroundColor: ERP.white }}>
            {years.map((y) => (
              <Pressable
                key={y}
                onPress={() => setYr(y)}
                style={[u.selectItem, mobile && { minHeight: 44 }, y === yr && { backgroundColor: ERP.activeBg }]}>
                <T style={y === yr && { fontWeight: '700' }}>{y}</T>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView style={{ flex: 1, borderWidth: 1, borderColor: ERP.border, backgroundColor: ERP.white }}>
            {MONTHS.map((m, idx) => (
              <Pressable
                key={m}
                onPress={() => {
                  const nextMo = idx + 1;
                  setMo(nextMo);
                  const maxD = new Date(yr, nextMo, 0).getDate();
                  if (dy > maxD) setDy(maxD);
                }}
                style={[u.selectItem, mobile && { minHeight: 44 }, idx + 1 === mo && { backgroundColor: ERP.activeBg }]}>
                <T style={idx + 1 === mo && { fontWeight: '700' }}>{m}</T>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView style={{ flex: 0.8, borderWidth: 1, borderColor: ERP.border, backgroundColor: ERP.white }}>
            {days.map((d) => (
              <Pressable
                key={d}
                onPress={() => setDy(d)}
                style={[u.selectItem, mobile && { minHeight: 44 }, d === dy && { backgroundColor: ERP.activeBg }]}>
                <T style={d === dy && { fontWeight: '700' }}>{pad(d)}</T>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Btn
            label="OK"
            primary
            mobile={mobile}
            onPress={() => {
              onChange(`${yr}-${pad(mo)}-${pad(dy)}`);
              setOpen(false);
            }}
          />
          <Btn
            label="Clear"
            mobile={mobile}
            onPress={() => {
              onChange('');
              setOpen(false);
            }}
          />
          <Btn label="Cancel" mobile={mobile} onPress={() => setOpen(false)} />
        </View>
      </Dialog>
    </>
  );
}

export function Btn({
  label,
  onPress,
  primary,
  danger,
  disabled,
  mobile,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  mobile?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        u.btn,
        mobile && { minHeight: 44 },
        primary && { backgroundColor: ERP.navy, borderColor: '#000000' },
        danger && { borderColor: ERP.danger },
        disabled && { opacity: 0.5 },
      ]}>
      <T style={[primary && { color: '#FFFFFF' }, danger && { color: ERP.danger }]}>{label}</T>
    </Pressable>
  );
}

export function Chips({
  options,
  value,
  onChange,
  mobile,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  mobile?: boolean;
}) {
  return (
    <View style={u.chipRow}>
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onChange(o)}
          style={[u.chip, mobile && { minHeight: 44 }, value === o && { backgroundColor: ERP.activeBg }]}>
          <T style={value === o && { fontWeight: '700' }}>{o}</T>
        </Pressable>
      ))}
    </View>
  );
}

export function Select({
  label,
  value,
  options,
  onChange,
  mobile,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  mobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[u.filterField, { zIndex: open ? 30 : 1 }]}>
      <T style={u.fieldLabel}>{label}</T>
      <Pressable onPress={() => setOpen((o) => !o)} style={[u.selectBtn, mobile && { minHeight: 44 }]}>
        <T numberOfLines={1} style={{ flex: 1 }}>
          {value}
        </T>
        <T>{open ? '▴' : '▾'}</T>
      </Pressable>
      {open && (
        <View style={u.selectList}>
          <ScrollView style={{ maxHeight: 200 }}>
            {options.map((o) => (
              <Pressable
                key={o}
                onPress={() => {
                  onChange(o);
                  setOpen(false);
                }}
                style={[u.selectItem, mobile && { minHeight: 44 }, o === value && { backgroundColor: ERP.activeBg }]}>
                <T>{o}</T>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

export function StatusBadge({ status }: { status: Customer['paymentStatus'] }) {
  const map = {
    Paid: { bg: '#D6EBD6', fg: '#0B5A0B', bd: '#5E9E5E' },
    Partial: { bg: '#FBE9C4', fg: '#7A4A00', bd: '#C99A3B' },
    Unpaid: { bg: '#F6D5D5', fg: '#8A0000', bd: '#C26A6A' },
  }[status];
  return (
    <View style={[u.badge, { backgroundColor: map.bg, borderColor: map.bd }]}>
      <Text style={{ fontFamily: ERP.font, fontSize: 11, fontWeight: '700', color: map.fg }}>{status}</Text>
    </View>
  );
}

export function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <View style={[{ gap: 3 }, full ? { width: '100%' } : { flexGrow: 1, flexBasis: 220, minWidth: 0 }]}>
      <T style={u.fieldLabel}>{label}</T>
      {children}
    </View>
  );
}

export function Dialog({
  visible,
  title,
  onClose,
  isMobile,
  maxWidth = 640,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  isMobile: boolean;
  maxWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent onRequestClose={onClose}>
      <View style={u.backdrop}>
        <View style={[u.dialog, { maxWidth }, isMobile && u.dialogMobile]}>
          <View style={u.dlgHeader}>
            <T style={u.dlgTitle}>{title}</T>
            <Pressable onPress={onClose} style={u.dlgClose}>
              <T style={{ color: '#FFFFFF', fontWeight: '700' }}>Close</T>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 10, gap: 8 }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export const fieldLabelStyle = { color: ERP.textMuted, fontSize: 12 } as const;

const u = StyleSheet.create({
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
  filterField: { gap: 3, minWidth: 140 },
  fieldLabel: { color: ERP.textMuted, fontSize: 12 },
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
  badge: { borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1, alignSelf: 'flex-start' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 8 },
  dialog: {
    width: '100%',
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
  dlgClose: {
    borderWidth: 1,
    borderColor: '#8FA3C4',
    paddingHorizontal: 10,
    paddingVertical: 3,
    minHeight: 28,
    justifyContent: 'center',
  },
});
