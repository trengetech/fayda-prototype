import { Logger } from '@nestjs/common';
import { createApp } from './create-app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.port, config.host);
new Logger('Bootstrap').log(`Fayda API listening on ${config.host}:${config.port} (${config.environment})`);
