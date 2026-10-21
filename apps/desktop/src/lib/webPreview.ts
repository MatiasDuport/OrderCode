import { useDesktopStore } from './store';

export function normalizeVisualizerUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096 || /\s/.test(trimmed)) return undefined;
  const local = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(trimmed);
  const candidate = local ? `http://${trimmed}` : /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    const loopback = ['localhost', '[::1]', '::1'].includes(url.hostname) || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function openWebPreview(value: string) {
  const url = normalizeVisualizerUrl(value);
  if (!url) return;
  const state = useDesktopStore.getState();
  useDesktopStore.setState({ currentView: 'Workspace', sidebarOpen: false, reviewOpen: false, previewOpen: true,
    previewRequest: { url, id: crypto.randomUUID(), projectPath: state.session?.projectPath } });
}

export function conversationUrls(texts: string[]): string[] {
  const urls = texts.slice(-12).reverse().flatMap((text) => [...text.matchAll(/https?:\/\/[^\s<>"`]+/g)].map(([match]) => normalizeVisualizerUrl(match.replace(/[.,;!?)\]}]+$/, ''))));
  return [...new Set(urls.filter((url): url is string => Boolean(url)))].slice(0, 3);
}
