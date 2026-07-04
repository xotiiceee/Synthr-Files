/**
 * Resume Pulse after an emergency stop.
 * Usage: npm run resume
 */
import { saveState, loadState } from '../src/core/state.js';

interface ControlState { paused: boolean; pausedAt: string; pausedReason: string }

const state = loadState<ControlState>('pulse-control', { paused: false, pausedAt: '', pausedReason: '' });
state.paused = false;
state.pausedAt = '';
state.pausedReason = '';
saveState('pulse-control', state);

console.log('\n  PULSE RESUMED');
console.log('  All posting and outreach active again.\n');
