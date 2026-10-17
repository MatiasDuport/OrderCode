import type { ButtonHTMLAttributes, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { useDesktopStore } from '../lib/store';
import { Localized } from '../lib/localization';
import orderCodeMark from '../../../../brand/LogoSinFondo.png';
import orderCodeWordmark from '../../../../brand/TextLogoSinFondo.png';

export function IconButton({ icon: Icon, label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}><Icon size={16} strokeWidth={1.8} /></button>;
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-lockup ${compact ? 'brand-lockup--compact' : 'brand-lockup--full'}`} role="img" aria-label="OrderCode">
    <picture className="brand-lockup-picture">
      <source media="(max-width: 540px)" srcSet={orderCodeMark} />
      <img className="brand-lockup-image" src={compact ? orderCodeMark : orderCodeWordmark} alt="" draggable={false} />
    </picture>
  </span>;
}

export function StatusDot({ color = 'green', pulse = false }: { color?: 'green' | 'blue' | 'violet' | 'red' | 'muted'; pulse?: boolean }) {
  return <span className={`status-dot status-dot--${color} ${pulse ? 'status-dot--pulse' : ''}`} aria-hidden="true" />;
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd>{children}</kbd>; }

function DropdownPopover({ id, label, children, anchor, menuRef }: { id: string; label: string; children: ReactNode; anchor: RefObject<HTMLButtonElement | null>; menuRef: RefObject<HTMLDivElement | null> }) {
  const present = useIsPresent();
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = useDesktopStore((state) => state.reducedMotion) || systemReducedMotion;
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const control = anchor.current;
    if (!menu || !control) return;
    const place = () => {
      const margin = 12, gap = 8;
      const rect = control.getBoundingClientRect();
      const composer = control.closest('.composer')?.getBoundingClientRect();
      const compact = window.innerWidth <= 620 && !!composer;
      menu.style.width = compact ? `${Math.min(composer.width, window.innerWidth - margin * 2)}px` : '';
      menu.style.maxWidth = `${Math.min(380, window.innerWidth - margin * 2)}px`;
      const above = Math.max(0, rect.top - margin - gap);
      const below = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
      menu.style.maxHeight = `${Math.max(64, Math.min(420, Math.max(above, below)))}px`;
      const width = menu.offsetWidth, height = menu.offsetHeight;
      const left = compact ? composer.x : rect.right - width;
      const opensAbove = above >= height || above >= below;
      const top = opensAbove ? rect.top - gap - height : rect.bottom + gap;
      menu.style.setProperty('--menu-origin', opensAbove ? 'bottom left' : 'top left');
      menu.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - width - margin))}px`;
      menu.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, menuRef]);
  return createPortal(<Localized><motion.div ref={menuRef} id={id} className="dropdown-menu" role="listbox" aria-label={label} aria-hidden={!present} inert={!present ? true : undefined}
    initial={reducedMotion ? false : { opacity: 0, y: 9, scale: .97, rotateX: -7 }} animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
    exit={{ opacity: 0, y: reducedMotion ? 0 : 5, scale: reducedMotion ? 1 : .98 }}
    transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 33, opacity: { duration: .14 } }}
    style={{ position: 'fixed', bottom: 'auto', right: 'auto', zIndex: 35, transformOrigin: 'var(--menu-origin, bottom left)', transformPerspective: 800 }}>{children}</motion.div></Localized>, document.body);
}

export function Dropdown({ label, value, open, onOpenChange, children, className = '' }: { label: string; value: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusOption = useRef<'first' | 'last' | null>(null);
  const openedByHover = useRef(false);
  const id = useId();
  const clearTimer = () => { clearTimeout(timer.current); timer.current = undefined; };
  const contains = useCallback((target: EventTarget | null) => target instanceof Node && (!!root.current?.contains(target) || !!menu.current?.contains(target)), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    if (focusOption.current) {
      const options = menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)');
      const index = focusOption.current === 'last' ? (options?.length ?? 1) - 1 : 0;
      focusOption.current = null;
      options?.[index]?.focus();
    }
    const dismiss = (event: PointerEvent) => { if (!contains(event.target)) onOpenChange(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, onOpenChange, contains]);
  return <Localized><div ref={root} className={`dropdown ${className}`} onPointerEnter={(event) => {
    clearTimer();
    if (event.pointerType === 'mouse' && !open) timer.current = setTimeout(() => { openedByHover.current = true; onOpenChange(true); }, 120);
  }} onPointerLeave={(event) => {
    clearTimer();
    if (event.pointerType === 'mouse' && (!contains(document.activeElement) || (openedByHover.current && document.activeElement === trigger.current))) timer.current = setTimeout(() => onOpenChange(false), 180);
  }} onFocusCapture={clearTimer} onClickCapture={(event) => {
    if ((event.target as HTMLElement).closest('[role="option"]:not(:disabled)')) trigger.current?.focus();
  }} onBlur={(event) => { if (!contains(event.relatedTarget)) { clearTimer(); onOpenChange(false); } }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clearTimer(); onOpenChange(false); trigger.current?.focus(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault(); clearTimer();
    if (!open) { focusOption.current = event.key === 'ArrowUp' ? 'last' : 'first'; onOpenChange(true); return; }
    const options = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])];
    if (!options.length) return;
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    options[index < 0 ? (event.key === 'ArrowUp' ? options.length - 1 : 0) : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length]?.focus();
  }}>
    <button ref={trigger} type="button" className="dropdown-trigger" aria-haspopup="listbox" aria-controls={open ? id : undefined} aria-expanded={open} onClick={() => {
      clearTimer();
      if (openedByHover.current && open) { openedByHover.current = false; return; }
      openedByHover.current = false; onOpenChange(!open);
    }}>
      <span className="dropdown-label">{label}</span><span className="dropdown-value">{value}</span><ChevronDown className="dropdown-caret" size={13} />
    </button>
    <AnimatePresence>{open && <DropdownPopover id={id} label={label} anchor={trigger} menuRef={menu}>{children}</DropdownPopover>}</AnimatePresence>
  </div></Localized>;
}

export function DropdownOption({ active, onClick, children, description, disabled = false }: { active?: boolean; onClick: () => void; children: ReactNode; description?: string; disabled?: boolean }) {
  return <button type="button" role="option" aria-selected={active} disabled={disabled} className={`dropdown-option ${active ? 'is-active' : ''}`} onClick={onClick}>
    <span><strong>{children}</strong>{description && <small>{description}</small>}</span>{active && <Check className="option-check" size={14} />}
  </button>;
}

export function PanelTitle({ icon: Icon, title, action }: { icon?: LucideIcon; title: string; action?: ReactNode }) {
  return <div className="panel-title">{Icon && <Icon size={14} strokeWidth={1.7} />}<span>{title}</span><span className="panel-title-spacer" />{action}</div>;
}

export function Divider() { return <div className="divider" aria-hidden="true" />; }
