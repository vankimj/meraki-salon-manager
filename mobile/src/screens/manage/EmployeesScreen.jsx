import { useEffect, useState } from 'react';
import ManageCrud from './ManageCrud';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';
import { fetchEmployees, createEmployee, saveEmployee, deleteEmployee, fetchServices } from '../../lib/firestore';

// Public employee fields only. Compensation/payroll (employees/{id}/private/
// comp) is admin-only and edited on the web app via a writeBatch split — not
// exposed here to avoid partial-write leakage of sensitive fields.
const BASE_FIELDS = [
  { key: 'name',      label: 'Name',      type: 'text', required: true, placeholder: 'Yasmin D' },
  { key: 'email',     label: 'Email',     type: 'text', keyboard: 'email-address', placeholder: 'name@salon.com' },
  { key: 'phone',     label: 'Phone',     type: 'text', keyboard: 'phone-pad' },
  { key: 'instagram', label: 'Instagram', type: 'text', placeholder: '@handle' },
  { key: 'active',    label: 'Active',    type: 'bool' },
];

export default function EmployeesScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['employees'], isAdmin);
  // Services power the "Services performed" multiselect (serviceIds). Same
  // field the web EmployeesAdmin edits + the booking/schedule flow reads.
  const [services, setServices] = useState([]);
  useEffect(() => { fetchServices().then(s => setServices(s || [])).catch(() => setServices([])); }, []);

  const fields = [
    ...BASE_FIELDS,
    {
      key: 'serviceIds', label: 'Services performed', type: 'multiselect',
      options: services.filter(s => s.active !== false).map(s => ({ value: s.id, label: s.name })),
      emptyLabel: 'Add services first (Manage → Services).',
    },
  ];

  return (
    <ManageCrud
      load={fetchEmployees}
      create={createEmployee}
      save={saveEmployee}
      remove={deleteEmployee}
      canEdit={isAdmin}
      blank={() => ({ name: '', email: '', phone: '', instagram: '', active: true, serviceIds: [], sortOrder: 999 })}
      fields={fields}
      titleOf={(e) => e.name}
      subtitleOf={(e) => {
        const n = Array.isArray(e.serviceIds) ? e.serviceIds.length : 0;
        return [e.email, e.phone].filter(Boolean).join(' · ')
          || (n ? `${n} service${n === 1 ? '' : 's'}` : (e.active === false ? 'inactive' : '—'));
      }}
      addLabel="New employee"
    />
  );
}
