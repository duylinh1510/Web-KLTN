import neo4j, { Node, Relationship, Path } from 'neo4j-driver';

export type GraphNode = {
  id: string;
  label: string;
  properties: Record<string, any>;
};

export type GraphLink = {
  source: string;
  target: string;
  type: string;
  properties: Record<string, any>;
};

export type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
  scalars: any[];
};

function toPlain(value: any): any {
  if (value === null || value === undefined) return value;
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPlain(v);
    return out;
  }
  return value;
}

function nodeToGraph(n: Node): GraphNode {
    return {
      id: n.identity.toString(),
      label: n.labels[0] ?? 'Node',
      properties: toPlain(n.properties),
    };
  }

  function relToGraph(r: Relationship): GraphLink {
    return {
      source: r.start.toString(),
      target: r.end.toString(),
      type: r.type,
      properties: toPlain(r.properties),
    };
  }

function collect(
  value: any,
  nodesMap: Map<string, GraphNode>,
  links: GraphLink[],
  scalars: any[],
): void {
  if (value === null || value === undefined) return;

  if (value instanceof Node) {
    nodesMap.set(value.identity.toString(), nodeToGraph(value));
    return;
  }

  if (value instanceof Relationship) {
    links.push(relToGraph(value));
    return;
  }

  if (value instanceof Path) {
    for (const seg of value.segments) {
      nodesMap.set(seg.start.identity.toString(), nodeToGraph(seg.start));
      nodesMap.set(seg.end.identity.toString(), nodeToGraph(seg.end));
      links.push(relToGraph(seg.relationship));
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collect(item, nodesMap, links, scalars);
    return;
  }

  scalars.push(toPlain(value));
}

export function formatRecords(records: any[]): GraphData {
  const nodesMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const scalars: any[] = [];

  for (const record of records) {
    for (const key of record.keys) {
      collect(record.get(key), nodesMap, links, scalars);
    }
  }

  return {
    nodes: Array.from(nodesMap.values()),
    links,
    scalars,
  };
}