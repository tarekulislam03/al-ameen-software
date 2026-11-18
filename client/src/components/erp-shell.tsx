import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ERP } from '@/constants/erp';
import { useAuth } from '@/services/auth';

export function ErpShell({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const isMobile = width < ERP.mobileBreakpoint;
  const { user, logout } = useAuth();

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <Text style={styles.title} numberOfLines={1}>
          AL AMIN MOTOR TRAINING{isMobile ? '' : ' - Customer & Payment Manager'}
        </Text>
        <View style={styles.topRight}>
          {!isMobile && user && <Text style={styles.topUser}>User: {user.username}</Text>}
          <Pressable onPress={logout} style={styles.topBtn}>
            <Text style={styles.topBtnText}>Logout</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ERP.pageBg },
  topBar: {
    height: ERP.topBarHeight,
    backgroundColor: ERP.navy,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  title: { flex: 1, color: ERP.navyText, fontFamily: ERP.font, fontSize: 14, fontWeight: '700' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  topUser: { color: ERP.navyText, fontFamily: ERP.font, fontSize: ERP.fontSize },
  topBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#8FA3C4',
  },
  topBtnText: { color: ERP.navyText, fontFamily: ERP.font, fontSize: ERP.fontSize },
  content: { flex: 1 },
});
