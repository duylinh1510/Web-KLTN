import { CypherReadOnlyGuardService } from './cypher-readonly-guard.service';

describe('CypherReadOnlyGuardService', () => {
  let service: CypherReadOnlyGuardService;

  beforeEach(() => {
    service = new CypherReadOnlyGuardService();
  });

  it('allows analytical MATCH queries', () => {
    const result = service.validate(`
      MATCH (t:Transaction)-[:HAS_CATEGORY]->(c:CategoryNode)
      WHERE toString(t.is_fraud) = "1"
      RETURN c.value AS category, COUNT(t) AS fraud_count
      ORDER BY fraud_count DESC
      LIMIT 5
    `);

    expect(result).toEqual({ safe: true });
  });

  it('does not reject forbidden words inside values or comments', () => {
    const result = service.validate(`
      MATCH (t:Transaction)
      WHERE t.note = "DELETE and CREATE are text only"
      /* MERGE (n) is not executed here */
      RETURN t
      LIMIT 5
    `);

    expect(result).toEqual({ safe: true });
  });

  it.each([
    ['CREATE', 'CREATE (n:Transaction) RETURN n'],
    ['MERGE', 'MATCH (t:Transaction) MERGE (x:Flag) RETURN t'],
    ['DELETE', 'MATCH (t:Transaction) DELETE t RETURN t'],
    ['SET', 'MATCH (t:Transaction) SET t.is_fraud = "0" RETURN t'],
    ['CALL', 'CALL db.labels() YIELD label RETURN label'],
    [
      'LOAD CSV',
      'LOAD CSV FROM "https://example.test/a.csv" AS row RETURN row',
    ],
  ])('rejects unsafe clause %s', (_clause, cypher) => {
    const result = service.validate(cypher);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('không được phép');
  });

  it('rejects multiple statements', () => {
    const result = service.validate(
      'MATCH (t:Transaction) RETURN t LIMIT 1; MATCH (m:MerchantNode) RETURN m',
    );

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('nhiều Cypher statement');
  });

  it('throws before execution for an unsafe query', () => {
    expect(() =>
      service.assertReadOnly('MATCH (t:Transaction) DETACH DELETE t'),
    ).toThrow('Cypher bị chặn bởi read-only guard.');
  });
});
