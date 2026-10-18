const $ = id => document.getElementById(id);
async function render() {
  const {state = {enabled: true}} = await chrome.storage.local.get('state');
  $('enabled').checked = state.enabled !== false;
  const active = state.status === 'running' && state.nextTry > Date.now();
  $('check').disabled = active;
  $('status').textContent = active ? '正在后台检查签到…' : state.lastResult || '尚未检查，点击“立即检查”开始。';
  $('time').textContent = state.lastAttempt ? '最近检查：' + new Date(state.lastAttempt).toLocaleString('zh-CN') : '';
  $('warning').textContent = state.notificationWarning || (state.status === 'failed' && state.nextTry ? '下次重试：' + new Date(state.nextTry).toLocaleString('zh-CN') : '');
}
$('check').onclick = async () => { $('check').disabled = true; await chrome.runtime.sendMessage({type: 'check'}); await render(); };
$('enabled').onchange = () => chrome.runtime.sendMessage({type: 'enabled', value: $('enabled').checked});
$('open').onclick = () => chrome.tabs.create({url: 'https://llmapi.isrc.ac.cn/profile'});
chrome.storage.onChanged.addListener(render);
void render();
