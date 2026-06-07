import { View, Text, StyleSheet, Platform } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';

// Minimal markdown for AI chat replies: headers, bold/italic/inline-code,
// bullet + numbered lists, and tables flattened to readable rows. Not a full
// markdown engine — just enough for the reports assistant's answers.
function renderInline(text, styles, kp) {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Text key={`${kp}-t${i++}`}>{text.slice(last, m.index)}</Text>);
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(<Text key={`${kp}-b${i++}`} style={styles.bold}>{tok.slice(2, -2)}</Text>);
    else if (tok.startsWith('`')) parts.push(<Text key={`${kp}-c${i++}`} style={styles.code}>{tok.slice(1, -1)}</Text>);
    else parts.push(<Text key={`${kp}-i${i++}`} style={styles.italic}>{tok.slice(1, -1)}</Text>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<Text key={`${kp}-t${i++}`}>{text.slice(last)}</Text>);
  return parts;
}

export default function MarkdownLite({ text }) {
  const styles = useThemedStyles(makeStyles);
  const lines = String(text || '').split('\n');
  return (
    <View>
      {lines.map((line, idx) => {
        const key = `l${idx}`;
        if (!line.trim()) return <View key={key} style={{ height: 6 }} />;
        let m;
        if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
          const lvl = m[1].length;
          return <Text key={key} style={[styles.h, lvl === 1 ? styles.h1 : lvl === 2 ? styles.h2 : styles.h3]}>{renderInline(m[2], styles, key)}</Text>;
        }
        if (/^\s*[-*]\s+/.test(line)) {
          return <View key={key} style={styles.li}><Text style={styles.bullet}>•</Text><Text style={styles.liText}>{renderInline(line.replace(/^\s*[-*]\s+/, ''), styles, key)}</Text></View>;
        }
        if ((m = line.match(/^\s*(\d+)\.\s+(.*)$/))) {
          return <View key={key} style={styles.li}><Text style={styles.bullet}>{m[1]}.</Text><Text style={styles.liText}>{renderInline(m[2], styles, key)}</Text></View>;
        }
        if (line.includes('|')) {
          if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) return null; // table separator row
          const cells = line.split('|').map(c => c.trim());
          const trimmed = cells.filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)));
          return <Text key={key} style={styles.tableRow}>{trimmed.join('   ·   ')}</Text>;
        }
        return <Text key={key} style={styles.p}>{renderInline(line, styles, key)}</Text>;
      })}
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  p:        { fontSize: 15, color: t.text, lineHeight: 21, marginBottom: 2 },
  bold:     { fontWeight: '800', color: t.text },
  italic:   { fontStyle: 'italic' },
  code:     { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 13.5, color: t.green },
  h:        { color: t.text, marginTop: 6, marginBottom: 4, fontWeight: '800' },
  h1:       { fontSize: 19 },
  h2:       { fontSize: 17 },
  h3:       { fontSize: 15.5 },
  li:       { flexDirection: 'row', marginBottom: 3, paddingLeft: 2 },
  bullet:   { width: 22, fontSize: 15, color: t.textMuted, fontWeight: '700' },
  liText:   { flex: 1, fontSize: 15, color: t.text, lineHeight: 21 },
  tableRow: { fontSize: 13.5, color: t.text, lineHeight: 20, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
});
