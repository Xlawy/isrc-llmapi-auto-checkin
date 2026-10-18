import test from 'node:test';
import assert from 'node:assert/strict';
import {checkIn, dayKey} from '../core.mjs';
const ok = data => ({status: 200, ok: true, json: async () => ({success: true, data})});
const auth = {access_token: 'temporary-test-token', user: {id: 1}};
function sequence(items) {
 const calls=[];
 return {calls, fetcher: async (url, options) => {calls.push({url, options}); const item=items.shift(); if(item instanceof Error) throw item; assert.ok(item, 'unexpected request'); return item;}};
}
test('Beijing midnight rolls over correctly', () => {
 assert.equal(dayKey(Date.parse('2026-10-17T15:59:59Z')), '2026-10-17');
 assert.equal(dayKey(Date.parse('2026-10-17T16:00:00Z')), '2026-10-18');
});
test('refresh cookie then submit with ephemeral bearer', async () => {
 const s=sequence([ok(auth),ok({stats:{checked_in_today:false}}),ok({quota_awarded:123})]);
 const result=await checkIn(s.fetcher);
 assert.equal(result.quota,123);
 assert.equal(s.calls[0].options.credentials,'include');
 assert.equal(s.calls[0].options.method,'POST');
 assert.equal(s.calls[2].options.headers.Authorization,'Bearer temporary-test-token');
});
test('already checked in does not POST again', async () => {
 const s=sequence([ok(auth),ok({stats:{checked_in_today:true}})]);
 assert.equal((await checkIn(s.fetcher)).already,true);
 assert.equal(s.calls.length,2);
});
test('expired login stops without checkin submission', async () => {
 const s=sequence([{status:401}]);
 await assert.rejects(checkIn(s.fetcher),e=>!e.retry && /登录已过期/.test(e.message));
 assert.equal(s.calls.length,1);
});
test('ambiguous timeout is verified before retry', async () => {
 const s=sequence([ok(auth),ok({stats:{checked_in_today:false}}),new Error('timeout'),ok({stats:{checked_in_today:true}})]);
 assert.equal((await checkIn(s.fetcher)).already,true);
});
test('captcha is actionable and not retried', async () => {
 const s=sequence([ok(auth),ok({stats:{checked_in_today:false}}),{status:200,ok:true,json:async()=>({success:false,message:'Turnstile required'})},ok({stats:{checked_in_today:false}})]);
 await assert.rejects(checkIn(s.fetcher),e=>!e.retry && /安全验证/.test(e.message));
});
test('server error allows bounded worker retry', async () => {
 await assert.rejects(checkIn(async()=>({status:503})),e=>e.retry);
});
test('unknown status schema never submits', async () => {
 const s=sequence([ok(auth),ok({})]);
 await assert.rejects(checkIn(s.fetcher),/格式发生变化/);
 assert.equal(s.calls.length,2);
});
test('worker deduplicates, records success despite notification failure, and limits retries', async () => {
 let state={enabled:true}; let fetchCount=0;
 const listener={addListener(){}};
 globalThis.chrome={
  storage:{local:{get:async()=>({state:structuredClone(state)}),set:async value=>{state=value.state;}}},
  alarms:{get:async()=>({}),create:async()=>{},onAlarm:listener},
  runtime:{id:'test',onStartup:listener,onInstalled:listener,onMessage:listener},
  notifications:{create:async()=>{throw new Error('denied');}},
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}
 };
 const s=sequence([ok(auth),ok({stats:{checked_in_today:false}}),ok({quota_awarded:1})]);
 globalThis.fetch=async(...args)=>{fetchCount++; return s.fetcher(...args);};
 const {run}=await import('../worker.js');
 await Promise.all([run(),run()]);
 assert.equal(fetchCount,3);
 assert.equal(state.status,'success');
 assert.match(state.notificationWarning,/通知/);
 await run(); assert.equal(fetchCount,3);
 state={enabled:true}; globalThis.fetch=async()=>({status:503});
 for(let i=0;i<4;i++){state.nextTry=0;await run();}
 assert.equal(state.attempts,4);assert.equal(state.stopped,true);
 const before=state.lastAttempt;await run();assert.equal(state.lastAttempt,before);
 state={enabled:false};await run();assert.equal(state.lastAttempt,undefined);
});
