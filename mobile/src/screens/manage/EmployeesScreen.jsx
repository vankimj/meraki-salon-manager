import ManageCrud from './ManageCrud';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';
import { fetchEmployees, createEmployee, saveEmployee, deleteEmployee } from '../../lib/firestore';

// Public employee fields only. Compensation/payroll (employees/{id}/private/
// comp) is admin-only and edited on the web app via a writeBatch split — not
// exposed here to avoid partial-write leakage of sensitive fields.
const FIELDS = [
  { key: 'name',      label: 'Name',      type: 'text', required: true, placeholder: 'Yasmin D' },
  { key: 'email',     label: 'Email',     type: 'text', keyboard: 'email-address', placeholder: 'name@salon.com' },
  { key: 'phone',     label: 'Phone',     type: 'text', keyboard: 'phone-pad' },
  { key: 'instagram', label: 'Instagram', type: 'text', placeholder: '@handle' },
  { key: 'active',    label: 'Active',    type: 'bool' },
];

export default function EmployeesScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['employees'], isAdmin);
  return (
    <ManageCrud
      load={fetchEmployees}
      create={createEmployee}
      save={saveEmployee}
      remove={deleteEmployee}
      canEdit={isAdmin}
      blank={() => ({ name: '', email: '', phone: '', instagram: '', active: true, sortOrder: 999 })}
      fields={FIELDS}
      titleOf={(e) => e.name}
      subtitleOf={(e) => [e.email, e.phone].filter(Boolean).join(' · ') || (e.active === false ? 'inactive' : '—')}
      addLabel="New employee"
    />
  );
}
