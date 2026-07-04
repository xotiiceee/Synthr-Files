const { spawn } = require('child_process');
const { writeFileSync, appendFileSync, existsSync, unlinkSync } = require('fs');
const { join } = require('path');

const SCRATCH = process.env.SCRATCH || 'C:\\\\Users\\\\Josh\\\\AppData\\\\Local\\\\Temp\\\\grok-goal-c12cf48a1191\\\\implementer';
const heartJson = join(process.cwd(), 'data', 'pulse-heart.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function one(i) {
  if (existsSync(heartJson)) { try { unlinkSync(heartJson); } catch(e){} }
  const logf = join(SCRATCH, 'server-launch-' + i + '.log');
  writeFileSync(logf, '=== LIVE SERVER LAUNCH ' + i + ' (soma-heart NOT USED) ===\n');

  const p = spawn('npx', ['tsx', 'hosted/server.ts'], { env: process.env, stdio: ['ignore','pipe','pipe'], shell: true });
  let out = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => out += d);

  await sleep(6200);

  const lines = out.split('\n').filter(l => /Listening on|Scheduler/.test(l)).slice(0,5).join('\n');
  appendFileSync(logf, 'LISTENING LOG SNIPPET:\n' + lines + '\n');

  try {
    const pay = Buffer.from(JSON.stringify({p:'paid'})).toString('base64');
    const res = await fetch('http://localhost:3457/v1/pulse/intel/research', {
      method:'POST',
      headers:{'content-type':'application/json', 'X-Payment':pay},
      body: JSON.stringify({query:'final clean ' + i, brandId:'tenant-verif-42'})
    });
    const b = await res.text();
    appendFileSync(logf, 'RAW RESPONSE BODY:\n' + b + '\n');
    appendFileSync(join(SCRATCH, 'server-launch-hit.log'), 'LAUNCH' + i + ' RAW BODY: ' + b + '\n');
  } catch(e) {
    appendFileSync(logf, 'FETCH ERR: ' + (e.message || e) + '\n');
  }
  p.kill();
  await sleep(700);
}

one(1).then(()=>one(2)).then(()=>console.log('CLEAN LAUNCHES COMPLETE'));
