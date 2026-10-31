import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import SignIn from '../app/sign-in';
import { json, managerWith, problem, renderWith, user } from './utils';

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
});
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
const type = (label: string, text: string) => act(async () => void fireEvent.changeText(screen.getByLabelText(label), text));
const auth = { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900, user, app: 'seller', profile: { complete: false, missing: ['name'] } };

describe('seller sign-in', () => {
  it('asks for the number first, and will not send a code for a short number', async () => {
    const m = managerWith('seller', fetchMock);
    await renderWith(m, <SignIn />);
    expect(screen.getByText('Sign in to Fayda Seller')).toBeOnTheScreen();
    await type('Mobile number', '98765');
    expect(screen.getByText('Send code')).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says the sign-in is simulated, then signs in with the code', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(String(url).endsWith('/otp/request') ? json({ sent: true, simulated: true }) : json(auth)));
    const m = managerWith('seller', fetchMock);
    await renderWith(m, <SignIn />);
    await type('Mobile number', '9876543210');
    await press('Send code');
    expect(await screen.findByText('Simulated sign-in')).toBeOnTheScreen();
    expect(screen.getByText(/Use the code 123456/)).toBeOnTheScreen();
    await type('6-digit code', '123456');
    await press('Verify and continue');
    await waitFor(() => expect(m.store.getState().status).toBe('signedIn'));
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sent).toEqual({ phone: '9876543210', code: '123456', app: 'seller' });
  });

  it('shows the server’s message for a wrong code and stays signed out', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(String(url).endsWith('/otp/request') ? json({ sent: true, simulated: true }) : problem(400, 'INVALID_OTP', { code: 'That code isn’t right.' })));
    const m = managerWith('seller', fetchMock);
    await renderWith(m, <SignIn />);
    await type('Mobile number', '9876543210');
    await press('Send code');
    await type('6-digit code', '000000');
    await press('Verify and continue');
    expect(await screen.findByText('That code isn’t right.')).toBeOnTheScreen();
    expect(m.store.getState().status).toBe('signedOut');
  });

  it('shows a connection message when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await renderWith(managerWith('seller', fetchMock), <SignIn />);
    await type('Mobile number', '9876543210');
    await press('Send code');
    expect(await screen.findByText(/Could not reach/)).toBeOnTheScreen();
  });

  it('can go back to change the number', async () => {
    fetchMock.mockResolvedValue(json({ sent: true, simulated: true }));
    await renderWith(managerWith('seller', fetchMock), <SignIn />);
    await type('Mobile number', '9876543210');
    await press('Send code');
    await press('Use a different number');
    expect(await screen.findByText('Sign in to Fayda Seller')).toBeOnTheScreen();
  });
});
