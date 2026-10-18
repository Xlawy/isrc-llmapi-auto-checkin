import {checkIn, dayKey} from './core.mjs';
const RETRIES = [60000, 300000, 1800000];
let running;
async function settings() { return (await chrome.storage.local.get('state')).state || {enabled: true}; }
async function save(patch) {
  const state = {...await settings(), ...patch};
  await chrome.storage.local.set({state});
  return state;
}
async function notify(message, failed = false) {
  try {
    await chrome.notifications.create('isrc-checkin', {type: 'basic', iconUrl: 'icon.png',
      title: failed ? 'ISRC 签到失败' : 'ISRC 每日签到', message});
    await save({notificationWarning: null});
  } catch { await save({notificationWarning: '系统通知未能发出，请检查 Chrome 与系统的通知权限。'}); }
}
async function perform(manual = false) {
  let state = await settings();
  const today = dayKey();
  if (!manual && (state.enabled === false || state.successDate === today ||
    (state.attemptDate === today && (state.stopped || state.nextTry > Date.now())))) return;
  const attempts = state.attemptDate === today ? (state.attempts || 0) + 1 : 1;
  // Persist a short lease so a terminated worker does not leave an infinite busy state.
  await save({attemptDate: today, attempts, lastAttempt: Date.now(), status: 'running',
    nextTry: Date.now() + 120000, stopped: false});
  try {
    const result = await checkIn();
    const message = (result.already ? '今天已经签到。' : '签到成功！') +
      (result.quota !== null ? `奖励额度：${result.quota}（网站原始额度单位）。` : '');
    await save({status: 'success', successDate: result.date, userId: result.userId,
      lastResult: message, lastFinished: Date.now(), attempts: 0, nextTry: 0, stopped: false});
    await chrome.action.setBadgeText({text: '✓'});
    await chrome.action.setBadgeBackgroundColor({color: '#17834b'});
    await notify(message);
  } catch (error) {
    const retryDelay = error.retry && attempts <= RETRIES.length ? RETRIES[attempts - 1] : null;
    const message = error.message || '签到失败，原因未知。';
    await save({status: 'failed', lastResult: message, lastFinished: Date.now(),
      nextTry: retryDelay ? Date.now() + retryDelay : 0, stopped: !retryDelay});
    await chrome.action.setBadgeText({text: '!'});
    await chrome.action.setBadgeBackgroundColor({color: '#b64432'});
    if (manual || attempts === 1 || !retryDelay) await notify(message +
      (retryDelay ? ' 将自动重试。' : ' 今天的自动重试已停止，可点击扩展手动重试。'), true);
  }
}
export function run(manual = false) {
  if (running) return running;
  running = perform(manual).finally(() => { running = null; });
  return running;
}
async function ensureAlarm() {
  if (!await chrome.alarms.get('isrc-daily')) await chrome.alarms.create('isrc-daily', {periodInMinutes: 1});
}
chrome.runtime.onStartup.addListener(() => { void ensureAlarm().then(() => run()); });
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm().then(() => run()); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'isrc-daily') void run(); });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'check') { run(true).then(() => reply({ok: true}), () => reply({ok: false})); return true; }
  if (message.type === 'enabled') {
    save({enabled: !!message.value}).then(async () => { if (message.value) await run(); reply({ok: true}); });
    return true;
  }
});
void ensureAlarm();
