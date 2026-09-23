import { it } from 'vitest';
import { defaultConfig } from '../src/sim/config';
import { readout } from '../src/sim/diagnostics';
import { balance } from '../src/sim/ledger';
import { createState, step, type SimState } from '../src/sim/model';
import { pourWater } from '../src/sim/actions';
import { mossCarbon, mossCoverFraction } from '../src/sim/bio/moss';
import { population } from '../src/sim/bio/fauna';
const w = (x: string) => process.stderr.write(x + '\n');
function summary(tag: string, s: SimState) {
  const r = readout(s); const top = s.soil[s.soil.length-1]; const vol = top.thickness * Math.PI * 0.12 ** 2; const b = balance(s);
  w(`${tag} d${r.day} T${r.airT.toFixed(1)} RH${(r.rh*100).toFixed(0)} CO2 ${r.co2ppm.toFixed(0)} θ ${s.soil.map(l=>l.theta.toFixed(2)).join('/')} redox ${s.soil.map(l=>l.redox).join('')} aer ${s.soil.map(l=>l.aerobic.toFixed(2)).join('/')}`);
  w(`   plants ${s.plants.map(p=>`${p.species.slice(0,4)} h${p.health.toFixed(2)} w${p.water.toFixed(2)} rot${p.rootDamage.toFixed(2)} wilt${p.wilt.toFixed(2)}`).join(' | ')}`);
  w(`   moss ${(mossCarbon(s)*1e3).toFixed(2)}g cov ${mossCoverFraction(s).toFixed(2)} hp ${(s.surface.moss.health.filter((_,i)=>s.surface.moss.species[i]).reduce((a,b)=>a+b,0)/Math.max(1,s.surface.moss.species.filter(Boolean).length)).toFixed(2)} | bact ${(top.bact/vol).toFixed(3)} fung ${(top.fung/vol).toFixed(3)} pyth ${(s.soil.reduce((a,l)=>a+l.pythium,0)*1e6).toFixed(2)}mg | fols ${population(s,'folsomia').toFixed(0)} gnat ${population(s,'bradysia').toFixed(0)} | algae ${(s.glassAlgae.reduce((a,b)=>a+b,0)*1e6).toFixed(1)}mg | ch4 ${(s.air.ch4/s.air.moles*1e6).toFixed(1)}ppm | err ${b.water.error.toExponential(0)} ${b.carbon.error.toExponential(0)} ${b.nitrogen.error.toExponential(0)} | ev ${s.events.slice(-3).map(e=>e.text).join('; ')}`);
}
function run(s: SimState, days: number) { for (let i = 0; i < days * 1440; i++) step(s); }
it('scenarios', () => {
  { const s = createState(defaultConfig()); run(s, 20); summary('base', s); }
  { const s = createState(defaultConfig()); pourWater(s, 1.2); run(s, 25); summary('flood', s); }
  { const c = defaultConfig(); c.lid = 'open'; const s = createState(c); run(s, 25); summary('open', s); }
  { const c = defaultConfig(); c.lighting.placement = 'windowsill'; c.startDayOfYear = 190; const s = createState(c); run(s, 15); summary('sill', s); }
  { const c = defaultConfig(); c.lighting.placement = 'room'; const s = createState(c); run(s, 40); summary('dark', s); }
}, 600000);
