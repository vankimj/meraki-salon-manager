import ManageCrud from './ManageCrud';
import useTenantAccess from '../../hooks/useTenantAccess';
import { fetchProducts, createProduct, saveProduct, deleteProduct } from '../../lib/firestore';

const FIELDS = [
  { key: 'name',        label: 'Name',      type: 'text',   required: true, placeholder: 'Cuticle Oil' },
  { key: 'category',    label: 'Category',  type: 'text',   placeholder: 'Retail' },
  { key: 'price',       label: 'Price ($)', type: 'number', placeholder: '18' },
  { key: 'stock',       label: 'Stock',     type: 'number', placeholder: '12' },
  { key: 'description', label: 'Description', type: 'text',  placeholder: 'Optional' },
  { key: 'active',      label: 'Active',    type: 'bool' },
];

export default function ProductsScreen() {
  const { isAdmin } = useTenantAccess();
  return (
    <ManageCrud
      load={fetchProducts}
      create={createProduct}
      save={saveProduct}
      remove={deleteProduct}
      canEdit={isAdmin}
      blank={() => ({ name: '', category: '', price: 0, stock: 0, description: '', active: true })}
      fields={FIELDS}
      titleOf={(p) => p.name}
      subtitleOf={(p) => {
        const low = Number(p.stock) <= 3;
        return [p.price != null ? `$${p.price}` : null, `${p.stock ?? 0} in stock${low ? ' ⚠' : ''}`, p.category]
          .filter(Boolean).join(' · ');
      }}
      addLabel="New product"
      headerNote={(items) => {
        const low = items.filter(p => Number(p.stock) <= 3).length;
        return low ? `${low} product${low > 1 ? 's' : ''} low on stock` : `${items.length} products`;
      }}
    />
  );
}
