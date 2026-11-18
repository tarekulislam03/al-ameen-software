import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ERP } from '@/constants/erp';
import { useAuth } from '@/services/auth';

// Flat black-and-white eye drawn with plain Views (no emoji / icon font needed).
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <View style={styles.eye}>
      <View style={styles.eyeOutline}>
        <View style={styles.eyePupil} />
      </View>
      {crossed && <View style={styles.eyeSlash} />}
    </View>
  );
}

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async () => {
    if (!username.trim() || !password) {
      setError('Enter username and password.');
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await login(username.trim(), password);
    } catch (e: any) {
      setError(e?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.box}>
        <View style={styles.header}>
          <Text style={styles.headerText}>AL AMIN MOTOR TRAINING - Login</Text>
        </View>
        <View style={styles.form}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Text style={styles.label}>Password</Text>
          <View style={styles.passRow}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              onSubmitEditing={submit}
              style={[styles.input, styles.passInput]}
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              style={styles.eyeBtn}>
              <EyeIcon crossed={!showPassword} />
            </Pressable>
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable onPress={submit} disabled={busy} style={styles.button}>
            <Text style={styles.buttonText}>{busy ? 'Please wait...' : 'Login'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: ERP.pageBg, alignItems: 'center', justifyContent: 'center', padding: 12 },
  box: { width: '100%', maxWidth: 340, borderWidth: 1, borderColor: ERP.border, backgroundColor: ERP.panelBg },
  header: { backgroundColor: ERP.navy, paddingHorizontal: 10, paddingVertical: 8 },
  headerText: { color: ERP.navyText, fontFamily: ERP.font, fontSize: 14, fontWeight: '700' },
  form: { padding: 12, gap: 6 },
  label: { fontFamily: ERP.font, fontSize: ERP.fontSize, color: ERP.text },
  input: {
    borderWidth: 1,
    borderColor: ERP.border,
    backgroundColor: ERP.white,
    paddingHorizontal: 6,
    paddingVertical: 5,
    fontFamily: ERP.font,
    fontSize: ERP.fontSize,
    color: ERP.text,
    marginBottom: 6,
  },
  error: { color: ERP.danger, fontFamily: ERP.font, fontSize: ERP.fontSize },
  passRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 6 },
  passInput: { flex: 1, marginBottom: 0 },
  eyeBtn: {
    width: 40,
    minHeight: 40,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: ERP.border,
    backgroundColor: ERP.panelBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eye: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  eyeOutline: {
    width: 20,
    height: 12,
    borderWidth: 2,
    borderColor: ERP.text,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyePupil: { width: 6, height: 6, borderRadius: 3, backgroundColor: ERP.text },
  eyeSlash: {
    position: 'absolute',
    width: 24,
    height: 2,
    backgroundColor: ERP.text,
    transform: [{ rotate: '-45deg' }],
  },
  button: {
    borderWidth: 1,
    borderColor: '#000000',
    backgroundColor: ERP.navy,
    paddingVertical: 6,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: { color: ERP.navyText, fontFamily: ERP.font, fontSize: ERP.fontSize, fontWeight: '700' },
});
