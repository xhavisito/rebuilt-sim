/**
 * Una conexión WebRTC con otro jugador: un DataChannel confiable y ordenado ("game") por el que
 * van los controles, los eventos y el estado del campo. El cliente crea la oferta; el host responde.
 */
import { iceServers } from '../config/net';
import type { SignalMessage, Signaling } from './signaling';

export type LinkData = string | ArrayBuffer;

export class PeerLink {
  readonly pc: RTCPeerConnection;
  private ch: RTCDataChannel | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private closed = false;
  onOpen: () => void = () => {};
  onData: (d: LinkData) => void = () => {};
  onClose: () => void = () => {};

  constructor(
    private sig: Signaling,
    readonly remoteId: string,
    initiator: boolean,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.sig.send(remoteId, { kind: 'ice', data: e.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed') this.close();
    };
    if (initiator) {
      this.attach(this.pc.createDataChannel('game', { ordered: true }));
      void this.pc
        .createOffer()
        .then((o) => this.pc.setLocalDescription(o))
        .then(() => this.sig.send(remoteId, { kind: 'offer', data: this.pc.localDescription?.toJSON() }));
    } else this.pc.ondatachannel = (e) => this.attach(e.channel);
  }

  private attach(ch: RTCDataChannel): void {
    this.ch = ch;
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => this.onOpen();
    ch.onmessage = (e) => this.onData(e.data as LinkData);
    ch.onclose = () => this.close();
  }

  /** Mensaje de señalización de este par. */
  async handleSignal(msg: SignalMessage): Promise<void> {
    if (this.closed) return;
    if (msg.kind === 'offer' || msg.kind === 'answer') {
      await this.pc.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
      for (const c of this.pendingIce.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
      if (msg.kind === 'offer') {
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        this.sig.send(this.remoteId, { kind: 'answer', data: this.pc.localDescription?.toJSON() });
      }
    } else if (msg.kind === 'ice') {
      const c = msg.data as RTCIceCandidateInit;
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(c).catch(() => {});
      else this.pendingIce.push(c);
    } else if (msg.kind === 'bye') this.close();
  }

  get open(): boolean {
    return this.ch?.readyState === 'open';
  }

  /** Bytes en cola sin enviar (para no saturar una conexión lenta). */
  get buffered(): number {
    return this.ch?.bufferedAmount ?? 0;
  }

  send(d: LinkData): void {
    if (!this.open) return;
    try {
      if (typeof d === 'string') this.ch!.send(d);
      else this.ch!.send(d as ArrayBuffer);
    } catch {
      this.close();
    }
  }

  sendJson(o: unknown): void {
    this.send(JSON.stringify(o));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ch?.close();
      this.pc.close();
    } catch {
      /* ya cerrada */
    }
    this.onClose();
  }
}
