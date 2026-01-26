import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema, model, models } = mongoose;

export interface AstPosition {
  line: number;
  column: number;
}

export interface AstRange {
  start: AstPosition;
  end: AstPosition;
}

export interface AstReference {
  root: string;
  relPath: string;
  fileHash: string;
  symbolId?: string;
  name: string;
  kind?: string;
  range: AstRange;
  createdAt: Date;
}

export type AstReferenceDocument = HydratedDocument<AstReference>;

const positionSchema = new Schema<AstPosition>(
  {
    line: { type: Number, required: true },
    column: { type: Number, required: true },
  },
  { _id: false },
);

const rangeSchema = new Schema<AstRange>(
  {
    start: { type: positionSchema, required: true },
    end: { type: positionSchema, required: true },
  },
  { _id: false },
);

const astReferenceSchema = new Schema<AstReference>(
  {
    root: { type: String, required: true },
    relPath: { type: String, required: true },
    fileHash: { type: String, required: true },
    symbolId: { type: String, required: false },
    name: { type: String, required: true },
    kind: { type: String, required: false },
    range: { type: rangeSchema, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'ast_references',
  },
);

astReferenceSchema.index({ root: 1, symbolId: 1 });
astReferenceSchema.index({ root: 1, name: 1, kind: 1 });
astReferenceSchema.index({ root: 1, relPath: 1, fileHash: 1 });

export const AstReferenceModel: Model<AstReference> =
  models.AstReference ||
  model<AstReference>('AstReference', astReferenceSchema);
