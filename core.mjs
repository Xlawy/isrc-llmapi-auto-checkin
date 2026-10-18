export const BASE = 'https://llmapi.isrc.ac.cn';
export const dayKey = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
export class CheckError extends Error {
  constructor(message, retry = false) { super(message); this.retry = retry; }
}
export async function request(path, {token, method = 'GET', fetcher = fetch} = {}) {
  let response;
  try {
    response = await fetcher(BASE + path, {
      method, credentials: 'include', cache: 'no-store', redirect: 'error',
      headers: token ? {Authorization: `Bearer ${token}`} : {},
      signal: AbortSignal.timeout(20000)
    });
  } catch { throw new CheckError('网络连接失败或请求超时，请检查网络；扩展会有限重试。', true); }
  if (response.status === 401) throw new CheckError('登录已过期，请打开网站重新登录，再点击“立即检查”。');
  if (response.status === 403) throw new CheckError('网站拒绝请求，可能需要重新登录、安全验证，或不允许扩展后台请求。');
  if (response.status === 429 || response.status >= 500) throw new CheckError(`服务器暂时不可用（HTTP ${response.status}）。`, true);
  let body;
  try { body = await response.json(); } catch { throw new CheckError('网站返回了非 JSON 内容，可能需要登录或完成安全验证。'); }
  if (!response.ok || body.success !== true) {
    const raw = typeof body.message === 'string' ? body.message : '';
    if (/turnstile|captcha|验证/i.test(raw)) throw new CheckError('网站要求安全验证，请打开个人资料页手动完成本次签到。');
    if (response.status === 409) throw new CheckError('登录会话正在刷新，请稍后重试。', true);
    throw new CheckError('网站未接受请求' + (raw ? `：${raw.slice(0, 160)}` : `（HTTP ${response.status}）`));
  }
  return body.data;
}
export async function checkIn(fetcher = fetch, now = Date.now()) {
  const call = (path, options) => request(path, {...options, fetcher});
  const auth = await call('/api/user/auth/refresh', {method: 'POST'});
  if (!auth?.access_token || !Number.isInteger(auth?.user?.id)) throw new CheckError('登录接口格式发生变化，无法获取访问令牌。');
  const token = auth.access_token;
  const date = dayKey(now);
  const statusPath = `/api/user/checkin?month=${date.slice(0, 7)}`;
  const status = await call(statusPath, {token});
  if (typeof status?.stats?.checked_in_today !== 'boolean') throw new CheckError('签到状态格式发生变化，已停止提交。');
  const result = (data, already) => ({date, userId: auth.user.id, already,
    quota: Number.isFinite(data?.quota_awarded) ? data.quota_awarded : null});
  if (status.stats.checked_in_today) return result(status.stats.records?.find(r => r.checkin_date === date), true);
  let submitted;
  try { submitted = await call('/api/user/checkin', {method: 'POST', token}); }
  catch (error) {
    // A timed-out submission may have succeeded. Read the authoritative state before retrying.
    try {
      const confirmed = await call(statusPath, {token});
      if (confirmed?.stats?.checked_in_today === true) return result(confirmed.stats.records?.find(r => r.checkin_date === date), true);
    } catch { /* Preserve the original reason. */ }
    throw error;
  }
  if (!submitted || typeof submitted !== 'object') throw new CheckError('签到响应缺少结果，请手动检查网站。');
  return result(submitted, false);
}
