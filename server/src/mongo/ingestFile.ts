import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema, model, models } = mongoose;

export interface IngestFile {
  root: string;
  relPath: string;
  fileHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export type IngestFileDocument = HydratedDocument<IngestFile>;

const ingestFileSchema = new Schema<IngestFile>(
  {
    root: { type: String, required: true },
    relPath: { type: String, required: true },
    fileHash: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: 'ingest_files',
  },
);

ingestFileSchema.index({ root: 1, relPath: 1 }, { unique: true });
ingestFileSchema.index({ root: 1 });

export const IngestFileModel: Model<IngestFile> =
  models.IngestFile || model<IngestFile>('IngestFile', ingestFileSchema);
