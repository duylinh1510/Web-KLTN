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
  scalars: Record<string, any>[];
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

// Xử 1 value: nếu là graph type (Node/Rel/Path) thì đẩy vào maps;
// nếu là scalar pure thì return plain value; mixed array xử từng item.
function extractGraphOrScalar(
  value: any,
  nodesMap: Map<string, GraphNode>,
  links: GraphLink[],
): { isGraph: boolean; scalarValue?: any } {
  if (value === null || value === undefined) {
    return { isGraph: false, scalarValue: value };
  }

  if (value instanceof Node) {
    nodesMap.set(value.identity.toString(), nodeToGraph(value));
    return { isGraph: true };
  }

  if (value instanceof Relationship) {
    links.push(relToGraph(value));
    return { isGraph: true };
  }

  if (value instanceof Path) {
    for (const seg of value.segments) {
      nodesMap.set(seg.start.identity.toString(), nodeToGraph(seg.start));
      nodesMap.set(seg.end.identity.toString(), nodeToGraph(seg.end));
      links.push(relToGraph(seg.relationship));
    }
    return { isGraph: true };
  }

  if (Array.isArray(value)) {
    let hasGraph = false;
    const plainItems: any[] = [];
    for (const item of value) {
      const res = extractGraphOrScalar(item, nodesMap, links);
      if (res.isGraph) hasGraph = true;
      else plainItems.push(res.scalarValue);
    }
    if (hasGraph && plainItems.length === 0) return { isGraph: true };
    if (!hasGraph) return { isGraph: false, scalarValue: plainItems };
    // Mixed: ưu tiên treat as graph, ignore plain items trong mảng đó
    return { isGraph: true };
  }

  // Scalar pure (string/number/bool/object literal)
  return { isGraph: false, scalarValue: toPlain(value) };
}

export function formatRecords(records: any[]): GraphData {
  const nodesMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const scalars: Record<string, any>[] = [];

  for (const record of records) {
    const recordScalars: Record<string, any> = {};

    for (const key of record.keys) {
      const value = record.get(key);
      const res = extractGraphOrScalar(value, nodesMap, links);
      if (!res.isGraph && res.scalarValue !== undefined) {
        recordScalars[key] = res.scalarValue;
      }
    }

    if (Object.keys(recordScalars).length > 0) {
      scalars.push(recordScalars);
    }
  }

  return {
    nodes: Array.from(nodesMap.values()),
    links,
    scalars,
  };
}
