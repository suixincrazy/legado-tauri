import type { CSSProperties } from 'react';

export function LegadoIcon({ name, size = 24 }: { name: string; size?: number }) {
  return <span aria-hidden="true" className="legado-icon" style={{ '--icon': `url('/legado/${name}.svg')`, width: size, height: size } as CSSProperties} />;
}
