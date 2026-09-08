import type { CSSProperties, ReactNode } from 'react'

export type IconName = 'home' | 'export' | 'flip' | 'photo' | 'controls' | 'image' | 'share' | 'install' | 'layout' | 'style' | 'arrow' | 'check' | 'close' | 'camera' | 'plus'

/** A single, 24px line-icon family for the entire studio. */
export function ActionIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m4 11 8-7 8 7" /><path d="M6.5 10v10h11V10M10 20v-6h4v6" /></>,
    export: <><path d="M12 3v12m-4.5-7.5L12 3l4.5 4.5M5 13v6h14v-6" /></>,
    flip: <><path d="M4.5 8.5A8 8 0 0 1 18 6V3m0 3.5h-3.5M19.5 15.5A8 8 0 0 1 6 18v3m0-3.5h3.5" /></>,
    photo: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4 17 4.7-4.6 3.3 3 2.4-2.2L20 18" /></>,
    controls: <><path d="M4 7h10m4 0h2M4 17h2m4 0h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m4 17 5-5 3.5 3.5 2-2L20 19" /><circle cx="16.5" cy="8.5" r="1.5" /></>,
    share: <><path d="M12 4v11m-4-7 4-4 4 4M5 13v6h14v-6" /></>,
    install: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M10 17h4M12 7v6m-2.5-2.5L12 13l2.5-2.5" /></>,
    layout: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 12h18M12 12v9" /></>,
    style: <><path d="m5 16 11-11a2.1 2.1 0 0 1 3 3L8 19H5v-3ZM13.5 7.5l3 3M4 22h16" /></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    camera: <><path d="M8 6 9.5 3h5L16 6h4v14H4V6h4Z" /><circle cx="12" cy="12" r="3.5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
  }
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>
}

export function ToolIcon({ name }: { name: 'undo' | 'redo' | 'replace' | 'fit' | 'reset' | 'remove' }) {
  const paths = {
    undo: <path d="m9 7-4.5 4L9 15M5 11h7.5a6 6 0 0 1 6 6" />,
    redo: <path d="m9 7-4.5 4L9 15M5 11h7.5a6 6 0 0 1 6 6" />,
    replace: <><rect x="3.5" y="4.5" width="13" height="13" rx="2" /><path d="m5.5 15 3.5-4 2.5 2.5 2-2 3 3M15 7h5.5L18 4.5M20.5 7 18 9.5" /></>,
    fit: <><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /><rect x="8" y="8" width="8" height="8" rx="1" /></>,
    reset: <path d="M6.4 7.2A7 7 0 1 1 5 14M6.5 3.5v4.3h4.3" />,
    remove: <path d="M5 7h14M9 7V4.5h6V7m-8 0 .8 12h8.4L17 7M10 10v6M14 10v6" />,
  }
  return <svg className={`action-icon ${name === 'redo' ? 'is-mirrored' : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`brand ${compact ? 'brand-compact' : ''}`}>
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 3h26v26H3zM3 15h26M16 15v14" /><path className="brand-mark-fill" d="M5 5h22v8H5z" /></svg>
    <span>instacomic<span className="brand-period">.</span></span>
  </span>
}

export function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="settings-section">
    <div className="settings-section-heading"><h3>{title}</h3><p>{description}</p></div>
    <div className="settings-section-body">{children}</div>
  </section>
}

export function RangeField({ label, value, min, max, step = 1, unit, ariaLabel, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; ariaLabel?: string; onChange: (value: number) => void
}) {
  return <label className="range-field">
    <span><strong>{label}</strong><output aria-hidden="true">{`${step < 1 ? value.toFixed(1) : value}${unit}`}</output></span>
    <input aria-label={ariaLabel ?? label} type="range" min={min} max={max} step={step} value={value} aria-valuetext={`${value}${unit}`}
      style={{ '--range-progress': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      onChange={(event) => onChange(Number(event.target.value))} />
  </label>
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="color-field"><span>{label}</span><span className="color-field-control">
    <input aria-label={label} type="color" value={value} onChange={(event) => onChange(event.target.value)} />
    <output aria-hidden="true">{value.toUpperCase()}</output>
  </span></label>
}
