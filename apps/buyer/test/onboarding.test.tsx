import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import Onboarding from '../app/onboarding';
import { json, managerWith, problem, renderWith } from './utils';

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
});
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
const type = (label: string, text: string) => act(async () => void fireEvent.changeText(screen.getByLabelText(label), text));
const fill = async () => {
  await type('Your name', 'Kiran');
  await type('Flat, house or building', '7');
  await type('Area or street', 'Miyapur');
  await type('PIN code', '500049');
};
const saved = { name: 'Kiran', addresses: [], defaultAddressId: null, contact: { phone: '9876543210', whatsapp: null }, agreementVersion: 'draft-2026-10', agreementAcceptedAt: 1, missing: [] };

describe('buyer onboarding', () => {
  it('prefills the contact number with the login number and offers the full agreement', async () => {
    await renderWith(managerWith('buyer', fetchMock, { missing: ['name'] }), <Onboarding />);
    expect(screen.getByLabelText('Phone number')).toHaveDisplayValue('9876543210');
    expect(screen.getByText('Agree and start shopping')).toBeOnTheScreen();
    await press('Read the full agreement');
    expect(await screen.findByText(/Fayda does not resolve disputes/)).toBeOnTheScreen();
    expect(screen.getByText(/has not been reviewed by a lawyer/)).toBeOnTheScreen();
  });

  it('will not submit without agreeing, and shows the problem next to the checkbox', async () => {
    await renderWith(managerWith('buyer', fetchMock, { missing: ['name'] }), <Onboarding />);
    await fill();
    await press('Agree and start shopping');
    expect(await screen.findByText('You need to accept the user agreement to continue.')).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server’s field messages when it refuses the profile', async () => {
    fetchMock.mockResolvedValue(problem(400, 'VALIDATION', { 'address.pin': 'Enter a 6-digit PIN code.', contactWhatsapp: 'Enter a valid 10-digit WhatsApp number.' }));
    await renderWith(managerWith('buyer', fetchMock, { missing: ['name'] }), <Onboarding />);
    await fill();
    await act(async () => void fireEvent.press(screen.getByRole('checkbox')));
    await press('Agree and start shopping');
    expect(await screen.findByText('Enter a 6-digit PIN code.')).toBeOnTheScreen();
    expect(screen.getByText('Enter a valid 10-digit WhatsApp number.')).toBeOnTheScreen();
  });

  it('saves the profile and reloads what is missing, which completes sign-up', async () => {
    fetchMock.mockImplementation((url: string, init: { method?: string }) => {
      if (String(url).endsWith('/v1/buyer/profile') && init.method === 'PUT') return Promise.resolve(json(saved));
      return Promise.resolve(json({ user: { id: 'u1', phone: '9876543210', name: 'Kiran' }, app: 'buyer', profile: { complete: true, missing: [] } }));
    });
    const m = managerWith('buyer', fetchMock, { missing: ['name', 'address', 'contact', 'agreement'] });
    await renderWith(m, <Onboarding />);
    await fill();
    await act(async () => void fireEvent.press(screen.getByRole('checkbox')));
    await press('Agree and start shopping');
    await waitFor(() => expect(m.store.getState().profile?.complete).toBe(true));
    const put = fetchMock.mock.calls.find((c) => c[1].method === 'PUT');
    expect(JSON.parse(put[1].body)).toMatchObject({ name: 'Kiran', agreementAccepted: true, contact: { phone: '9876543210', whatsapp: null }, address: { pin: '500049' } });
  });
});
