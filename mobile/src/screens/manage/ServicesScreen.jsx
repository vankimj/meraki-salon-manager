import ManageCrud from './ManageCrud';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';
import { fetchServices, createService, saveService, deleteService } from '../../lib/firestore';

const FIELDS = [
  { key: 'name',        label: 'Name',        type: 'text',   required: true, placeholder: 'Gel Manicure' },
  { key: 'category',    label: 'Category',    type: 'text',   placeholder: 'Manicures' },
  { key: 'price',       label: 'Price ($)',   type: 'number', placeholder: '45' },
  { key: 'duration',    label: 'Duration (min)', type: 'number', placeholder: '45' },
  { key: 'description', label: 'Description', type: 'text',   placeholder: 'Optional' },
  { key: 'active',      label: 'Active',      type: 'bool' },
];

export default function ServicesScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['services'], isAdmin);
  return (
    <ManageCrud
      load={fetchServices}
      create={createService}
      save={saveService}
      remove={deleteService}
      canEdit={isAdmin}
      blank={() => ({ name: '', category: '', price: 0, duration: 0, description: '', active: true })}
      fields={FIELDS}
      titleOf={(s) => s.name}
      subtitleOf={(s) => [s.price != null ? `$${s.price}` : null, s.duration ? `${s.duration} min` : null, s.category]
        .filter(Boolean).join(' · ') || '—'}
      addLabel="New service"
    />
  );
}
