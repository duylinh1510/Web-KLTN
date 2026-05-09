export interface Text2CypherResult {
  finalCypher: string;
  success: boolean;
  retries: number;
  errors: string[];
  schemaUsed: string;
  cypherV1?: string;
  cypherV2?: string;
}

export interface CorrectionResult {
  success: boolean;
  finalCypher: string;
  retries: number;
  errors: string[];
}
