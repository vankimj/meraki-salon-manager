import { View, Text, Image, StyleSheet } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';

const initials = (n) => {
  const p = String(n || '?').trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
};

// Small round tech avatar — photo if on file, else initials.
export default function TechAvatar({ name, photo, size = 28 }) {
  const styles = useThemedStyles(makeStyles);
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (photo) return <Image source={{ uri: photo }} style={dim} />;
  return (
    <View style={[styles.fallback, dim]}>
      <Text style={[styles.init, { fontSize: Math.round(size * 0.4) }]}>{initials(name)}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  fallback: { backgroundColor: t.greenSoft, alignItems: 'center', justifyContent: 'center' },
  init:     { fontWeight: '800', color: t.green },
});
