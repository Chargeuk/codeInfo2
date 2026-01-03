import mongoose from 'mongoose';
import { append } from '../logStore.js';
import { baseLogger as logger } from '../logger.js';
import { IngestFileModel } from './ingestFile.js';

export async function connectMongo(uri: string) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  logger.info({ uri }, 'Mongo connected');

  append({
    level: 'info',
    message: '0000020 ingest_files model ready',
    timestamp: new Date().toISOString(),
    source: 'server',
    context: {
      modelName: IngestFileModel.modelName,
      collection: 'ingest_files',
    },
  });
}

export async function disconnectMongo() {
  await mongoose.connection.close();
  logger.info('Mongo disconnected');
}

export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
