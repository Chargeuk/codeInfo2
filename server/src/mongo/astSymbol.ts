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

export interface AstSymbol {
  root: string;
  relPath: string;
  fileHash: string;
  language: string;
  kind: string;
  name: string;
  range: AstRange;
  container?: string;
  symbolId: string;
  createdAt: Date;
  updatedAt: Date;
}

export type AstSymbolDocument = HydratedDocument<AstSymbol>;

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

const astSymbolSchema = new Schema<AstSymbol>(
  {
    root: { type: String, required: true },
    relPath: { type: String, required: true },
    fileHash: { type: String, required: true },
    language: { type: String, required: true },
    kind: { type: String, required: true },
    name: { type: String, required: true },
    range: { type: rangeSchema, required: true },
    container: { type: String, required: false },
    symbolId: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: 'ast_symbols',
  },
);

astSymbolSchema.index({ root: 1, relPath: 1, fileHash: 1 });
astSymbolSchema.index({ root: 1, symbolId: 1 }, { unique: true });
astSymbolSchema.index({ root: 1, kind: 1 });

export const AstSymbolModel: Model<AstSymbol> =
  models.AstSymbol || model<AstSymbol>('AstSymbol', astSymbolSchema);
