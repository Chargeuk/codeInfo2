import { getAppInfo } from '@codeinfo2/common';
import cors from 'cors';
import { config } from 'dotenv';
import express from 'express';
import pkg from '../package.json' with { type: 'json' };

config();
const app = express();
app.use(cors());
const PORT = process.env.PORT ?? '5010';

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

app.listen(Number(PORT), () => console.log(`Server on ${PORT}`));
