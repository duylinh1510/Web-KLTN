import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

export interface CypherReadOnlyValidation {
  safe: boolean;
  reason?: string;
}

@Injectable()
export class CypherReadOnlyGuardService {
  private readonly forbiddenPatterns: Array<{
    clause: string;
    pattern: RegExp;
  }> = [
    { clause: 'CREATE', pattern: /\bCREATE\b/i },
    { clause: 'MERGE', pattern: /\bMERGE\b/i },
    { clause: 'DELETE', pattern: /\bDELETE\b/i },
    { clause: 'DETACH DELETE', pattern: /\bDETACH\s+DELETE\b/i },
    { clause: 'SET', pattern: /\bSET\b/i },
    { clause: 'REMOVE', pattern: /\bREMOVE\b/i },
    { clause: 'DROP', pattern: /\bDROP\b/i },
    { clause: 'LOAD CSV', pattern: /\bLOAD\s+CSV\b/i },
    { clause: 'FOREACH', pattern: /\bFOREACH\b/i },
    { clause: 'CALL', pattern: /\bCALL\b/i },
    { clause: 'SHOW', pattern: /\bSHOW\b/i },
    { clause: 'USE', pattern: /\bUSE\b/i },
    { clause: 'GRANT', pattern: /\bGRANT\b/i },
    { clause: 'DENY', pattern: /\bDENY\b/i },
    { clause: 'REVOKE', pattern: /\bREVOKE\b/i },
    { clause: 'ALTER', pattern: /\bALTER\b/i },
    { clause: 'RENAME', pattern: /\bRENAME\b/i },
    { clause: 'TERMINATE', pattern: /\bTERMINATE\b/i },
    { clause: 'START', pattern: /\bSTART\b/i },
    { clause: 'STOP', pattern: /\bSTOP\b/i },
  ];

  validate(cypher: string): CypherReadOnlyValidation {
    if (!cypher || cypher.trim().length === 0 || cypher.trim() === 'error') {
      return {
        safe: false,
        reason: 'Query trống hoặc AI không sinh được Cypher.',
      };
    }

    const queryBody = this.stripLiteralsAndComments(cypher);
    const normalized = queryBody.replace(/\s+/g, ' ').trim();

    if (normalized.includes(';')) {
      return {
        safe: false,
        reason: 'Không cho phép nhiều Cypher statement trong một request.',
      };
    }

    for (const { clause, pattern } of this.forbiddenPatterns) {
      if (pattern.test(normalized)) {
        return {
          safe: false,
          reason: `Phát hiện clause không được phép: ${clause}.`,
        };
      }
    }

    if (!/^(MATCH|OPTIONAL\s+MATCH)\b/i.test(normalized)) {
      return {
        safe: false,
        reason: 'Text2Cypher chỉ cho phép query phân tích bắt đầu bằng MATCH.',
      };
    }

    if (!/\bRETURN\b/i.test(normalized)) {
      return {
        safe: false,
        reason: 'Query phân tích phải kết thúc bằng dữ liệu RETURN.',
      };
    }

    return { safe: true };
  }

  assertReadOnly(cypher: string): void {
    const validation = this.validate(cypher);
    if (validation.safe) return;

    throw new HttpException(
      {
        status: 'error',
        message: 'Cypher bị chặn bởi read-only guard.',
        reason: validation.reason,
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  private stripLiteralsAndComments(cypher: string): string {
    let output = '';
    let mode: 'normal' | 'literal' | 'line-comment' | 'block-comment' =
      'normal';
    let quote = '';

    for (let index = 0; index < cypher.length; index++) {
      const current = cypher[index];
      const next = cypher[index + 1];

      if (mode === 'normal') {
        if (current === '/' && next === '/') {
          output += '  ';
          index++;
          mode = 'line-comment';
        } else if (current === '/' && next === '*') {
          output += '  ';
          index++;
          mode = 'block-comment';
        } else if (current === "'" || current === '"' || current === '`') {
          output += ' ';
          quote = current;
          mode = 'literal';
        } else {
          output += current;
        }
        continue;
      }

      if (mode === 'literal') {
        output += current === '\n' ? '\n' : ' ';
        if (current === '\\' && next !== undefined) {
          output += next === '\n' ? '\n' : ' ';
          index++;
        } else if (current === quote) {
          if (next === quote) {
            output += ' ';
            index++;
          } else {
            quote = '';
            mode = 'normal';
          }
        }
        continue;
      }

      if (mode === 'line-comment') {
        output += current === '\n' ? '\n' : ' ';
        if (current === '\n') mode = 'normal';
        continue;
      }

      output += current === '\n' ? '\n' : ' ';
      if (current === '*' && next === '/') {
        output += ' ';
        index++;
        mode = 'normal';
      }
    }

    return output;
  }
}
