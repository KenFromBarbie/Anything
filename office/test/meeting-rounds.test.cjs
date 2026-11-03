/**
 * Several agents asked at once in a meeting take turns: whoever is handed
 * over to goes next, else the next one still waiting.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { BuzzBridge } = require('../src/sidecar/buzz-bridge.cjs');

function fakeBridge(waiting) {
  const spoke = [];
  const bridge = Object.create(BuzzBridge.prototype);
  bridge.meetingRounds = new Map([['c1', { evId: 'e1', ev: { id: 'e1' }, noteFor: (w) => `note ${w.name}`, waiting }]]);
  bridge.answerInMeeting = (_ev, who) => { spoke.push(who.name); return Promise.resolve(); };
  return { bridge, spoke };
}

const [michael, oscar, pam, angela] = ['Michael', 'Oscar', 'Pam', 'Angela'].map((name) => ({ name }));

test('no hand-over: the next one still waiting speaks', () => {
  const { bridge, spoke } = fakeBridge([oscar, pam, angela]);
  bridge.advanceRound('c1', michael, [], []);
  assert.deepEqual(spoke, ['Oscar']);
  assert.deepEqual(bridge.meetingRounds.get('c1').waiting, [pam, angela]);
});

test('a hand-over goes to who was named, and they leave the queue', () => {
  const { bridge, spoke } = fakeBridge([oscar, pam, angela]);
  bridge.advanceRound('c1', michael, [angela], []);
  assert.deepEqual(spoke, []); // Angela is brought in by the hand-over itself
  assert.deepEqual(bridge.meetingRounds.get('c1').waiting, [oscar, pam]);
  bridge.advanceRound('c1', angela, [], []);
  assert.deepEqual(spoke, ['Oscar']);
});

test('the round ends when everyone has spoken', () => {
  const { bridge } = fakeBridge([oscar]);
  bridge.advanceRound('c1', michael, [oscar], []);
  assert.equal(bridge.meetingRounds.has('c1'), false);
});
