(() => {
  'use strict';

  const LEVELS = {
    easy:   { size: 5, cats: 3 },
    medium: { size: 7, cats: 5 },
    hard:   { size: 9, cats: 7 },
  };

  const CAT_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M10 8 L24 18 Q32 16 40 18 L54 8 L56 30 Q60 40 52 50 Q44 58 32 58 Q20 58 12 50 Q4 40 8 30 Z" fill="#111"/>
    <path d="M14 14 L21 19 L14 24Z M50 14 L43 19 L50 24Z" fill="#555"/>
    <ellipse cx="23" cy="35" rx="4.5" ry="5.5" fill="#fff"/><ellipse cx="41" cy="35" rx="4.5" ry="5.5" fill="#fff"/>
    <ellipse cx="23" cy="35.5" rx="1.6" ry="4" fill="#111"/><ellipse cx="41" cy="35.5" rx="1.6" ry="4" fill="#111"/>
    <path d="M29.5 42 H34.5 L32 45Z" fill="#fff"/>
    <path d="M32 45 Q28 50 24 47 M32 45 Q36 50 40 47" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M4 40 L18 43 M4 47 L18 46 M60 40 L46 43 M60 47 L46 46" stroke="#999" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`;

  // ---------- Puzzle generation ----------
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const compatible = ([r1, c1], [r2, c2]) =>
    r1 !== r2 && c1 !== c2 && Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)) > 1;

  function isValid(cats, size, count) {
    if (cats.length !== count) return false;
    for (const [r, c] of cats) if (r < 0 || c < 0 || r >= size || c >= size) return false;
    for (let i = 0; i < cats.length; i++)
      for (let j = i + 1; j < cats.length; j++)
        if (!compatible(cats[i], cats[j])) return false;
    return true;
  }

  function generateCats(size, count) {
    const cells = [];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) cells.push([r, c]);

    // Backtracking: try random compatible cells until `count` cats are placed.
    const solve = (placed) => {
      if (placed.length === count) return placed;
      const options = shuffle(cells.filter((cell) => placed.every((p) => compatible(p, cell))));
      for (const cell of options) {
        const result = solve([...placed, cell]);
        if (result) return result;
      }
      return null;
    };

    for (let attempt = 0; attempt < 50; attempt++) {
      const cats = solve([]);
      if (cats && isValid(cats, size, count)) return cats;
    }
    throw new Error('Could not generate a valid board');
  }

  // ---------- State ----------
  const $ = (s) => document.querySelector(s);
  const el = {
    board: $('#board'), difficulty: $('#difficulty'), found: $('#found'), remaining: $('#remaining'),
    moves: $('#moves'), timer: $('#timer'), sound: $('#sound'),
    help: $('#helpDialog'), confirm: $('#confirmDialog'), win: $('#winDialog'),
  };

  let state = null;
  let timerId = null;
  let soundOn = true;
  let audioCtx = null;
  let currentLevel = 'easy';

  const formatTime = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  function newState(level, cats) {
    const { size, cats: count } = LEVELS[level];
    const grid = () => Array.from({ length: size }, () => Array(size).fill(false));
    return {
      level, size, count, cats,
      catSet: new Set(cats.map(([r, c]) => `${r},${c}`)),
      revealed: grid(), blocked: grid(), tiles: [],
      found: 0, moves: 0, startTime: null, elapsed: 0, over: false,
    };
  }

  // ---------- Rendering ----------
  function render() {
    const { size } = state;
    el.board.style.setProperty('--n', size);
    el.board.innerHTML = '';
    state.tiles = [];
    for (let r = 0; r < size; r++) {
      state.tiles[r] = [];
      for (let c = 0; c < size; c++) {
        const t = document.createElement('button');
        t.className = 'tile';
        t.type = 'button';
        t.setAttribute('role', 'gridcell');
        t.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}, covered`);
        t.addEventListener('click', () => reveal(r, c));
        el.board.appendChild(t);
        state.tiles[r][c] = t;
      }
    }
    updateStats();
  }

  function updateStats() {
    el.found.textContent = `${state.found} / ${state.count}`;
    el.remaining.textContent = state.count - state.found;
    el.moves.textContent = state.moves;
    el.timer.textContent = formatTime(state.elapsed);
  }

  // ---------- Timer ----------
  function startTimer() {
    state.startTime = Date.now() - state.elapsed;
    clearInterval(timerId);
    timerId = setInterval(() => {
      state.elapsed = Date.now() - state.startTime;
      el.timer.textContent = formatTime(state.elapsed);
    }, 250);
  }
  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
    if (state && state.startTime) state.elapsed = Date.now() - state.startTime;
  }

  // ---------- Gameplay ----------
  function blockAround(r0, c0) {
    const { size } = state;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const sameLine = r === r0 || c === c0;
        const adjacent = Math.max(Math.abs(r - r0), Math.abs(c - c0)) <= 1;
        if ((sameLine || adjacent) && !state.revealed[r][c] && !state.blocked[r][c]) {
          state.blocked[r][c] = true;
          const t = state.tiles[r][c];
          t.classList.add('blocked');
          t.disabled = true;
          t.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}, unavailable`);
        }
      }
    }
  }

  function reveal(r, c) {
    if (!state || state.over || state.revealed[r][c] || state.blocked[r][c]) return;
    if (!state.startTime) startTimer();

    const t = state.tiles[r][c];
    state.revealed[r][c] = true;
    state.moves++;
    t.disabled = true;

    if (state.catSet.has(`${r},${c}`)) {
      state.found++;
      t.classList.add('cat');
      t.innerHTML = CAT_SVG;
      t.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}, cat`);
      blockAround(r, c);
      beep([523, 784], 0.12);
    } else {
      t.classList.add('empty');
      t.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}, empty`);
      beep([300], 0.06);
    }
    updateStats();
    if (state.found === state.count) win();
  }

  function win() {
    state.over = true;
    stopTimer();
    updateStats();
    $('#winMoves').textContent = state.moves;
    $('#winTime').textContent = formatTime(state.elapsed);
    $('#levels').hidden = true;
    beep([523, 659, 784, 1047], 0.14);
    setTimeout(() => el.win.showModal(), 600);
  }

  const inProgress = () => state && state.moves > 0 && !state.over;

  function startGame(level, reuseCats) {
    stopTimer();
    currentLevel = level;
    el.difficulty.value = level;
    const { size, cats } = LEVELS[level];
    state = newState(level, reuseCats || generateCats(size, cats));
    render();
  }

  // ---------- Dialogs ----------
  function confirmAction(title, text, yesLabel, onYes, onNo) {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmYes').textContent = yesLabel;
    el.confirm.returnValue = '';
    const yes = () => { cleanup(); el.confirm.close(); onYes(); };
    const no = () => { cleanup(); el.confirm.close(); if (onNo) onNo(); };
    const cleanup = () => {
      $('#confirmYes').removeEventListener('click', yes);
      $('#confirmNo').removeEventListener('click', no);
      el.confirm.removeEventListener('cancel', no);
    };
    $('#confirmYes').addEventListener('click', yes);
    $('#confirmNo').addEventListener('click', no);
    el.confirm.addEventListener('cancel', no, { once: true });
    el.confirm.showModal();
  }

  function guarded(title, text, yesLabel, action, onNo) {
    if (inProgress()) confirmAction(title, text, yesLabel, action, onNo);
    else action();
  }

  // ---------- Sound ----------
  function beep(freqs, dur) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      freqs.forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        const t0 = audioCtx.currentTime + i * dur;
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(audioCtx.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
      });
    } catch (_) { /* audio unavailable */ }
  }

  // ---------- Events ----------
  $('#newGame').addEventListener('click', () =>
    guarded('Start a new game?', 'Your current game will be lost.', 'New game', () => startGame(currentLevel)));

  $('#restart').addEventListener('click', () =>
    guarded('Restart this puzzle?', 'The same board will be covered again and your progress reset.', 'Restart',
      () => startGame(currentLevel, state.cats)));

  el.difficulty.addEventListener('change', () => {
    const next = el.difficulty.value;
    guarded('Change difficulty?', 'Your current game will be lost.', 'Change',
      () => startGame(next),
      () => { el.difficulty.value = currentLevel; });
  });

  el.sound.addEventListener('click', () => {
    soundOn = !soundOn;
    el.sound.setAttribute('aria-pressed', soundOn);
    el.sound.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
  });

  $('#help').addEventListener('click', () => el.help.showModal());
  el.help.querySelector('[data-close]').addEventListener('click', () => el.help.close());

  $('#playAgain').addEventListener('click', () => { el.win.close(); startGame(currentLevel); });
  $('#newDifficulty').addEventListener('click', () => { $('#levels').hidden = !$('#levels').hidden; });
  document.querySelectorAll('[data-level]').forEach((b) =>
    b.addEventListener('click', () => { el.win.close(); startGame(b.dataset.level); }));

  // Close dialogs when clicking the backdrop
  [el.help, el.win].forEach((d) =>
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  startGame('easy');
})();
