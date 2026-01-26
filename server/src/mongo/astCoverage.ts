import mongoose, { type HydratedDocument, type Model } from 'mongoose';
import { append } from '../logStore.js';
import { baseLogger } from '../logger.js';

const { Schema, model, models } = mongoose;

export interface AstCoverage {
  root: string;
  supportedFileCount: number;
  skippedFileCount: number;
  failedFileCount: number;
  lastIndexedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type AstCoverageDocument = HydratedDocument<AstCoverage>;

const astCoverageSchema = new Schema<AstCoverage>(
  {
    root: { type: String, required: true },
    supportedFileCount: { type: Number, required: true },
    skippedFileCount: { type: Number, required: true },
    failedFileCount: { type: Number, required: true },
    lastIndexedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'ast_coverage',
  },
);

astCoverageSchema.index({ root: 1 }, { unique: true });

export const AstCoverageModel: Model<AstCoverage> =
  models.AstCoverage || model<AstCoverage>('AstCoverage', astCoverageSchema);

append({
  level: 'info',
  message: 'DEV-0000032:T1:ast-mongo-models-ready',
  timestamp: new Date().toISOString(),
  source: 'server',
  context: { collection: 'ast_coverage' },
});

baseLogger.info(
  {
    event: 'DEV-0000032:T1:ast-mongo-models-ready',
    collection: 'ast_coverage',
  },
  'AST Mongo models ready',
);
