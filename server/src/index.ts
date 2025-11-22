import { getAppInfo } from '@codeinfo2/common';
import { LMStudioClient } from '@lmstudio/sdk';
import cors from 'cors';
import { config } from 'dotenv';
import express from 'express';
import pkg from '../package.json' with { type: 'json' };
import { createRequestLogger } from './logger.js';
import { createLmStudioRouter } from './routes/lmstudio.js';

config();
const app = express();
app.use(cors());
app.use(createRequestLogger());
const PORT = process.env.PORT ?? '5010';
const clientFactory = (baseUrl: string) => new LMStudioClient({ baseUrl });

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

app.get('/version', (_req, res) => {
  res.json(getAppInfo('server', pkg.version));
});

app.get('/info', (_req, res) => {
  res.json({
    message: 'Server using common package',
    info: getAppInfo('server', pkg.version),
  });
});

app.use('/', createLmStudioRouter({ clientFactory }));

app.listen(Number(PORT), () => console.log(`Server on ${PORT}`));
