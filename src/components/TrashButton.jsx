import { useState } from 'react';
import { useApp } from '../context/AppContext';
import TrashPanel from './TrashPanel';

// Admin-only 🗑 Trash button for a module's toolbar. Opens a scoped
// TrashPanel (only this module's collections) as a modal. Renders nothing
// for non-admins — the trash exposes deleted record contents + who deleted
// them, so it's admin-gated (same as the global Admin trash).
//
// Usage: <TrashButton collections={['services']} scope="Services" />
export default function TrashButton({ collections, scope }) {
  const { isAdmin } = useApp();
  const [open, setOpen] = useState(false);
  if (!isAdmin) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Recently deleted"
        style={{ fontSize: 13, padding: '7px 12px', borderRadius: 8, border: '1px solid #e0e0e0', background: '#fff', color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}
      >
        🗑 Trash
      </button>
      {open && (
        <TrashPanel
          collections={collections}
          title={`🗑 Trash${scope ? ' — ' + scope : ''}`}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
