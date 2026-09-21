(function () {
  'use strict';

  const bank = window.QUIZ_BANK;
  if (!bank || !Array.isArray(bank.questions)) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">题库加载失败，请确认 questions.js 与页面在同一目录。</p>';
    return;
  }

  const STORAGE_KEY = 'one-plus-x-quiz-state-v1';
  const MAX_HISTORY = 50;
  const questionMap = new Map(bank.questions.map((question) => [question.id, question]));
  const state = loadState();
  const view = {
    screen: 'home',
    wrongFilter: 'all',
    resultSession: null,
    reviewQuestionId: null,
    reviewSelected: [],
    reviewOrigin: 'wrong'
  };
  const MODULE_DEFINITIONS = [
    { id: 'single', label: '单项选择题', shortLabel: '单选', icon: '单', description: '基础概念与法规判断', match: (q) => q.type === 'single' && q.source_type !== 'matching' },
    { id: 'multiple', label: '多项选择题', shortLabel: '多选', icon: '多', description: '多知识点综合判断', match: (q) => q.type === 'multiple' },
    { id: 'matching', label: '配伍选择题', shortLabel: '配伍', icon: '配', description: '题干与选项匹配', match: (q) => q.source_type === 'matching' }
  ];

  let storageWarningShown = false;
  let toastTimer = 0;

  const $ = (id) => document.getElementById(id);
  const screens = {
    home: $('screen-home'),
    quiz: $('screen-quiz'),
    sequential: $('screen-sequential'),
    result: $('screen-result'),
    wrong: $('screen-wrong'),
    review: $('screen-review'),
    history: $('screen-history')
  };

  function blankState() {
    return {
      version: 2,
      createdAt: Date.now(),
      current: null,
      history: [],
      wrong: {},
      progress: {}
    };
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeState(JSON.parse(raw)) : blankState();
    } catch (error) {
      return blankState();
    }
  }

  function normalizeState(raw) {
    const base = blankState();
    if (!raw || typeof raw !== 'object') return base;

    base.createdAt = Number(raw.createdAt) || Date.now();
    base.history = Array.isArray(raw.history)
      ? raw.history.filter(isUsableSession).slice(0, MAX_HISTORY)
      : [];
    base.wrong = {};

    if (raw.wrong && typeof raw.wrong === 'object') {
      Object.entries(raw.wrong).forEach(([id, entry]) => {
        if (!questionMap.has(id) || !entry || typeof entry !== 'object') return;
        base.wrong[id] = {
          firstAt: Number(entry.firstAt) || Number(entry.lastAt) || Date.now(),
          lastAt: Number(entry.lastAt) || Date.now(),
          wrongCount: Math.max(1, Number(entry.wrongCount) || 1),
          lastSelected: Array.isArray(entry.lastSelected) ? entry.lastSelected : []
        };
      });
    }

    base.progress = {};
    if (raw.progress && typeof raw.progress === 'object') {
      Object.entries(raw.progress).forEach(([id, entry]) => {
        if (!questionMap.has(id) || !entry || typeof entry !== 'object') return;
        base.progress[id] = {
          firstAt: Number(entry.firstAt) || Number(entry.lastAt) || Date.now(),
          lastAt: Number(entry.lastAt) || Date.now(),
          attempts: Math.max(1, Number(entry.attempts) || 1),
          correctCount: Math.max(0, Number(entry.correctCount) || 0),
          wrongCount: Math.max(0, Number(entry.wrongCount) || 0),
          lastCorrect: Boolean(entry.lastCorrect)
        };
      });
    }

    const oldSessions = (Array.isArray(raw.history) ? raw.history : []).concat(raw.current ? [raw.current] : []);
    oldSessions.forEach((session) => {
      if (!isUsableSession(session) || !session.answers) return;
      Object.entries(session.answers).forEach(([id, answer]) => {
        if (!questionMap.has(id) || !answer || base.progress[id]) return;
        const answeredAt = Number(answer.answeredAt) || Date.now();
        base.progress[id] = {
          firstAt: answeredAt,
          lastAt: answeredAt,
          attempts: 1,
          correctCount: answer.correct ? 1 : 0,
          wrongCount: answer.correct ? 0 : 1,
          lastCorrect: Boolean(answer.correct)
        };
      });
    });

    if (isUsableSession(raw.current)) {
      base.current = raw.current;
      base.current.mode = base.current.mode || 'random';
      base.current.draftSelected = Array.isArray(base.current.draftSelected) ? base.current.draftSelected : [];
      base.current.answers = base.current.answers && typeof base.current.answers === 'object' ? base.current.answers : {};
    }
    return base;
  }

  function isUsableSession(session) {
    return Boolean(
      session &&
      typeof session === 'object' &&
      Array.isArray(session.questionIds) &&
      session.questionIds.length > 0 &&
      session.questionIds.every((id) => questionMap.has(id))
    );
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      if (!storageWarningShown) {
        storageWarningShown = true;
        window.setTimeout(() => showToast('当前打开方式可能无法长期保存记录，建议使用本地 HTTP 打开。'), 500);
      }
    }
  }

  function showToast(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2300);
  }

  function setScreen(name, options) {
    const opts = options || {};
    if (!screens[name]) name = 'home';
    const changed = view.screen !== name;
    view.screen = name;
    document.body.dataset.screen = name;

    if (changed && !opts.skipHistory) {
      const historyState = { screen: name };
      if (opts.replace && window.history && window.history.replaceState) {
        window.history.replaceState(historyState, '', window.location.href);
      } else if (window.history && window.history.pushState) {
        window.history.pushState(historyState, '', window.location.href);
      }
    }

    Object.entries(screens).forEach(([screenName, element]) => {
      element.classList.toggle('active', screenName === name);
    });

    const titles = {
      home: '1+X随机刷题',
      quiz: '答题中',
      sequential: '顺序刷题',
      result: '练习结果',
      wrong: '错题回顾',
      review: '题目解析',
      history: '练习记录'
    };
    $('topTitle').textContent = titles[name] || '1+X随机刷题';
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (name === 'home') renderHome();
    if (name === 'quiz') renderQuiz();
    if (name === 'sequential') renderSequential();
    if (name === 'result') renderResult(view.resultSession || state.current);
    if (name === 'wrong') renderWrongBook();
    if (name === 'review') renderReview();
    if (name === 'history') renderHistory();
  }

  function goBack() {
    if (view.screen === 'quiz' && state.current && !state.current.completed) {
      const shouldExit = window.confirm('退出本次练习吗？当前答题进度会保存在本机。');
      if (!shouldExit) return;
      saveState();
      setScreen('home', { replace: true });
      return;
    }
    if (window.history.state && window.history.state.screen && view.screen !== 'home') {
      window.history.back();
    } else {
      setScreen('home', { replace: true });
    }
  }

  function goHome() {
    if (view.screen === 'quiz' && state.current && !state.current.completed) saveState();
    setScreen('home');
  }

  function secureRandomInt(max) {
    if (!Number.isInteger(max) || max <= 0) return 0;
    const cryptoObject = window.crypto || window.msCrypto;
    if (cryptoObject && cryptoObject.getRandomValues) {
      const limit = Math.floor(0x100000000 / max) * max;
      const values = new Uint32Array(1);
      let value = 0;
      do {
        cryptoObject.getRandomValues(values);
        value = values[0];
      } while (value >= limit);
      return value % max;
    }
    return Math.floor(Math.random() * max);
  }

  function randomSample(items, count) {
    const copy = items.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = secureRandomInt(index + 1);
      const temporary = copy[index];
      copy[index] = copy[swapIndex];
      copy[swapIndex] = temporary;
    }
    return copy.slice(0, Math.min(count, copy.length));
  }

  function getModuleDefinition(moduleId) {
    return MODULE_DEFINITIONS.find((module) => module.id === moduleId) || MODULE_DEFINITIONS[0];
  }

  function getModuleQuestionIds(moduleId) {
    const definition = getModuleDefinition(moduleId);
    return bank.questions.filter((question) => definition.match(question)).map((question) => question.id);
  }

  function getOverallProgressStats() {
    const ids = bank.questions.map((question) => question.id);
    const practiced = ids.filter((id) => state.progress[id]).length;
    return { practiced, total: ids.length, percent: ids.length ? Math.round((practiced / ids.length) * 100) : 0 };
  }

  function getModuleProgress(moduleId) {
    const ids = getModuleQuestionIds(moduleId);
    const practiced = ids.filter((id) => state.progress[id]).length;
    return { practiced, total: ids.length, percent: ids.length ? Math.round((practiced / ids.length) * 100) : 0 };
  }

  function createSession(questionIds, options) {
    const now = Date.now();
    const config = options || {};
    return {
      id: 'session-' + now + '-' + secureRandomInt(100000),
      mode: config.mode || 'random',
      module: config.module || null,
      title: config.title || '随机 100 题',
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      completed: false,
      questionIds,
      index: 0,
      draftSelected: [],
      answers: {}
    };
  }

  function confirmReplaceUnfinished(message) {
    if (!state.current || state.current.completed) return true;
    return window.confirm(message || '当前有一轮练习尚未完成。重新开始会放弃本轮进度，但历史错题仍会保留。是否继续？');
  }

  function startNewSession() {
    if (!confirmReplaceUnfinished('当前有一轮练习尚未完成。重新开始随机题会放弃本轮进度，是否继续？')) return;
    const ids = randomSample(bank.questions.map((question) => question.id), 100);
    state.current = createSession(ids, { mode: 'random', title: '随机 100 题' });
    view.resultSession = null;
    saveState();
    setScreen('quiz');
  }

  function startSequentialSession(moduleId) {
    const module = getModuleDefinition(moduleId);
    if (state.current && !state.current.completed && state.current.mode === 'sequential' && state.current.module === moduleId) {
      resumeSession();
      return;
    }
    if (!confirmReplaceUnfinished('当前有一轮练习尚未完成。开始顺序刷题会放弃本轮进度，是否继续？')) return;

    const allIds = getModuleQuestionIds(moduleId);
    const unseenIds = allIds.filter((id) => !state.progress[id]);
    if (!unseenIds.length && !window.confirm(module.label + '已经全部刷过，将从第一题开始重刷。是否继续？')) return;
    const seenIds = allIds.filter((id) => state.progress[id]);
    const orderedIds = unseenIds.length ? unseenIds.concat(seenIds) : allIds;

    state.current = createSession(orderedIds, {
      mode: 'sequential',
      module: moduleId,
      title: module.label + '顺序刷题'
    });
    view.resultSession = null;
    saveState();
    setScreen('quiz');
  }

  function resumeSession() {
    if (!state.current) return;
    if (state.current.completed) {
      view.resultSession = state.current;
      setScreen('result');
    } else {
      setScreen('quiz');
    }
  }

  function getSessionLabel(session) {
    if (!session) return '练习';
    if (session.mode === 'sequential') return getModuleDefinition(session.module).label + ' · 顺序';
    return '随机 100 题';
  }

  function getSessionStats(session) {
    let correct = 0;
    let wrong = 0;
    let answered = 0;
    Object.values(session.answers || {}).forEach((answer) => {
      answered += 1;
      if (answer.correct) correct += 1;
      else wrong += 1;
    });
    const total = session.questionIds.length;
    const score = answered ? Math.round((correct / total) * 100) : 0;
    return { correct, wrong, answered, total, score };
  }

  function renderHome() {
    $('statBank').textContent = String(bank.meta.total || bank.questions.length);
    $('statWrong').textContent = String(Object.keys(state.wrong).length);
    $('statHistory').textContent = String(state.history.length);

    const overall = getOverallProgressStats();
    $('overallProgressText').textContent = overall.practiced + ' / ' + overall.total;
    $('overallProgressBar').style.width = overall.percent + '%';

    const latest = state.history[0];
    $('latestScore').textContent = latest ? getSessionStats(latest).score + '%' : '--';

    const resumeButton = $('resumeBtn');
    if (state.current && !state.current.completed) {
      const stats = getSessionStats(state.current);
      resumeButton.classList.remove('hidden');
      $('resumeTitle').textContent = getSessionLabel(state.current) + ' · 已完成 ' + stats.answered + ' / ' + state.current.questionIds.length;
    } else {
      resumeButton.classList.add('hidden');
    }
  }

  function renderSequential() {
    const overall = getOverallProgressStats();
    $('sequentialOverallText').textContent = overall.practiced + ' / ' + overall.total;
    $('sequentialOverallBar').style.width = overall.percent + '%';

    $('sequentialModules').innerHTML = MODULE_DEFINITIONS.map((module) => {
      const stats = getModuleProgress(module.id);
      const isCurrent = state.current && !state.current.completed && state.current.mode === 'sequential' && state.current.module === module.id;
      const actionText = isCurrent ? '继续' : (stats.practiced >= stats.total ? '重刷' : '开始');
      return '<button class="module-card" type="button" data-module="' + module.id + '">' +
        '<span class="module-icon">' + escapeHtml(module.icon) + '</span>' +
        '<span class="module-main"><span class="module-title-row"><strong>' + escapeHtml(module.label) + '</strong><span>' + actionText + '</span></span>' +
        '<small>' + escapeHtml(module.description) + ' · 已刷 ' + stats.practiced + ' / ' + stats.total + '</small>' +
        '<span class="progress-track"><span class="progress-bar" style="width:' + stats.percent + '%"></span></span></span></button>';
    }).join('');
  }
  function renderQuiz() {
    const session = state.current;
    if (!session) {
      setScreen('home', { replace: true });
      return;
    }
    if (session.completed || session.index >= session.questionIds.length) {
      view.resultSession = session;
      setScreen('result', { replace: true });
      return;
    }

    const question = questionMap.get(session.questionIds[session.index]);
    if (!question) {
      session.index += 1;
      saveState();
      renderQuiz();
      return;
    }

    const currentNumber = session.index + 1;
    const total = session.questionIds.length;
    const answer = session.answers[question.id] || null;
    const selected = answer && Array.isArray(answer.selected) ? answer.selected.slice() : (Array.isArray(session.draftSelected) ? session.draftSelected : []);
    $('quizProgressText').textContent = currentNumber + ' / ' + total;
    $('quizTypeText').textContent = getTypeLabel(question);
    $('quizProgressBar').style.width = ((currentNumber / total) * 100).toFixed(2) + '%';
    $('questionMeta').textContent = getQuestionMeta(question);
    $('questionStem').textContent = question.stem;

    $('optionsList').innerHTML = question.options.map((option) => {
      const isSelected = selected.includes(option.key);
      const isCorrect = question.answer.includes(option.key);
      let className = '';
      if (answer && isCorrect) className = ' correct';
      else if (answer && isSelected && !isCorrect) className = ' wrong';
      else if (!answer && isSelected) className = ' selected';
      return '<button class="option-btn' + className + '" type="button" data-key="' + option.key + '" aria-pressed="' + String(isSelected) + '"' + (answer ? ' disabled' : '') + '>' +
        '<span class="option-key">' + escapeHtml(option.key) + '</span>' +
        '<span class="option-text">' + escapeHtml(option.text) + (answer && isSelected ? ' <small>（你的选择）</small>' : '') + '</span>' +
        '</button>';
    }).join('');

    updateQuizSelection(question, selected, answer);
    if (answer) {
      window.requestAnimationFrame(() => {
        const feedback = $('answerFeedback');
        if (feedback) feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }

  function renderAnswerFeedback(question, answer) {
    const feedback = $('answerFeedback');
    feedback.classList.remove('hidden', 'correct', 'wrong');
    feedback.classList.add(answer.correct ? 'correct' : 'wrong');
    const title = answer.correct ? '回答正确' : '回答错误';
    feedback.innerHTML = '<div class="feedback-banner"><span>' + title + '</span><span>正确答案：' + escapeHtml(question.answer.join('、')) + '</span></div>' +
      '<div class="explanation-card"><div class="explanation-title"><span>解析</span><strong>及时回顾</strong></div>' +
      '<p>' + escapeHtml(question.explanation || '请结合正确答案回顾题目知识点。') + '</p></div>';
  }

  function updateQuizSelection(question, selected, answer) {
    const confirmButton = $('confirmBtn');
    const hint = $('selectionHint');
    const isLast = state.current.index === state.current.questionIds.length - 1;

    if (answer) {
      confirmButton.disabled = false;
      confirmButton.textContent = isLast ? '查看结果' : '下一题';
      hint.textContent = answer.correct ? '回答正确，进度已记录' : '回答错误，正确答案：' + question.answer.join('、');
      renderAnswerFeedback(question, answer);
      return;
    }

    $('answerFeedback').classList.add('hidden');
    confirmButton.disabled = selected.length === 0;
    confirmButton.textContent = '确认答案';
    if (!selected.length) {
      hint.textContent = question.type === 'multiple' ? '多选题，请选择全部正确项' : '请选择答案';
    } else if (question.type === 'multiple') {
      hint.textContent = '已选择：' + selected.join('、') + '，确认后立即显示答案';
    } else {
      hint.textContent = '已选择：' + selected[0] + '，确认后立即显示答案';
    }
    $('optionsList').querySelectorAll('.option-btn').forEach((button) => {
      const isSelected = selected.includes(button.dataset.key);
      button.classList.toggle('selected', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });
  }

  function toggleOption(key) {
    const session = state.current;
    if (!session || session.completed) return;
    const questionId = session.questionIds[session.index];
    if (session.answers[questionId]) return;
    const question = questionMap.get(questionId);
    if (!question) return;
    let selected = Array.isArray(session.draftSelected) ? session.draftSelected.slice() : [];
    if (question.type === 'multiple') {
      selected = selected.includes(key) ? selected.filter((item) => item !== key) : selected.concat(key);
      selected.sort((a, b) => 'ABCDE'.indexOf(a) - 'ABCDE'.indexOf(b));
    } else {
      selected = [key];
    }
    session.draftSelected = selected;
    session.updatedAt = Date.now();
    saveState();
    updateQuizSelection(question, selected, null);
  }

  function submitAnswer() {
    const session = state.current;
    if (!session || session.completed) return;
    const questionId = session.questionIds[session.index];
    if (session.answers[questionId]) {
      advanceQuiz();
      return;
    }
    gradeCurrentAnswer();
  }

  function gradeCurrentAnswer() {
    const session = state.current;
    const questionId = session.questionIds[session.index];
    const question = questionMap.get(questionId);
    const selected = Array.isArray(session.draftSelected) ? session.draftSelected.slice() : [];
    if (!question || selected.length === 0) {
      showToast('请先选择答案');
      return;
    }

    const correct = sameAnswer(selected, question.answer);
    session.answers[questionId] = {
      selected,
      correct,
      answeredAt: Date.now()
    };
    recordProgress(questionId, correct);

    if (correct) {
      if (state.wrong[questionId]) {
        state.wrong[questionId].lastCorrectAt = Date.now();
      }
    } else {
      recordWrongAnswer(questionId, selected);
    }

    session.updatedAt = Date.now();
    saveState();
    renderQuiz();
  }

  function advanceQuiz() {
    const session = state.current;
    if (!session) return;
    session.index += 1;
    session.draftSelected = [];
    session.updatedAt = Date.now();

    if (session.index >= session.questionIds.length) {
      session.completed = true;
      session.completedAt = Date.now();
      addHistory(session);
      view.resultSession = session;
      saveState();
      setScreen('result', { replace: true });
      return;
    }

    saveState();
    renderQuiz();
  }

  function recordProgress(questionId, correct) {
    const now = Date.now();
    const previous = state.progress[questionId] || {
      firstAt: now,
      attempts: 0,
      correctCount: 0,
      wrongCount: 0,
      lastCorrect: false
    };
    state.progress[questionId] = {
      firstAt: previous.firstAt || now,
      lastAt: now,
      attempts: (Number(previous.attempts) || 0) + 1,
      correctCount: (Number(previous.correctCount) || 0) + (correct ? 1 : 0),
      wrongCount: (Number(previous.wrongCount) || 0) + (correct ? 0 : 1),
      lastCorrect: correct
    };
  }
  function sameAnswer(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const leftSorted = left.slice().sort();
    const rightSorted = right.slice().sort();
    return leftSorted.every((value, index) => value === rightSorted[index]);
  }

  function recordWrongAnswer(questionId, selected) {
    const previous = state.wrong[questionId] || {
      firstAt: Date.now(),
      wrongCount: 0,
      lastSelected: []
    };
    state.wrong[questionId] = {
      firstAt: previous.firstAt || Date.now(),
      lastAt: Date.now(),
      lastCorrectAt: previous.lastCorrectAt || null,
      wrongCount: (Number(previous.wrongCount) || 0) + 1,
      lastSelected: selected.slice()
    };
  }

  function addHistory(session) {
    state.history = state.history.filter((item) => item.id !== session.id);
    state.history.unshift(deepCopy(session));
    state.history = state.history.slice(0, MAX_HISTORY);
  }

  function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function renderResult(session) {
    if (!session) {
      setScreen('home', { replace: true });
      return;
    }
    const stats = getSessionStats(session);
    $('resultScore').textContent = stats.score + '%';
    $('scoreRing').style.setProperty('--score', stats.score + '%');
    $('resultCorrect').textContent = String(stats.correct);
    $('resultWrong').textContent = String(stats.wrong);
    $('resultTime').textContent = formatDuration((session.completedAt || Date.now()) - session.startedAt);

    let title = '练习完成';
    if (stats.score >= 90) title = '表现优秀';
    else if (stats.score >= 80) title = '顺利通关';
    else if (stats.score >= 60) title = '继续巩固';
    else title = '重点复习';
    $('resultTitle').textContent = title;
    $('resultSub').textContent = getSessionLabel(session) + ' · ' + stats.answered + ' 道题已完成，成绩已保存到本机';
    $('resultNewBtn').textContent = session.mode === 'sequential' ? '重新开始本模块' : '再练一组随机 100 题';

    const wrongIds = session.questionIds.filter((id) => session.answers[id] && !session.answers[id].correct);
    $('resultWrongHint').textContent = wrongIds.length ? '点击题目可查看答案与解析' : '本组全部答对';
    renderQuestionRows($('resultWrongList'), wrongIds, 'result', session);
    $('resultWrongList').classList.toggle('scroll', wrongIds.length > 4);
  }

  function continueResultSession() {
    const session = view.resultSession;
    if (session && session.mode === 'sequential' && session.module) {
      startSequentialSession(session.module);
    } else {
      startNewSession();
    }
  }

  function renderWrongBook() {
    const allEntries = Object.entries(state.wrong)
      .map(([id, entry]) => ({ id, entry, question: questionMap.get(id) }))
      .filter((item) => item.question)
      .sort((a, b) => b.entry.lastAt - a.entry.lastAt);

    $('wrongCount').textContent = String(allEntries.length);
    let entries = allEntries;
    if (view.wrongFilter === 'single') entries = allEntries.filter((item) => item.question.type === 'single' && item.question.source_type !== 'matching');
    if (view.wrongFilter === 'multiple') entries = allEntries.filter((item) => item.question.type === 'multiple');
    if (view.wrongFilter === 'matching') entries = allEntries.filter((item) => item.question.source_type === 'matching');

    const list = $('wrongList');
    if (!entries.length) {
      list.innerHTML = '<div class="empty-state"><strong>暂无错题</strong><span>完成练习后，答错的题目会自动出现在这里。</span></div>';
      return;
    }

    list.innerHTML = entries.map((item) => {
      const meta = escapeHtml(getQuestionMeta(item.question)) + ' · 错 ' + item.entry.wrongCount + ' 次 · ' + formatDate(item.entry.lastAt, true);
      return '<button class="question-row" type="button" data-question-id="' + item.id + '">' +
        '<span class="question-row-main"><span class="question-row-tag">' + escapeHtml(getTypeLabel(item.question)) + '</span>' +
        '<span class="question-row-text">' + escapeHtml(item.question.stem) + '</span>' +
        '<span class="question-row-meta">' + meta + '</span></span><span class="question-row-arrow">›</span></button>';
    }).join('');
  }

  function renderQuestionRows(container, questionIds, origin, session) {
    if (!questionIds.length) {
      container.innerHTML = '<div class="empty-state"><strong>没有错题</strong><span>这组练习全部答对。</span></div>';
      return;
    }
    container.innerHTML = questionIds.map((id) => {
      const question = questionMap.get(id);
      const answer = session && session.answers ? session.answers[id] : null;
      const selectedText = answer && answer.selected ? '你的答案：' + answer.selected.join('、') : '点击查看';
      return '<button class="question-row" type="button" data-question-id="' + id + '" data-origin="' + origin + '">' +
        '<span class="question-row-main"><span class="question-row-tag">' + escapeHtml(getTypeLabel(question)) + '</span>' +
        '<span class="question-row-text">' + escapeHtml(question.stem) + '</span>' +
        '<span class="question-row-meta">' + escapeHtml(selectedText) + ' · 正确答案：' + escapeHtml(question.answer.join('、')) + '</span></span>' +
        '<span class="question-row-arrow">›</span></button>';
    }).join('');
  }

  function openReview(questionId, selected, origin, session) {
    if (!questionMap.has(questionId)) return;
    view.reviewQuestionId = questionId;
    view.reviewOrigin = origin || 'wrong';
    if (Array.isArray(selected)) {
      view.reviewSelected = selected.slice();
    } else if (origin === 'result' && session && session.answers[questionId]) {
      view.reviewSelected = session.answers[questionId].selected.slice();
    } else if (state.wrong[questionId]) {
      view.reviewSelected = (state.wrong[questionId].lastSelected || []).slice();
    } else {
      view.reviewSelected = [];
    }
    if (session) view.resultSession = session;
    setScreen('review');
  }

  function renderReview() {
    const question = questionMap.get(view.reviewQuestionId);
    if (!question) {
      setScreen('wrong', { replace: true });
      return;
    }
    const selected = Array.isArray(view.reviewSelected) ? view.reviewSelected : [];
    $('reviewMeta').textContent = getQuestionMeta(question) + ' · ' + getTypeLabel(question);
    $('reviewStem').textContent = question.stem;
    $('reviewAnswer').textContent = '正确答案：' + question.answer.join('、');
    $('reviewExplanation').textContent = question.explanation || '请结合正确答案回顾题目知识点。';

    $('reviewOptions').innerHTML = question.options.map((option) => {
      const isCorrect = question.answer.includes(option.key);
      const isSelected = selected.includes(option.key);
      const className = isCorrect ? ' correct' : (isSelected ? ' wrong' : '');
      return '<div class="option-btn review' + className + '">' +
        '<span class="option-key">' + escapeHtml(option.key) + '</span>' +
        '<span class="option-text">' + escapeHtml(option.text) + (isSelected ? ' <small>（你的选择）</small>' : '') + '</span>' +
        '</div>';
    }).join('');

    const entry = state.wrong[question.id];
    const stats = [
      '你的选择：' + (selected.length ? selected.join('、') : '未记录'),
      '正确答案：' + question.answer.join('、')
    ];
    if (entry) {
      stats.push('累计答错：' + entry.wrongCount + ' 次');
      stats.push('最近答错：' + formatDate(entry.lastAt));
    }
    $('reviewStats').innerHTML = stats.map((text) => '<div>' + escapeHtml(text) + '</div>').join('');
    $('masteredBtn').classList.toggle('hidden', !entry);
  }

  function markMastered() {
    const id = view.reviewQuestionId;
    if (!id || !state.wrong[id]) {
      showToast('这道题不在错题本中');
      return;
    }
    delete state.wrong[id];
    saveState();
    showToast('已移出错题本');
    setScreen(view.reviewOrigin === 'result' ? 'result' : 'wrong', { replace: true });
  }

  function renderHistory() {
    const list = $('historyList');
    if (!state.history.length) {
      list.innerHTML = '<div class="empty-state"><strong>还没有练习记录</strong><span>完成一组随机题或顺序题后，成绩会自动保存在这里。</span></div>';
      return;
    }
    list.innerHTML = state.history.map((session) => {
      const stats = getSessionStats(session);
      return '<button class="history-card" type="button" data-session-id="' + escapeHtml(session.id) + '">' +
        '<span class="history-score">' + stats.score + '%</span>' +
        '<span class="history-info"><strong>' + getSessionLabel(session) + '</strong>' +
        '<span class="history-meta">' + formatDate(session.completedAt || session.startedAt) + '</span>' +
        '<span class="history-meta">' + stats.correct + ' 对 · ' + stats.wrong + ' 错 · 用时 ' + formatDuration((session.completedAt || Date.now()) - session.startedAt) + '</span></span>' +
        '<span class="history-arrow">›</span></button>';
    }).join('');
  }

  function openHistorySession(sessionId) {
    const session = state.history.find((item) => item.id === sessionId);
    if (!session) return;
    view.resultSession = session;
    setScreen('result');
  }

  function exportData() {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '1+X刷题记录-' + formatFileDate(Date.now()) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('记录文件已导出');
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const imported = JSON.parse(String(reader.result));
        const normalized = normalizeState(imported);
        if (!window.confirm('导入会覆盖当前浏览器里的练习记录，是否继续？')) return;
        state.createdAt = normalized.createdAt;
        state.current = normalized.current;
        state.history = normalized.history;
        state.wrong = normalized.wrong;
        state.progress = normalized.progress;
        saveState();
        showToast('记录导入成功');
        setScreen('history');
      } catch (error) {
        showToast('导入失败，请选择本应用导出的 JSON 文件');
      } finally {
        $('importFile').value = '';
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function getTypeLabel(question) {
    if (!question) return '题目';
    if (question.type === 'multiple') return '多选题';
    if (question.source_type === 'matching') return '配伍单选题';
    return '单选题';
  }

  function getQuestionMeta(question) {
    if (!question) return '题目';
    if (question.source_type === 'matching') {
      return '配伍题第 ' + question.source_number + ' 组 · 小题 ' + question.sub_index;
    }
    return (question.type === 'multiple' ? '多选题 ' : '单选题 ') + question.number;
  }

  function formatDate(timestamp, short) {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    if (short) return (date.getMonth() + 1) + '/' + date.getDate() + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function formatFileDate(timestamp) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes());
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.round(milliseconds / 1000));
    if (seconds < 60) return '不到1分钟';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + '分钟';
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return hours + '小时' + (remainder ? remainder + '分钟' : '');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function bindEvents() {
    $('startBtn').addEventListener('click', startNewSession);
    $('resumeBtn').addEventListener('click', resumeSession);
    $('sequentialBtn').addEventListener('click', () => setScreen('sequential'));
    $('sequentialMenuBtn').addEventListener('click', () => setScreen('sequential'));
    $('wrongBookBtn').addEventListener('click', () => setScreen('wrong'));
    $('historyBtn').addEventListener('click', () => setScreen('history'));
    $('backBtn').addEventListener('click', goBack);
    $('homeBtn').addEventListener('click', goHome);

    $('optionsList').addEventListener('click', (event) => {
      const button = event.target.closest('.option-btn');
      if (button) toggleOption(button.dataset.key);
    });
    $('confirmBtn').addEventListener('click', submitAnswer);

    $('resultWrongList').addEventListener('click', (event) => {
      const row = event.target.closest('[data-question-id]');
      if (!row) return;
      const session = view.resultSession;
      const answer = session && session.answers ? session.answers[row.dataset.questionId] : null;
      openReview(row.dataset.questionId, answer ? answer.selected : [], 'result', session);
    });
    $('resultNewBtn').addEventListener('click', continueResultSession);
    $('resultHomeBtn').addEventListener('click', goHome);

    $('sequentialModules').addEventListener('click', (event) => {
      const card = event.target.closest('[data-module]');
      if (card) startSequentialSession(card.dataset.module);
    });

    $('wrongFilters').addEventListener('click', (event) => {
      const chip = event.target.closest('[data-filter]');
      if (!chip) return;
      const filter = chip.dataset.filter;
      if (filter === 'clear') {
        const count = Object.keys(state.wrong).length;
        if (!count) {
          showToast('错题本已经是空的');
          return;
        }
        if (window.confirm('确定清空错题本中的 ' + count + ' 道题吗？')) {
          state.wrong = {};
          saveState();
          showToast('错题本已清空');
          renderWrongBook();
        }
        return;
      }
      view.wrongFilter = filter;
      $('wrongFilters').querySelectorAll('.filter-chip').forEach((item) => item.classList.toggle('active', item.dataset.filter === filter));
      renderWrongBook();
    });

    $('wrongList').addEventListener('click', (event) => {
      const row = event.target.closest('[data-question-id]');
      if (!row) return;
      const entry = state.wrong[row.dataset.questionId];
      openReview(row.dataset.questionId, entry ? entry.lastSelected : [], 'wrong');
    });

    $('masteredBtn').addEventListener('click', markMastered);
    $('historyList').addEventListener('click', (event) => {
      const card = event.target.closest('[data-session-id]');
      if (card) openHistorySession(card.dataset.sessionId);
    });
    $('exportBtn').addEventListener('click', exportData);
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (event) => importData(event.target.files[0]));

    window.addEventListener('popstate', (event) => {
      const screenName = event.state && event.state.screen ? event.state.screen : 'home';
      setScreen(screenName, { skipHistory: true });
    });
  }

  function init() {
    if (window.history && window.history.replaceState) {
      window.history.replaceState({ screen: 'home' }, '', window.location.href);
    }
    bindEvents();
    document.body.dataset.screen = 'home';
    renderHome();

    if (!window.__SINGLE_FILE__ && 'serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  }

  init();
})();










