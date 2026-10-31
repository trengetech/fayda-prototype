import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import Onboarding from '../app/onboarding';
import { json, managerWith, problem, renderWith } from './utils';

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
});
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
const pressLabel = (label: string) => act(async () => void fireEvent.press(screen.getByLabelText(label)));
const type = (label: string, text: string) => act(async () => void fireEvent.changeText(screen.getByLabelText(label), text));

const shop = (missing: string[] = ['payment', 'conduct']) => ({
  id: 's1', sellerType: 'INDIVIDUAL', name: 'Sana Studio', handle: 'sanastudio', area: 'Tolichowki', city: 'Hyderabad', gstin: null, bio: '',
  categories: ['Ethnic wear'], mapsUrl: 'https://maps.app.goo.gl/abc', googleProfileUrl: null, socialUrl: null,
  contact: { phone: null, whatsapp: '9876543210' }, sla: { confirmHours: 6, shipDays: 2 }, payment: null, conductAcceptedAt: null, missing,
});
const noShop = () => Promise.resolve(problem(404, 'NO_SELLER'));

async function fillStep1() {
  await type('Shop name', 'Sana Studio');
  await type('Shop handle', 'sanastudio');
  await type('Area or locality', 'Tolichowki');
  await pressLabel('Ethnic wear');
}
async function fillStep2() {
  await type('Google Maps link to your shop', 'https://maps.app.goo.gl/abc');
  await pressLabel('6 hours');
  await act(async () => void fireEvent.press(screen.getAllByLabelText('2 days')[1] as never)); // 48 hours also reads "2 days"
}

describe('seller onboarding', () => {
  it('starts at step 1 for a new seller and will not move on without a name, handle, area or category', async () => {
    fetchMock.mockImplementation(noShop);
    await renderWith(managerWith('seller', fetchMock, { missing: ['shop', 'payment', 'conduct'] }), <Onboarding />);
    expect(await screen.findByText('Step 1 of 3')).toBeOnTheScreen();
    await press('Next');
    expect(await screen.findByText('Choose at least one category you sell.')).toBeOnTheScreen();
    expect(screen.getByText('Enter your shop name (2–60 characters).')).toBeOnTheScreen();
    expect(screen.queryByText('Step 2 of 3')).not.toBeOnTheScreen();
  });

  it('asks for the Maps link, a contact number and both declared times in step 2', async () => {
    fetchMock.mockImplementation(noShop);
    await renderWith(managerWith('seller', fetchMock, { missing: ['shop', 'payment', 'conduct'] }), <Onboarding />);
    await screen.findByText('Step 1 of 3');
    await fillStep1();
    await press('Next');
    expect(await screen.findByText('Step 2 of 3')).toBeOnTheScreen();
    expect(screen.getByLabelText('WhatsApp number')).toHaveDisplayValue('9876543210');
    await press('Next');
    expect(await screen.findByText('Paste your shop’s Google Maps link.')).toBeOnTheScreen();
    expect(screen.getByText('Choose how soon you usually confirm payments.')).toBeOnTheScreen();
    expect(screen.getByText('Choose how soon you usually ship.')).toBeOnTheScreen();
    expect(fetchMock.mock.calls.filter((c) => c[1].method === 'PUT')).toHaveLength(0);
  });

  it('shows the server’s message for an invalid link, then saves the shop and moves to payment', async () => {
    let fail = true;
    fetchMock.mockImplementation((url: string, init: { method?: string }) => {
      if (init.method === 'PUT' && String(url).endsWith('/v1/seller/profile')) return Promise.resolve(fail ? problem(400, 'VALIDATION', { mapsUrl: 'Paste your shop’s Google Maps link (https://maps.app.goo.gl/… or https://www.google.com/maps/…).' }) : json(shop()));
      if (String(url).endsWith('/v1/me')) return Promise.resolve(json({ user: { id: 'u1', phone: '9876543210', name: null }, app: 'seller', profile: { complete: false, missing: ['payment', 'conduct'] } }));
      return noShop();
    });
    await renderWith(managerWith('seller', fetchMock, { missing: ['shop', 'payment', 'conduct'] }), <Onboarding />);
    await screen.findByText('Step 1 of 3');
    await fillStep1();
    await press('Next');
    await screen.findByText('Step 2 of 3');
    await fillStep2();
    await type('Google Maps link to your shop', 'https://example.com/nope');
    await press('Next');
    expect(await screen.findByText(/Paste your shop’s Google Maps link \(https/)).toBeOnTheScreen();
    fail = false;
    await type('Google Maps link to your shop', 'https://maps.app.goo.gl/abc');
    await press('Next');
    expect(await screen.findByText('Step 3 of 3')).toBeOnTheScreen();
    const put = fetchMock.mock.calls.filter((c) => c[1].method === 'PUT').at(-1);
    expect(JSON.parse(put[1].body)).toMatchObject({ name: 'Sana Studio', handle: 'sanastudio', categories: ['Ethnic wear'], sla: { confirmHours: 6, shipDays: 2 }, contact: { phone: null, whatsapp: '9876543210' } });
  });

  it('returns to step 1 when the server says the handle is taken', async () => {
    fetchMock.mockImplementation((url: string, init: { method?: string }) => (init.method === 'PUT' ? Promise.resolve(problem(400, 'VALIDATION', { handle: 'That handle is taken.' })) : noShop()));
    await renderWith(managerWith('seller', fetchMock, { missing: ['shop', 'payment', 'conduct'] }), <Onboarding />);
    await screen.findByText('Step 1 of 3');
    await fillStep1();
    await press('Next');
    await screen.findByText('Step 2 of 3');
    await fillStep2();
    await press('Next');
    expect(await screen.findByText('That handle is taken.')).toBeOnTheScreen();
    expect(screen.getByText('Step 1 of 3')).toBeOnTheScreen();
  });

  it('resumes at payment when the shop is already saved, needs the Code of Conduct, and completes the profile', async () => {
    fetchMock.mockImplementation((url: string, init: { method?: string }) => {
      if (init.method === 'PUT' && String(url).endsWith('/v1/seller/payment')) return Promise.resolve(json({ ...shop([]), payment: { upiId: 'sana@okaxis', upiQrMediaId: null, bankHolder: null, bankAccount: null, bankIfsc: null, bankName: null, paymentLink: null, website: null } }));
      if (String(url).endsWith('/v1/me')) return Promise.resolve(json({ user: { id: 'u1', phone: '9876543210', name: null }, app: 'seller', profile: { complete: true, missing: [] } }));
      return Promise.resolve(json(shop()));
    });
    const m = managerWith('seller', fetchMock, { missing: ['payment', 'conduct'] });
    await renderWith(m, <Onboarding />);
    expect(await screen.findByText('Step 3 of 3')).toBeOnTheScreen();
    await type('UPI ID', 'sana@okaxis');
    await press('Finish setup');
    expect(await screen.findByText('You need to agree to the Seller Code of Conduct to register.')).toBeOnTheScreen();
    await press('Read the Code of Conduct');
    expect(await screen.findByText(/Confirm each payment and ship each order/)).toBeOnTheScreen();
    await press('Close');
    await act(async () => void fireEvent.press(screen.getByRole('checkbox')));
    await press('Finish setup');
    await waitFor(() => expect(fetchMock.mock.calls.map((c) => c[0])).toContain('http://api.test/v1/seller/payment'));
    await waitFor(() => expect(m.store.getState().profile?.complete).toBe(true));
    const put = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/v1/seller/payment'));
    expect(JSON.parse(put[1].body)).toMatchObject({ upiId: 'sana@okaxis', bankAccount: null, conductAccepted: true });
  });
});
