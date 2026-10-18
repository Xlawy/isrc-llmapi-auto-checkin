const $ = id => document.getElementById(id);
let loadingBalance = false;
let balanceError = '';
async function render() {
  const {state = {enabled: true}, balance} = await chrome.storage.local.get(['state', 'balance']);
  $('balance').textContent = loadingBalance ? '正在刷新…' : (balanceError || balance?.error) ? '暂时无法获取' : balance?.text || '尚未获取';
  $('balance-time').textContent = loadingBalance ? '' : balanceError || balance?.error || (balance?.updatedAt ? '更新于 ' + new Date(balance.updatedAt).toLocaleString('zh-CN') : '');
  $('refresh').disabled = loadingBalance;
  $('enabled').checked = state.enabled !== false;
  const active = state.status === 'running' && state.nextTry > Date.now();
  $('check').disabled = active;
  $('status').textContent = active ? '正在后台检查签到…' : state.lastResult || '尚未检查，点击“立即检查”开始。';
  $('time').textContent = state.lastAttempt ? '最近检查：' + new Date(state.lastAttempt).toLocaleString('zh-CN') : '';
  $('warning').textContent = state.notificationWarning || (state.status === 'failed' && state.nextTry ? '下次重试：' + new Date(state.nextTry).toLocaleString('zh-CN') : '');
}
$('check').onclick = async () => { $('check').disabled = true; await chrome.runtime.sendMessage({type: 'check'}); await refresh(); await render(); };
$('enabled').onchange = () => chrome.runtime.sendMessage({type: 'enabled', value: $('enabled').checked});
$('open').onclick = () => chrome.tabs.create({url: 'https://llmapi.isrc.ac.cn/profile'});
chrome.storage.onChanged.addListener(render);
async function refresh() {
  if (loadingBalance) return;
  loadingBalance = true;
  balanceError = '';
  await render();
  try { await chrome.runtime.sendMessage({type: 'balance'}); }
  catch { balanceError = '扩展连接中断，请重新打开弹窗。'; }
  finally { loadingBalance = false; await render(); }
}
$('refresh').onclick = refresh;
void refresh();
