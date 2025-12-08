import mongoose from 'mongoose';
import { baseLogger as logger } from '../logger.js';

export async function connectMongo(uri: string) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  logger.info({ uri }, 'Mongo connected');
}

export async function disconnectMongo() {
  await mongoose.connection.close();
  logger.info('Mongo disconnected');
}
