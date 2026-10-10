// --- Global State ---
let activeQuizInstance = null;
let currentQuestionIdx = 0;
let userAnswers = {};
let pendingDeleteRecordId = null;
let pendingQuizForMode = null;
let currentQuizMode = "device"; // "device" or "paper"
let selectedPaperMistakes = new Set();
let cachedDecks = [];

// --- Supabase Universal Sync Setup ---
const SUPABASE_URL = "https://uvxtokjdedebpuasvbyk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xOAPwp8cUxAYmG9CjoiNFQ_XOjNXQ25";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initManualCreator();
  initBackgroundRunner();
  updateDashboardMetrics();

  // Load cloud data and re-calculate metrics when finished
  await renderQuizList();
  await renderRecordsTable();
  updateDashboardMetrics();
});

// --- View Router ---
function switchView(viewName) {
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const target = document.getElementById('view-' + viewName);
  if (target) target.classList.add('active');

  const btn = Array.from(document.querySelectorAll('.nav-btn')).find(b =>
    b.getAttribute('onclick') && b.getAttribute('onclick').includes(viewName)
  );
  if (btn) btn.classList.add('active');
  closeSidebar();
  updateDashboardMetrics();
}

// --- Module: Quiz Library & Deck (Cloud-Synced) ---
async function renderQuizList() {
  const container = document.getElementById('available-quiz-list');
  if (!container) return;

  container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; padding: 12px 0;">Syncing quizzes from cloud...</p>`;

  try {
    const { data, error } = await sb
      .from('quiz_decks')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('uploaded_at', { ascending: false });

    if (error) throw error;

    cachedDecks = (data || []).map((q, idx) => ({
      id: q.id,
      title: q.title,
      subject: q.subject || 'General',
      sortOrder: q.sort_order ?? idx,
      uploadedAt: q.uploaded_at,
      totalQuestions: q.total_questions,
      questions: q.questions
    }));

    localStorage.setItem('quizzes', JSON.stringify(cachedDecks));
  } catch (err) {
    console.warn("Using local quiz cache:", err.message);
    cachedDecks = JSON.parse(localStorage.getItem('quizzes') || '[]');
  }

  populateEditQuizDropdown();
  updateDashboardMetrics();
  container.innerHTML = "";

  if (cachedDecks.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; padding: 12px 0;">No quizzes found in library. Upload or create one to get started.</p>`;
    return;
  }

  // Group decks by subject
  const subjectsMap = {};
  cachedDecks.forEach(deck => {
    const subj = deck.subject || 'General';
    if (!subjectsMap[subj]) subjectsMap[subj] = [];
    subjectsMap[subj].push(deck);
  });

  // Render vertical frames per subject
  Object.keys(subjectsMap).forEach(subjectName => {
    const decks = subjectsMap[subjectName];
    const safeSubjId = encodeURIComponent(subjectName).replace(/%/g, '_');

    const frame = document.createElement('div');
    frame.className = 'subject-frame';
    frame.id = `subject-frame-${safeSubjId}`;
    frame.dataset.subject = subjectName;

    frame.innerHTML = `
      <div class="subject-frame-header" onclick="toggleSubjectCollapse('${safeSubjId}')">
        <span class="subject-badge">
          📁 ${subjectName}
        </span>
        <div class="subject-header-actions">
          <button type="button" class="subject-toggle-pill" title="Click to collapse or expand">
            <span>${decks.length} Deck${decks.length > 1 ? 's' : ''}</span>
            <span class="subject-toggle-arrow">▼</span>
          </button>
        </div>
      </div>
      <div class="subject-quiz-list" data-subject="${subjectName}"></div>
    `;

    const listContainer = frame.querySelector('.subject-quiz-list');

    decks.forEach(quiz => {
      const card = document.createElement('div');
      card.className = 'quiz-card';
      card.draggable = true;
      card.dataset.id = quiz.id;
      card.dataset.subject = subjectName;

      card.innerHTML = `
        <div class="quiz-drag-handle" title="Drag to reorder">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="6" r="1"></circle>
            <circle cx="15" cy="6" r="1"></circle>
            <circle cx="9" cy="12" r="1"></circle>
            <circle cx="15" cy="12" r="1"></circle>
            <circle cx="9" cy="18" r="1"></circle>
            <circle cx="15" cy="18" r="1"></circle>
          </svg>
        </div>
        <div class="quiz-card-info">
          <strong>${quiz.title}</strong>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
            ${quiz.totalQuestions} Questions &bull; Added on ${quiz.uploadedAt}
          </p>
        </div>
        <div class="quiz-card-actions">
          <button class="btn" type="button" onclick="launchQuizById('${quiz.id}')">Start Quiz</button>
          
          <div class="card-menu-container">
            <button class="menu-trigger-btn" type="button" onclick="toggleCardMenu(event, '${quiz.id}')" title="More options" aria-label="More options">
              &#8942;
            </button>
            <div class="card-menu-dropdown" id="card-menu-${quiz.id}">
              <button class="btn-menu-rename" type="button" onclick="openRenameModal('${quiz.id}', '${encodeURIComponent(quiz.title)}')">
                ✏️ Rename
              </button>
              <button class="btn-menu-rename" type="button" onclick="openCategorizeModal('${quiz.id}')">
                📁 Change Subject
              </button>
              <button class="btn-menu-delete" type="button" onclick="deleteQuiz('${quiz.id}')">
                🗑️ Delete
              </button>
            </div>
          </div>
        </div>
      `;

      attachDragEvents(card, listContainer);
      listContainer.appendChild(card);
    });

    container.appendChild(frame);
  });
}

let draggedItem = null;

function attachDragEvents(card, container) {
  const handle = card.querySelector('.quiz-drag-handle') || card;

  // Desktop Mouse Drag
  card.addEventListener('dragstart', (e) => {
    draggedItem = card;
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('is-dragging');
    draggedItem = null;
    document.querySelectorAll('.quiz-card').forEach(c => c.classList.remove('drag-over'));
    saveReorderedDeckSequence(card.dataset.subject);
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === card) return;
    if (draggedItem.dataset.subject !== card.dataset.subject) return;

    card.classList.add('drag-over');
    const bounding = card.getBoundingClientRect();
    const offset = e.clientY - bounding.top;
    if (offset > bounding.height / 2) {
      card.after(draggedItem);
    } else {
      card.before(draggedItem);
    }
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over');
  });

  // Mobile Touch Drag
  handle.addEventListener('touchstart', (e) => {
    draggedItem = card;
    card.classList.add('is-dragging');
    if (navigator.vibrate) navigator.vibrate(25);
  }, { passive: true });

  handle.addEventListener('touchmove', (e) => {
    if (!draggedItem) return;
    const touch = e.touches[0];
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetCard = targetEl ? targetEl.closest('.quiz-card') : null;

    if (targetCard && targetCard !== draggedItem && targetCard.dataset.subject === draggedItem.dataset.subject) {
      const bounding = targetCard.getBoundingClientRect();
      const offset = touch.clientY - bounding.top;
      
      if (offset > bounding.height / 2) {
        targetCard.after(draggedItem);
      } else {
        targetCard.before(draggedItem);
      }
    }
  }, { passive: true });

  handle.addEventListener('touchend', () => {
    if (!draggedItem) return;
    card.classList.remove('is-dragging');
    card.classList.add('drop-settle');
    setTimeout(() => card.classList.remove('drop-settle'), 300);

    if (navigator.vibrate) navigator.vibrate(15);
    saveReorderedDeckSequence(card.dataset.subject);
    draggedItem = null;
  });
}

async function saveReorderedDeckSequence(subjectName) {
  const listEl = document.querySelector(`.subject-quiz-list[data-subject="${subjectName}"]`);
  if (!listEl) return;

  const cardElements = Array.from(listEl.querySelectorAll('.quiz-card'));
  const updates = [];

  cardElements.forEach((el, index) => {
    const deckId = el.dataset.id;
    const target = cachedDecks.find(d => d.id === deckId);
    if (target) {
      target.sortOrder = index;
      updates.push(sb.from('quiz_decks').update({ sort_order: index }).eq('id', deckId));
    }
  });

  localStorage.setItem('quizzes', JSON.stringify(cachedDecks));

  try {
    await Promise.all(updates);
  } catch (err) {
    console.error("Failed saving reordered decks:", err);
  }
}

function syncSliderFromInput(val) {
  const slider = document.getElementById('mode-item-range-slider');
  const input = document.getElementById('mode-item-count-input');
  let num = parseInt(val, 10);
  const max = parseInt(slider.max, 10);

  if (isNaN(num) || num < 1) num = 1;
  if (num > max) num = max;

  slider.value = num;
}

function syncInputFromSlider(val) {
  const input = document.getElementById('mode-item-count-input');
  if (input) input.value = val;
}

function launchQuizById(quizId) {
  const stored = JSON.parse(localStorage.getItem('quizzes') || '[]');
  const quiz = stored.find(q => q.id === quizId);
  if (!quiz) return;

  pendingQuizForMode = quiz;
  const total = quiz.questions.length;

  const modal = document.getElementById('quiz-mode-modal');
  const input = document.getElementById('mode-item-count-input');
  const slider = document.getElementById('mode-item-range-slider');
  const totalHint = document.getElementById('mode-total-hint');
  const maxLabel = document.getElementById('slider-max-label');

  if (input && slider) {
    input.min = 1;
    input.max = total;
    input.value = total;
    slider.min = 1;
    slider.max = total;
    slider.value = total;
    if (totalHint) totalHint.innerText = `/ ${total} items`;
    if (maxLabel) maxLabel.innerText = `${total} items (All)`;
  }

  if (modal) {
    modal.style.display = 'flex';
  } else {
    startQuizSession(quiz, 'device');
  }
}

function selectQuizMode(mode) {
  currentQuizMode = mode;
  const targetQuiz = pendingQuizForMode;
  const input = document.getElementById('mode-item-count-input');
  let limit = targetQuiz ? targetQuiz.questions.length : 1;
  
  if (input) {
    const parsed = parseInt(input.value, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= targetQuiz.questions.length) {
      limit = parsed;
    }
  }

  closeQuizModeModal();

  if (targetQuiz) {
    const limitedQuizInstance = {
      ...targetQuiz,
      totalQuestions: limit,
      questions: targetQuiz.questions.slice(0, limit)
    };

    switchView('take');
    startQuizSession(limitedQuizInstance, mode);
  }
}

function closeQuizModeModal() {
  pendingQuizForMode = null;
  const modal = document.getElementById('quiz-mode-modal');
  if (modal) modal.style.display = 'none';
}

function openRenameModal(quizId, encodedTitle) {
  const decodedTitle = decodeURIComponent(encodedTitle);
  document.getElementById('rename-quiz-id').value = quizId;
  const titleInput = document.getElementById('rename-quiz-input');
  titleInput.value = decodedTitle;

  const targetQuiz = (cachedDecks || []).find(q => q.id === quizId);
  const subjectInput = document.getElementById('rename-quiz-subject');
  if (subjectInput) {
    subjectInput.value = targetQuiz ? (targetQuiz.subject || "General") : "General";
  }
  
  const modal = document.getElementById('rename-modal');
  modal.style.display = 'flex';
  titleInput.focus();
  titleInput.select();
}

function closeRenameModal() {
  document.getElementById('rename-modal').style.display = 'none';
}

async function saveQuizRename() {
  const quizId = document.getElementById('rename-quiz-id').value;
  const newTitle = document.getElementById('rename-quiz-input').value.trim();
  const newSubject = (document.getElementById('rename-quiz-subject')?.value || "").trim() || "General";

  if (!newTitle) return;

  try {
    const { error } = await sb
      .from('quiz_decks')
      .update({ title: newTitle, subject: newSubject })
      .eq('id', quizId);

    if (error) console.error("Cloud rename failed:", error);
  } catch (err) {
    console.error("Cloud rename request error:", err);
  }

  const stored = JSON.parse(localStorage.getItem('quizzes') || '[]');
  const targetQuiz = stored.find(q => q.id === quizId);
  if (targetQuiz) {
    targetQuiz.title = newTitle;
    targetQuiz.subject = newSubject;
    localStorage.setItem('quizzes', JSON.stringify(stored));
  }

  const targetCached = (cachedDecks || []).find(q => q.id === quizId);
  if (targetCached) {
    targetCached.title = newTitle;
    targetCached.subject = newSubject;
  }

  closeRenameModal();
  await renderQuizList();
  populateEditQuizDropdown();
  updateDashboardMetrics();
}

async function deleteQuiz(quizId) {
  if (!confirm("Are you sure you want to remove this quiz from your library across all devices?")) return;
  
  try {
    await sb.from('quiz_decks').delete().eq('id', quizId);
  } catch(err) {
    console.error("Cloud deck delete failed:", err);
  }

  let stored = JSON.parse(localStorage.getItem('quizzes') || '[]');
  stored = stored.filter(q => q.id !== quizId);
  localStorage.setItem('quizzes', JSON.stringify(stored));
  cachedDecks = cachedDecks.filter(q => q.id !== quizId);
  
  await renderQuizList();
  updateDashboardMetrics();
}

// --- Module: Quiz Runner Execution ---
function startQuizSession(quiz, mode = "device") {
  activeQuizInstance = quiz;
  currentQuizMode = mode;
  currentQuestionIdx = 0;
  userAnswers = {};

  document.getElementById('quiz-deck-view').style.display = 'none';
  document.getElementById('quiz-result-summary').style.display = 'none';
  document.getElementById('quiz-active-runner').style.display = 'block';

  const modeBadge = mode === 'paper' ? ' [Pen & Paper]' : '';
  document.getElementById('active-quiz-title').innerText = quiz.title + modeBadge;

  renderActiveQuestion();
}

function renderActiveQuestion() {
  const q = activeQuizInstance.questions[currentQuestionIdx];
  const total = activeQuizInstance.questions.length;

  document.getElementById('active-progress').innerText = `Question ${currentQuestionIdx + 1} of ${total}`;
  document.getElementById('active-q-text').innerText = `${q.id}. ${q.question}`;

  const optionsBox = document.getElementById('active-options-list');
  optionsBox.innerHTML = "";

  q.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-select-btn';

    if (currentQuizMode === 'paper') {
      btn.classList.add('paper-mode');
      btn.innerHTML = `<strong>${opt.letter.toUpperCase()}.</strong> <span>${opt.text}</span>`;
    } else {
      if (userAnswers[currentQuestionIdx] === opt.letter) {
        btn.classList.add('selected');
      }
      btn.innerHTML = `<strong>${opt.letter.toUpperCase()}.</strong> <span>${opt.text}</span>`;
      btn.onclick = () => selectOption(opt.letter);
    }

    optionsBox.appendChild(btn);
  });

  const checkBtn = document.getElementById('btn-check-q');
  if (checkBtn) {
    checkBtn.style.display = currentQuizMode === 'paper' ? 'none' : 'inline-block';
  }

  document.getElementById('btn-prev-q').style.visibility = currentQuestionIdx === 0 ? 'hidden' : 'visible';
  
  const isLast = currentQuestionIdx === total - 1;
  document.getElementById('btn-next-q').style.display = isLast ? 'none' : 'inline-block';
  document.getElementById('btn-finish-q').style.display = isLast ? 'inline-block' : 'none';

  const expBox = document.getElementById('active-explanation');
  expBox.style.display = 'none';
  expBox.innerText = "";
}

function selectOption(letter) {
  userAnswers[currentQuestionIdx] = letter;
  renderActiveQuestion();
}

function changeQuestion(step) {
  currentQuestionIdx += step;
  renderActiveQuestion();
}

function checkCurrentAnswer() {
  const q = activeQuizInstance.questions[currentQuestionIdx];
  const expBox = document.getElementById('active-explanation');
  
  let html = "";
  if (q.answer) {
    html += `<strong>Correct Answer:</strong> Option ${q.answer.toUpperCase()}<br/>`;
  }
  if (q.explanation) {
    html += `<strong>Rationale:</strong> ${q.explanation}`;
  } else if (!q.answer) {
    html += `<em>No key/rationale provided for this item.</em>`;
  }

  expBox.innerHTML = html;
  expBox.style.display = 'block';
}

async function submitQuizAttempt() {
  const total = activeQuizInstance.questions.length;
  let score = 0;
  const wrongQuestions = [];

  if (currentQuizMode === 'paper') {
    document.getElementById('quiz-active-runner').style.display = 'none';
    document.getElementById('result-score-display').innerText = `Finished ${total} Items`;
    renderPaperSummary(activeQuizInstance.questions);
    document.getElementById('quiz-result-summary').style.display = 'block';
  } else {
    activeQuizInstance.questions.forEach((q, idx) => {
      const userChoice = userAnswers[idx] ? userAnswers[idx].toLowerCase() : null;
      const isCorrect = userChoice && q.answer && userChoice === q.answer.toLowerCase();

      if (isCorrect) {
        score++;
      } else {
        wrongQuestions.push({
          ...q,
          chosenAnswer: userChoice
        });
      }
    });

    const percentage = Math.round((score / total) * 100) + "%";
    const record = {
      id: "rec_" + Date.now(),
      title: activeQuizInstance.title,
      date: new Date().toISOString().split("T")[0],
      score: `${score} / ${total}`,
      percentage: percentage,
      mode: "device",
      questions: activeQuizInstance.questions,
      userAnswers: { ...userAnswers }
    };

    try {
      await sb.from('quiz_records').insert({
        id: record.id,
        title: record.title,
        date: record.date,
        score: record.score,
        percentage: record.percentage,
        mode: record.mode,
        questions: record.questions,
        user_answers: record.userAnswers
      });
    } catch (err) {
      console.error("Cloud save failed:", err);
    }

    const records = JSON.parse(localStorage.getItem('quiz_records') || '[]');
    records.unshift(record);
    localStorage.setItem('quiz_records', JSON.stringify(records));

    document.getElementById('quiz-active-runner').style.display = 'none';
    document.getElementById('result-score-display').innerText = `${score} / ${total} (${percentage})`;
    renderSummaryMistakes(wrongQuestions);
    document.getElementById('quiz-result-summary').style.display = 'block';
    
    await renderRecordsTable();
    updateDashboardMetrics();
  }
}

function renderSummaryMistakes(wrongItems) {
  const container = document.getElementById('summary-wrong-items-container');
  const list = document.getElementById('summary-wrong-items-list');
  const badge = document.getElementById('wrong-count-badge');

  if (!container || !list) return;
  list.innerHTML = '';

  if (wrongItems.length === 0) {
    container.style.display = 'none';
    return;
  }

  if (badge) {
    badge.innerText = `${wrongItems.length} Incorrect`;
    badge.style.background = "#ffe4e6";
    badge.style.color = "var(--red)";
  }
  container.style.display = 'block';

  wrongItems.forEach(q => {
    const card = document.createElement('div');
    card.className = 'review-item-card is-wrong';

    let optionsHtml = q.options.map(opt => {
      let extraClass = '';
      let labelTag = '';

      if (q.chosenAnswer && opt.letter.toLowerCase() === q.chosenAnswer) {
        extraClass = 'user-wrong';
        labelTag = ' <strong>(Your Answer)</strong>';
      }
      if (q.answer && opt.letter.toLowerCase() === q.answer.toLowerCase()) {
        extraClass = 'is-answer';
        labelTag = ' <strong>(Correct)</strong>';
      }

      return `<div class="review-opt-row ${extraClass}">
        <span>${opt.letter.toUpperCase()}.</span>
        <span>${opt.text}${labelTag}</span>
      </div>`;
    }).join('');

    card.innerHTML = `
      <span class="review-item-badge badge-wrong">Question ${q.id} &bull; Incorrect</span>
      <div style="font-weight: 800; font-size: 0.98rem; margin-bottom: 8px;">${q.question}</div>
      <div class="review-options-list">${optionsHtml}</div>
      ${q.explanation ? `<div class="explanation-callout"><strong>Rationale:</strong> ${q.explanation}</div>` : ''}
    `;
    list.appendChild(card);
  });
}

function renderPaperSummary(questions) {
  const container = document.getElementById('summary-wrong-items-container');
  const list = document.getElementById('summary-wrong-items-list');
  const badge = document.getElementById('wrong-count-badge');

  if (!container || !list) return;
  list.innerHTML = '';
  if (badge) {
    badge.innerText = `Answer Key (${questions.length} Items)`;
    badge.style.background = "var(--accent-mint)";
    badge.style.color = "var(--primary)";
  }
  container.style.display = 'block';

  questions.forEach(q => {
    const card = document.createElement('div');
    card.className = 'review-item-card';

    let optionsHtml = q.options.map(opt => {
      const isCorrect = q.answer && opt.letter.toLowerCase() === q.answer.toLowerCase();
      return `<div class="review-opt-row ${isCorrect ? 'is-answer' : 'paper-neutral'}">
        <span>${opt.letter.toUpperCase()}.</span>
        <span>${opt.text}${isCorrect ? ' <strong>(Correct Key)</strong>' : ''}</span>
      </div>`;
    }).join('');

    card.innerHTML = `
      <span class="review-item-badge badge-paper">Question ${q.id} &bull; Answer Key</span>
      <div style="font-weight: 800; font-size: 0.98rem; margin-bottom: 8px;">${q.question}</div>
      <div class="review-options-list">${optionsHtml}</div>
      ${q.explanation ? `<div class="explanation-callout"><strong>Rationale:</strong> ${q.explanation}</div>` : ''}
    `;
    list.appendChild(card);
  });
}

function exitQuizRunner() {
  if (currentQuizMode === 'paper' && activeQuizInstance) {
    openPaperScoreModal();
  } else {
    finishAndReturnToLibrary();
  }
}

// --- Module: Pen & Paper Itemized Mistakes Logger ---
function openPaperScoreModal() {
  if (!activeQuizInstance) return;
  const total = activeQuizInstance.questions.length;
  selectedPaperMistakes.clear();

  const container = document.getElementById('paper-items-grid');
  if (!container) return;
  container.innerHTML = '';

  const baseSize = Math.floor(total / 3);
  const remainder = total % 3;
  const colSizes = [
    baseSize + (remainder > 0 ? 1 : 0),
    baseSize + (remainder > 1 ? 1 : 0),
    baseSize
  ];

  let currentItemIdx = 0;

  for (let c = 0; c < 3; c++) {
    const colDiv = document.createElement('div');
    colDiv.className = 'paper-col';

    for (let i = 0; i < colSizes[c]; i++) {
      if (currentItemIdx >= total) break;
      
      const qIndex = currentItemIdx;
      const qNum = currentItemIdx + 1;

      const itemCard = document.createElement('div');
      itemCard.className = 'mistake-check-item';
      itemCard.id = `paper-item-${qIndex}`;
      itemCard.innerHTML = `
        <span>Item ${qNum}</span>
        <div class="mistake-box"></div>
      `;

      itemCard.onclick = () => togglePaperMistake(qIndex);
      colDiv.appendChild(itemCard);
      currentItemIdx++;
    }
    container.appendChild(colDiv);
  }

  updatePaperMistakeSummary(total);

  const modal = document.getElementById('paper-score-modal');
  if (modal) modal.style.display = 'flex';
}

function togglePaperMistake(index) {
  const itemEl = document.getElementById(`paper-item-${index}`);
  if (selectedPaperMistakes.has(index)) {
    selectedPaperMistakes.delete(index);
    if (itemEl) itemEl.classList.remove('is-wrong');
  } else {
    selectedPaperMistakes.add(index);
    if (itemEl) itemEl.classList.add('is-wrong');
  }

  const total = activeQuizInstance ? activeQuizInstance.questions.length : 0;
  updatePaperMistakeSummary(total);
}

function updatePaperMistakeSummary(total) {
  const summaryEl = document.getElementById('paper-mistake-summary');
  if (!summaryEl) return;
  const mistakes = selectedPaperMistakes.size;
  const score = total - mistakes;
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

  summaryEl.innerHTML = `Score: <strong>${score} / ${total} (${percentage}%)</strong> &bull; Mistakes: <strong>${mistakes}</strong>`;
}

async function confirmPaperScoreLogging() {
  const total = activeQuizInstance ? activeQuizInstance.questions.length : 0;
  const mistakes = selectedPaperMistakes.size;
  const score = total - mistakes;
  const percentage = total > 0 ? Math.round((score / total) * 100) + "%" : "0%";

  const syntheticAnswers = {};
  activeQuizInstance.questions.forEach((q, idx) => {
    if (selectedPaperMistakes.has(idx)) {
      syntheticAnswers[idx] = "__WRONG__";
    } else {
      syntheticAnswers[idx] = q.answer ? q.answer.toLowerCase() : "correct";
    }
  });

  const record = {
    id: "rec_" + Date.now(),
    title: activeQuizInstance.title + " (Pen & Paper)",
    date: new Date().toISOString().split("T")[0],
    score: `${score} / ${total}`,
    percentage: percentage,
    mode: "paper",
    mistakesCount: mistakes,
    mistakenIndices: Array.from(selectedPaperMistakes),
    questions: activeQuizInstance.questions,
    userAnswers: syntheticAnswers
  };

  try {
    await sb.from('quiz_records').insert({
      id: record.id,
      title: record.title,
      date: record.date,
      score: record.score,
      percentage: record.percentage,
      mode: record.mode,
      mistakes_count: record.mistakesCount,
      mistaken_indices: record.mistakenIndices,
      questions: record.questions,
      user_answers: record.userAnswers
    });
  } catch (err) {
    console.error("Cloud save failed:", err);
  }

  const records = JSON.parse(localStorage.getItem('quiz_records') || '[]');
  records.unshift(record);
  localStorage.setItem('quiz_records', JSON.stringify(records));

  await renderRecordsTable();
  updateDashboardMetrics();
  closePaperScoreModal();
  finishAndReturnToLibrary();
}

function closePaperScoreModal() {
  const modal = document.getElementById('paper-score-modal');
  if (modal) modal.style.display = 'none';
}

function skipPaperScoreLogging() {
  closePaperScoreModal();
  finishAndReturnToLibrary();
}

function finishAndReturnToLibrary() {
  document.getElementById('quiz-active-runner').style.display = 'none';
  document.getElementById('quiz-result-summary').style.display = 'none';
  document.getElementById('quiz-deck-view').style.display = 'block';
  activeQuizInstance = null;
}

// --- Module: Quiz Records Table ---
async function renderRecordsTable() {
  const tbody = document.getElementById('records-table-body');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 18px;">Syncing latest records...</td></tr>`;

  let records = [];

  try {
    const { data, error } = await sb
      .from('quiz_records')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    records = (data || []).map(r => ({
      id: r.id,
      title: r.title,
      date: r.date,
      score: r.score,
      percentage: r.percentage,
      mode: r.mode,
      mistakesCount: r.mistakes_count,
      mistakenIndices: r.mistaken_indices,
      questions: r.questions,
      userAnswers: r.user_answers
    }));

    localStorage.setItem('quiz_records', JSON.stringify(records));
  } catch (err) {
    console.warn("Using local cache:", err.message);
    records = JSON.parse(localStorage.getItem('quiz_records') || '[]');
  }

  tbody.innerHTML = "";
  updateDashboardMetrics();

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 18px;">No attempts logged yet.</td></tr>`;
    return;
  }

  records.forEach((r, idx) => {
    const recordId = r.id || `rec_${idx}`;
    const row = document.createElement('tr');
    
    row.onclick = (e) => {
      if (e.target.closest('button')) return;
      openFullAttemptReview(recordId);
    };

    row.innerHTML = `
      <td><strong>${r.title}</strong></td>
      <td>${r.date}</td>
      <td>${r.score}</td>
      <td><span style="color: var(--primary); font-weight: 800;">${r.percentage}</span></td>
      <td style="text-align: center;">
        <button class="btn btn-danger" style="padding: 5px 12px; font-size: 0.8rem; white-space: nowrap;" type="button" onclick="handleDeleteRecordClick('${recordId}', ${idx})">
          Delete
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function openFullAttemptReview(recordId) {
  const records = JSON.parse(localStorage.getItem('quiz_records') || '[]');
  const record = records.find(r => r.id === recordId);
  if (!record || !record.questions) {
    alert("Full question breakdown not available for this record.");
    return;
  }

  const isPaperMode = record.mode === 'paper';

  document.getElementById('review-panel-title').innerText = `Review: ${record.title}`;
  document.getElementById('review-panel-subtitle').innerText = `Attempted on ${record.date}`;
  document.getElementById('review-score-text').innerText = record.score;
  document.getElementById('review-accuracy-text').innerText = record.percentage;

  const container = document.getElementById('review-all-questions-list');
  container.innerHTML = '';

  record.questions.forEach((q, idx) => {
    const card = document.createElement('div');

    if (isPaperMode) {
      const isMistake = record.mistakenIndices 
        ? record.mistakenIndices.includes(idx) 
        : (record.userAnswers && record.userAnswers[idx] === "__WRONG__");

      card.className = `review-item-card ${isMistake ? 'is-wrong' : 'is-correct'}`;

      let optionsHtml = q.options.map(opt => {
        const isAnswer = q.answer && opt.letter.toLowerCase() === q.answer.toLowerCase();
        return `<div class="review-opt-row ${isAnswer ? 'is-answer' : 'paper-neutral'}">
          <span>${opt.letter.toUpperCase()}.</span>
          <span>${opt.text}${isAnswer ? ' <strong>(Correct Key)</strong>' : ''}</span>
        </div>`;
      }).join('');

      card.innerHTML = `
        <span class="review-item-badge ${isMistake ? 'badge-wrong' : 'badge-correct'}">
          Question ${idx + 1} &bull; ${isMistake ? '❌ Marked Wrong' : '✓ Correct'}
        </span>
        <div style="font-weight: 800; font-size: 1rem; margin-bottom: 8px;">${q.id || idx + 1}. ${q.question}</div>
        <div class="review-options-list">${optionsHtml}</div>
        ${q.explanation ? `<div class="explanation-callout"><strong>Rationale:</strong> ${q.explanation}</div>` : ''}
      `;
    } else {
      const userChoice = record.userAnswers && record.userAnswers[idx] ? record.userAnswers[idx].toLowerCase() : null;
      const isCorrect = userChoice && q.answer && userChoice === q.answer.toLowerCase();
      card.className = `review-item-card ${isCorrect ? 'is-correct' : 'is-wrong'}`;

      let optionsHtml = q.options.map(opt => {
        let extraClass = '';
        let tag = '';

        if (userChoice && opt.letter.toLowerCase() === userChoice) {
          extraClass = isCorrect ? 'is-answer' : 'user-wrong';
          tag = isCorrect ? ' <strong>(Your Correct Answer)</strong>' : ' <strong>(Your Answer)</strong>';
        } else if (q.answer && opt.letter.toLowerCase() === q.answer.toLowerCase()) {
          extraClass = 'is-answer';
          tag = ' <strong>(Correct Answer)</strong>';
        }

        return `<div class="review-opt-row ${extraClass}">
          <span>${opt.letter.toUpperCase()}.</span>
          <span>${opt.text}${tag}</span>
        </div>`;
      }).join('');

      card.innerHTML = `
        <span class="review-item-badge ${isCorrect ? 'badge-correct' : 'badge-wrong'}">
          Question ${idx + 1} &bull; ${isCorrect ? 'Correct' : 'Mistake'}
        </span>
        <div style="font-weight: 800; font-size: 1rem; margin-bottom: 8px;">${q.id || idx + 1}. ${q.question}</div>
        <div class="review-options-list">${optionsHtml}</div>
        ${q.explanation ? `<div class="explanation-callout"><strong>Rationale:</strong> ${q.explanation}</div>` : ''}
      `;
    }

    container.appendChild(card);
  });

  switchView('review');
}

function handleDeleteRecordClick(recordId, index) {
  const modal = document.getElementById('delete-record-modal');
  if (modal) {
    pendingDeleteRecordId = recordId;
    modal.style.display = 'flex';
  } else {
    if (confirm("Are you sure you want to permanently delete this attempt record?")) {
      executeDeleteRecord(recordId, index);
    }
  }
}

async function executeDeleteRecord(recordId, index) {
  try {
    await sb.from('quiz_records').delete().eq('id', recordId);
  } catch (err) {
    console.error("Cloud delete failed:", err);
  }

  let records = JSON.parse(localStorage.getItem('quiz_records') || '[]');
  records = records.filter(r => r.id !== recordId);
  localStorage.setItem('quiz_records', JSON.stringify(records));
  await renderRecordsTable();
  updateDashboardMetrics();
}

function closeDeleteRecordModal() {
  pendingDeleteRecordId = null;
  const modal = document.getElementById('delete-record-modal');
  if (modal) modal.style.display = 'none';
}

function confirmDeleteRecord() {
  if (!pendingDeleteRecordId) return;
  executeDeleteRecord(pendingDeleteRecordId);
  closeDeleteRecordModal();
}

async function clearAllRecords() {
  const records = JSON.parse(localStorage.getItem('quiz_records') || '[]');
  if (records.length === 0) return;

  if (confirm("Are you sure you want to permanently clear all quiz records across all devices?")) {
    try {
      await sb.from('quiz_records').delete().neq('id', 'placeholder');
    } catch (err) {
      console.error("Cloud clear failed:", err);
    }

    localStorage.removeItem('quiz_records');
    await renderRecordsTable();
    updateDashboardMetrics();
  }
}

// --- Module: Upload & Parser Engine ---
async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  const titleInput = document.getElementById('quiz-title-input');
  if (!titleInput.value.trim()) {
    titleInput.value = file.name.replace(/\.[^/.]+$/, "");
  }

  showStatus("Reading file: " + file.name, "success");

  try {
    if (ext === 'docx') {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
      document.getElementById('raw-paste').value = result.value;
    } else if (ext === 'txt' || ext === 'json' || ext === 'csv') {
      document.getElementById('raw-paste').value = await file.text();
    }
    processAndLoadQuiz();
  } catch (err) {
    showStatus("Error reading file: " + err.message, "error");
  }
}

function parseFormattedText(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  let questionSection = [];
  let answerSection = [];
  let inAnswers = false;

  for (let line of lines) {
    if (/^(answers?|answer\s*key|rationales?):?/i.test(line)) {
      inAnswers = true;
      continue;
    }
    if (inAnswers) {
      answerSection.push(line);
    } else {
      questionSection.push(line);
    }
  }

  const questions = [];
  let curQ = null;

  for (let line of questionSection) {
    const qMatch = line.match(/^(\d+)[\.\)]\s*(.+)/i);
    const optMatch = line.match(/^([a-d])[\.\)]\s*(.+)/i);

    if (qMatch) {
      if (curQ) questions.push(curQ);
      curQ = {
        id: parseInt(qMatch[1], 10),
        question: qMatch[2].trim(),
        options: [],
        answer: "",
        explanation: ""
      };
    } else if (optMatch && curQ) {
      curQ.options.push({
        letter: optMatch[1].toLowerCase(),
        text: optMatch[2].trim()
      });
    } else if (curQ && curQ.options.length === 0) {
      curQ.question += " " + line;
    }
  }
  if (curQ) questions.push(curQ);

  for (let line of answerSection) {
    const ansMatch = line.match(/^(\d+)[\.\)]\s*([a-d])?[\.\-\:\)]?\s*(.*)/i);
    if (ansMatch) {
      const num = parseInt(ansMatch[1], 10);
      const qObj = questions.find(q => q.id === num);
      if (qObj) {
        if (ansMatch[2]) qObj.answer = ansMatch[2].toLowerCase();
        qObj.explanation = ansMatch[3] ? ansMatch[3].replace(/^(explanation|rationale):?\s*/i, "").trim() : "";
      }
    }
  }
  return questions;
}

function parseJSON(text) {
  const data = JSON.parse(text);
  const items = Array.isArray(data) ? data : data.questions;
  return items.map((q, idx) => ({
    id: idx + 1,
    question: q.question,
    options: Array.isArray(q.options) 
      ? q.options.map((opt, i) => ({ letter: String.fromCharCode(97 + i), text: opt })) 
      : [],
    answer: (q.answer || "").toLowerCase(),
    explanation: q.explanation || q.rationale || ""
  }));
}

async function processAndLoadQuiz() {
  const text = document.getElementById('raw-paste').value.trim();
  const title = document.getElementById('quiz-title-input').value.trim() || "Untitled Assessment";
  const subject = (document.getElementById('quiz-subject-input')?.value || "").trim() || "General";

  if (!text) {
    showStatus("Please paste content or upload a valid quiz file.", "error");
    return;
  }

  let parsedQuestions = [];
  try {
    if (text.startsWith("{") || text.startsWith("[")) {
      parsedQuestions = parseJSON(text);
    } else {
      parsedQuestions = parseFormattedText(text);
    }

    if (parsedQuestions.length === 0) {
      showStatus("No valid questions detected. Verify numbering format.", "error");
      return;
    }

    const quizRecord = {
      id: "quiz_" + Date.now(),
      title: title,
      subject: subject,
      sortOrder: (cachedDecks || []).length,
      uploadedAt: new Date().toISOString().split("T")[0],
      totalQuestions: parsedQuestions.length,
      questions: parsedQuestions
    };

    try {
      await sb.from('quiz_decks').upsert({
        id: quizRecord.id,
        title: quizRecord.title,
        subject: quizRecord.subject,
        sort_order: quizRecord.sortOrder,
        uploaded_at: quizRecord.uploadedAt,
        total_questions: quizRecord.totalQuestions,
        questions: quizRecord.questions
      });
    } catch (err) {
      console.error("Cloud deck save failed:", err);
    }

    const stored = JSON.parse(localStorage.getItem('quizzes') || '[]');
    stored.unshift(quizRecord);
    localStorage.setItem('quizzes', JSON.stringify(stored));

    clearUploadForm();
    await renderQuizList();
    updateDashboardMetrics();
    switchView('take');
    startQuizSession(quizRecord, 'device');
  } catch (err) {
    showStatus("Parsing failed: " + err.message, "error");
  }
}

function clearUploadForm() {
  document.getElementById('raw-paste').value = "";
  document.getElementById('quiz-title-input').value = "";
  document.getElementById('file-input').value = "";
  const box = document.getElementById('upload-status');
  if (box) box.style.display = 'none';
  const subjectInput = document.getElementById('quiz-subject-input');
  if (subjectInput) subjectInput.value = "";
}

function showStatus(msg, type) {
  const box = document.getElementById('upload-status');
  if (!box) return;
  box.className = 'status-box ' + type;
  box.innerText = msg;
}

// --- Module: Manual Quiz Creator & Editor ---
let questionCounter = 0;

function initManualCreator() {
  const container = document.getElementById("creator-questions-container");
  if (!container) return;
  
  populateEditQuizDropdown();
  startFreshQuizCreation();
}

function populateEditQuizDropdown() {
  const dropdown = document.getElementById("select-edit-quiz");
  if (!dropdown) return;

  const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  dropdown.innerHTML = `<option value="">-- Choose a quiz to load and edit --</option>`;

  stored.forEach(quiz => {
    const opt = document.createElement("option");
    opt.value = quiz.id;
    opt.innerText = `${quiz.title} (${quiz.totalQuestions} items)`;
    dropdown.appendChild(opt);
  });
}

function startFreshQuizCreation() {
  const editingIdInput = document.getElementById("editing-quiz-id");
  if (editingIdInput) editingIdInput.value = "";
  
  const titleInput = document.getElementById("create-quiz-title");
  if (titleInput) titleInput.value = "";
  
  // Clean initialization (No undefined variable crash)
  const subjectInput = document.getElementById("create-quiz-subject");
  if (subjectInput) subjectInput.value = "General";
  
  const heading = document.getElementById("creator-heading");
  if (heading) heading.innerText = "Manual Quiz Creator";
  
  const saveBtn = document.getElementById("btn-save-creator");
  if (saveBtn) saveBtn.innerText = "Save & Open in Library";
  
  const resetBtn = document.getElementById("btn-creator-reset");
  if (resetBtn) resetBtn.style.display = "none";
  
  const selectEdit = document.getElementById("select-edit-quiz");
  if (selectEdit) selectEdit.value = "";

  const container = document.getElementById("creator-questions-container");
  if (container) {
    container.innerHTML = "";
    questionCounter = 0;
    addQuestionBlock();
  }
}

function loadQuizForEditing(explicitId = null) {
  const quizId = explicitId || document.getElementById("select-edit-quiz").value;
  if (!quizId) return;

  const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  const quiz = stored.find(q => q.id === quizId);
  if (!quiz) return;

  document.getElementById("editing-quiz-id").value = quiz.id;
  document.getElementById("create-quiz-title").value = quiz.title;
  
  const subjectInput = document.getElementById("create-quiz-subject");
  if (subjectInput) subjectInput.value = quiz.subject || "General";

  document.getElementById("creator-heading").innerText = `Editing: ${quiz.title}`;
  document.getElementById("btn-save-creator").innerText = "Update Quiz";
  document.getElementById("btn-creator-reset").style.display = "inline-block";

  const container = document.getElementById("creator-questions-container");
  container.innerHTML = "";
  questionCounter = 0;

  quiz.questions.forEach(q => {
    addQuestionBlock({
      question: q.question,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation
    });
  });

  const statusBox = document.getElementById("create-status");
  if (statusBox) {
    statusBox.className = "status-box success";
    statusBox.innerText = `Loaded "${quiz.title}" for editing.`;
    setTimeout(() => { statusBox.style.display = "none"; }, 3000);
  }
}

function addQuestionBlock(data = null) {
  questionCounter++;
  const container = document.getElementById("creator-questions-container");
  if (!container) return;

  const block = document.createElement("div");
  block.className = "create-question-card";
  block.id = `q-card-${questionCounter}`;

  const promptVal = data ? data.question : "";
  const expVal = data ? (data.explanation || "") : "";
  const optA = data && data.options && data.options[0] ? data.options[0].text : "";
  const optB = data && data.options && data.options[1] ? data.options[1].text : "";
  const optC = data && data.options && data.options[2] ? data.options[2].text : "";
  const optD = data && data.options && data.options[3] ? data.options[3].text : "";
  const correctOpt = data ? (data.answer || "a") : "a";

  block.innerHTML = `
    <div class="create-card-header">
      <strong style="color: var(--primary);">Question ${questionCounter}</strong>
      <button type="button" class="btn btn-danger" style="padding: 3px 8px; font-size: 0.75rem;" onclick="removeQuestionBlock(${questionCounter})">Remove</button>
    </div>

    <div class="form-group">
      <input type="text" class="q-input-prompt" placeholder="Enter question prompt..." value="${promptVal.replace(/"/g, '&quot;')}" />
    </div>

    <div class="options-input-grid">
      <div class="input-with-label"><span>A</span><input type="text" class="opt-val" data-opt="a" placeholder="Option A text" value="${optA.replace(/"/g, '&quot;')}" /></div>
      <div class="input-with-label"><span>B</span><input type="text" class="opt-val" data-opt="b" placeholder="Option B text" value="${optB.replace(/"/g, '&quot;')}" /></div>
      <div class="input-with-label"><span>C</span><input type="text" class="opt-val" data-opt="c" placeholder="Option C text" value="${optC.replace(/"/g, '&quot;')}" /></div>
      <div class="input-with-label"><span>D</span><input type="text" class="opt-val" data-opt="d" placeholder="Option D text" value="${optD.replace(/"/g, '&quot;')}" /></div>
    </div>

    <div style="display: grid; grid-template-columns: 140px 1fr; gap: 12px; align-items: start;">
      <div class="form-group" style="margin-bottom: 0;">
        <label>Correct Answer</label>
        <select class="correct-opt-select" style="padding: 9px; border: 1px solid var(--border-subtle); border-radius: 6px; width: 100%; outline: none;">
          <option value="a" ${correctOpt === 'a' ? 'selected' : ''}>Option A</option>
          <option value="b" ${correctOpt === 'b' ? 'selected' : ''}>Option B</option>
          <option value="c" ${correctOpt === 'c' ? 'selected' : ''}>Option C</option>
          <option value="d" ${correctOpt === 'd' ? 'selected' : ''}>Option D</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label>Rationale / Explanation (Optional)</label>
        <input type="text" class="q-input-explanation" placeholder="Why this option is correct..." value="${expVal.replace(/"/g, '&quot;')}" />
      </div>
    </div>
  `;
  container.appendChild(block);
  renumberQuestionBlocks();
}

function removeQuestionBlock(id) {
  const card = document.getElementById(`q-card-${id}`);
  if (card) card.remove();
  renumberQuestionBlocks();
}

function renumberQuestionBlocks() {
  const cards = document.querySelectorAll(".create-question-card");
  cards.forEach((card, index) => {
    const headerTitle = card.querySelector(".create-card-header strong");
    if (headerTitle) headerTitle.innerText = `Question ${index + 1}`;
  });
}

async function saveManualQuiz() {
  const titleInput = document.getElementById("create-quiz-title");
  const title = titleInput.value.trim() || "Untitled Quiz";
  const subjectInput = document.getElementById("create-quiz-subject");
  const subject = (subjectInput?.value || "").trim() || "General";
  const cards = document.querySelectorAll(".create-question-card");
  const statusBox = document.getElementById("create-status");
  const editingId = document.getElementById("editing-quiz-id").value;

  if (cards.length === 0) {
    statusBox.className = "status-box error";
    statusBox.innerText = "Please add at least one question before saving.";
    return;
  }

  const parsedQuestions = [];
  let hasIncomplete = false;

  cards.forEach((card, index) => {
    const prompt = card.querySelector(".q-input-prompt").value.trim();
    const optInputs = card.querySelectorAll(".opt-val");
    const correctOpt = card.querySelector(".correct-opt-select").value;
    const explanation = card.querySelector(".q-input-explanation").value.trim();

    if (!prompt) hasIncomplete = true;

    const options = [];
    optInputs.forEach(input => {
      const val = input.value.trim();
      if (!val) hasIncomplete = true;
      options.push({
        letter: input.getAttribute("data-opt"),
        text: val
      });
    });

    parsedQuestions.push({
      id: index + 1,
      question: prompt,
      options: options,
      answer: correctOpt,
      explanation: explanation
    });
  });

  if (hasIncomplete) {
    statusBox.className = "status-box error";
    statusBox.innerText = "Please fill in all question prompts and their 4 choices.";
    return;
  }

  const quizObj = {
    id: editingId || ("quiz_" + Date.now()),
    title: title,
    subject: subject,
    sortOrder: (cachedDecks || []).length,
    uploadedAt: new Date().toISOString().split("T")[0],
    totalQuestions: parsedQuestions.length,
    questions: parsedQuestions
  };

  try {
    await sb.from('quiz_decks').upsert({
      id: quizObj.id,
      title: quizObj.title,
      subject: quizObj.subject,
      sort_order: quizObj.sortOrder,
      uploaded_at: quizObj.uploadedAt,
      total_questions: quizObj.totalQuestions,
      questions: quizObj.questions
    });
  } catch (err) {
    console.error("Cloud deck save failed:", err);
  }

  let stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  if (editingId) {
    const targetIdx = stored.findIndex(q => q.id === editingId);
    if (targetIdx !== -1) stored[targetIdx] = quizObj;
  } else {
    stored.unshift(quizObj);
  }
  localStorage.setItem("quizzes", JSON.stringify(stored));

  startFreshQuizCreation();
  populateEditQuizDropdown();
  await renderQuizList();
  updateDashboardMetrics();
  switchView("take");
}

// --- Module: Mobile Sidebar Navigation ---
function toggleSidebar() {
  const sidebar = document.getElementById('main-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  const isOpen = sidebar.classList.toggle('open');
  if (backdrop) backdrop.classList.toggle('active', isOpen);
}

function closeSidebar() {
  const sidebar = document.getElementById('main-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
}

// --- Module: Theme Management ---
function initTheme() {
  const savedTheme = localStorage.getItem('quizhub_theme') || 'normal';
  setTheme(savedTheme);
}

function setTheme(themeName) {
  const root = document.documentElement;
  const btnDoraemon = document.getElementById('theme-btn-doraemon');
  const btnNormal = document.getElementById('theme-btn-normal');

  if (themeName === 'normal') {
    root.setAttribute('data-theme', 'normal');
    if (btnNormal) btnNormal.classList.add('active');
    if (btnDoraemon) btnDoraemon.classList.remove('active');
  } else {
    root.removeAttribute('data-theme');
    if (btnDoraemon) btnDoraemon.classList.add('active');
    if (btnNormal) btnNormal.classList.remove('active');
  }

  localStorage.setItem('quizhub_theme', themeName);
}

// --- Module: Backup Import & Export Engine ---
function exportDataBackup() {
  const quizzes = JSON.parse(localStorage.getItem('quizzes') || '[]');
  const records = JSON.parse(localStorage.getItem('quiz_records') || '[]');

  const backupData = {
    app: "QuizHub",
    version: "1.0",
    exportedAt: new Date().toISOString(),
    quizzes: quizzes,
    quiz_records: records
  };

  const jsonString = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
  const downloadAnchor = document.createElement('a');
  const dateStamp = new Date().toISOString().split('T')[0];
  
  downloadAnchor.setAttribute("href", jsonString);
  downloadAnchor.setAttribute("download", `QuizHub_Backup_${dateStamp}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function triggerImportFileInput() {
  const input = document.getElementById('backup-file-input');
  if (input) {
    input.value = ""; 
    input.click();
  }
}

function handleBackupFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.quizzes && !data.quiz_records) {
        alert("Invalid backup file: Expected QuizHub backup data.");
        return;
      }

      const confirmRestore = confirm(
        `Restore backup from ${data.exportedAt ? data.exportedAt.split('T')[0] : 'file'}?\n` +
        `• Quizzes: ${data.quizzes ? data.quizzes.length : 0}\n` +
        `• Records: ${data.quiz_records ? data.quiz_records.length : 0}\n\n` +
        `Click OK to restore local data with this backup.`
      );

      if (!confirmRestore) return;

      if (Array.isArray(data.quizzes)) {
        localStorage.setItem('quizzes', JSON.stringify(data.quizzes));
      }
      if (Array.isArray(data.quiz_records)) {
        localStorage.setItem('quiz_records', JSON.stringify(data.quiz_records));
      }

      await renderQuizList();
      await renderRecordsTable();
      populateEditQuizDropdown();
      updateDashboardMetrics();

      alert("Backup successfully restored!");
    } catch (err) {
      alert("Error parsing backup JSON file: " + err.message);
    }
  };

  reader.readAsText(file);
}

// --- Manual Cloud Push: LocalStorage -> Supabase ---
async function pushLocalDataToSupabase() {
  const localRecords = JSON.parse(localStorage.getItem('quiz_records') || '[]');
  const localQuizzes = JSON.parse(localStorage.getItem('quizzes') || '[]');

  if (localRecords.length === 0 && localQuizzes.length === 0) {
    alert("No local data found to push.");
    return;
  }

  let failCount = 0;

  for (const r of localRecords) {
    const { error } = await sb.from('quiz_records').upsert({
      id: r.id || ("rec_" + Date.now()),
      title: r.title || "Untitled Attempt",
      date: r.date || new Date().toISOString().split("T")[0],
      score: r.score || "0 / 0",
      percentage: r.percentage || "0%",
      mode: r.mode || "device",
      mistakes_count: r.mistakesCount || 0,
      mistaken_indices: r.mistakenIndices || [],
      questions: r.questions || [],
      user_answers: r.userAnswers || {}
    });
    if (error) failCount++;
  }

  for (const q of localQuizzes) {
    const { error } = await sb.from('quiz_decks').upsert({
      id: q.id || ("quiz_" + Date.now()),
      title: q.title || "Untitled Quiz",
      subject: q.subject || "General",
      sort_order: q.sortOrder ?? 0,
      uploaded_at: q.uploadedAt || new Date().toISOString().split("T")[0],
      total_questions: q.totalQuestions || 0,
      questions: q.questions || []
    });
    if (error) failCount++;
  }

  if (failCount === 0) {
    alert(`Successfully synced all quizzes and records to the cloud!`);
  } else {
    alert(`Sync finished, but ${failCount} items failed to upload.`);
  }

  await renderRecordsTable();
  await renderQuizList();
  updateDashboardMetrics();
}

function initBackgroundRunner() {
  // Handled cleanly
}

// --- Live Dashboard Metrics Calculator ---
function updateDashboardMetrics() {
  let totalDecksCount = 0;
  if (Array.isArray(cachedDecks) && cachedDecks.length > 0) {
    totalDecksCount = cachedDecks.length;
  } else {
    try {
      const localDecks = JSON.parse(localStorage.getItem('quizzes') || '[]');
      totalDecksCount = localDecks.length;
    } catch (e) {
      totalDecksCount = 0;
    }
  }

  let records = [];
  try {
    records = JSON.parse(localStorage.getItem('quiz_records') || '[]');
  } catch (e) {
    records = [];
  }

  const totalDecksEl = document.getElementById('dash-total-decks');
  const totalAttemptsEl = document.getElementById('dash-total-attempts');
  const avgAccuracyEl = document.getElementById('dash-avg-accuracy');

  if (totalDecksEl) totalDecksEl.innerText = totalDecksCount;
  if (totalAttemptsEl) totalAttemptsEl.innerText = records.length;

  if (avgAccuracyEl) {
    if (records.length === 0) {
      avgAccuracyEl.innerText = '0%';
    } else {
      let sumPct = 0;
      let validCount = 0;

      records.forEach(r => {
        let val = 0;
        if (r.percentage !== undefined && r.percentage !== null) {
          val = parseFloat(String(r.percentage).replace('%', ''));
        } else if (r.score !== undefined && r.totalQuestions) {
          val = (parseFloat(r.score) / parseFloat(r.totalQuestions)) * 100;
        }

        if (!isNaN(val)) {
          sumPct += val;
          validCount++;
        }
      });

      avgAccuracyEl.innerText = validCount > 0 ? `${Math.round(sumPct / validCount)}%` : '0%';
    }
  }
}

// Realtime search bar filter
function filterQuizzesRealtime(query) {
  const term = query.toLowerCase().trim();
  const cards = document.querySelectorAll('.quiz-card');

  cards.forEach(card => {
    const title = card.querySelector('strong')?.innerText.toLowerCase() || "";
    const subject = card.dataset.subject?.toLowerCase() || "";
    const matches = title.includes(term) || subject.includes(term);
    card.style.display = matches ? 'flex' : 'none';
  });

  document.querySelectorAll('.subject-frame').forEach(frame => {
    const visibleCards = frame.querySelectorAll('.quiz-card:not([style*="display: none"])');
    frame.style.display = visibleCards.length > 0 ? 'block' : 'none';
  });
}

function toggleCardMenu(event, quizId) {
  event.stopPropagation();
  const targetDropdown = document.getElementById(`card-menu-${quizId}`);
  const isCurrentlyOpen = targetDropdown?.classList.contains('show');

  document.querySelectorAll('.card-menu-dropdown').forEach(d => d.classList.remove('show'));

  if (!isCurrentlyOpen && targetDropdown) {
    targetDropdown.classList.add('show');
  }
}

document.addEventListener('click', () => {
  document.querySelectorAll('.card-menu-dropdown').forEach(d => d.classList.remove('show'));
});

function openCategorizeModal(quizId) {
  document.querySelectorAll('.card-menu-dropdown').forEach(d => d.classList.remove('show'));

  const targetQuiz = (cachedDecks || []).find(q => q.id === quizId);
  if (!targetQuiz) return;

  document.getElementById('categorize-quiz-id').value = quizId;
  const input = document.getElementById('categorize-subject-input');
  const select = document.getElementById('categorize-subject-select');
  
  const currentSubject = targetQuiz.subject || "General";
  input.value = currentSubject;

  const uniqueSubjects = Array.from(new Set((cachedDecks || []).map(d => d.subject || "General")));
  
  select.innerHTML = '<option value="">-- Choose Existing Subject --</option>';
  uniqueSubjects.forEach(subj => {
    const opt = document.createElement('option');
    opt.value = subj;
    opt.innerText = subj;
    if (subj.toLowerCase() === currentSubject.toLowerCase()) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  const modal = document.getElementById('categorize-modal');
  if (modal) modal.style.display = 'flex';
}

function syncCategorizeInput(val) {
  if (val) {
    document.getElementById('categorize-subject-input').value = val;
  }
}

function closeCategorizeModal() {
  const modal = document.getElementById('categorize-modal');
  if (modal) modal.style.display = 'none';
}

async function saveSubjectCategorization() {
  const quizId = document.getElementById('categorize-quiz-id').value;
  const newSubject = (document.getElementById('categorize-subject-input').value || "").trim() || "General";

  if (!quizId) return;

  try {
    const { error } = await sb
      .from('quiz_decks')
      .update({ subject: newSubject })
      .eq('id', quizId);

    if (error) console.error("Cloud category update failed:", error);
  } catch (err) {
    console.error("Cloud category request error:", err);
  }

  const stored = JSON.parse(localStorage.getItem('quizzes') || '[]');
  const target = stored.find(q => q.id === quizId);
  if (target) {
    target.subject = newSubject;
    localStorage.setItem('quizzes', JSON.stringify(stored));
  }

  const cachedTarget = (cachedDecks || []).find(q => q.id === quizId);
  if (cachedTarget) {
    cachedTarget.subject = newSubject;
  }

  closeCategorizeModal();
  await renderQuizList();
  updateDashboardMetrics();
}

function toggleSubjectCollapse(safeSubjId) {
  const frame = document.getElementById(`subject-frame-${safeSubjId}`);
  if (!frame) return;

  const isCollapsed = frame.classList.toggle('is-collapsed');
  const pillSpan = frame.querySelector('.subject-toggle-pill span:first-child');
  const arrow = frame.querySelector('.subject-toggle-arrow');

  const deckCount = frame.querySelectorAll('.quiz-card').length;
  const countText = `${deckCount} Deck${deckCount > 1 ? 's' : ''}`;

  if (isCollapsed) {
    if (pillSpan) pillSpan.innerText = `${countText} (Hidden)`;
    if (arrow) arrow.innerText = '◀';
  } else {
    if (pillSpan) pillSpan.innerText = countText;
    if (arrow) arrow.innerText = '▼';
  }
}