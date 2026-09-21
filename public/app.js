const listEl = document.getElementById('list');
const countsEl = document.getElementById('counts');
const statusEl = document.getElementById('status');
const footEl = document.getElementById('foot');
const tabsEl = document.getElementById('tabs');

let filter = 'open';

const PRIORITY = {
  urgent: 'عاجل',
  high: 'مهم',
  normal: 'عادي',
};

const STATUS_TEXT = {
  connected: ['ok', 'متصل بواتساب'],
  'waiting-qr': ['bad', 'بانتظار مسح QR في الطرفية'],
  reconnecting: ['bad', 'يعيد الاتصال…'],
  'logged-out': ['bad', 'تم تسجيل الخروج'],
  starting: ['', 'جارٍ الاتصال…'],
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

const todayISO = () => new Date().toLocaleDateString('en-CA');

function relativeTime(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} د`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `قبل ${hrs} س`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'أمس' : `قبل ${days} يوم`;
}

function card(t) {
  const overdue = t.due_date && t.due_date < todayISO() && t.status === 'open';
  const dueLabel = t.due_date || t.due_text;

  const chips = [
    t.requester && `<span class="chip">من: ${esc(t.requester)}</span>`,
    dueLabel &&
      `<span class="chip due ${overdue ? 'overdue' : ''}">⏳ ${esc(dueLabel)}${overdue ? ' — متأخرة' : ''}</span>`,
    `<span class="chip">${PRIORITY[t.priority] ?? t.priority}</span>`,
    t.chat_name && `<span class="chip">${esc(t.chat_name)}</span>`,
    t.source_ts && `<span class="chip">${relativeTime(t.source_ts)}</span>`,
    t.confidence < 0.75 &&
      `<span class="chip conf">ثقة ${Math.round(t.confidence * 100)}٪ — راجعها</span>`,
  ].filter(Boolean);

  return `
    <article class="card ${t.status === 'done' ? 'is-done' : ''}" data-priority="${esc(t.priority)}" data-id="${t.id}">
      <div class="row">
        <h2 class="title">${esc(t.title)}</h2>
        <div class="actions">
          <button class="btn primary" data-act="toggle">${t.status === 'open' ? '✓ تم' : '↺ رجّعها'}</button>
          <button class="btn danger" data-act="delete">حذف</button>
        </div>
      </div>
      ${t.details ? `<p class="details">${esc(t.details)}</p>` : ''}
      <div class="meta">${chips.join('')}</div>
      ${
        t.source_text
          ? `<details class="src"><summary>الرسالة الأصلية</summary><blockquote>${esc(t.source_text)}</blockquote></details>`
          : ''
      }
    </article>`;
}

async function refresh() {
  try {
    const [tasksRes, statusRes] = await Promise.all([
      fetch(`/api/tasks?status=${filter}`).then((r) => r.json()),
      fetch('/api/status').then((r) => r.json()),
    ]);

    const { tasks, counts } = tasksRes;

    listEl.innerHTML = tasks.length
      ? tasks.map(card).join('')
      : `<div class="empty"><p>${
          filter === 'open' ? 'ما فيه مهام مفتوحة 🎉' : 'لا يوجد شيء هنا'
        }</p></div>`;

    countsEl.innerHTML = `
      <span><b>${counts.open ?? 0}</b> مفتوحة</span>
      <span><b>${counts.urgent ?? 0}</b> عاجلة</span>
      <span><b>${counts.done ?? 0}</b> منجزة</span>`;

    const [cls, text] = STATUS_TEXT[statusRes.whatsapp] ?? ['', statusRes.whatsapp];
    statusEl.className = `status ${cls}`;
    statusEl.innerHTML = `<i></i><span>${esc(text)}</span>`;

    const s = statusRes.stats;
    footEl.textContent =
      `${statusRes.model} · ${s.batches} دفعة · ${s.tasks} مهمة مستخرجة · ` +
      `${s.inputTokens.toLocaleString('ar')} توكن دخل (${s.cachedTokens.toLocaleString('ar')} من الكاش)` +
      (statusRes.pending ? ` · ${statusRes.pending} رسالة بالطابور` : '');
  } catch {
    statusEl.className = 'status bad';
    statusEl.innerHTML = '<i></i><span>الخادم غير متاح</span>';
  }
}

listEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const cardEl = btn.closest('.card');
  const id = cardEl.dataset.id;
  const act = btn.dataset.act;

  if (act === 'delete') {
    if (!confirm('تحذف هذه المهمة نهائيًا؟')) return;
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  } else {
    const now = cardEl.classList.contains('is-done') ? 'open' : 'done';
    await fetch(`/api/tasks/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: now }),
    });
  }
  refresh();
});

tabsEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  filter = tab.dataset.status;
  for (const t of tabsEl.children) t.classList.toggle('is-active', t === tab);
  refresh();
});

refresh();
setInterval(refresh, 15000);
