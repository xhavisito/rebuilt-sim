/** Piezas comunes de las pantallas (sistema "pit console"): barra de la marca, botón de regreso
 *  e íconos de línea propios (24×24) en lugar de emojis, que se ven distinto en cada sistema. */
import { t } from './i18n';

const svg = (d: string, cls = 'ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ic = {
  back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  skip: svg('<path d="M5 5.5v13l9-6.5zM18 5.5v13"/>'),
  skipAll: svg('<path d="M3 5.5v13l8-6.5zM12 5.5v13l8-6.5zM21 5.5v13"/>'),
  pause: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  check: svg('<path d="m4.5 12.5 5 5 10-11"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  reset: svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v5h5"/>'),
  download: svg('<path d="M12 3.5v12M7 11l5 5 5-5M4.5 20.5h15"/>'),
  upload: svg('<path d="M12 16.5v-12M7 9l5-5 5 5M4.5 20.5h15"/>'),
  globe: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5z"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  star: svg('<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>'),
  flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  touch: svg('<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11M12 10.5V9a1.5 1.5 0 0 1 3 0v2M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.9-2.5L4.3 15a1.5 1.5 0 0 1 2.4-1.8L9 15.5"/>'),
  gamepad: svg('<path d="M7 7h10a5 5 0 0 1 4.9 6l-.8 3.6a2.3 2.3 0 0 1-4 1L15 16H9l-2.1 1.6a2.3 2.3 0 0 1-4-1L2.1 13A5 5 0 0 1 7 7z"/><path d="M7.5 10.5v3M6 12h3M15.5 11h.01M17.5 13h.01"/>'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M7.5 14.5h9"/>'),
  vibrate: svg('<rect x="8" y="4" width="8" height="16" rx="1.5"/><path d="M4.5 8v8M2 10v4M19.5 8v8M22 10v4"/>'),
  ruler: svg('<path d="M3 16.5 16.5 3 21 7.5 7.5 21z"/><path d="m7 12.5 2 2M10 9.5l1.5 1.5M13 6.5l2 2"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>'),
  tv: svg('<rect x="2.5" y="5.5" width="19" height="13" rx="1.5"/><path d="M8 21.5h8M9 2.5l3 3 3-3"/>'),
  field: svg('<rect x="2.5" y="5" width="19" height="14" rx="1"/><path d="M12 5v14M2.5 9.5h3v5h-3M21.5 9.5h-3v5h3"/>'),
  pen: svg('<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/>'),
  target: svg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>'),
  expand: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  clipboard: svg('<rect x="5" y="4.5" width="14" height="17" rx="1.5"/><path d="M9 3h6v3H9zM8.5 11h7M8.5 15h5"/>'),
};

/** Barra superior con la marca; `right` = botones a la derecha (p. ej. `backBtn()`). */
export function brandbar(ctx = '', right = ''): string {
  return `<div class="brandbar"><div class="brand"><i class="logo" aria-hidden="true"></i>REBUILT<span>SIM</span></div>${ctx ? `<div class="ctx">${ctx}</div>` : ''}<div class="grow"></div>${right}</div>`;
}

/** Botón "Regresar" de la barra superior; `attrs` = atributos data-* que espera cada pantalla. */
export function backBtn(attrs = 'data-back'): string {
  return `<button class="btn backbtn" ${attrs}>${ic.back}<span>${t('back')}</span></button>`;
}
