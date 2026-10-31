import { createSessionManager } from '@fayda/api-client';
import { API_URL } from './config';
import { secureStorage } from './secure-storage';

export const sessionManager = createSessionManager({ baseUrl: API_URL, app: 'buyer', storage: secureStorage });
