import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { UpiQrField, type UpiQrValue } from '../src/upi-qr-field';
import { fakeApi, json, managerWith, renderWith } from './utils';

const mockPick = jest.fn();
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...a: unknown[]) => mockPick(...a) }));
const mockScan = jest.fn();
jest.mock('expo-camera', () => ({ Camera: { scanFromURLAsync: (...a: unknown[]) => mockScan(...a) } }));
const mockUpload = jest.fn();
jest.mock('expo-file-system/legacy', () => ({ FileSystemUploadType: { BINARY_CONTENT: 0 }, uploadAsync: (...a: unknown[]) => mockUpload(...a), getInfoAsync: jest.fn() }));

let fetchMock: jest.Mock;
let latest: UpiQrValue | null = null;
const qr = (pa: string) => `upi://pay?pa=${pa}&pn=Sana&cu=INR`;
const MEDIA_ID = 'd4d4d4d4-0000-4000-8000-000000000001';
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));

function Harness({ upiId = 'sana@okaxis', initial = null }: { upiId?: string; initial?: UpiQrValue | null }) {
  const [v, setV] = useState<UpiQrValue | null>(initial);
  return <UpiQrField upiId={upiId} value={v} onChange={(x) => { latest = x; setV(x); }} />;
}
const happyApi = () =>
  fakeApi({
    'POST /v1/seller/media/intents': () => json({ mediaId: MEDIA_ID, upload: { method: 'PUT', url: `/v1/media/upload/${MEDIA_ID}?token=t`, headers: { 'Content-Type': 'image/png' } }, expiresAt: 1 }, 201),
    [`POST /v1/seller/media/${MEDIA_ID}/complete`]: () => json({ id: MEDIA_ID, kind: 'image', purpose: 'UPI_QR', status: 'READY', size: 9, url: null }),
  }, fetchMock);

beforeEach(() => {
  fetchMock = jest.fn();
  latest = null;
  [mockPick, mockScan, mockUpload].forEach((m) => m.mockReset());
  mockUpload.mockResolvedValue({ status: 204 });
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///qr.png', mimeType: 'image/png', fileSize: 9000 }] });
});

describe('UPI QR field', () => {
  it('decodes the picked image, checks the payee against the UPI ID, then uploads it as a private QR', async () => {
    happyApi();
    mockScan.mockResolvedValue([{ data: qr('Sana@OkAxis') }]);
    await renderWith(managerWith('seller', fetchMock, { missing: [] }), <Harness />);
    await press('Upload QR image');
    expect(await screen.findByText('QR added · pays to sana@okaxis')).toBeOnTheScreen();
    expect(mockScan).toHaveBeenCalledWith('file:///qr.png', ['qr']);
    expect(latest).toEqual({ mediaId: MEDIA_ID, payload: qr('Sana@OkAxis') });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ kind: 'image', purpose: 'UPI_QR', mime: 'image/png', size: 9000 });
  });

  it('refuses a QR that belongs to someone else, without uploading anything', async () => {
    fakeApi({}, fetchMock);
    mockScan.mockResolvedValue([{ data: qr('someone@okicici') }]);
    await renderWith(managerWith('seller', fetchMock, { missing: [] }), <Harness />);
    await press('Upload QR image');
    expect(await screen.findByText(/The QR belongs to someone@okicici, not sana@okaxis/)).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest).toBeNull();
  });

  it('says so when the image holds no QR code, or a QR that is not for UPI', async () => {
    fakeApi({}, fetchMock);
    mockScan.mockResolvedValueOnce([]).mockResolvedValueOnce([{ data: 'https://example.com' }]);
    await renderWith(managerWith('seller', fetchMock, { missing: [] }), <Harness />);
    await press('Upload QR image');
    expect(await screen.findByText(/No QR code found in that image/)).toBeOnTheScreen();
    await press('Upload QR image');
    expect(await screen.findByText(/not a UPI payment QR code/)).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('needs a UPI ID to check against', async () => {
    fakeApi({}, fetchMock);
    mockScan.mockResolvedValue([{ data: qr('sana@okaxis') }]);
    await renderWith(managerWith('seller', fetchMock, { missing: [] }), <Harness upiId="" />);
    await press('Upload QR image');
    expect(await screen.findByText('Enter your UPI ID too, so we can check it against the QR.')).toBeOnTheScreen();
  });

  it('shows why an upload failed, and does nothing when the picker is cancelled', async () => {
    happyApi();
    mockScan.mockResolvedValue([{ data: qr('sana@okaxis') }]);
    mockUpload.mockResolvedValue({ status: 500 });
    await renderWith(managerWith('seller', fetchMock, { missing: [] }), <Harness />);
    await press('Upload QR image');
    expect(await screen.findByText(/The upload did not go through/)).toBeOnTheScreen();
    expect(latest).toBeNull();
    mockPick.mockResolvedValueOnce({ canceled: true, assets: null });
    const callsBefore = mockScan.mock.calls.length;
    await press('Upload QR image');
    expect(mockScan.mock.calls.length).toBe(callsBefore);
  });

  it('warns when the UPI ID is changed after the QR was added, and can remove the QR', async () => {
    fakeApi({}, fetchMock);
    const initial = { mediaId: MEDIA_ID, payload: qr('sana@okaxis') };
    const m = managerWith('seller', fetchMock, { missing: [] });
    const view = await renderWith(m, <Harness initial={initial} upiId="different@okaxis" />);
    expect(await screen.findByText(/The QR belongs to sana@okaxis, not different@okaxis/)).toBeOnTheScreen();
    await press('Remove');
    await waitFor(() => expect(latest).toBeNull());
    expect(screen.getByText('Upload QR image')).toBeOnTheScreen();
    view.unmount();
  });
});
