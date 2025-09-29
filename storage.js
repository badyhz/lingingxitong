
(() => {
  const NS = 'psys:v1';
  const STORAGE_VERSION = '1.1.0';
  const SCHEMA_VERSION = 4;

  const load = (key, defVal) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? defVal; }
    catch { return defVal; }
  };
  const save = (key, val) => localStorage.setItem(key, JSON.stringify(val));
  const uuid = () => (globalThis.crypto?.randomUUID?.() || (Date.now()+'-'+Math.random().toString(16).slice(2)));

  // 数据迁移和兼容性处理
  function migrateDataIfNeeded() {
    const versionKey = `${NS}:version`;
    const schemaKey = `${NS}:schemaVersion`;
    const currentVersion = load(versionKey, null);
    const currentSchema = load(schemaKey, 3); // 默认为版本3
    
    if (!currentVersion) {
      // 首次使用或旧版本数据，进行兼容性处理
      console.log('检测到旧版本数据或首次使用，进行数据迁移...');
      
      // 检查是否存在旧格式的数据
      const oldTeams = load('teams', null);
      if (oldTeams && Array.isArray(oldTeams)) {
        // 迁移旧格式团队数据
        console.log('迁移旧格式团队数据');
        setTeams(oldTeams);
        localStorage.removeItem('teams');
      }
      
      // 标记当前版本
      save(versionKey, STORAGE_VERSION);
      save(schemaKey, SCHEMA_VERSION);
      console.log(`数据迁移完成，当前版本: ${STORAGE_VERSION}, Schema: ${SCHEMA_VERSION}`);
    } else if (currentVersion !== STORAGE_VERSION || currentSchema < SCHEMA_VERSION) {
      console.log(`检测到版本差异，当前: ${currentVersion}, 目标: ${STORAGE_VERSION}, Schema: ${currentSchema} -> ${SCHEMA_VERSION}`);
      
      // Schema 3 -> 4: 添加指数数据支持
      if (currentSchema < 4) {
        console.log('升级Schema到版本4：添加指数数据支持');
        migrateToSchemaV4();
        save(schemaKey, 4);
      }
      
      save(versionKey, STORAGE_VERSION);
    }
  }

  // Schema v3 -> v4 迁移：添加指数数据支持
  function migrateToSchemaV4() {
    // 为所有现有会话添加indices字段
    const prefix = `${NS}:sessions:`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const session = load(key, null);
        if (session && !session.indices) {
          session.indices = {
            latest: null,
            history: [],
            schemaVersion: 4
          };
          save(key, session);
        }
      }
    }
    console.log('Schema v4 迁移完成：已为现有会话添加指数数据支持');
  }

  const getTeams = () => load(`${NS}:teams`, []);
  const setTeams = (arr) => save(`${NS}:teams`, arr);

  const usersKey = (teamId) => `${NS}:users:${teamId}`;
  const getUsers = (tid) => load(usersKey(tid), []);
  const setUsers = (tid, arr) => save(usersKey(tid), arr);

  const sessionKey = (tid, uid, rid) => `${NS}:sessions:${tid}:${uid}:${rid}`;
  const getSession = (tid, uid, rid) => load(sessionKey(tid, uid, rid), null);
  const setSession = (tid, uid, rid, s) => save(sessionKey(tid, uid, rid), s);

  const lastSessionKey = (tid, uid) => `${NS}:lastSession:${tid}:${uid}`;
  const getLastSessionMetaForUser = (tid, uid) => load(lastSessionKey(tid, uid), null);
  const setLastSessionMetaForUser = (meta) => {
    if (!meta?.teamId || !meta?.userId || !meta?.runId) return;
    save(lastSessionKey(meta.teamId, meta.userId), {
      teamId: meta.teamId,
      userId: meta.userId,
      runId: meta.runId,
      storedAt: new Date().toISOString()
    });
  };

  function ensureTeam(teamName) {
    const teams = getTeams();
    let t = teams.find(x => x.teamName === teamName);
    if (!t) {
      t = { teamId: uuid(), teamName, createdAt: new Date().toISOString() };
      teams.push(t); setTeams(teams);
    }
    return t;
  }

  function ensureUser(teamId, name, title) {
    const users = getUsers(teamId);
    let u = users.find(x => x.name === name && x.title === title);
    if (!u) {
      u = { userId: uuid(), teamId, name, title, hidden: false, createdAt: new Date().toISOString() };
      users.push(u); setUsers(teamId, users);
    }
    return u;
  }

  function startRun(teamName, testerName, title) {
    const team = ensureTeam(teamName);
    const user = ensureUser(team.teamId, testerName, title);
    const runId = uuid();
    const sess = {
      runId, teamId: team.teamId, userId: user.userId,
      startedAt: new Date().toISOString()
    };
    setSession(team.teamId, user.userId, runId, sess);
    sessionStorage.setItem(`${NS}:currentSession`, JSON.stringify({ teamId: team.teamId, userId: user.userId, runId }));
    return { team, user, runId };
  }

  function setCurrentSession(meta) {
    sessionStorage.setItem(`${NS}:currentSession`, JSON.stringify(meta));
  }

  function getCurrentSessionMeta() {
    const raw = sessionStorage.getItem(`${NS}:currentSession`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function saveStep(partName, data) {
    const meta = getCurrentSessionMeta();
    if (!meta) throw new Error('No current session. Please startRun() first.');
    const sess = getSession(meta.teamId, meta.userId, meta.runId) || { runId: meta.runId, teamId: meta.teamId, userId: meta.userId, startedAt: new Date().toISOString() };
    sess[partName] = data;
    setSession(meta.teamId, meta.userId, meta.runId, sess);
    setLastSessionMetaForUser(meta);
    return sess;
  }

  function saveComputed(computed) {
    const meta = getCurrentSessionMeta();
    if (!meta) throw new Error('No current session.');
    const sess = getSession(meta.teamId, meta.userId, meta.runId) || { runId: meta.runId, teamId: meta.teamId, userId: meta.userId, startedAt: new Date().toISOString() };
    sess.computed = computed;
    sess.completedAt = new Date().toISOString();
    
    // 确保indices字段存在
    if (!sess.indices) {
      sess.indices = {
        latest: null,
        history: [],
        schemaVersion: SCHEMA_VERSION
      };
    }
    
    setSession(meta.teamId, meta.userId, meta.runId, sess);
    setLastSessionMetaForUser(meta);
    return sess;
  }

  // 保存指数数据
  function saveIndices(indices) {
    const meta = getCurrentSessionMeta();
    if (!meta) throw new Error('No current session.');
    const sess = getSession(meta.teamId, meta.userId, meta.runId) || { runId: meta.runId, teamId: meta.teamId, userId: meta.userId, startedAt: new Date().toISOString() };
    
    // 确保indices字段存在
    if (!sess.indices) {
      sess.indices = {
        latest: null,
        history: [],
        schemaVersion: SCHEMA_VERSION
      };
    }
    
    // 保存最新指数
    sess.indices.latest = indices;
    sess.indices.timestamp = new Date().toISOString();
    
    // 添加到历史记录（保留最近10次）
    sess.indices.history = sess.indices.history || [];
    sess.indices.history.push({
      indices: indices,
      timestamp: new Date().toISOString()
    });
    
    // 限制历史记录数量
    if (sess.indices.history.length > 10) {
      sess.indices.history = sess.indices.history.slice(-10);
    }
    
    setSession(meta.teamId, meta.userId, meta.runId, sess);
    return sess;
  }

  // 获取指数数据
  function getIndices() {
    const meta = getCurrentSessionMeta();
    if (!meta) return null;
    const sess = getSession(meta.teamId, meta.userId, meta.runId);
    return sess?.indices || null;
  }

  function getLatestCompletedSessionForUser(teamId, userId) {
    const prefix = `${NS}:sessions:${teamId}:${userId}:`;
    const runs = [];
    for (let i=0;i<localStorage.length;i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        const s = load(k, null);
        if (s?.computed && s?.completedAt) runs.push(s);
      }
    }
    runs.sort((a,b)=> new Date(b.completedAt) - new Date(a.completedAt));
    return runs[0] || null;
  }

  function aggregateTeam(teamId) {
    const users = getUsers(teamId).filter(u => !u.hidden);
    const perUser = [];
    const acc = { structure: [], ecology: [], potentialA: [], potentialB: [] };
    let n = 0;
    for (const u of users) {
      const s = getLatestCompletedSessionForUser(teamId, u.userId);
      if (!s?.computed) continue;
      perUser.push({ name: u.name, title: u.title, runId: s.runId, completedAt: s.completedAt, computed: s.computed });
      const addVec = (key) => {
        const arr = s.computed[key];
        if (!Array.isArray(arr)) return;
        for (let i=0;i<arr.length;i++) {
          acc[key][i] = (acc[key][i] || 0) + arr[i];
        }
      };
      addVec('structure'); addVec('ecology'); addVec('potentialA'); addVec('potentialB');
      n++;
    }
    const avgVec = (key)=> acc[key].length ? acc[key].map(x=> +(x / Math.max(1,n)).toFixed(2)) : [];
    return { count: n, perUser, teamAvg: {
      structure: avgVec('structure'),
      ecology: avgVec('ecology'),
      potentialA: avgVec('potentialA'),
      potentialB: avgVec('potentialB'),
    }};
  }

  function setUserHidden(teamId, userId, hidden) {
    const users = getUsers(teamId);
    const idx = users.findIndex(u => u.userId === userId);
    if (idx >= 0) { users[idx].hidden = !!hidden; setUsers(teamId, users); }
  }

  // 删除用户（移动到回收站）
  const deletedUsersKey = (teamId) => `${NS}:deletedUsers:${teamId}`;
  const getDeletedUsers = (tid) => load(deletedUsersKey(tid), []);
  const setDeletedUsers = (tid, arr) => save(deletedUsersKey(tid), arr);

  function deleteUser(teamId, userId) {
    const users = getUsers(teamId);
    const userIdx = users.findIndex(u => u.userId === userId);
    if (userIdx < 0) return false;
    
    const user = users[userIdx];
    user.deletedAt = new Date().toISOString();
    
    // 移动到回收站
    const deletedUsers = getDeletedUsers(teamId);
    deletedUsers.push(user);
    setDeletedUsers(teamId, deletedUsers);
    
    // 从活跃用户列表中移除
    users.splice(userIdx, 1);
    setUsers(teamId, users);
    
    return true;
  }

  function restoreUser(teamId, userId) {
    const deletedUsers = getDeletedUsers(teamId);
    const userIdx = deletedUsers.findIndex(u => u.userId === userId);
    if (userIdx < 0) return false;
    
    const user = deletedUsers[userIdx];
    delete user.deletedAt;
    
    // 移回活跃用户列表
    const users = getUsers(teamId);
    users.push(user);
    setUsers(teamId, users);
    
    // 从回收站移除
    deletedUsers.splice(userIdx, 1);
    setDeletedUsers(teamId, deletedUsers);
    
    return true;
  }

  function permanentlyDeleteUser(teamId, userId) {
    const deletedUsers = getDeletedUsers(teamId);
    const userIdx = deletedUsers.findIndex(u => u.userId === userId);
    if (userIdx < 0) return false;
    
    // 从回收站永久删除
    deletedUsers.splice(userIdx, 1);
    setDeletedUsers(teamId, deletedUsers);
    
    // 删除相关的会话数据
    const prefix = `${NS}:sessions:${teamId}:${userId}:`;
    const keysToDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => localStorage.removeItem(key));
    
    // 删除最后会话记录
    localStorage.removeItem(lastSessionKey(teamId, userId));
    
    return true;
  }

  // Expose minimal API
  window.PSYS = {
    NS, STORAGE_VERSION, SCHEMA_VERSION, getTeams, setTeams, getUsers, setUsers,
    getSession, setSession,
    ensureTeam, ensureUser, startRun, setCurrentSession, getCurrentSessionMeta,
    saveStep, saveComputed, saveIndices, getIndices, getLatestCompletedSessionForUser, aggregateTeam,
    setUserHidden,
    getLastSessionMetaForUser,
    setLastSessionMetaForUser,
    // 新增的用户管理API
    getDeletedUsers, deleteUser, restoreUser, permanentlyDeleteUser,
    // 数据迁移和版本管理API
    migrateDataIfNeeded
  };

  // 自动执行数据迁移检查
  migrateDataIfNeeded();
})();
