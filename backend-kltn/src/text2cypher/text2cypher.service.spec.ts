import { Text2CypherService } from './text2cypher.service';

describe('Text2CypherService selfCorrectionLoop', () => {
  let service: Text2CypherService;
  let executeCypherExplain: jest.Mock;
  let callColabCorrect: jest.Mock;

  beforeEach(() => {
    executeCypherExplain = jest.fn();

    service = new Text2CypherService(
      {} as any,
      {} as any,
      { executeCypherExplain } as any,
      {} as any,
      {} as any,
      { validate: jest.fn().mockReturnValue({ safe: true }) } as any,
    );

    callColabCorrect = jest.fn();
    (service as any).callColabCorrect = callColabCorrect;
  });

  it('validates the Cypher produced by the third allowed correction', async () => {
    executeCypherExplain
      .mockResolvedValueOnce({ success: false, error: 'syntax error 1' })
      .mockResolvedValueOnce({ success: false, error: 'syntax error 2' })
      .mockResolvedValueOnce({ success: false, error: 'syntax error 3' })
      .mockResolvedValueOnce({ success: true });
    callColabCorrect
      .mockResolvedValueOnce('MATCH (n) RETURN n LIMIT 1')
      .mockResolvedValueOnce('MATCH (n) RETURN n LIMIT 2')
      .mockResolvedValueOnce('MATCH (n) RETURN n LIMIT 3');

    const result = await service.selfCorrectionLoop(
      'MATCH (n RETURN n',
      'schema',
      'question',
    );

    expect(result).toMatchObject({
      success: true,
      finalCypher: 'MATCH (n) RETURN n LIMIT 3',
      retries: 3,
    });
    expect(executeCypherExplain).toHaveBeenCalledTimes(4);
    expect(callColabCorrect).toHaveBeenCalledTimes(3);
  });

  it('stops without requesting a fourth correction after three fixes fail', async () => {
    executeCypherExplain.mockResolvedValue({
      success: false,
      error: 'still invalid',
    });
    callColabCorrect
      .mockResolvedValueOnce('MATCH (n) RETURN n LIMIT 1')
      .mockResolvedValueOnce('MATCH (n) RETURN n LIMIT 2')
      .mockResolvedValueOnce('MATCH (n) RETURN n LIMIT 3');

    const result = await service.selfCorrectionLoop(
      'MATCH (n RETURN n',
      'schema',
      'question',
    );

    expect(result).toMatchObject({
      success: false,
      finalCypher: 'MATCH (n) RETURN n LIMIT 3',
      retries: 3,
    });
    expect(executeCypherExplain).toHaveBeenCalledTimes(4);
    expect(callColabCorrect).toHaveBeenCalledTimes(3);
  });
});
