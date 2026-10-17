import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Box, FileCode2, Focus, Link2, Maximize2, Minus, Plus, RefreshCw, X } from 'lucide-react';
import type { CodeGraphResult, CodeRelationship } from '../lib/contracts';
import { Localized } from '../lib/localization';

const WIDTH = 1200;
const HEIGHT = 720;
const GRAPH_KINDS = ['IMPORTS', 'CALLS', 'REFERENCES'] as const;
type GraphKind = typeof GRAPH_KINDS[number];
type Point = { x: number; y: number };
type ViewTransform = Point & { scale: number };
type GraphNode = { id: string; label: string; path: string; kind: 'file' | 'symbol'; degree: number };
type GraphEdge = CodeRelationship & { id: string; from: string; to: string; count: number };
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };
type Gesture = { type: 'pan'; pointer: Point; view: ViewTransform } | { type: 'node'; pointer: Point; nodeId: string; origin: Point };

const kindColor: Record<GraphKind, string> = { IMPORTS: 'var(--blue)', CALLS: 'var(--ion)', REFERENCES: 'var(--violet)' };
const kindLabel: Record<GraphKind, string> = { IMPORTS: 'Imports', CALLS: 'Calls', REFERENCES: 'References' };

function basename(value: string): string { return value.replaceAll('\\', '/').split('/').at(-1) || value || 'Módulo externo'; }
function shortLabel(value: string, max = 25): string { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }

function createGraph(relationships: CodeRelationship[], filters: Record<GraphKind, boolean>): GraphData {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const register = (id: string, label: string, path: string, kind: GraphNode['kind']) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, path, kind, degree: 0 });
    return id;
  };

  for (const relationship of relationships) {
    if (!filters[relationship.kind]) continue;
    const isImport = relationship.kind === 'IMPORTS';
    const from = isImport || !relationship.sourceName
      ? register(`file:${relationship.sourcePath}`, basename(relationship.sourcePath), relationship.sourcePath, 'file')
      : register(`symbol:${relationship.sourcePath}:${relationship.sourceName}`, relationship.sourceName, relationship.sourcePath, 'symbol');
    const targetPath = relationship.targetPath ?? (isImport ? relationship.targetName : '');
    const to = isImport
      ? register(`file:${targetPath}`, basename(targetPath), targetPath, 'file')
      : register(`symbol:${targetPath || 'unresolved'}:${relationship.targetName}`, relationship.targetName, targetPath, 'symbol');
    const id = `${relationship.kind}:${from}:${to}`;
    const edge = edges.get(id);
    if (edge) edge.count += 1;
    else edges.set(id, { ...relationship, id, from, to, count: 1 });
  }

  for (const edge of edges.values()) {
    const source = nodes.get(edge.from);
    const target = nodes.get(edge.to);
    if (source) source.degree += 1;
    if (target && target !== source) target.degree += 1;
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

type GraphLayout = { positions: Map<string, Point>; scale: number };

function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphLayout {
  if (!nodes.length) return { positions: new Map(), scale: 1 };
  const points = nodes.map((node, index) => {
    const angle = index * 2.399963 + (hashText(node.id) % 1000) / 1000;
    const radius = 125 + Math.sqrt(index + 1) * 58;
    return { id: node.id, x: WIDTH / 2 + Math.cos(angle) * radius, y: HEIGHT / 2 + Math.sin(angle) * radius * .62, vx: 0, vy: 0 };
  });
  const indexes = new Map(points.map((point, index) => [point.id, index]));
  const links = edges.map((edge) => [indexes.get(edge.from), indexes.get(edge.to)] as const).filter((link): link is readonly [number, number] => link[0] !== undefined && link[1] !== undefined);
  const iterations = Math.min(96, 72 + Math.ceil(points.length / 24));
  const nearbyPairs = (): Array<readonly [number, number]> => {
    const cellSize = 275;
    const buckets = new Map<string, number[]>();
    points.forEach((point, index) => {
      const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(index);
      buckets.set(key, bucket);
    });
    const pairs: Array<readonly [number, number]> = [];
    for (let left = 0; left < points.length; left += 1) {
      const point = points[left]!;
      const cellX = Math.floor(point.x / cellSize);
      const cellY = Math.floor(point.y / cellSize);
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (const right of buckets.get(`${cellX + offsetX}:${cellY + offsetY}`) ?? []) if (right > left) pairs.push([left, right]);
      }
    }
    return pairs;
  };

  for (let step = 0; step < iterations; step += 1) {
    const cooling = .28 + (1 - step / iterations) * .72;
    for (const [left, right] of nearbyPairs()) {
      const a = points[left]!;
      const b = points[right]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 1) { dx = ((left + right) % 2 ? 1 : -1); dy = (left % 2 ? -1 : 1); distance = Math.SQRT2; }
      const overlapX = 226 - Math.abs(dx);
      const overlapY = 78 - Math.abs(dy);
      if (overlapX > 0 && overlapY > 0) {
        const separateX = overlapX / 226 < overlapY / 78;
        if (separateX) {
          const push = Math.sign(dx || (left % 2 ? 1 : -1)) * (overlapX + 8) * .2 * cooling;
          a.vx -= push; b.vx += push;
        } else {
          const push = Math.sign(dy || (right % 2 ? -1 : 1)) * (overlapY + 7) * .2 * cooling;
          a.vy -= push; b.vy += push;
        }
      } else if (distance < 275) {
        const push = (275 - distance) * .003 * cooling;
        const px = dx / distance * push;
        const py = dy / distance * push;
        a.vx -= px; a.vy -= py; b.vx += px; b.vy += py;
      }
    }
    for (const [sourceIndex, targetIndex] of links) {
      if (sourceIndex === targetIndex) continue;
      const a = points[sourceIndex]!;
      const b = points[targetIndex]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const pull = (distance - 300) * .00035 * cooling;
      a.vx += dx / distance * pull; a.vy += dy / distance * pull;
      b.vx -= dx / distance * pull; b.vy -= dy / distance * pull;
    }
    for (const point of points) {
      point.vx += (WIDTH / 2 - point.x) * .00024;
      point.vy += (HEIGHT / 2 - point.y) * .00024;
      point.x += point.vx;
      point.y += point.vy;
      point.vx *= .72;
      point.vy *= .72;
    }
  }

  // A deterministic relaxation prevents node cards from overlapping after fitting.
  for (let step = 0; step < 96; step += 1) {
    for (const [left, right] of nearbyPairs()) {
      const a = points[left]!;
      const b = points[right]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const overlapX = 226 - Math.abs(dx);
      const overlapY = 78 - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      if (overlapX / 226 < overlapY / 78) {
        const push = (overlapX + 8) * .7 * (dx < 0 ? -1 : 1);
        a.x -= push; b.x += push;
      } else {
        const push = (overlapY + 7) * .7 * (dy < 0 ? -1 : 1);
        a.y -= push; b.y += push;
      }
    }
  }

  const minX = Math.min(...points.map((point) => point.x - 100));
  const maxX = Math.max(...points.map((point) => point.x + 100));
  const minY = Math.min(...points.map((point) => point.y - 31));
  const maxY = Math.max(...points.map((point) => point.y + 31));
  const scale = Math.min(1, (WIDTH - 80) / Math.max(1, maxX - minX), (HEIGHT - 80) / Math.max(1, maxY - minY));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    positions: new Map(points.map((point) => [point.id, { x: WIDTH / 2 + point.x - centerX, y: HEIGHT / 2 + point.y - centerY }])),
    scale,
  };
}

function edgeCurve(source: Point, target: Point, index: number) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const sourceScale = 1 / Math.max(.0001, Math.abs(dx / distance) / 100, Math.abs(dy / distance) / 31);
  const targetScale = sourceScale;
  const start = { x: source.x + dx / distance * sourceScale, y: source.y + dy / distance * sourceScale };
  const end = { x: target.x - dx / distance * targetScale, y: target.y - dy / distance * targetScale };
  const bend = ((hashText(`${source.x}:${target.y}:${index}`) % 2) ? 1 : -1) * Math.min(44, distance * .13);
  const control = { x: (start.x + end.x) / 2 - dy / distance * bend, y: (start.y + end.y) / 2 + dx / distance * bend };
  const midpoint = { x: .25 * start.x + .5 * control.x + .25 * end.x, y: .25 * start.y + .5 * control.y + .25 * end.y };
  return { start, end, control, midpoint };
}

function pointFor(event: { clientX: number; clientY: number }, element: SVGSVGElement): Point {
  const rect = element.getBoundingClientRect();
  const scale = Math.min(rect.width / WIDTH, rect.height / HEIGHT);
  const offsetX = (rect.width - WIDTH * scale) / 2;
  const offsetY = (rect.height - HEIGHT * scale) / 2;
  return { x: (event.clientX - rect.left - offsetX) / scale, y: (event.clientY - rect.top - offsetY) / scale };
}

function NodeMark({ kind, color }: { kind: GraphNode['kind']; color: string }) {
  return <span className="code-graph-node-mark">{kind === 'file' ? <FileCode2 size={16} color={color} /> : <Box size={16} color={color} />}</span>;
}

function CodeGraphInspector({ node, nodes, edges, onSelect, onClose }: { node?: GraphNode; nodes: GraphNode[]; edges: GraphEdge[]; onSelect: (id: string) => void; onClose: () => void }) {
  if (!node) return <Localized><aside className="code-graph-inspector code-graph-inspector--empty"><div className="code-graph-inspector-heading"><span>Explorador</span><span className="code-graph-inspector-help">Selecciona un nodo</span></div><div className="code-graph-inspector-empty"><span className="code-graph-inspector-empty-mark"><Focus size={18} /></span><strong>Explora el proyecto</strong><p>Elige un archivo o símbolo para ver sus conexiones directas.</p></div></aside></Localized>;
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const incoming = edges.filter((edge) => edge.to === node.id);
  const outgoing = edges.filter((edge) => edge.from === node.id);
  const neighbors = (items: GraphEdge[], side: 'from' | 'to') => items.slice(0, 8).map((edge) => {
    const other = byId.get(side === 'from' ? edge.from : edge.to);
    if (!other) return null;
    return <button className="code-graph-neighbor" type="button" key={edge.id} onClick={() => onSelect(other.id)}><NodeMark kind={other.kind} color={kindColor[edge.kind]} /><span><strong>{shortLabel(other.label, 28)}</strong><small>{kindLabel[edge.kind]} · {other.path || 'destino no resuelto'}</small></span><span className="code-graph-neighbor-count">{edge.count > 1 ? `×${edge.count}` : `L${edge.line}`}</span></button>;
  });

  return <Localized><aside className="code-graph-inspector" aria-label="Detalles del nodo"><div className="code-graph-inspector-heading"><span>Inspector</span><button type="button" aria-label="Cerrar inspector" onClick={onClose}><X size={14} /></button></div><div className="code-graph-node-detail"><span className={`code-graph-detail-icon code-graph-detail-icon--${node.kind}`}><NodeMark kind={node.kind} color={node.kind === 'file' ? 'var(--blue)' : 'var(--ion)'} /></span><div className="code-graph-detail-title"><strong title={node.label}>{node.label}</strong><span>{node.kind === 'file' ? 'Archivo' : 'Símbolo'}</span></div></div><code className="code-graph-detail-path" title={node.path}>{node.path || 'Referencia sin resolver'}</code><div className="code-graph-detail-stats"><span><strong>{incoming.length}</strong> entrantes</span><span><strong>{outgoing.length}</strong> salientes</span></div><section className="code-graph-link-section"><h3>Entrantes <span>{incoming.length}</span></h3>{incoming.length ? neighbors(incoming, 'from') : <p className="code-graph-no-links">Sin conexiones entrantes</p>}</section><section className="code-graph-link-section"><h3>Salientes <span>{outgoing.length}</span></h3>{outgoing.length ? neighbors(outgoing, 'to') : <p className="code-graph-no-links">Sin conexiones salientes</p>}</section><p className="code-graph-confidence-note">Los imports reflejan la sintaxis del código. Las llamadas y referencias se infieren por análisis sintáctico.</p></aside></Localized>;
}

export function CodeGraphView({ graph, onRefresh, loading = false }: { graph: CodeGraphResult; onRefresh: () => void; loading?: boolean }) {
  const [filters, setFilters] = useState<Record<GraphKind, boolean>>({ IMPORTS: true, CALLS: true, REFERENCES: true });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const gesture = useRef<Gesture | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const data = useMemo(() => createGraph(graph.relationships, filters), [filters, graph.relationships]);
  const layout = useMemo(() => layoutGraph(data.nodes, data.edges), [data]);
  const nodes = useMemo(() => data.nodes.map((node) => ({ ...node, ...(positions[node.id] ?? layout.positions.get(node.id) ?? { x: WIDTH / 2, y: HEIGHT / 2 }) })), [data.nodes, layout, positions]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const selected = selectedId ? nodeById.get(selectedId) : undefined;
  const connected = useMemo(() => new Set(selected ? [selected.id, ...data.edges.filter((edge) => edge.from === selected.id || edge.to === selected.id).flatMap((edge) => [edge.from, edge.to])] : []), [data.edges, selected]);
  const visibleCount = data.edges.reduce((total, edge) => total + edge.count, 0);

  useEffect(() => {
    setPositions({});
    setView({ x: WIDTH / 2 * (1 - layout.scale), y: HEIGHT / 2 * (1 - layout.scale), scale: layout.scale });
  }, [layout]);
  useEffect(() => { if (selectedId && !nodeById.has(selectedId)) setSelectedId(null); }, [nodeById, selectedId]);

  const graphPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = pointFor(event, svg);
    return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
  };
  const startNodeDrag = (event: ReactPointerEvent<SVGGElement>, node: GraphNode & Point) => {
    event.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    gesture.current = { type: 'node', pointer: graphPoint(event as unknown as ReactPointerEvent<SVGSVGElement>), nodeId: node.id, origin: { x: node.x, y: node.y } };
    setSelectedId(node.id);
  };
  const startPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('[data-graph-node]'))) return;
    const point = pointFor(event, event.currentTarget);
    svgRef.current?.setPointerCapture(event.pointerId);
    gesture.current = { type: 'pan', pointer: point, view };
  };
  const movePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = gesture.current;
    if (!active) return;
    const svg = svgRef.current;
    if (!svg) return;
    const point = pointFor(event, svg);
    if (active.type === 'pan') setView({ ...active.view, x: active.view.x + point.x - active.pointer.x, y: active.view.y + point.y - active.pointer.y });
    else {
      const local = { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
      setPositions((previous) => ({ ...previous, [active.nodeId]: { x: active.origin.x + local.x - active.pointer.x, y: active.origin.y + local.y - active.pointer.y } }));
    }
  };
  const endPointer = () => { gesture.current = null; };
  const zoom = (delta: number) => setView((current) => {
    const minimum = Math.max(.03, Math.min(.45, layout.scale * .65));
    const scale = Math.max(minimum, Math.min(2.2, Math.round((current.scale + delta) * 100) / 100));
    return { scale, x: current.x + (current.scale - scale) * WIDTH / 2, y: current.y + (current.scale - scale) * HEIGHT / 2 };
  });
  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); zoom(event.deltaY < 0 ? .08 : -.08); };
  const fit = () => { setView({ x: WIDTH / 2 * (1 - layout.scale), y: HEIGHT / 2 * (1 - layout.scale), scale: layout.scale }); setPositions({}); };

  return <Localized><section className="code-graph-panel" aria-label="Grafo de relaciones del código">
    <div className="code-graph-toolbar"><div className="code-graph-filters" aria-label="Filtrar relaciones">{GRAPH_KINDS.map((kind) => <button type="button" key={kind} className={`code-graph-filter code-graph-filter--${kind.toLowerCase()} ${filters[kind] ? 'is-active' : ''}`} aria-pressed={filters[kind]} onClick={() => setFilters((current) => ({ ...current, [kind]: !current[kind] }))}><span className="code-graph-filter-dot" />{kindLabel[kind]}</button>)}</div><span className="code-graph-toolbar-separator" /><span className="code-graph-toolbar-hint"><Link2 size={13} />{data.edges.length} vínculos</span><span className="code-graph-toolbar-spacer" /><button className="code-graph-icon-button" type="button" title="Alejar" aria-label="Alejar" onClick={() => zoom(-.15)}><Minus size={14} /></button><span className="code-graph-zoom-value">{Math.round(view.scale * 100)}%</span><button className="code-graph-icon-button" type="button" title="Acercar" aria-label="Acercar" onClick={() => zoom(.15)}><Plus size={14} /></button><button className="code-graph-fit-button" type="button" onClick={fit}><Maximize2 size={13} />Ajustar vista</button><button className="code-graph-icon-button" type="button" title="Actualizar grafo" aria-label="Actualizar grafo" disabled={loading} onClick={onRefresh}><RefreshCw size={14} className={loading ? 'code-graph-refreshing' : ''} /></button></div>
    <div className="code-graph-workspace">
      <div className="code-graph-canvas-wrap">
        {data.nodes.length ? <svg ref={svgRef} className="code-graph-canvas" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={`Grafo con ${data.nodes.length} nodos y ${data.edges.length} relaciones`} onPointerDown={startPan} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer} onWheel={onWheel}>
          <defs><pattern id="code-graph-grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".9" fill="var(--border-strong)" /></pattern>{GRAPH_KINDS.map((kind) => <marker key={kind} id={`code-graph-arrow-${kind.toLowerCase()}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={kindColor[kind]} /></marker>)}</defs>
          <rect width={WIDTH} height={HEIGHT} fill="var(--code-bg)" /><rect width={WIDTH} height={HEIGHT} fill="url(#code-graph-grid)" />
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {data.edges.map((edge, index) => {
              const source = nodeById.get(edge.from); const target = nodeById.get(edge.to);
              if (!source || !target) return null;
              const curve = edgeCurve(source, target, index);
              const connectedEdge = Boolean(selected && (selected.id === edge.from || selected.id === edge.to));
              const active = !selected || connectedEdge;
              return <g key={edge.id} className={`code-graph-edge code-graph-edge--${edge.kind.toLowerCase()} ${connectedEdge ? 'is-connected' : active ? '' : 'is-muted'}`}><path d={`M ${curve.start.x} ${curve.start.y} Q ${curve.control.x} ${curve.control.y} ${curve.end.x} ${curve.end.y}`} markerEnd={`url(#code-graph-arrow-${edge.kind.toLowerCase()})`} /><g className="code-graph-edge-label" transform={`translate(${curve.midpoint.x} ${curve.midpoint.y})`}><rect x={-34} y={-10} width={68} height={18} rx={5} /><text textAnchor="middle" dominantBaseline="central">{kindLabel[edge.kind]}{edge.count > 1 ? ` ×${edge.count}` : ''}</text></g></g>;
            })}
            {nodes.map((node) => {
              const active = !selected || connected.has(node.id);
              const selectedNode = selected?.id === node.id;
              const color = node.kind === 'file' ? 'var(--blue)' : 'var(--violet)';
              return <g key={node.id} data-graph-node="true" className={`code-graph-node code-graph-node--${node.kind} ${selectedNode ? 'is-selected' : ''} ${active ? '' : 'is-muted'}`} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} aria-label={`${node.kind === 'file' ? 'Archivo' : 'Símbolo'} ${node.label}, ${node.path || 'destino externo'}`} aria-pressed={selectedNode} onPointerDown={(event) => startNodeDrag(event, node)} onClick={() => setSelectedId(node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(node.id); } }}><title>{node.label} · {node.path || 'Referencia sin resolver'}</title><rect className="code-graph-node-outline" x={-100} y={-31} width={200} height={62} rx={9} /><circle className="code-graph-node-halo" cx={-78} cy={0} r={15} /><foreignObject x={-87} y={-9} width={18} height={18}><div className="code-graph-mark-wrap"><NodeMark kind={node.kind} color={color} /></div></foreignObject><foreignObject x={-58} y={-20} width={148} height={42}><div className="code-graph-node-copy"><strong>{shortLabel(node.label, 23)}</strong><small>{shortLabel(node.path || 'Destino no resuelto', 28)}</small></div></foreignObject><circle className="code-graph-node-degree" cx={87} cy={-20} r={10} /><text className="code-graph-node-degree-text" x={87} y={-20} textAnchor="middle" dominantBaseline="central">{node.degree}</text></g>;
            })}
          </g>
          <GraphMiniMap nodes={nodes} edges={data.edges} view={view} />
        </svg> : <div className="code-graph-empty"><span><Link2 size={20} /></span><strong>{graph.relationships.length ? 'No hay vínculos con estos filtros' : graph.query ? 'No se encontraron relaciones' : 'El índice no encontró relaciones'}</strong><p>{graph.relationships.length ? 'Activa algún tipo de relación para mostrarlo.' : 'Busca un símbolo o actualiza el índice para volver a explorar.'}</p></div>}
        {data.nodes.length > 0 && <div className="code-graph-canvas-hint"><span className="code-graph-hint-dot" />Arrastra el fondo para desplazarte <span>·</span> Ctrl + rueda para ampliar</div>}
      </div>
      <CodeGraphInspector node={selected} nodes={nodes} edges={data.edges} onSelect={setSelectedId} onClose={() => setSelectedId(null)} />
    </div>
    <footer className="code-graph-footer"><span><strong>{graph.files}</strong> archivos</span><i /><span><strong>{graph.symbols}</strong> símbolos</span><i /><span><strong>{visibleCount}</strong> relaciones</span><span className="code-graph-footer-spacer" />{graph.truncated && <span className="code-graph-truncated">Vista limitada a 250 relaciones</span>}<span className="code-graph-confidence"><span className="code-graph-confidence-mark is-confirmed" />Import explícito<span className="code-graph-confidence-mark is-inferred" />Llamada o referencia inferida</span></footer>
  </section></Localized>;
}

function GraphMiniMap({ nodes, edges, view }: { nodes: Array<GraphNode & Point>; edges: GraphEdge[]; view: ViewTransform }) {
  if (!nodes.length) return null;
  const minX = Math.min(...nodes.map((node) => node.x)); const maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y)); const maxY = Math.max(...nodes.map((node) => node.y));
  const mapPoint = (point: Point) => ({ x: 18 + (point.x - minX) / Math.max(1, maxX - minX) * 134, y: 18 + (point.y - minY) / Math.max(1, maxY - minY) * 72 });
  const visibleStart = mapPoint({ x: (0 - view.x) / view.scale, y: (0 - view.y) / view.scale });
  const visibleEnd = mapPoint({ x: (WIDTH - view.x) / view.scale, y: (HEIGHT - view.y) / view.scale });
  return <g className="code-graph-minimap" transform="translate(1006 574)" aria-hidden="true"><rect width="176" height="128" rx="8" />{edges.map((edge) => { const source = nodes.find((node) => node.id === edge.from); const target = nodes.find((node) => node.id === edge.to); if (!source || !target) return null; const a = mapPoint(source); const b = mapPoint(target); return <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`is-${edge.kind.toLowerCase()}`} />; })}{nodes.map((node) => { const point = mapPoint(node); return <circle key={node.id} cx={point.x} cy={point.y} r={node.kind === 'file' ? 2.6 : 3.5} className={`is-${node.kind}`} />; })}<rect className="code-graph-minimap-viewport" x={Math.max(4, visibleStart.x)} y={Math.max(4, visibleStart.y)} width={Math.max(8, Math.min(168, visibleEnd.x) - Math.max(4, visibleStart.x))} height={Math.max(8, Math.min(120, visibleEnd.y) - Math.max(4, visibleStart.y))} rx="4" /></g>;
}
