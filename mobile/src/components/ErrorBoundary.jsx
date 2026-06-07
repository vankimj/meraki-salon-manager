import { Component } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

// App-wide crash net. A render/lifecycle exception anywhere below this would
// otherwise unmount the whole tree → blank white screen with no clue. Instead
// we show the actual error + component stack and a recover button, so a crash
// is reportable + recoverable on a release build (no Metro, no dev overlay).
export default class ErrorBoundary extends Component {
  state = { error: null, stack: '' };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error?.message, info?.componentStack);
    this.setState({ stack: info?.componentStack || '' });
  }

  reset = () => this.setState({ error: null, stack: '' });

  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || String(this.state.error);
    return (
      <View style={s.wrap}>
        <Text style={s.title}>Something hit an error</Text>
        <Text style={s.msg}>{msg}</Text>
        <ScrollView style={s.stackBox} contentContainerStyle={{ padding: 10 }}>
          <Text style={s.stack}>{this.state.stack || '(no component stack)'}</Text>
        </ScrollView>
        <TouchableOpacity style={s.btn} onPress={this.reset}>
          <Text style={s.btnText}>Try again</Text>
        </TouchableOpacity>
        <Text style={s.hint}>Screenshot this and send it — it tells us exactly what to fix.</Text>
      </View>
    );
  }
}

const s = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#0f1923', padding: 20, paddingTop: 80, justifyContent: 'flex-start' },
  title:   { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 10 },
  msg:     { color: '#fca5a5', fontSize: 14, fontWeight: '600', marginBottom: 14, lineHeight: 20 },
  stackBox:{ maxHeight: 280, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, marginBottom: 16 },
  stack:   { color: '#cbd5e1', fontSize: 11, fontFamily: 'Courier' },
  btn:     { backgroundColor: '#3D9E8A', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  hint:    { color: '#64748b', fontSize: 12, textAlign: 'center', marginTop: 14 },
});
