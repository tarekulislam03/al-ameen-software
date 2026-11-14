import { Redirect, Slot, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View } from 'react-native';

import { ErpShell } from '@/components/erp-shell';
import { ERP } from '@/constants/erp';
import { AuthProvider, useAuth } from '@/services/auth';

function Gate() {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const onLogin = pathname === '/login';

  if (!ready) return <View style={{ flex: 1, backgroundColor: ERP.pageBg }} />;
  if (!user && !onLogin) return <Redirect href="/login" />;
  if (user && onLogin) return <Redirect href="/" />;

  if (!user) return <Slot />;
  return (
    <ErpShell>
      <Slot />
    </ErpShell>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Gate />
    </AuthProvider>
  );
}
