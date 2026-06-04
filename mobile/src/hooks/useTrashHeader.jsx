import { useLayoutEffect } from 'react';
import { TouchableOpacity } from 'react-native';
import Icon from '../components/Icon';

// Adds an admin-gated 🗑 header button that opens the scoped TrashScreen
// for the given collections. The host stack must register a 'Trash' screen
// (TrashScreen). `enabled` is normally isAdmin — trash is admin-only.
export default function useTrashHeader(navigation, collections, enabled) {
  useLayoutEffect(() => {
    if (!navigation?.setOptions) return;
    navigation.setOptions({
      headerRight: () => enabled
        ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('Trash', { collections })}
            style={{ paddingHorizontal: 6, paddingVertical: 4 }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="trash" size={20} color="#c0392b" />
          </TouchableOpacity>
        )
        : undefined,
    });
  }, [navigation, enabled, JSON.stringify(collections)]);
}
