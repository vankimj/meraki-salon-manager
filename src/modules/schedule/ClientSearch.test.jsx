import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import ClientSearch from './ClientSearch';

afterEach(cleanup);

const CLIENTS = [
  { id: 'c1', name: 'Marisela Ibarra', phone: '+1 (614) 555-0101' },
  { id: 'c2', name: 'Jonathan VanKim', phone: '+1 (614) 555-0102' },
];

describe('ClientSearch', () => {
  // The reported bug: clicking Manual/Next prefilled appt.clientName but the
  // search box rendered blank because a local query state ignored the prop.
  it('shows a PREFILLED clientName when no client is linked (the seat-flow bug)', () => {
    render(<ClientSearch clients={CLIENTS} clientId="" clientName="Walk-in Wanda" onChange={() => {}} />);
    expect(screen.getByPlaceholderText('Search clients by name…')).toHaveValue('Walk-in Wanda');
  });

  it('renders an empty box when there is no name and no link', () => {
    render(<ClientSearch clients={CLIENTS} clientId="" clientName="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText('Search clients by name…')).toHaveValue('');
  });

  it('typing emits clientName via onChange (and updates the controlled value)', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ClientSearch clients={CLIENTS} clientId="" clientName="" onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('Search clients by name…'), { target: { value: 'Mari' } });
    expect(onChange).toHaveBeenCalledWith({ clientId: '', clientName: 'Mari' });
    // parent re-renders with the new clientName → box reflects it (controlled)
    rerender(<ClientSearch clients={CLIENTS} clientId="" clientName="Mari" onChange={onChange} />);
    expect(screen.getByPlaceholderText('Search clients by name…')).toHaveValue('Mari');
  });

  it('renders the linked-client chip (name + ×) when clientId resolves to a loaded client', () => {
    render(<ClientSearch clients={CLIENTS} clientId="c1" clientName="Marisela Ibarra" onChange={() => {}} />);
    expect(screen.getByText('Marisela Ibarra')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search clients by name…')).not.toBeInTheDocument();
  });

  it('selecting a client from the dropdown links it via onChange', () => {
    const onChange = vi.fn();
    render(<ClientSearch clients={CLIENTS} clientId="" clientName="Jon" onChange={onChange} />);
    fireEvent.focus(screen.getByPlaceholderText('Search clients by name…'));
    fireEvent.mouseDown(screen.getByText('Jonathan VanKim'));
    expect(onChange).toHaveBeenCalledWith({ clientId: 'c2', clientName: 'Jonathan VanKim' });
  });

  it('a prefilled clientId NOT in the loaded list shows the name with a × to clear (no dead end)', () => {
    const onChange = vi.fn();
    render(<ClientSearch clients={CLIENTS} clientId="ghost-id" clientName="Kiosk Kelly" onChange={onChange} />);
    // no chip (client not loaded) → input shows the name…
    expect(screen.getByPlaceholderText('Search clients by name…')).toHaveValue('Kiosk Kelly');
    // …and the × clears the stale link
    fireEvent.click(screen.getByLabelText('Clear client'));
    expect(onChange).toHaveBeenCalledWith({ clientId: '', clientName: '' });
  });
});
