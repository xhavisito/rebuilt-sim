/**
 * Galería de robots de la comunidad (src/net/robotHub.ts): robots que publicó cualquiera, con su
 * CAD. Vista previa 3D, descargar a "mis robots", reportar y borrar los propios. Las miniaturas
 * se dibujan al aparecer en pantalla (cada una baja su GLB).
 */
import { communityEnabled } from '../config/community';
import { loadCustomRobots, saveCustomRobots } from '../config/robots';
import { countHubDownload, deleteHubRobot, listHubRobots, myHubTokens, reportHubRobot, type HubRobot } from '../net/robotHub';
import { ensureCustomCads, storeHubCad } from '../render/customCad';
import type { Showroom } from '../render/Showroom';
import { esc } from './forms';
import { t } from './i18n';
import { backBtn, brandbar, ic } from './chrome';

export class CommunityScreen {
  private list: HubRobot[] = [];
  private current: HubRobot | null = null;
  private query = '';
  private observer: IntersectionObserver | null = null;
  private reported = new Set<string>();

  constructor(
    private root: HTMLElement,
    private showroom: Showroom,
    private onBack: () => void,
    /** Robot descargado: abre el taller con él. */
    private onOpen: (id: string) => void,
  ) {}

  open(): void {
    this.current = null;
    this.render();
    if (communityEnabled()) void this.load();
  }

  private async load(): Promise<void> {
    const grid = this.root.querySelector<HTMLElement>('[data-grid]');
    try {
      this.list = await listHubRobots();
      if (!this.list.some((r) => r.id === this.current?.id)) this.current = this.list[0] ?? null;
      this.render();
    } catch (e) {
      if (grid) grid.innerHTML = `<div class="msg bad">${esc(t('hub_loadErr', { err: String((e as Error).message ?? e).slice(0, 160) }))}</div>`;
    }
  }

  private render(): void {
    this.observer?.disconnect();
    const enabled = communityEnabled();
    const mine = myHubTokens();
    const c = this.current;
    const q = this.query.trim().toLowerCase();
    const shown = this.list.filter((r) => !q || `${r.team} ${r.name} ${r.author}`.toLowerCase().includes(q));
    const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('hub_title'), backBtn('data-back'))}
      <h1>${t('hub_title')}</h1>
      <div class="split">
        <div class="panel editprev" style="display:flex;flex-direction:column;gap:10px">
          <div class="preview" data-preview style="height:300px"></div>
          ${
            c
              ? `<div class="rc-head" style="padding:0"><span class="rc-num">${c.team}</span><span class="rc-name"><b>${esc(c.name)}</b><small>${esc(c.author || t('hub_anon'))} · ${new Date(c.createdAt).toLocaleDateString()}</small></span></div>
                 <div class="msg">${c.spec.customCad ? `CAD ${mb(c.cadBytes)} MB` : t('hub_noCad')} · ${c.spec.maxSpeed} m/s · INTAKE ${c.spec.intake.rate} FUEL/s · SHOOTER ${c.spec.shooter.rate} FUEL/s · ${t('hopper')} ${c.spec.hopperCapacity} · ${c.spec.climb.maxLevel ? `L${c.spec.climb.maxLevel}` : '—'} · ⬇ ${c.downloads}</div>
                 <div class="row">
                   <button class="chipbtn on" data-get>${ic.download}${t('hub_download')}</button>
                   ${mine[c.id] ? `<button class="chipbtn" data-del>${t('delete')}</button>` : `<button class="chipbtn" data-report ${this.reported.has(c.id) ? 'disabled' : ''}>⚑ ${t('hub_report')}</button>`}
                 </div>
                 <div data-msg></div>`
              : ''
          }
        </div>
        <div class="panel" style="display:flex;flex-direction:column;gap:10px">
          ${
            enabled
              ? `<div class="row"><input type="search" class="pk-search" data-search placeholder="${t('pk_search')}" value="${esc(this.query)}" style="flex:1"/><button class="chipbtn" data-reload>↻</button></div>
                 <div class="msg">${t('hub_hint')}</div>
                 <div class="rgrid" data-grid>${
                   this.list.length
                     ? shown
                         .map(
                           (r) => `<button class="rcard ${r.id === c?.id ? 'sel' : ''}" data-id="${r.id}">
                       <div class="thumb loading"><img alt="" data-thumb="${r.id}"/>${mine[r.id] ? `<span class="rc-badge gold">${t('hub_mine')}</span>` : ''}</div>
                       <div class="rc-head"><span class="rc-num">${r.team}</span><span class="rc-name"><b>${esc(r.name)}</b><small>${esc(r.author || t('hub_anon'))}</small></span></div>
                     </button>`,
                         )
                         .join('') || `<div class="msg warn">${t('pk_none')}</div>`
                     : `<div class="msg">${t('hub_empty')}</div>`
                 }</div>`
              : `<div class="msg warn">${t('hub_disabled')}</div>`
          }
        </div>
      </div></div>`;
    const r = this.root;
    this.showroom.mount(r.querySelector<HTMLElement>('[data-preview]')!, 2.6);
    if (c) void ensureCustomCads([c.spec], 20000).then(() => this.current === c && this.showroom.setRobot(c.spec, 'blue'));
    r.querySelector('[data-back]')!.addEventListener('click', () => this.onBack());
    r.querySelector('[data-reload]')?.addEventListener('click', () => void this.load());
    const search = r.querySelector<HTMLInputElement>('[data-search]');
    search?.addEventListener('input', () => {
      this.query = search.value;
      const qq = this.query.trim().toLowerCase();
      r.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => {
        const h = this.list.find((x) => x.id === el.dataset.id)!;
        el.hidden = !!qq && !`${h.team} ${h.name} ${h.author}`.toLowerCase().includes(qq);
      });
    });
    r.querySelectorAll<HTMLElement>('[data-id]').forEach((el) =>
      el.addEventListener('click', () => {
        this.current = this.list.find((x) => x.id === el.dataset.id) ?? null;
        this.render();
      }),
    );
    r.querySelector('[data-get]')?.addEventListener('click', () => void this.download());
    r.querySelector('[data-report]')?.addEventListener('click', () => {
      if (!c) return;
      this.reported.add(c.id);
      void reportHubRobot(c.id).catch(() => undefined);
      this.say('ok', t('hub_reported'));
      r.querySelector<HTMLButtonElement>('[data-report]')!.disabled = true;
    });
    r.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!c) return;
      const ok = await deleteHubRobot(c.id).catch(() => false);
      if (!ok) return this.say('bad', t('hub_deleteErr'));
      this.list = this.list.filter((x) => x.id !== c.id);
      this.current = this.list[0] ?? null;
      this.render();
    });
    this.lazyThumbs();
  }

  private say(cls: 'ok' | 'bad' | '', text: string): void {
    const el = this.root.querySelector<HTMLElement>('[data-msg]');
    if (el) el.innerHTML = `<div class="msg ${cls}">${esc(text)}</div>`;
  }

  /** Miniaturas al entrar en pantalla, una a la vez (cada una baja su CAD). */
  private lazyThumbs(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    let chain = Promise.resolve();
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        this.observer?.unobserve(e.target);
        const img = e.target as HTMLImageElement;
        const h = this.list.find((x) => x.id === img.dataset.thumb);
        if (!h) continue;
        chain = chain.then(async () => {
          await ensureCustomCads([h.spec], 20000);
          const url = await this.showroom.snapshot(h.spec, 'blue').catch(() => '');
          if (!img.isConnected) return;
          if (url) img.src = url;
          img.parentElement?.classList.remove('loading');
        });
      }
    });
    this.root.querySelectorAll<HTMLImageElement>('img[data-thumb]').forEach((img) => this.observer!.observe(img));
  }

  private async download(): Promise<void> {
    const c = this.current;
    if (!c) return;
    this.say('', t('cadLoading'));
    const spec = structuredClone(c.spec);
    if (spec.customCad) {
      const ok = await storeHubCad(spec.customCad);
      if (!ok) return this.say('bad', t('hub_downloadErr'));
    }
    saveCustomRobots([...loadCustomRobots().filter((x) => x.id !== spec.id), spec]);
    void countHubDownload(c.id);
    this.onOpen(spec.id);
  }
}
