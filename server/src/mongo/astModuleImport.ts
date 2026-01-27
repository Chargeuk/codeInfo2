import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema, model, models } = mongoose;

export interface AstModuleImportEntry {
  source: string;
  names: string[];
}

export interface AstModuleImport {
  root: string;
  relPath: string;
  fileHash: string;
  imports: AstModuleImportEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export type AstModuleImportDocument = HydratedDocument<AstModuleImport>;

const importEntrySchema = new Schema<AstModuleImportEntry>(
  {
    source: { type: String, required: true },
    names: { type: [String], required: true },
  },
  { _id: false },
);

const astModuleImportSchema = new Schema<AstModuleImport>(
  {
    root: { type: String, required: true },
    relPath: { type: String, required: true },
    fileHash: { type: String, required: true },
    imports: { type: [importEntrySchema], required: true },
  },
  {
    timestamps: true,
    collection: 'ast_module_imports',
  },
);

astModuleImportSchema.index({ root: 1, relPath: 1, fileHash: 1 });
astModuleImportSchema.index({ root: 1, relPath: 1 });

export const AstModuleImportModel: Model<AstModuleImport> =
  models.AstModuleImport ||
  model<AstModuleImport>('AstModuleImport', astModuleImportSchema);
