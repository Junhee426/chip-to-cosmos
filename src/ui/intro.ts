import type { ScaleManager } from '../app/scale-manager';
import type { Store } from '../app/state';
import type { CameraRig } from '../graphics/camera';
import { easeInOutSine } from '../graphics/camera';
import * as THREE from 'three';
import { h } from './dom';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Skippable cinematic intro: Earth limb → satellite → cutaway → payload
 * (exploded) → PCB → package (exploded) → die → MOSFET channel formation.
 */
export class Intro {
  private el: HTMLElement;
  private caption: HTMLElement;
  private cancelled = false;
  running = false;

  constructor(parent: HTMLElement, private mgr: ScaleManager, private rig: CameraRig, private store: Store, private onDone: () => void) {
    this.el = h('div', 'intro');
    this.el.innerHTML = `<div class="letterbox top"></div><div class="letterbox bottom"></div><div class="intro-caption"></div><div class="intro-title"><div>FROM ELECTRONS</div><div>TO ORBITAL NETWORKS</div></div><button class="skip">SKIP ›</button>`;
    this.caption = this.el.querySelector('.intro-caption')!;
    this.el.querySelector('.skip')!.addEventListener('click', () => this.skip());
    parent.append(this.el);
  }

  private say(title: string, sub = ''): void {
    this.caption.classList.remove('show');
    void this.caption.offsetWidth;
    this.caption.innerHTML = `<div class="ic-title">${title}</div><div class="ic-sub">${sub}</div>`;
    this.caption.classList.add('show');
  }

  private async step(fn: () => Promise<void> | void): Promise<boolean> {
    if (this.cancelled) return false;
    await fn();
    return !this.cancelled;
  }

  async play(): Promise<void> {
    this.running = true;
    this.cancelled = false;
    this.el.classList.add('on');
    this.el.classList.remove('final');
    document.body.classList.add('intro-on');
    const s = this.store;
    s.set({ mode: 'structure', explode: 0, cutaway: true, selected: null });
    s.setParams({ vgs: 0.2, vds: 1.2 });
    const ok =
      (await this.step(async () => {
        await this.mgr.jumpTo('cosmos');
        const lvl = this.mgr.current!;
        lvl.active = false; // freeze orbital motion while framing the hero satellite
        this.rig.controls.minDistance = 0;
        const a = lvl.anchorFor('satellite')!;
        const up = a.position.clone().normalize();
        const tangent = new THREE.Vector3(1, 0, 0).applyQuaternion(a.quaternion!);
        // behind the satellite along-track, slightly above: the sunlit limb curves away below it
        this.rig.setView({ pos: a.position.clone().addScaledVector(up, 0.28).addScaledVector(tangent, -1.6), target: a.position.clone().addScaledVector(up, -0.05).addScaledVector(tangent, 0.4) });
        this.say('LOW EARTH ORBIT', '550 km · 7.6 km/s · one orbit every 95 minutes');
        await wait(2600);
      })) &&
      (await this.step(async () => {
        this.say('LEO BROADBAND SATELLITE', 'Phased arrays · regenerative payload · electric propulsion');
        await this.mgr.goTo('satellite', 3.6);
        await wait(700);
      })) &&
      (await this.step(async () => {
        this.say('CUTAWAY', 'Payload, avionics, power and propulsion inside the bus');
        const v = this.rig.currentView();
        await this.rig.flyTo({ pos: v.pos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5), target: v.target }, 2.2, easeInOutSine);
      })) &&
      (await this.step(async () => {
        this.say('COMMUNICATION PAYLOAD', 'Signal chain: RF front end → ADC → modem → beamformer → PA');
        await this.mgr.goTo('payload', 3.2);
        s.set({ explode: 0.85 });
        await wait(2600);
        s.set({ explode: 0 });
        await wait(900);
      })) &&
      (await this.step(async () => {
        this.say('RF / DIGITAL PCB', '10-layer board · microstrip RF · point-of-load power');
        await this.mgr.goTo('pcb', 3.0);
        await wait(1200);
      })) &&
      (await this.step(async () => {
        this.say('ADVANCED PACKAGE', 'Heat spreader · die · micro-bumps · interposer · substrate');
        await this.mgr.goTo('package', 3.0);
        s.set({ explode: 1 });
        await wait(2800);
        s.set({ explode: 0 });
        await wait(1200);
      })) &&
      (await this.step(async () => {
        this.say('SILICON DIE', 'RF transceivers · ADCs · DSP · beamformer · SRAM');
        await this.mgr.goTo('die', 3.0);
        await wait(1200);
      })) &&
      (await this.step(async () => {
        this.say('MOSFET', 'Gate voltage creates an inversion channel');
        await this.mgr.goTo('mosfet', 3.4);
        const t0 = performance.now();
        await new Promise<void>((res) => {
          const tick = () => {
            if (this.cancelled) return res();
            const t = Math.min(1, (performance.now() - t0) / 3200);
            s.setParams({ vgs: 0.2 + 1.6 * easeInOutSine(t) });
            if (t < 1) requestAnimationFrame(tick);
            else res();
          };
          tick();
        });
        this.say('CHANNEL FORMATION', 'Vgs > Vth → electrons flow from source to drain');
        await wait(1800);
      })) &&
      (await this.step(async () => {
        this.caption.classList.remove('show');
        this.el.classList.add('final');
        await wait(3600);
      }));
    if (ok) this.finish();
  }

  async skip(): Promise<void> {
    if (!this.running) return;
    this.cancelled = true;
    this.rig.finishFlight(); // complete the running scale step so renormalisation stays consistent
    while (this.mgr.isBusy) await wait(30);
    this.store.set({ explode: 0 });
    this.store.setParams({ vgs: 1.6 });
    await this.mgr.jumpTo('satellite');
    this.finish();
  }

  private finish(): void {
    this.running = false;
    this.el.classList.remove('on', 'final');
    document.body.classList.remove('intro-on');
    this.onDone();
  }
}
