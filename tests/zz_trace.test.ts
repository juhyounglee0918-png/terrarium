import { it } from 'vitest';
import { defaultConfig } from '../src/sim/config';
import { readout } from '../src/sim/diagnostics';
import { balance } from '../src/sim/ledger';
import { createState, step } from '../src/sim/model';
import { mossCarbon, mossCoverFraction } from '../src/sim/bio/moss';
import { leafArea } from '../src/sim/bio/plants';
import { population } from '../src/sim/bio/fauna';
it('trace', () => {
  const c = defaultConfig();
  const s = createState(c);
  const w = (x: string) => process.stderr.write(x + '\n');
  const t0 = performance.now();
  for (let d = 0; d < 60; d++) {
    let minC = 1e9, maxC = 0;
    for (let i = 0; i < 1440; i++) { step(s); const r = readout(s); minC = Math.min(minC, r.co2ppm); maxC = Math.max(maxC, r.co2ppm); }
    if (d % 5 === 0 || d < 3) {
      const r = readout(s); const top = s.soil[2]; const vol = top.thickness * Math.PI * 0.12 ** 2;
      const b = balance(s);
      w(`d${d} CO2 ${minC.toFixed(0)}-${maxC.toFixed(0)} RH ${(r.rh*100).toFixed(0)} T ${r.airT.toFixed(1)} θ ${top.theta.toFixed(2)} | plants ${s.plants.map(p => `${p.species.slice(0,4)}:LA${(leafArea(p)*1e4).toFixed(0)}cm² h${p.health.toFixed(2)} w${p.water.toFixed(2)} N${(p.N/ (p.leafC/20+p.stemC/50+p.rootC/40)).toFixed(2)}`).join(' ')}`);
      w(`   moss C ${(mossCarbon(s)*1e3).toFixed(2)}g cov ${mossCoverFraction(s).toFixed(2)} | bact ${(top.bact/vol).toFixed(3)} fung ${(top.fung/vol).toFixed(3)} prot ${(top.protist/vol).toFixed(4)} met ${(top.metC/vol).toFixed(2)} str ${(top.strC/vol).toFixed(2)} nh4 ${(top.nh4/vol*1000).toFixed(1)} no3 ${(top.no3/vol*1000).toFixed(1)} g/m³ | litter ${((s.litter.metC+s.litter.strC)*1e3).toFixed(2)}g mould ${Math.max(...s.surface.mould).toFixed(2)} redox ${s.soil.map(l=>l.redox).join('')} | folsomia ${population(s,'folsomia').toFixed(0)} trich ${population(s,'trichorhina').toFixed(0)} nemB ${(top.nemB/vol*1e3).toFixed(2)} | err W ${b.water.error.toExponential(1)} C ${b.carbon.error.toExponential(1)} N ${b.nitrogen.error.toExponential(1)}`);
    }
  }
  w(`time ${(performance.now()-t0).toFixed(0)} ms`);
}, 300000);
