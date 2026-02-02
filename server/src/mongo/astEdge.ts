import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema, model, models } = mongoose;

export interface AstEdge {
  root: string;
  relPath: string;
  fileHash: string;
  fromSymbolId: string;
  toSymbolId: string;
  type: string;
  createdAt: Date;
}

export type AstEdgeDocument = HydratedDocument<AstEdge>;

const astEdgeSchema = new Schema<AstEdge>(
  {
    root: { type: String, required: true },
    relPath: { type: String, required: true },
    fileHash: { type: String, required: true },
    fromSymbolId: { type: String, required: true },
    toSymbolId: { type: String, required: true },
    type: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'ast_edges',
  },
);

astEdgeSchema.index({ root: 1, fromSymbolId: 1 });
astEdgeSchema.index({ root: 1, toSymbolId: 1 });
astEdgeSchema.index({ root: 1, relPath: 1, fileHash: 1 });

export const AstEdgeModel: Model<AstEdge> =
  models.AstEdge || model<AstEdge>('AstEdge', astEdgeSchema);
