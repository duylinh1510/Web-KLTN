import { FullSchema } from '../interfaces/classification-schema.interface';

export interface Csv2GraphFiles {
  inputCsv: string;
  nodesCsv: string;
  edgesCsv: string;
  schemaJson: string;
  preprocessedCsv?: string;
  dataPt?: string;
}

export interface Csv2GraphStats {
  inputRows: number;
  numNodes: number;
  numEdges: number;
  /** Số raw feature columns trong nodes.csv (CSV input shape, không one-hot) */
  numFeatures: number;
  /** Số encoded feature columns sau one-hot (= chiều của tensor x trong data.pt) */
  numEncodedFeatures: number;
  numRelationTypes: number;
  ingested?: {
    nodes: number;
    relationships: number;
  };
}

export interface Csv2GraphResult {
  jobId: string;
  /** 'full' = build mới khi DB rỗng; 'append' = MERGE upsert vào dataset hiện tại */
  mode: 'full' | 'append';
  /** Khi mode='append', jobId của lần build đầu (canonical schema). */
  canonicalJobId?: string;
  schema: FullSchema;
  stats: Csv2GraphStats;
  files: Csv2GraphFiles;
}
