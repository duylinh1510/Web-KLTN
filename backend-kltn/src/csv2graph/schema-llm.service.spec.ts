import { SchemaLlmService } from './schema-llm.service';

describe('SchemaLlmService enforceRules', () => {
  let service: SchemaLlmService;

  beforeEach(() => {
    service = new SchemaLlmService({} as any, {} as any);
  });

  it('defaults Neo4j roles from homogeneous roles for old schemas', () => {
    const schema = service.enforceRules(
      {
        node_id: 'trans_num',
        relation_cols: ['merchant'],
        feature: ['amt', 'category'],
        encoding_hints: {},
      },
      ['trans_num', 'merchant', 'amt', 'category', 'is_fraud'],
      'is_fraud',
    );

    expect(schema.relation_cols).toEqual(['merchant']);
    expect(schema.rel_hetero).toEqual(['merchant']);
    expect(schema.feature).toEqual(['amt', 'category']);
    expect(schema.feature_hetero).toEqual(['amt', 'category']);
  });

  it('keeps homogeneous and Neo4j roles independent when provided', () => {
    const schema = service.enforceRules(
      {
        node_id: 'trans_num',
        relation_cols: ['category'],
        rel_hetero: ['merchant'],
        feature: ['amt'],
        feature_hetero: ['city', 'merchant'],
        encoding_hints: {},
      },
      ['trans_num', 'merchant', 'category', 'amt', 'city', 'is_fraud'],
      'is_fraud',
    );

    expect(schema.relation_cols).toEqual(['category']);
    expect(schema.rel_hetero).toEqual(['merchant']);
    expect(schema.feature).toEqual(['amt']);
    expect(schema.feature_hetero).toEqual(['city']);
  });
});
