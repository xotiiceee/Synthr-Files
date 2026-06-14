/**
 * Emergency stop — immediately pauses all Pulse activity.
 * Usage: npm run stop
 */
import { saveState, loadState } from '../src/core/state.js';

interface ControlState { paused: boolean; pausedAt: string; pausedReason: string }

const state = loadState<ControlState>('pulse-control', { paused: false, pausedAt: '', pausedReason: '' });
state.paused = true;
state.pausedAt = new Date().toISOString();
state.pausedReason = 'Emergency stop via npm run stop';
saveState('pulse-control', state);

console.log('\n  PULSE EMERGENCY STOP');
console.log('  All posting and outreach paused immediately.');
console.log('  To resume: npm run resume\n');
