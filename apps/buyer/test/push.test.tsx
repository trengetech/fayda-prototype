import { Platform } from 'react-native';
import { getPushToken, targetFromPush } from '../src/push';

const N = jest.requireMock('expo-notifications') as Record<string, jest.Mock>;
const expoConfig: { extra?: { eas?: { projectId?: string } } } = {};
jest.mock('expo-constants', () => ({ __esModule: true, default: { get expoConfig() { return (globalThis as { __expoConfig?: unknown }).__expoConfig; }, easConfig: undefined } }));
const withProject = (id?: string) => {
  (globalThis as { __expoConfig?: unknown }).__expoConfig = id ? { extra: { eas: { projectId: id } } } : { extra: {} };
};

beforeEach(() => {
  Object.values(N).forEach((m) => m.mockClear?.());
  N.getPermissionsAsync!.mockResolvedValue({ status: 'granted' });
  withProject('proj-1');
  void expoConfig;
});

describe('getPushToken', () => {
  it('returns the Expo token and the platform when allowed and the build has a project id', async () => {
    const t = await getPushToken();
    expect(t).toEqual({ token: 'ExponentPushToken[abcdefghijklmnopqrstuv]', platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
  });
  it('asks for permission when it has not been given, and returns null if the person says no', async () => {
    N.getPermissionsAsync!.mockResolvedValue({ status: 'undetermined' });
    N.requestPermissionsAsync!.mockResolvedValueOnce({ status: 'denied' });
    expect(await getPushToken()).toBeNull();
    expect(N.requestPermissionsAsync).toHaveBeenCalled();
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });
  it('returns null (no crash) when the build has no Expo project id', async () => {
    withProject(undefined);
    expect(await getPushToken()).toBeNull();
  });
});

describe('targetFromPush', () => {
  it('reads the kind and id the server sent, and ignores anything else', () => {
    expect(targetFromPush({ kind: 'ORDER', id: 'o1', app: 'buyer' })).toEqual({ kind: 'ORDER', id: 'o1' });
    expect(targetFromPush({ kind: 'EVIL', id: 'x' })).toBeNull();
    expect(targetFromPush({ kind: 'ORDER' })).toBeNull();
    expect(targetFromPush(undefined)).toBeNull();
  });
});
