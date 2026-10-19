/** Helpers de formularios para las pantallas (HTML + enlace de eventos). */

export interface Opt {
  value: string;
  label: string;
  cls?: string;
}

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Botones segmentados (como radio). */
export function seg(name: string, opts: Opt[], current: string): string {
  return `<div class="seg" data-seg="${name}">${opts
    .map((o) => `<button type="button" data-v="${esc(o.value)}" class="${o.cls ?? ''} ${o.value === current ? 'on' : ''}">${esc(o.label)}</button>`)
    .join('')}</div>`;
}

export function select(name: string, opts: Opt[], current: string): string {
  return `<select data-sel="${name}">${opts
    .map((o) => `<option value="${esc(o.value)}" ${o.value === current ? 'selected' : ''}>${esc(o.label)}</option>`)
    .join('')}</select>`;
}

export function range(name: string, min: number, max: number, step: number, value: number, suffix = ''): string {
  return `<div class="row"><input type="range" data-range="${name}" min="${min}" max="${max}" step="${step}" value="${value}" style="flex:1"/><span data-out="${name}" style="min-width:52px;text-align:right">${value}${suffix}</span></div>`;
}

export function num(name: string, value: number, step = 1, min?: number, max?: number): string {
  return `<input type="number" data-num="${name}" value="${value}" step="${step}" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} style="width:110px"/>`;
}

/** Enlaza los controles de un contenedor; `on(name, value)` recibe el valor como string/number. */
export function bind(root: HTMLElement, on: (name: string, value: string | number) => void): void {
  root.querySelectorAll<HTMLElement>('[data-seg]').forEach((g) => {
    g.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        g.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        on(g.dataset.seg!, b.dataset.v!);
      }),
    );
  });
  root.querySelectorAll<HTMLSelectElement>('[data-sel]').forEach((s) => s.addEventListener('change', () => on(s.dataset.sel!, s.value)));
  root.querySelectorAll<HTMLInputElement>('[data-range]').forEach((r) =>
    r.addEventListener('input', () => {
      const out = root.querySelector<HTMLElement>(`[data-out="${r.dataset.range}"]`);
      const suffix = out?.textContent?.replace(/^[-\d.]+/, '') ?? '';
      if (out) out.textContent = `${r.value}${suffix}`;
      on(r.dataset.range!, Number(r.value));
    }),
  );
  root.querySelectorAll<HTMLInputElement>('[data-num]').forEach((n) =>
    n.addEventListener('change', () => {
      const v = Number(n.value);
      if (Number.isFinite(v)) on(n.dataset.num!, v);
    }),
  );
}
