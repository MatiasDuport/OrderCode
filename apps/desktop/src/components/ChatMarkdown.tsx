import { Children, isValidElement, memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { openExternalUrl } from '../lib/ipc';
import { Localized, translate } from '../lib/localization';
import { useDesktopStore } from '../lib/store';

const plugins = [remarkGfm];

function safeLink(value: string): string {
  if (value.startsWith('#')) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function codeText(children: ReactNode): string {
  return Children.toArray(children).map((child) => isValidElement<{ children?: ReactNode }>(child) ? codeText(child.props.children) : String(child ?? '')).join('');
}

function CodeBlock({ children, onError }: { children?: ReactNode; onError: (error: unknown) => void }) {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  const code = Children.toArray(children).find((child) => isValidElement(child));
  const language = isValidElement<{ className?: string }>(code) ? /language-([\w+-]+)/.exec(code.props.className ?? '')?.[1] : undefined;
  const copy = async () => {
    await navigator.clipboard.writeText(codeText(children).replace(/\n$/, ''));
    clearTimeout(reset.current); setCopied(true); reset.current = setTimeout(() => setCopied(false), 1800);
  };
  return <div className="markdown-code-block">
    <Localized><div className="markdown-code-heading"><span>{language ?? 'Código'}</span><button type="button" aria-label={copied ? 'Código copiado' : 'Copiar código'} onClick={() => { void copy().catch(onError); }}>{copied ? <Check size={13} /> : <Copy size={13} />}<span>{copied ? 'Copiado' : 'Copiar'}</span></button></div></Localized>
    <pre>{children}</pre>
  </div>;
}

export const ChatMarkdown = memo(function ChatMarkdown({ content, streaming = false, onLinkError }: { content: string; streaming?: boolean; onLinkError: (error: unknown) => void }) {
  const deferred = useDeferredValue(content);
  const language = useDesktopStore((state) => state.language);
  const tableLabel = translate('Tabla de la respuesta', language);
  const components = useMemo<Components>(() => ({
      a: ({ href, children }) => !href ? <span>{children}</span> : href.startsWith('#') ? <a href={href}>{children}</a> : <a href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); void openExternalUrl(href).catch(onLinkError); }}>{children}<ExternalLink size={11} aria-hidden="true" /></a>,
      img: ({ src, alt }) => src ? <a href={src} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); void openExternalUrl(src).catch(onLinkError); }}>{alt || 'Imagen'}<ExternalLink size={11} aria-hidden="true" /></a> : <span>{alt}</span>,
      pre: ({ children }) => <CodeBlock onError={onLinkError}>{children}</CodeBlock>,
      table: ({ children, ...props }) => { const { node: _node, ...attributes } = props; return <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label={tableLabel}><table {...attributes}>{children}</table></div>; },
    }), [onLinkError, tableLabel]);
  return <div className={`chat-markdown${streaming ? ' is-streaming' : ''}`} aria-busy={streaming}>
    <Markdown remarkPlugins={plugins} skipHtml urlTransform={safeLink} components={components}>{streaming ? deferred : content}</Markdown>
  </div>;
});
