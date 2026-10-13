(function () {
  const DEFAULT_TABS = [
    { key: 'shopping', label: '買い物', color: '#B65A34' },
    { key: 'routine', label: 'ルーティン', color: '#3F6E52' },
    { key: 'irregular', label: '不定期', color: '#5C5490' }
  ];
  const TAB_COLOR_PALETTE = ['#B65A34', '#3F6E52', '#5C5490', '#2D6E8E', '#A6432F', '#8A6D3B', '#4A5568', '#7A4069'];
  const EMOJIS = ['🛒','🥛','🧻','🧴','🧹','🧺','🗑️','💡','🔧','📮','🌱','🧯','🪫','🧊','📦','✅'];

  const DEFAULT_TASKS = {
    shopping: [
      { id: 'seed-1', content: '牛乳', emoji: '🥛', projectId: '', due: '' },
      { id: 'seed-2', content: 'トイレットペーパー', emoji: '🧻', projectId: '', due: '' },
      { id: 'seed-3', content: '食器用洗剤', emoji: '🧴', projectId: '', due: '' }
    ],
    routine: [
      { id: 'seed-4', content: 'ゴミ出し', emoji: '🗑️', projectId: '', due: '今日' },
      { id: 'seed-5', content: '掃除機がけ', emoji: '🧹', projectId: '', due: '' }
    ],
    irregular: [
      { id: 'seed-6', content: '電球の交換', emoji: '💡', projectId: '', due: '' },
      { id: 'seed-7', content: '水道の元栓確認', emoji: '🔧', projectId: '', due: '' }
    ]
  };

  let state = {
    token: '',
    defaultProjectId: '',
    projects: [],
    tabs: null,
    tasks: null,
    activeTab: null,
    editingTaskId: null,
    editingTabKey: null
  };

  const $ = (sel) => document.querySelector(sel);
  const taskListEl = $('#task-list');
  const emptyStateEl = $('#empty-state');
  const statusBanner = $('#status-banner');
  const toastEl = $('#toast');

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function showBanner(msg) {
    statusBanner.innerHTML = msg + '<button id="banner-settings-btn">設定を開く</button>';
    statusBanner.classList.add('show');
    $('#banner-settings-btn').addEventListener('click', openSettings);
  }
  function hideBanner() { statusBanner.classList.remove('show'); }

  // ---------- Storage (localStorage, for standalone/GitHub Pages hosting) ----------
  const STORAGE_PREFIX = 'pochitto_';
  async function storageGet(key) {
    try {
      return localStorage.getItem(STORAGE_PREFIX + key);
    } catch (e) {
      return null;
    }
  }
  async function storageSet(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, value);
    } catch (e) {
      console.error('storage set failed', e);
    }
  }

  async function loadState() {
    const token = await storageGet('todoist_token');
    const defaultProjectId = await storageGet('default_project_id');
    const tabsRaw = await storageGet('quick_tabs_v1');
    const tasksRaw = await storageGet('quick_tasks_v1');
    state.token = token || '';
    state.defaultProjectId = defaultProjectId || '';

    if (tabsRaw) {
      try { state.tabs = JSON.parse(tabsRaw); } catch (e) { state.tabs = JSON.parse(JSON.stringify(DEFAULT_TABS)); }
    } else {
      state.tabs = JSON.parse(JSON.stringify(DEFAULT_TABS));
      await storageSet('quick_tabs_v1', JSON.stringify(state.tabs));
    }
    if (!state.tabs.length) state.tabs = JSON.parse(JSON.stringify(DEFAULT_TABS));

    if (tasksRaw) {
      try { state.tasks = JSON.parse(tasksRaw); } catch (e) { state.tasks = { ...DEFAULT_TASKS }; }
    } else {
      state.tasks = JSON.parse(JSON.stringify(DEFAULT_TASKS));
      await storageSet('quick_tasks_v1', JSON.stringify(state.tasks));
    }
    // Make sure every tab has a tasks bucket, even ones added on another device.
    state.tabs.forEach(t => { if (!state.tasks[t.key]) state.tasks[t.key] = []; });

    state.activeTab = state.tabs[0].key;
  }

  async function saveTabs() {
    await storageSet('quick_tabs_v1', JSON.stringify(state.tabs));
  }

  async function saveTasks() {
    await storageSet('quick_tasks_v1', JSON.stringify(state.tasks));
  }

  // ---------- Todoist API ----------
  async function apiRequest(path, options = {}) {
    if (!state.token) {
      const err = new Error('NO_TOKEN');
      err.code = 'NO_TOKEN';
      throw err;
    }
    const res = await fetch('https://api.todoist.com/api/v1' + path, {
      ...options,
      headers: {
        'Authorization': 'Bearer ' + state.token,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch (e) {}
      const err = new Error('API_ERROR ' + res.status + ' ' + detail);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function fetchAllProjects() {
    let results = [];
    let cursor = null;
    for (let i = 0; i < 10; i++) {
      const qs = new URLSearchParams({ limit: '200' });
      if (cursor) qs.set('cursor', cursor);
      const data = await apiRequest('/projects?' + qs.toString());
      const page = (data && (data.results || data.projects || data)) || [];
      results = results.concat(Array.isArray(page) ? page : []);
      cursor = data && data.next_cursor;
      if (!cursor) break;
    }
    return results;
  }

  async function createTodoistTask({ content, projectId, due }) {
    const body = { content };
    const pid = projectId || state.defaultProjectId;
    if (pid) body.project_id = pid;
    if (due) body.due_string = due;
    return apiRequest('/tasks', { method: 'POST', body: JSON.stringify(body) });
  }

  // ---------- Rendering ----------
  function currentTasks() {
    return state.tasks[state.activeTab] || [];
  }

  function renderTabs() {
    const wrap = $('#tabs');
    wrap.innerHTML = '';
    state.tabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn' + (tab.key === state.activeTab ? ' active' : '');
      btn.textContent = tab.label;
      btn.style.setProperty('--tab-color', tab.color);
      btn.addEventListener('click', () => { state.activeTab = tab.key; render(); });
      let pressTimer;
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openTabModal(tab); });
      btn.addEventListener('touchstart', () => { pressTimer = setTimeout(() => openTabModal(tab), 480); });
      btn.addEventListener('touchend', () => clearTimeout(pressTimer));
      btn.addEventListener('touchmove', () => clearTimeout(pressTimer));
      wrap.appendChild(btn);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-add-btn';
    addBtn.textContent = '＋';
    addBtn.setAttribute('aria-label', 'タブを追加');
    addBtn.addEventListener('click', () => openTabModal(null));
    wrap.appendChild(addBtn);
  }

  function render() {
    renderTabs();

    const list = currentTasks();
    taskListEl.innerHTML = '';
    emptyStateEl.classList.toggle('show', list.length === 0);

    list.forEach(task => {
      const row = document.createElement('div');
      row.className = 'task-row';
      row.dataset.id = task.id;

      const projLabel = task.projectId
        ? (state.projects.find(p => p.id === task.projectId)?.name || 'プロジェクト')
        : (state.defaultProjectId
            ? (state.projects.find(p => p.id === state.defaultProjectId)?.name || 'Inbox')
            : 'Inbox');
      const metaParts = [projLabel];
      if (task.due) metaParts.push(task.due);

      row.innerHTML = `
        <div class="emoji">${task.emoji || '✅'}</div>
        <div class="info">
          <div class="name">${escapeHtml(task.content)}</div>
          <div class="meta">${escapeHtml(metaParts.join(' ・ '))}</div>
        </div>
        <div class="plus" data-role="add">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </div>
      `;

      row.addEventListener('click', (e) => handleAdd(task, row));
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); openTaskModal(task); });

      let pressTimer;
      row.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => openTaskModal(task), 480);
      });
      row.addEventListener('touchend', () => clearTimeout(pressTimer));
      row.addEventListener('touchmove', () => clearTimeout(pressTimer));

      taskListEl.appendChild(row);
    });
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function handleAdd(task, rowEl) {
    if (!state.token) { openSettings(); return; }
    const plusIcon = rowEl.querySelector('.plus');
    rowEl.style.pointerEvents = 'none';
    try {
      await createTodoistTask({ content: task.content, projectId: task.projectId, due: task.due });
      rowEl.classList.add('added');
      showToast('「' + task.content + '」を追加しました');
      setTimeout(() => rowEl.classList.remove('added'), 900);
    } catch (err) {
      if (err.code === 'NO_TOKEN') {
        openSettings();
      } else {
        showToast('追加に失敗しました。設定を確認してください');
        showBanner('タスクの追加に失敗しました。APIトークンやネットワークをご確認ください。');
      }
    } finally {
      rowEl.style.pointerEvents = '';
    }
  }

  // ---------- Tabs (create/edit/delete) ----------

  // ---------- Settings modal ----------
  const settingsModal = $('#settings-modal');
  const settingsStatus = $('#settings-status');

  function openSettings() {
    $('#token-input').value = state.token;
    populateProjectSelect($('#project-select'), state.defaultProjectId);
    settingsStatus.textContent = '';
    settingsStatus.className = 'status-line';
    settingsModal.classList.add('show');
  }
  function closeSettings() { settingsModal.classList.remove('show'); }

  $('#gear-btn').addEventListener('click', openSettings);
  $('#settings-cancel').addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });

  $('#settings-save').addEventListener('click', async () => {
    const newToken = $('#token-input').value.trim();
    if (!newToken) {
      settingsStatus.textContent = 'トークンを入力してください。';
      settingsStatus.className = 'status-line err';
      return;
    }
    state.token = newToken;
    settingsStatus.textContent = '接続を確認しています…';
    settingsStatus.className = 'status-line';
    try {
      state.projects = await fetchAllProjects();
      await storageSet('todoist_token', state.token);
      state.defaultProjectId = $('#project-select').value;
      await storageSet('default_project_id', state.defaultProjectId);
      populateProjectSelect($('#project-select'), state.defaultProjectId);
      populateProjectSelect($('#task-project-select'), '');
      settingsStatus.textContent = '接続に成功しました（プロジェクト ' + state.projects.length + ' 件を取得）。';
      settingsStatus.className = 'status-line ok';
      hideBanner();
      render();
    } catch (err) {
      settingsStatus.textContent = '接続に失敗しました。トークンをご確認ください。';
      settingsStatus.className = 'status-line err';
    }
  });

  function populateProjectSelect(selectEl, selectedId) {
    selectEl.innerHTML = '<option value="">Inbox（受信箱）</option>';
    state.projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === selectedId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  // ---------- Backup: export / import ----------
  function buildBackupPayload() {
    return {
      app: 'pochitto-todoist',
      version: 1,
      exportedAt: new Date().toISOString(),
      tabs: state.tabs,
      tasks: state.tasks,
      defaultProjectId: state.defaultProjectId
    };
    // Note: the Todoist API token is intentionally left out of backups.
  }

  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  $('#export-btn').addEventListener('click', () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJSON('pochitto-backup-' + stamp + '.json', buildBackupPayload());
    showToast('バックアップを書き出しました');
  });

  $('#import-btn').addEventListener('click', () => $('#import-file-input').click());

  $('#import-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.tabs) || !data.tabs.length || typeof data.tasks !== 'object') {
        throw new Error('invalid format');
      }
      const ok = confirm('現在のタブとタスクを、読み込んだバックアップの内容で上書きします。よろしいですか？');
      if (!ok) { e.target.value = ''; return; }

      state.tabs = data.tabs;
      state.tasks = data.tasks;
      if (data.defaultProjectId !== undefined) state.defaultProjectId = data.defaultProjectId;
      state.tabs.forEach(t => { if (!state.tasks[t.key]) state.tasks[t.key] = []; });
      if (!state.tabs.find(t => t.key === state.activeTab)) state.activeTab = state.tabs[0].key;

      await saveTabs();
      await saveTasks();
      await storageSet('default_project_id', state.defaultProjectId);
      populateProjectSelect($('#project-select'), state.defaultProjectId);

      settingsStatus.textContent = 'バックアップを読み込みました。';
      settingsStatus.className = 'status-line ok';
      render();
      showToast('バックアップを読み込みました');
    } catch (err) {
      settingsStatus.textContent = 'ファイルの読み込みに失敗しました。正しいバックアップファイルかご確認ください。';
      settingsStatus.className = 'status-line err';
    } finally {
      e.target.value = '';
    }
  });

  // ---------- Task add/edit modal ----------
  const taskModal = $('#task-modal');
  let selectedEmoji = EMOJIS[0];

  function buildEmojiPicker() {
    const wrap = $('#emoji-picker');
    wrap.innerHTML = '';
    EMOJIS.forEach(em => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = em;
      b.addEventListener('click', () => {
        selectedEmoji = em;
        wrap.querySelectorAll('button').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
      });
      wrap.appendChild(b);
    });
  }
  buildEmojiPicker();

  const DUE_PRESETS = ['今日', '明日', '週末', '来週', '毎日', '平日毎日', '毎週月曜', '毎月1日'];

  function buildDuePresets() {
    const wrap = $('#due-presets');
    wrap.innerHTML = '';
    DUE_PRESETS.forEach(label => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        const input = $('#task-due-input');
        input.value = label;
        syncDuePresetSelection();
      });
      wrap.appendChild(b);
    });
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'なしにする';
    clearBtn.className = 'clear-btn';
    clearBtn.addEventListener('click', () => {
      $('#task-due-input').value = '';
      syncDuePresetSelection();
    });
    wrap.appendChild(clearBtn);
  }
  buildDuePresets();

  function syncDuePresetSelection() {
    const val = $('#task-due-input').value.trim();
    document.querySelectorAll('#due-presets button').forEach(b => {
      const isClear = b.classList.contains('clear-btn');
      b.classList.toggle('selected', !isClear && b.textContent === val);
    });
  }
  $('#task-due-input').addEventListener('input', syncDuePresetSelection);

  function openTaskModal(task) {
    state.editingTaskId = task ? task.id : null;
    $('#task-modal-tab-label').textContent = state.tabs.find(t => t.key === state.activeTab).label + ' タブに追加されます';
    $('#task-name-input').value = task ? task.content : '';
    $('#task-due-input').value = task ? (task.due || '') : '';
    syncDuePresetSelection();
    selectedEmoji = task ? (task.emoji || EMOJIS[0]) : EMOJIS[0];
    buildEmojiPicker();
    const wrap = $('#emoji-picker');
    [...wrap.children].forEach(b => b.classList.toggle('selected', b.textContent === selectedEmoji));
    populateProjectSelect($('#task-project-select'), task ? (task.projectId || '') : '');
    $('#task-delete').style.display = task ? 'block' : 'none';
    taskModal.classList.add('show');
  }
  function closeTaskModal() { taskModal.classList.remove('show'); }

  $('#add-task-btn').addEventListener('click', () => openTaskModal(null));
  $('#task-cancel').addEventListener('click', closeTaskModal);
  taskModal.addEventListener('click', (e) => { if (e.target === taskModal) closeTaskModal(); });

  $('#task-save').addEventListener('click', async () => {
    const content = $('#task-name-input').value.trim();
    if (!content) return;
    const projectId = $('#task-project-select').value;
    const due = $('#task-due-input').value.trim();

    const list = state.tasks[state.activeTab];
    if (state.editingTaskId) {
      const idx = list.findIndex(t => t.id === state.editingTaskId);
      if (idx > -1) list[idx] = { ...list[idx], content, emoji: selectedEmoji, projectId, due };
    } else {
      list.push({ id: 't-' + Date.now(), content, emoji: selectedEmoji, projectId, due });
    }
    await saveTasks();
    closeTaskModal();
    render();
  });

  $('#task-delete').addEventListener('click', async () => {
    if (!state.editingTaskId) return;
    state.tasks[state.activeTab] = state.tasks[state.activeTab].filter(t => t.id !== state.editingTaskId);
    await saveTasks();
    closeTaskModal();
    render();
  });

  // ---------- Tab create/edit modal ----------
  const tabModal = $('#tab-modal');
  let selectedTabColor = TAB_COLOR_PALETTE[0];

  function buildTabColorPicker() {
    const wrap = $('#tab-color-picker');
    wrap.innerHTML = '';
    TAB_COLOR_PALETTE.forEach(color => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = color;
      b.addEventListener('click', () => {
        selectedTabColor = color;
        wrap.querySelectorAll('button').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
      });
      wrap.appendChild(b);
    });
  }

  function openTabModal(tab) {
    state.editingTabKey = tab ? tab.key : null;
    $('#tab-modal-title').textContent = tab ? 'タブを編集' : 'タブを追加';
    $('#tab-name-input').value = tab ? tab.label : '';
    selectedTabColor = tab ? tab.color : TAB_COLOR_PALETTE[state.tabs.length % TAB_COLOR_PALETTE.length];
    buildTabColorPicker();
    const wrap = $('#tab-color-picker');
    [...wrap.children].forEach((b, i) => b.classList.toggle('selected', TAB_COLOR_PALETTE[i] === selectedTabColor));
    $('#tab-delete').style.display = (tab && state.tabs.length > 1) ? 'block' : 'none';
    tabModal.classList.add('show');
  }
  function closeTabModal() { tabModal.classList.remove('show'); }

  $('#tab-cancel').addEventListener('click', closeTabModal);
  tabModal.addEventListener('click', (e) => { if (e.target === tabModal) closeTabModal(); });

  $('#tab-save').addEventListener('click', async () => {
    const label = $('#tab-name-input').value.trim();
    if (!label) return;
    if (state.editingTabKey) {
      const tab = state.tabs.find(t => t.key === state.editingTabKey);
      if (tab) { tab.label = label; tab.color = selectedTabColor; }
    } else {
      const key = 'tab-' + Date.now();
      state.tabs.push({ key, label, color: selectedTabColor });
      state.tasks[key] = [];
      await saveTasks();
      state.activeTab = key;
    }
    await saveTabs();
    closeTabModal();
    render();
  });

  $('#tab-delete').addEventListener('click', async () => {
    if (!state.editingTabKey || state.tabs.length <= 1) return;
    const key = state.editingTabKey;
    state.tabs = state.tabs.filter(t => t.key !== key);
    delete state.tasks[key];
    if (state.activeTab === key) state.activeTab = state.tabs[0].key;
    await saveTabs();
    await saveTasks();
    closeTabModal();
    render();
  });

  // ---------- Init ----------
  async function init() {
    await loadState();
    render();
    if (!state.token) {
      showBanner('Todoistと連携するためにAPIトークンを設定してください。');
    } else {
      try {
        state.projects = await fetchAllProjects();
        render();
      } catch (e) {
        showBanner('Todoistへの接続に失敗しました。トークンをご確認ください。');
      }
    }
  }
  init();
})();
