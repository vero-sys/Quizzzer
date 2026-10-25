/* ==========================================================================
   QUIZHUB APPLICATION CORE
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. CONSTANTS & SUPABASE INITIALIZATION
   -------------------------------------------------------------------------- */
const SUPABASE_URL = "https://uvxtokjdedebpuasvbyk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xOAPwp8cUxAYmG9CjoiNFQ_XOjNXQ25";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PERSONAL_AUTH_CONFIG = {
  dummyEmail: "admin@quizhub.local",
  getPassword: (pin) => `${pin}`,
};

/* --------------------------------------------------------------------------
   2. GLOBAL APPLICATION STATE
   -------------------------------------------------------------------------- */
let currentUser = null;
let pendingAuthCallback = null;

// Library & Runner State
let cachedDecks = [];
let activeQuizInstance = null;
let currentQuestionIdx = 0;
let currentQuizMode = "device"; // "device" | "paper"
let pendingQuizForMode = null;
let userAnswers = {};
let visitedQuestions = new Set();
let flaggedQuestions = new Set();
let selectedPaperMistakes = new Set();
let currentSummaryReviewItems = [];
let isQuizShuffleEnabled = false;
let isWeakSpotsDrillActive = false;
let draggedItem = null;

// Records & Table State
let currentRecordsCache = [];
let currentRecordsFilter = "all"; // "all" | "device" | "paper"
let currentSortColumn = "date"; // "title" | "date" | "score" | "accuracy"
let currentSortOrder = "desc"; // "asc" | "desc"
let currentActiveAttemptRecord = null;
let currentAttemptFilter = "all"; // "all" | "correct" | "mistakes" | "flagged"
let pendingDeleteRecordId = null;

/* --------------------------------------------------------------------------
   3. LIFECYCLE, ROUTING & DASHBOARD METRICS
   -------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initManualCreator();
  initBackgroundRunner();
  initAuthSession();

  await renderQuizList();
  await renderRecordsTable();
  populateUploadSubjectDatalist();
  updateDashboardMetrics();
});

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function initBackgroundRunner() {
  // Reserved for background interval utilities
}

function switchView(viewName) {
  document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.remove("active"));

  const targetPanel = document.getElementById("view-" + viewName);
  if (targetPanel) targetPanel.classList.add("active");

  const navButton = Array.from(document.querySelectorAll(".nav-btn")).find((btn) =>
    btn.getAttribute("onclick")?.includes(viewName)
  );
  if (navButton) navButton.classList.add("active");

  const topBar = document.querySelector(".top-action-bar");
  if (topBar) {
    topBar.classList.toggle("is-not-take", viewName !== "take");
  }

  closeSidebar();
  updateDashboardMetrics();
}

function updateDashboardMetrics() {
  let totalDecksCount = cachedDecks.length;
  if (!totalDecksCount) {
    try {
      totalDecksCount = JSON.parse(localStorage.getItem("quizzes") || "[]").filter((d) => d.isActive !== false).length;
    } catch {
      totalDecksCount = 0;
    }
  }

  let records = [];
  try {
    records = JSON.parse(localStorage.getItem("quiz_records") || "[]");
  } catch {
    records = [];
  }

  const elDecks = document.getElementById("dash-total-decks");
  const elAttempts = document.getElementById("dash-total-attempts");
  const elAccuracy = document.getElementById("dash-avg-accuracy");

  if (elDecks) elDecks.innerText = totalDecksCount;
  if (elAttempts) elAttempts.innerText = records.length;

  if (elAccuracy) {
    if (records.length === 0) {
      elAccuracy.innerText = "0%";
    } else {
      let sum = 0;
      let valid = 0;
      records.forEach((r) => {
        let val = NaN;
        if (r.percentage !== undefined && r.percentage !== null) {
          val = parseFloat(String(r.percentage).replace("%", ""));
        } else if (r.score !== undefined && r.totalQuestions) {
          val = (parseFloat(r.score) / parseFloat(r.totalQuestions)) * 100;
        }
        if (!isNaN(val)) {
          sum += val;
          valid++;
        }
      });
      elAccuracy.innerText = valid > 0 ? `${Math.round(sum / valid)}%` : "0%";
    }
  }

  calculateRecordsStatistics(records);
}

/* --------------------------------------------------------------------------
   4. SIDEBAR, THEME & UI HELPERS
   -------------------------------------------------------------------------- */
function toggleSidebar() {
  const sidebar = document.getElementById("main-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!sidebar) return;

  const isOpen = sidebar.classList.toggle("open");
  if (backdrop) backdrop.classList.toggle("active", isOpen);
}

function closeSidebar() {
  const sidebar = document.getElementById("main-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (sidebar) sidebar.classList.remove("open");
  if (backdrop) backdrop.classList.remove("active");
}

function initTheme() {
  const savedTheme = localStorage.getItem("quizhub_theme") || "normal";
  setTheme(savedTheme);
}

function setTheme(themeName) {
  const root = document.documentElement;
  const btnDoraemon = document.getElementById("theme-btn-doraemon");
  const btnNormal = document.getElementById("theme-btn-normal");

  if (themeName === "normal") {
    root.setAttribute("data-theme", "normal");
    if (btnNormal) btnNormal.classList.add("active");
    if (btnDoraemon) btnDoraemon.classList.remove("active");
  } else {
    root.removeAttribute("data-theme");
    if (btnDoraemon) btnDoraemon.classList.add("active");
    if (btnNormal) btnNormal.classList.remove("active");
  }
  localStorage.setItem("quizhub_theme", themeName);
}

function showStatus(elementId, message, statusType) {
  const box = document.getElementById(elementId);
  if (!box) return;
  box.className = `status-box ${statusType}`;
  box.innerText = message;
  box.style.display = "block";
}

function copyAIPromptTemplate(btnElement) {
  if (btnElement && btnElement.classList.contains("copied")) return;

  const promptText = `Please generate a multiple-choice quiz about [TOPIC/DOCUMENT].

Rules:
- Put the entire output inside a text block
- Do NOT use markdown styling (no bold, no italics, no asterisks like **word** or *word*).
- No introductory or concluding remarks (output only the code block).
- Exactly 4 options per question (a, b, c, d).
- Do not escape dots with backslashes (use "1." not "1\\.").
- Provide a clear rationale for each answer in the key. Then "-- ELI5" (you don't have to say eli5 everytime)
- Randomize correct options so consecutive items rarely share the same answer letter.

Strictly format the text block content as follows:

1. [Question text here]
a. [Option A]
b. [Option B]
c. [Option C]
d. [Option D]

Answer Key:
1. a - [Explanation / rationale here -- ELI5]`;

  const originalHtml = btnElement ? btnElement.innerHTML : "";

  navigator.clipboard.writeText(promptText).then(() => {
    if (!btnElement) return;
    btnElement.classList.add("copied");
    btnElement.innerHTML = `<span>✓</span> <span>Copied to Clipboard!</span>`;
    setTimeout(() => {
      btnElement.classList.remove("copied");
      btnElement.innerHTML = originalHtml;
    }, 2000);
  }).catch((err) => {
    console.error("Clipboard copy failed:", err);
  });
}

/* --------------------------------------------------------------------------
   5. AUTHENTICATION & PIN PASSCODE MANAGEMENT
   -------------------------------------------------------------------------- */
async function initAuthSession() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  updateAuthSidebar(currentUser);

  sb.auth.onAuthStateChange((_event, sessionState) => {
    currentUser = sessionState?.user || null;
    updateAuthSidebar(currentUser);
  });
}

function handleAuthAction() {
  if (currentUser) {
    handleAuthLogout();
  } else {
    openAuthModal();
  }
}

function openAuthModal(callbackAfterLogin = null) {
  pendingAuthCallback = callbackAfterLogin;
  const modal = document.getElementById("auth-modal");
  const pinInput = document.getElementById("auth-pin");
  const errBox = document.getElementById("auth-error-msg");

  if (errBox) errBox.style.display = "none";
  if (pinInput) pinInput.value = "";
  if (modal) modal.style.display = "flex";

  setTimeout(() => pinInput?.focus(), 50);
}

function closeAuthModal() {
  const modal = document.getElementById("auth-modal");
  const pinInput = document.getElementById("auth-pin");
  if (modal) modal.style.display = "none";
  if (pinInput) pinInput.value = "";
  pendingAuthCallback = null;
}

async function handleAuthLogin() {
  const pinInput = document.getElementById("auth-pin");
  const pin = pinInput ? pinInput.value.trim() : "";
  const errBox = document.getElementById("auth-error-msg");
  if (errBox) errBox.style.display = "none";

  if (!pin) {
    if (errBox) {
      errBox.innerText = "Please enter your passcode.";
      errBox.style.display = "block";
    }
    return;
  }

  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: PERSONAL_AUTH_CONFIG.dummyEmail,
      password: PERSONAL_AUTH_CONFIG.getPassword(pin),
    });

    if (error) throw new Error("Incorrect passcode.");

    currentUser = data.user;
    updateAuthSidebar(currentUser);
    closeAuthModal();

    if (typeof pendingAuthCallback === "function") {
      const action = pendingAuthCallback;
      pendingAuthCallback = null;
      await action();
    } else {
      typeof showToast === "function"
        ? showToast("Unlocked successfully!")
        : alert("Unlocked successfully!");
    }
  } catch (err) {
    if (errBox) {
      errBox.innerText = err.message || "Failed to unlock.";
      errBox.style.display = "block";
    }
  } finally {
    if (pinInput) pinInput.value = "";
  }
}

async function handleAuthLogout() {
  try {
    const { error } = await sb.auth.signOut();
    if (error) throw error;

    currentUser = null;
    updateAuthSidebar(null);
    typeof showToast === "function"
      ? showToast("Locked. Switched to guest mode.")
      : alert("Locked. Switched to guest mode.");
  } catch (err) {
    console.error("Lock/Sign-out failed:", err);
    typeof showToast === "function"
      ? showToast("Sign out failed: " + err.message)
      : alert("Sign out failed: " + err.message);
  }
}

function updateAuthSidebar(user) {
  const labelEl = document.getElementById("auth-nav-label");
  const btnEl = document.getElementById("auth-sidebar-item");
  if (!labelEl || !btnEl) return;

  if (user) {
    labelEl.textContent = "Lock Session";
    btnEl.title = "Cloud access unlocked";
  } else {
    labelEl.textContent = "Unlock (PIN)";
    btnEl.title = "Enter PIN to access cloud sync";
  }
}

/* --------------------------------------------------------------------------
   6. WEAK SPOTS MISTAKE BANK & DRILL CHALLENGE
   -------------------------------------------------------------------------- */
function getMistakeBank() {
  let bank = {};
  try {
    bank = JSON.parse(localStorage.getItem("quiz_mistake_bank") || "{}");
  } catch {
    bank = {};
  }

  // Auto-backfill from historical quiz_records if the bank is currently empty
  if (Object.keys(bank).length === 0) {
    try {
      const records = JSON.parse(localStorage.getItem("quiz_records") || "[]");
      records.forEach((rec) => {
        if (!rec.questions || !Array.isArray(rec.mistakenIndices)) return;
        rec.mistakenIndices.forEach((idx) => {
          const q = rec.questions[idx];
          if (!q || !q.question) return;
          const key = `${rec.id || "rec"}_${q.id || idx}_${q.question.trim().slice(0, 30)}`;
          if (!bank[key]) {
            bank[key] = {
              id: key,
              deckId: rec.id || "historical",
              question: q,
              fail_count: 1,
              is_mastered: false,
              historical_mistake: true,
              last_failed_at: rec.date || new Date().toISOString().split("T")[0],
            };
          } else {
            bank[key].fail_count = (bank[key].fail_count || 1) + 1;
          }
        });
      });
      if (Object.keys(bank).length > 0) {
        saveMistakeBank(bank);
      }
    } catch (e) {
      console.warn("Backfill note:", e);
    }
  }

  return bank;
}

function saveMistakeBank(bank) {
  localStorage.setItem("quiz_mistake_bank", JSON.stringify(bank));
}

function recordQuestionMistake(questionObj, deckId = "general") {
  if (!questionObj || !questionObj.question) return;

  const key = `${deckId}_${questionObj.id}_${questionObj.question.trim().slice(0, 30)}`;
  const bank = getMistakeBank();

  if (!bank[key]) {
    bank[key] = {
      id: key,
      deckId: deckId,
      question: questionObj,
      fail_count: 1,
      is_mastered: false,
      historical_mistake: true,
      last_failed_at: new Date().toISOString().split("T")[0],
    };
  } else {
    bank[key].fail_count = (bank[key].fail_count || 0) + 1;
    bank[key].is_mastered = false;
    bank[key].last_failed_at = new Date().toISOString().split("T")[0];
  }

  saveMistakeBank(bank);
}

function renderWeakSpotsBanner() {
  const container = document.getElementById("weak-spots-deck-container");
  if (!container) return;

  const bank = getMistakeBank();
  const allEntries = Object.values(bank);
  const activeMistakes = allEntries.filter((item) => item.is_mastered !== true);

  if (allEntries.length === 0) {
    container.innerHTML = "";
    return;
  }

  if (activeMistakes.length === 0) {
    container.innerHTML = `
      <div class="weak-spots-card" style="border-color: #86efac; background: linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%);">
        <div class="weak-spots-icon" style="background: #dcfce7; color: #15803d; border-color: #86efac;">🎉</div>
        <div class="quiz-card-info">
          <strong>Weak Spots Cleared!</strong>
          <span class="weak-spots-badge" style="background: #22c55e;">100% Mastered</span>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
            All ${allEntries.length} recorded mistakes have been successfully cleared.
          </p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="weak-spots-card">
      <div class="weak-spots-icon">🧠</div>
      <div class="quiz-card-info">
        <strong>Weak Spots Drill Challenge</strong>
        <span class="weak-spots-badge">Mistake Bank</span>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
          ${activeMistakes.length} Active Mistake${activeMistakes.length > 1 ? "s" : ""} to Master &bull; Lifetime Recorded: ${allEntries.length}
        </p>
      </div>
      <div class="quiz-card-actions">
        <button class="btn btn-secondary" type="button" style="padding: 9px 12px;" title="Recalculate from saved records" onclick="recalculateMistakeBankFromRecords()">
          Recalculate Mistakes
        </button>
        <button class="btn" type="button" style="background: var(--amber); border-color: var(--amber);" onclick="launchWeakSpotsDrill()">
          Start Practice
        </button>
      </div>
    </div>
  `;
}

function recalculateMistakeBankFromRecords() {
  if (!confirm("This will rebuild your Mistake Bank exclusively from your current saved Attempt Records.\n\nContinue?")) {
    return;
  }

  const newBank = {};
  let totalMistakesFound = 0;

  try {
    const records = JSON.parse(localStorage.getItem("quiz_records") || "[]");

    records.forEach((rec) => {
      if (!rec.questions || !Array.isArray(rec.mistakenIndices)) return;

      rec.mistakenIndices.forEach((idx) => {
        const q = rec.questions[idx];
        if (!q || !q.question) return;

        const key = `${rec.id || "rec"}_${q.id || idx}_${q.question.trim().slice(0, 30)}`;

        if (!newBank[key]) {
          newBank[key] = {
            id: key,
            deckId: rec.id || "historical",
            question: q,
            fail_count: 1,
            is_mastered: false,
            historical_mistake: true,
            last_failed_at: rec.date || new Date().toISOString().split("T")[0],
          };
          totalMistakesFound++;
        } else {
          newBank[key].fail_count = (newBank[key].fail_count || 1) + 1;
        }
      });
    });

    saveMistakeBank(newBank);
    renderWeakSpotsBanner();
    updateDashboardMetrics();

    alert(`✅ Mistake Bank rebuilt successfully!\n• Active Mistakes: ${totalMistakesFound}`);
  } catch (err) {
    console.error("Recalculate error:", err);
    alert("Failed to recalculate: " + err.message);
  }
}

function launchWeakSpotsDrill() {
  const bank = getMistakeBank();
  const activeMistakes = Object.values(bank).filter((item) => item.is_mastered !== true);
  if (activeMistakes.length === 0) return;

  const syntheticQuestions = activeMistakes.map((entry, idx) => ({
    ...entry.question,
    id: idx + 1,
    bankKey: entry.id,
    failCount: entry.fail_count,
  }));

  const syntheticQuiz = {
    id: "weak_spots_drill_deck",
    title: "Weak Spots Drill Challenge",
    subject: "Mastery Bank",
    totalQuestions: syntheticQuestions.length,
    questions: syntheticQuestions,
    isWeakSpots: true,
  };

  isWeakSpotsDrillActive = true;
  pendingQuizForMode = syntheticQuiz;

  const total = syntheticQuestions.length;
  const modal = document.getElementById("quiz-mode-modal");
  const input = document.getElementById("mode-item-count-input");
  const slider = document.getElementById("mode-item-range-slider");
  const totalHint = document.getElementById("mode-total-hint");
  const maxLabel = document.getElementById("slider-max-label");

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

  isQuizShuffleEnabled = true;
  const shuffleBtn = document.getElementById("btn-toggle-shuffle");
  const shuffleLabel = document.getElementById("shuffle-btn-text");
  if (shuffleBtn) shuffleBtn.classList.add("selected");
  if (shuffleLabel) shuffleLabel.innerText = "Question Order: Shuffled 🔀";

  modal ? (modal.style.display = "flex") : startQuizSession(syntheticQuiz, "device");
}

/* --------------------------------------------------------------------------
   7. QUIZ LIBRARY, SUBJECT FRAMES & THEME ACCENTS
   -------------------------------------------------------------------------- */
function isDeckNew(uploadedAtStr, daysThreshold = 3) {
  if (!uploadedAtStr) return false;
  const uploadedDate = new Date(uploadedAtStr);
  if (isNaN(uploadedDate.getTime())) return false;
  const diffTime = Date.now() - uploadedDate.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= daysThreshold;
}

function getSubjectColorsMap() {
  try {
    return JSON.parse(localStorage.getItem("quiz_subject_colors") || "{}");
  } catch {
    return {};
  }
}

function saveSubjectColorsMap(map) {
  localStorage.setItem("quiz_subject_colors", JSON.stringify(map));
}

function getSubjectColor(subjectName, deckColorAccent = null) {
  // 1. If the deck itself has a saved colorAccent, prioritize it
  if (deckColorAccent && /^#[0-9A-F]{6}$/i.test(deckColorAccent)) {
    return deckColorAccent;
  }

  const map = getSubjectColorsMap();
  const normalizedKey = (subjectName || "General").trim().toLowerCase();

  // 2. Direct exact match
  if (map[normalizedKey]) {
    return map[normalizedKey];
  }

  // 3. Fallback fuzzy match (handles trailing spaces or minor typos)
  for (const savedSubject of Object.keys(map)) {
    if (savedSubject.includes(normalizedKey) || normalizedKey.includes(savedSubject)) {
      return map[savedSubject];
    }
  }

  return "#2563eb"; // Final fallback
}

async function renderQuizList() {
  const container = document.getElementById("available-quiz-list");
  if (!container) return;

  const rawStored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  cachedDecks = rawStored.filter((deck) => deck.isActive !== false);

  populateEditQuizDropdown();
  populateUploadSubjectDatalist();
  updateDashboardMetrics();
  renderWeakSpotsBanner();
  container.innerHTML = "";

  if (cachedDecks.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; padding: 12px 0;">No quizzes found in library. Upload or create one to get started.</p>`;
    return;
  }

  const subjectsMap = {};
  cachedDecks.forEach((deck) => {
    const subj = deck.subject || "General";
    if (!subjectsMap[subj]) subjectsMap[subj] = [];
    subjectsMap[subj].push(deck);
  });

  Object.keys(subjectsMap).forEach((subjectName) => {
    const decks = subjectsMap[subjectName];
    const safeSubjId = encodeURIComponent(subjectName).replace(/%/g, "_");
    const subjectColor = getSubjectColor(subjectName);

    const frame = document.createElement("div");
    frame.className = "subject-frame";
    frame.id = `subject-frame-${safeSubjId}`;
    frame.dataset.subject = subjectName;
    frame.style.setProperty("--subj-accent", subjectColor);

    frame.innerHTML = `
      <div class="subject-frame-header">
        <div style="display: flex; align-items: center; gap: 10px;" onclick="toggleSubjectCollapse('${safeSubjId}')">
          <span class="subject-badge">
            <span class="subject-color-indicator"></span>
            📁 ${escapeHtml(subjectName)}
          </span>
        </div>

        <div class="subject-header-actions" style="display: flex; align-items: center; gap: 8px;">
          <button type="button" class="btn-subject-theme" onclick="event.stopPropagation(); openSubjectColorModal('${encodeURIComponent(subjectName)}')">
            <span>🎨 Color</span>
          </button>

          <button type="button" class="subject-toggle-pill" onclick="toggleSubjectCollapse('${safeSubjId}')" title="Click to collapse or expand">
            <span>${decks.length} Deck${decks.length > 1 ? "s" : ""}</span>
            <span class="subject-toggle-arrow">▼</span>
          </button>
        </div>
      </div>
      <div class="subject-quiz-list" data-subject="${subjectName}"></div>
    `;

    const listContainer = frame.querySelector(".subject-quiz-list");
    decks.forEach((quiz) => {
      const isNew = isDeckNew(quiz.uploadedAt);
      const newBadgeHtml = isNew ? `<span class="deck-new-badge">NEW</span>` : "";

      const card = document.createElement("div");
      card.className = "quiz-card";
      card.draggable = true;
      card.dataset.id = quiz.id;
      card.dataset.subject = subjectName;

      card.innerHTML = `
        <div class="quiz-drag-handle" title="Drag to reorder">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="6" r="1"></circle><circle cx="15" cy="6" r="1"></circle>
            <circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle>
            <circle cx="9" cy="18" r="1"></circle><circle cx="15" cy="18" r="1"></circle>
          </svg>
        </div>

        <div class="deck-icon-tile">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
        </div>

        <div class="quiz-card-info">
          <div>
            <strong>${escapeHtml(quiz.title)}</strong>${newBadgeHtml}
          </div>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
            ${quiz.totalQuestions} Questions &bull; Added on ${quiz.uploadedAt}
          </p>
        </div>

        <div class="quiz-card-actions">
          <button class="btn btn-start-quiz" type="button" onclick="launchQuizById('${quiz.id}')">Start Quiz</button>
          
          <div class="card-menu-container">
            <button class="menu-trigger-btn" type="button" onclick="toggleCardMenu(event, '${quiz.id}')" title="More options" aria-label="More options">&#8942;</button>
            <div class="card-menu-dropdown" id="card-menu-${quiz.id}">
              <button class="btn-menu-rename" type="button" onclick="openRenameModal('${quiz.id}', '${encodeURIComponent(quiz.title)}')">✏️ Rename</button>
              <button class="btn-menu-rename" type="button" onclick="openCategorizeModal('${quiz.id}')">📁 Change Subject</button>
              <button type="button" onclick="exportQuizDeckToPDF('${quiz.id}')">📄 Export as PDF</button>
              <button class="btn-menu-delete" type="button" onclick="deleteQuiz('${quiz.id}')">🗑️ Delete</button>
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

function filterQuizzesRealtime(query) {
  const term = query.toLowerCase().trim();
  const libraryContainer = document.getElementById("available-quiz-list");
  if (!libraryContainer) return;

  if (!term) {
    libraryContainer.querySelectorAll(".quiz-card").forEach((card) => (card.style.display = ""));
    libraryContainer.querySelectorAll(".subject-frame").forEach((frame) => (frame.style.display = ""));
    return;
  }

  const subjectFrames = libraryContainer.querySelectorAll(".subject-frame");
  subjectFrames.forEach((frame) => {
    const cards = frame.querySelectorAll(".quiz-card");
    let hasVisibleCards = false;

    cards.forEach((card) => {
      const title = card.querySelector("strong")?.innerText.toLowerCase() || "";
      const subject = card.dataset.subject?.toLowerCase() || "";
      const matches = title.includes(term) || subject.includes(term);

      card.style.display = matches ? "" : "none";
      if (matches) hasVisibleCards = true;
    });

    frame.style.display = hasVisibleCards ? "" : "none";
    if (hasVisibleCards && frame.classList.contains("is-collapsed")) {
      frame.classList.remove("is-collapsed");
    }
  });
}

function toggleSubjectCollapse(safeSubjId) {
  const frame = document.getElementById(`subject-frame-${safeSubjId}`);
  if (!frame) return;

  const isCollapsed = frame.classList.toggle("is-collapsed");
  const pillSpan = frame.querySelector(".subject-toggle-pill span:first-child");
  const arrow = frame.querySelector(".subject-toggle-arrow");
  const deckCount = frame.querySelectorAll(".quiz-card").length;
  const countText = `${deckCount} Deck${deckCount > 1 ? "s" : ""}`;

  if (isCollapsed) {
    if (pillSpan) pillSpan.innerText = `${countText} (Hidden)`;
    if (arrow) arrow.innerText = "◀";
  } else {
    if (pillSpan) pillSpan.innerText = countText;
    if (arrow) arrow.innerText = "▼";
  }
}

function toggleCardMenu(event, quizId) {
  event.stopPropagation();
  const targetDropdown = document.getElementById(`card-menu-${quizId}`);
  const isOpen = targetDropdown?.classList.contains("show");

  document.querySelectorAll(".card-menu-dropdown").forEach((d) => d.classList.remove("show"));
  if (!isOpen && targetDropdown) targetDropdown.classList.add("show");
}

document.addEventListener("click", () => {
  document.querySelectorAll(".card-menu-dropdown").forEach((d) => d.classList.remove("show"));
});

function attachDragEvents(card) {
  const handle = card.querySelector(".quiz-drag-handle") || card;

  card.addEventListener("dragstart", (e) => {
    draggedItem = card;
    card.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("is-dragging");
    draggedItem = null;
    document.querySelectorAll(".quiz-card").forEach((c) => c.classList.remove("drag-over"));
    saveReorderedDeckSequence(card.dataset.subject);
  });

  card.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === card) return;
    if (draggedItem.dataset.subject !== card.dataset.subject) return;

    card.classList.add("drag-over");
    const bounding = card.getBoundingClientRect();
    const offset = e.clientY - bounding.top;
    offset > bounding.height / 2 ? card.after(draggedItem) : card.before(draggedItem);
  });

  card.addEventListener("dragleave", () => {
    card.classList.remove("drag-over");
  });

  handle.addEventListener("touchstart", () => {
    draggedItem = card;
    card.classList.add("is-dragging");
    if (navigator.vibrate) navigator.vibrate(25);
  }, { passive: true });

  handle.addEventListener("touchmove", (e) => {
    if (!draggedItem) return;
    const touch = e.touches[0];
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetCard = targetEl ? targetEl.closest(".quiz-card") : null;

    if (targetCard && targetCard !== draggedItem && targetCard.dataset.subject === draggedItem.dataset.subject) {
      const bounding = targetCard.getBoundingClientRect();
      const offset = touch.clientY - bounding.top;
      offset > bounding.height / 2 ? targetCard.after(draggedItem) : targetCard.before(draggedItem);
    }
  }, { passive: true });

  handle.addEventListener("touchend", () => {
    if (!draggedItem) return;
    card.classList.remove("is-dragging");
    card.classList.add("drop-settle");
    setTimeout(() => card.classList.remove("drop-settle"), 300);
    if (navigator.vibrate) navigator.vibrate(15);
    saveReorderedDeckSequence(card.dataset.subject);
    draggedItem = null;
  });
}

async function saveReorderedDeckSequence(subjectName) {
  const listEl = document.querySelector(`.subject-quiz-list[data-subject="${subjectName}"]`);
  if (!listEl) return;

  const cardElements = Array.from(listEl.querySelectorAll(".quiz-card"));
  cardElements.forEach((el, index) => {
    const deckId = el.dataset.id;
    const target = cachedDecks.find((d) => d.id === deckId);
    if (target) target.sortOrder = index;
  });
  localStorage.setItem("quizzes", JSON.stringify(cachedDecks));
}

// Rename, Categorize, Delete & Color Modals
function setRenameColor(hexColor) {
  const colorInput = document.getElementById("rename-quiz-color");
  if (colorInput) colorInput.value = hexColor;

  document.querySelectorAll(".swatch-btn").forEach((btn) => {
    const btnColor = btn.style.getPropertyValue("--c").trim().toLowerCase();
    btn.classList.toggle("active", btnColor === hexColor.toLowerCase());
  });
}

function openRenameModal(quizId, encodedTitle) {
  const decodedTitle = decodeURIComponent(encodedTitle);
  document.getElementById("rename-quiz-id").value = quizId;
  const titleInput = document.getElementById("rename-quiz-input");
  titleInput.value = decodedTitle;

  const targetQuiz = (cachedDecks || []).find((q) => q.id === quizId);
  const subjectInput = document.getElementById("rename-quiz-subject");
  if (subjectInput) subjectInput.value = targetQuiz ? (targetQuiz.subject || "General") : "General";

  const currentColor = targetQuiz?.colorAccent || "#2563eb";
  setRenameColor(currentColor);

  const modal = document.getElementById("rename-modal");
  modal.style.display = "flex";
  titleInput.focus();
  titleInput.select();
}

function closeRenameModal() {
  document.getElementById("rename-modal").style.display = "none";
}

async function saveQuizRename() {
  const quizId = document.getElementById("rename-quiz-id").value;
  const newTitle = document.getElementById("rename-quiz-input").value.trim();
  const newSubject = (document.getElementById("rename-quiz-subject")?.value || "").trim() || "General";
  const newColor = document.getElementById("rename-quiz-color")?.value || "#2563eb";
  if (!newTitle) return;

  const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  const targetQuiz = stored.find((q) => q.id === quizId);
  if (targetQuiz) {
    targetQuiz.title = newTitle;
    targetQuiz.subject = newSubject;
    targetQuiz.colorAccent = newColor;
    localStorage.setItem("quizzes", JSON.stringify(stored));
  }

  const targetCached = (cachedDecks || []).find((q) => q.id === quizId);
  if (targetCached) {
    targetCached.title = newTitle;
    targetCached.subject = newSubject;
    targetCached.colorAccent = newColor;
  }

  closeRenameModal();
  await renderQuizList();
  populateEditQuizDropdown();
  updateDashboardMetrics();
}

function openCategorizeModal(quizId) {
  document.querySelectorAll(".card-menu-dropdown").forEach((d) => d.classList.remove("show"));
  const targetQuiz = (cachedDecks || []).find((q) => q.id === quizId);
  if (!targetQuiz) return;

  document.getElementById("categorize-quiz-id").value = quizId;
  const input = document.getElementById("categorize-subject-input");
  const select = document.getElementById("categorize-subject-select");
  const currentSubject = targetQuiz.subject || "General";

  input.value = currentSubject;
  const uniqueSubjects = Array.from(new Set((cachedDecks || []).map((d) => d.subject || "General")));

  select.innerHTML = '<option value="">-- Choose Existing Subject --</option>';
  uniqueSubjects.forEach((subj) => {
    const opt = document.createElement("option");
    opt.value = subj;
    opt.innerText = subj;
    if (subj.toLowerCase() === currentSubject.toLowerCase()) opt.selected = true;
    select.appendChild(opt);
  });

  const modal = document.getElementById("categorize-modal");
  if (modal) modal.style.display = "flex";
}

function syncCategorizeInput(val) {
  if (val) document.getElementById("categorize-subject-input").value = val;
}

function closeCategorizeModal() {
  const modal = document.getElementById("categorize-modal");
  if (modal) modal.style.display = "none";
}

async function saveSubjectCategorization() {
  const quizId = document.getElementById("categorize-quiz-id").value;
  const newSubject = (document.getElementById("categorize-subject-input").value || "").trim() || "General";
  if (!quizId) return;

  const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  const target = stored.find((q) => q.id === quizId);
  if (target) {
    target.subject = newSubject;
    localStorage.setItem("quizzes", JSON.stringify(stored));
  }

  const cachedTarget = (cachedDecks || []).find((q) => q.id === quizId);
  if (cachedTarget) cachedTarget.subject = newSubject;

  closeCategorizeModal();
  await renderQuizList();
  updateDashboardMetrics();
}

async function deleteQuiz(quizId) {
  if (!confirm("Are you sure you want to remove this quiz from your local library?")) return;

  const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  const target = stored.find((q) => q.id === quizId);
  if (target) {
    target.isActive = false;
  }
  localStorage.setItem("quizzes", JSON.stringify(stored));

  await renderQuizList();
  updateDashboardMetrics();
}

function openSubjectColorModal(encodedSubjectName) {
  const subjectName = decodeURIComponent(encodedSubjectName);
  const currentColor = getSubjectColor(subjectName);

  document.getElementById("subj-modal-subject-key").value = subjectName;
  const nameDisplay = document.getElementById("subj-modal-name-display");
  if (nameDisplay) nameDisplay.innerText = subjectName;

  selectSubjectColor(currentColor);

  const modal = document.getElementById("subject-color-modal");
  if (modal) modal.style.display = "flex";
}

function selectSubjectColor(hexColor) {
  const picker = document.getElementById("subj-modal-custom-picker");
  const hexInput = document.getElementById("subj-modal-hex-input");

  if (picker) picker.value = hexColor;
  if (hexInput) hexInput.value = hexColor.toUpperCase();

  document.querySelectorAll(".subj-swatch").forEach((btn) => {
    const btnColor = btn.style.getPropertyValue("--c").trim().toLowerCase();
    btn.classList.toggle("active", btnColor === hexColor.toLowerCase());
  });
}

function syncSubjCustomColor(val) {
  const hexInput = document.getElementById("subj-modal-hex-input");
  if (hexInput) hexInput.value = val.toUpperCase();
  selectSubjectColor(val);
}

function syncSubjHexInput(val) {
  if (/^#[0-9A-F]{6}$/i.test(val)) {
    const picker = document.getElementById("subj-modal-custom-picker");
    if (picker) picker.value = val;
    selectSubjectColor(val);
  }
}

function closeSubjectColorModal() {
  const modal = document.getElementById("subject-color-modal");
  if (modal) modal.style.display = "none";
}

async function saveSubjectColor() {
  const subjectName = document.getElementById("subj-modal-subject-key")?.value;
  const newColor = document.getElementById("subj-modal-custom-picker")?.value || "#2563eb";
  if (!subjectName) return;

  const map = getSubjectColorsMap();
  map[subjectName.trim().toLowerCase()] = newColor;
  saveSubjectColorsMap(map);

  closeSubjectColorModal();
  await renderQuizList();
}

function openDeckColorModal(quizId) {
  document.querySelectorAll(".card-menu-dropdown").forEach((d) => d.classList.remove("show"));
  const target = (cachedDecks || []).find((q) => q.id === quizId);
  if (!target) return;

  document.getElementById("color-modal-quiz-id").value = quizId;
  const currentColor = target.colorAccent || "#2563eb";
  selectDeckColorModal(currentColor);

  const modal = document.getElementById("deck-color-modal");
  if (modal) modal.style.display = "flex";
}

function selectDeckColorModal(hexColor) {
  const colorPicker = document.getElementById("deck-modal-custom-color");
  const hexInput = document.getElementById("deck-modal-hex-input");

  if (colorPicker) colorPicker.value = hexColor;
  if (hexInput) hexInput.value = hexColor.toUpperCase();

  document.querySelectorAll(".deck-modal-swatch").forEach((btn) => {
    const btnColor = btn.style.getPropertyValue("--c").trim().toLowerCase();
    btn.classList.toggle("active", btnColor === hexColor.toLowerCase());
  });
}

function syncDeckModalCustomColor(val) {
  const hexInput = document.getElementById("deck-modal-hex-input");
  if (hexInput) hexInput.value = val.toUpperCase();
  selectDeckColorModal(val);
}

function syncDeckModalHexInput(val) {
  if (/^#[0-9A-F]{6}$/i.test(val)) {
    const colorPicker = document.getElementById("deck-modal-custom-color");
    if (colorPicker) colorPicker.value = val;
    selectDeckColorModal(val);
  }
}

function closeDeckColorModal() {
  const modal = document.getElementById("deck-color-modal");
  if (modal) modal.style.display = "none";
}

async function saveDeckColorModal() {
  const quizId = document.getElementById("color-modal-quiz-id")?.value;
  const chosenColor = document.getElementById("deck-modal-custom-color")?.value || "#2563eb";
  if (!quizId) return;

  const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  const target = stored.find((q) => q.id === quizId);
  if (target) {
    target.colorAccent = chosenColor;
    localStorage.setItem("quizzes", JSON.stringify(stored));
  }

  const cachedTarget = (cachedDecks || []).find((q) => q.id === quizId);
  if (cachedTarget) cachedTarget.colorAccent = chosenColor;

  closeDeckColorModal();
  await renderQuizList();
}

/* --------------------------------------------------------------------------
   8. QUIZ EXECUTION ENGINE & FLOATING QUESTION MATRIX
   -------------------------------------------------------------------------- */
function launchQuizById(quizId) {
  const quiz = (cachedDecks || []).find((q) => q.id === quizId);
  if (!quiz || !quiz.questions || quiz.questions.length === 0) {
    alert("This quiz deck has no questions.");
    return;
  }

  isWeakSpotsDrillActive = false;
  pendingQuizForMode = JSON.parse(JSON.stringify(quiz));

  const total = quiz.questions.length;
  const modal = document.getElementById("quiz-mode-modal");
  const input = document.getElementById("mode-item-count-input");
  const slider = document.getElementById("mode-item-range-slider");
  const totalHint = document.getElementById("mode-total-hint");
  const maxLabel = document.getElementById("slider-max-label");

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

  isQuizShuffleEnabled = false;
  const shuffleBtn = document.getElementById("btn-toggle-shuffle");
  const shuffleLabel = document.getElementById("shuffle-btn-text");
  if (shuffleBtn) shuffleBtn.classList.remove("selected");
  if (shuffleLabel) shuffleLabel.innerText = "Question Order: Normal";

  if (modal) {
    modal.style.display = "flex";
  } else {
    startQuizSession(pendingQuizForMode, "device");
  }
}

function syncSliderFromInput(val) {
  const slider = document.getElementById("mode-item-range-slider");
  if (!slider) return;
  let num = parseInt(val, 10);
  const max = parseInt(slider.max, 10);
  if (isNaN(num) || num < 1) num = 1;
  if (num > max) num = max;
  slider.value = num;
}

function syncInputFromSlider(val) {
  const input = document.getElementById("mode-item-count-input");
  if (input) input.value = val;
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function toggleQuizShuffle() {
  isQuizShuffleEnabled = !isQuizShuffleEnabled;
  const btn = document.getElementById("btn-toggle-shuffle");
  const label = document.getElementById("shuffle-btn-text");

  if (btn) btn.classList.toggle("selected", isQuizShuffleEnabled);
  if (label) {
    label.innerText = isQuizShuffleEnabled
      ? "Question Order: Shuffled 🔀"
      : "Question Order: Normal";
  }
}

function selectQuizMode(mode) {
  currentQuizMode = mode;
  const targetQuiz = pendingQuizForMode;
  const input = document.getElementById("mode-item-count-input");
  let limit = targetQuiz ? targetQuiz.questions.length : 1;

  if (input && targetQuiz) {
    const parsed = parseInt(input.value, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= targetQuiz.questions.length) {
      limit = parsed;
    }
  }

  closeQuizModeModal();
  if (targetQuiz) {
    let chosenQuestions = targetQuiz.questions.slice(0, limit);
    if (isQuizShuffleEnabled) {
      chosenQuestions = shuffleArray(chosenQuestions);
    }

    const limitedInstance = {
      ...targetQuiz,
      totalQuestions: limit,
      questions: chosenQuestions,
    };
    switchView("take");
    startQuizSession(limitedInstance, mode);
  }
}

function closeQuizModeModal() {
  pendingQuizForMode = null;
  const modal = document.getElementById("quiz-mode-modal");
  if (modal) modal.style.display = "none";
}

function startQuizSession(quiz, mode = "device") {
  document.querySelector(".app-container")?.classList.add("quiz-focus-mode");
  activeQuizInstance = quiz;
  currentQuizMode = mode;
  currentQuestionIdx = 0;
  flaggedQuestions.clear();
  visitedQuestions.clear();
  userAnswers = {};

  // 🔗 RESOLVE ACCENT: Check deck accent first, then subject map
  const activeColor = getSubjectColor(quiz.subject || "General", quiz.colorAccent);
  
  // Apply globally to documentElement, body, and runner
  document.documentElement.style.setProperty("--subj-accent", activeColor);
  document.body.style.setProperty("--subj-accent", activeColor);

  const runnerEl = document.getElementById("quiz-active-runner");
  if (runnerEl) {
    runnerEl.style.setProperty("--subj-accent", activeColor);
  }

  const deckView = document.getElementById("quiz-deck-view");
  const resultSummary = document.getElementById("quiz-result-summary");
  if (deckView) deckView.style.display = "none";
  if (resultSummary) resultSummary.style.display = "none";
  if (runnerEl) runnerEl.style.display = "block";

  const modeBadge = mode === "paper" ? " [Pen & Paper]" : "";
  const titleEl = document.getElementById("active-quiz-title");
  if (titleEl) titleEl.innerText = quiz.title + modeBadge;

  window.scrollTo({ top: 0, behavior: "smooth" });
  renderActiveQuestion();
}

function renderSegmentedProgressBar() {
  const track = document.getElementById("quiz-progress-segments-track");
  if (!track || !activeQuizInstance || !activeQuizInstance.questions) return;

  const total = activeQuizInstance.questions.length;
  track.innerHTML = "";

  for (let i = 0; i < total; i++) {
    const step = document.createElement("div");
    step.className = "quiz-progress-step";

    const hasAnswer = userAnswers[i] !== undefined;
    const isVisited = visitedQuestions.has(i);
    const isCurrent = i === currentQuestionIdx;

    if (hasAnswer) {
      step.classList.add("is-answered");
      step.title = `Question ${i + 1}: Answered`;
    } else if (isVisited && !isCurrent) {
      step.classList.add("is-skipped");
      step.title = `Question ${i + 1}: Skipped`;
    } else {
      step.title = `Question ${i + 1}`;
    }

    if (isCurrent) {
      step.classList.add("is-current");
    }

    step.onclick = () => {
      currentQuestionIdx = i;
      renderActiveQuestion();
    };

    track.appendChild(step);
  }
}

function renderActiveQuestion() {
  if (!activeQuizInstance || !activeQuizInstance.questions) return;

  const total = activeQuizInstance.questions.length;
  const q = activeQuizInstance.questions[currentQuestionIdx];
  if (!q) return;

  visitedQuestions.add(currentQuestionIdx);

  // 0. Resolve Subject / Deck Accent Color
  const activeColor = getSubjectColor(
    activeQuizInstance.subject || "General",
    activeQuizInstance.colorAccent
  );

  // 1. Update Header & Matrix Counters
  const counterLabel = document.getElementById("q-counter-label");
  if (counterLabel) counterLabel.innerText = `Question ${currentQuestionIdx + 1} of ${total}`;

  const navCounter = document.getElementById("runner-matrix-counter");
  if (navCounter) navCounter.innerText = `${currentQuestionIdx + 1} / ${total}`;

  // 2. Update Question Text (Clean numbering)
  const qTextEl = document.getElementById("quiz-question-text");
  if (qTextEl) {
    const rawPrompt = String(q.question || "").replace(/^\d+[\.\)]\s*/, "");
    qTextEl.innerText = `${currentQuestionIdx + 1}. ${rawPrompt}`;
  }

  // 3. Hide rationale callout when moving between questions
  const expBox = document.getElementById("active-explanation");
  if (expBox) expBox.style.display = "none";

  // 4. Render Pill Option Rows (A., B., C., D.) with Theme Colors
  const container = document.getElementById("quiz-options-container");
  if (container) {
    container.innerHTML = "";

    (q.options || []).forEach((opt, optIdx) => {
      const optLetter = (opt.letter || String.fromCharCode(97 + optIdx)).toLowerCase();
      const optText = typeof opt === "string" ? opt : (opt.text || "");
      const isSelected = userAnswers[currentQuestionIdx] === optLetter;

      const optionRow = document.createElement("div");
      optionRow.className = "quiz-option-pill" + (isSelected ? " selected" : "");

      // Apply dynamic colors directly so theme overrides static fallbacks
      if (isSelected) {
        optionRow.style.setProperty("border-color", activeColor, "important");
        optionRow.style.setProperty(
          "background-color",
          `color-mix(in srgb, ${activeColor} 8%, #ffffff)`,
          "important"
        );
      }

      optionRow.innerHTML = `
        <span class="option-letter-circle" style="color: ${activeColor} !important;">${optLetter.toUpperCase()}.</span>
        <span class="option-text-body">${escapeHtml(optText)}</span>
      `;

      optionRow.onclick = () => {
        userAnswers[currentQuestionIdx] = optLetter;
        renderActiveQuestion();
      };

      container.appendChild(optionRow);
    });
  }

  // 5. Update Segmented Progress Bar
  renderSegmentedProgressBar();

  // 6. Update Prev & Anchored Next Buttons
  const prevBtn = document.getElementById("btn-runner-prev");
  if (prevBtn) prevBtn.disabled = currentQuestionIdx === 0;

  const nextBtn = document.getElementById("btn-runner-next");
  if (nextBtn) {
    // Force the dynamic theme color onto the anchored Next button
    nextBtn.style.setProperty("background-color", activeColor, "important");
    nextBtn.style.setProperty("border-color", activeColor, "important");
    nextBtn.style.setProperty(
      "box-shadow",
      `0 4px 12px color-mix(in srgb, ${activeColor} 30%, transparent)`,
      "important"
    );

    if (currentQuestionIdx === total - 1) {
      nextBtn.innerText = "Submit Quiz ✓";
      nextBtn.onclick = () => submitQuizAttempt();
    } else {
      nextBtn.innerText = "Next →";
      nextBtn.onclick = () => changeQuestion(1);
    }
  }

  // 7. Update Flag Button UI
  updateFlagButtonUI();
}

function changeQuestion(step) {
  if (!activeQuizInstance || !activeQuizInstance.questions) return;
  const newIdx = currentQuestionIdx + step;
  if (newIdx >= 0 && newIdx < activeQuizInstance.questions.length) {
    currentQuestionIdx = newIdx;
    renderActiveQuestion();
  }
}

function toggleCurrentFlag() {
  if (!flaggedQuestions) flaggedQuestions = new Set();
  const idx = Number(currentQuestionIdx);
  if (flaggedQuestions.has(idx)) {
    flaggedQuestions.delete(idx);
  } else {
    flaggedQuestions.add(idx);
  }
  updateFlagButtonUI();
}

function updateFlagButtonUI() {
  const btn = document.getElementById("btn-flag-q");
  const icon = document.getElementById("flag-icon");
  const label = document.getElementById("flag-label");
  if (!btn) return;

  const isFlagged = flaggedQuestions.has(Number(currentQuestionIdx));
  btn.classList.toggle("is-flagged", isFlagged);
  if (icon) icon.innerText = isFlagged ? "🚩" : "🏳️";
  if (label) label.innerText = isFlagged ? "Flagged" : "Flag";
}

function toggleQuestionMatrix() {
  const drawer = document.getElementById("quiz-matrix-drawer");
  const overlay = document.getElementById("quiz-matrix-overlay");
  if (!drawer || !overlay) return;

  const isOpen = drawer.classList.contains("open");
  if (isOpen) {
    closeQuestionMatrix();
  } else {
    buildMatrixGrid();
    drawer.classList.add("open");
    overlay.classList.add("open");
  }
}

function closeQuestionMatrix() {
  const drawer = document.getElementById("quiz-matrix-drawer");
  const overlay = document.getElementById("quiz-matrix-overlay");
  if (drawer) drawer.classList.remove("open");
  if (overlay) overlay.classList.remove("open");
}

function buildMatrixGrid() {
  const grid = document.getElementById("drawer-matrix-grid");
  if (!grid || !activeQuizInstance || !activeQuizInstance.questions) return;

  grid.innerHTML = "";
  activeQuizInstance.questions.forEach((_, idx) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "matrix-node";
    node.innerText = idx + 1;

    if (idx === currentQuestionIdx) node.classList.add("current");
    if (userAnswers[idx] !== undefined) node.classList.add("answered");
    if (flaggedQuestions && flaggedQuestions.has(idx)) node.classList.add("flagged");

    node.onclick = () => {
      currentQuestionIdx = idx;
      renderActiveQuestion();
      closeQuestionMatrix();
    };

    grid.appendChild(node);
  });
}

function exitQuizRunner() {
  if (currentQuizMode === "paper" && activeQuizInstance && document.getElementById("quiz-active-runner").style.display !== "none") {
    openPaperScoreModal();
  } else {
    finishAndReturnToLibrary();
  }
}

function finishAndReturnToLibrary() {
  document.querySelector(".app-container")?.classList.remove("quiz-focus-mode");
  document.documentElement.style.removeProperty("--subj-accent");

  const runner = document.getElementById("quiz-active-runner");
  const summary = document.getElementById("quiz-result-summary");
  const deckView = document.getElementById("quiz-deck-view");

  if (runner) runner.style.display = "none";
  if (summary) summary.style.display = "none";
  if (deckView) deckView.style.display = "block";

  closeQuestionMatrix();
  activeQuizInstance = null;
  updateDashboardMetrics();
}

async function submitQuizAttempt() {
  if (!activeQuizInstance || !activeQuizInstance.questions) return;

  if (currentQuizMode === "paper") {
    openPaperScoreModal();
    return;
  }

  const total = activeQuizInstance.questions.length;
  let score = 0;
  const reviewItems = [];
  const flaggedArray = Array.from(flaggedQuestions).map((n) => Number(n));
  const mistakeBank = getMistakeBank();

  activeQuizInstance.questions.forEach((q, idx) => {
    const userChoice = userAnswers[idx];
    const isCorrect = userChoice && q.answer && String(userChoice).toLowerCase() === String(q.answer).toLowerCase();
    const isFlagged = flaggedQuestions.has(idx);

    if (isCorrect) {
      score++;
      if (activeQuizInstance.isWeakSpots && q.bankKey && mistakeBank[q.bankKey]) {
        mistakeBank[q.bankKey].is_mastered = true;
      }
    } else {
      recordQuestionMistake(q, activeQuizInstance.id);
    }

    reviewItems.push({
      ...q,
      originalIndex: idx,
      isCorrect: !!isCorrect,
      isFlagged: !!isFlagged,
      chosenAnswer: userChoice || null,
    });
  });

  saveMistakeBank(mistakeBank);
  renderWeakSpotsBanner();

  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const scoreDisplay = document.getElementById("result-score-display") || document.getElementById("summary-score-text");
  if (scoreDisplay) scoreDisplay.innerText = `${score} / ${total} (${pct}%)`;

  const record = {
    id: "rec_" + Date.now(),
    title: activeQuizInstance.title,
    date: new Date().toISOString().split("T")[0],
    score: `${score} / ${total}`,
    percentage: `${pct}%`,
    mode: currentQuizMode || "device",
    mistakesCount: total - score,
    mistakenIndices: reviewItems.filter((i) => !i.isCorrect).map((i) => i.originalIndex),
    flaggedIndices: flaggedArray,
    questions: activeQuizInstance.questions,
    userAnswers: userAnswers,
  };

  try {
    const localRecords = JSON.parse(localStorage.getItem("quiz_records") || "[]");
    localRecords.unshift(record);
    localStorage.setItem("quiz_records", JSON.stringify(localRecords));
    currentRecordsCache = localRecords;
  } catch (err) {
    console.error("Local storage save error:", err);
  }

  currentSummaryReviewItems = reviewItems;
  updateSummaryFilterPillCounts(reviewItems);
  filterSummaryReview("all");

  closeQuestionMatrix();
  const runner = document.getElementById("quiz-active-runner");
  const summary = document.getElementById("quiz-result-summary");
  if (runner) runner.style.display = "none";
  if (summary) summary.style.display = "block";

  try {
    updateRecordFilterCounts(currentRecordsCache);
    renderFilteredRecordsRows();
  } catch (e) {
    console.warn("UI update warning:", e);
  }
  updateDashboardMetrics();
}

/* --------------------------------------------------------------------------
   9. PEN & PAPER MODE HANDLERS
   -------------------------------------------------------------------------- */
function openPaperScoreModal() {
  if (!activeQuizInstance) return;
  const total = activeQuizInstance.questions.length;
  selectedPaperMistakes.clear();

  const container = document.getElementById("paper-items-grid");
  if (!container) return;
  container.innerHTML = "";

  const baseSize = Math.floor(total / 3);
  const remainder = total % 3;
  const colSizes = [baseSize + (remainder > 0 ? 1 : 0), baseSize + (remainder > 1 ? 1 : 0), baseSize];
  let currentItemIdx = 0;

  for (let c = 0; c < 3; c++) {
    const colDiv = document.createElement("div");
    colDiv.className = "paper-col";
    for (let i = 0; i < colSizes[c]; i++) {
      if (currentItemIdx >= total) break;
      const qIndex = currentItemIdx;
      const qNum = currentItemIdx + 1;

      const itemCard = document.createElement("div");
      itemCard.className = "mistake-check-item";
      itemCard.id = `paper-item-${qIndex}`;
      itemCard.innerHTML = `<span>Item ${qNum}</span><div class="mistake-box"></div>`;
      itemCard.onclick = () => togglePaperMistake(qIndex);
      colDiv.appendChild(itemCard);
      currentItemIdx++;
    }
    container.appendChild(colDiv);
  }

  updatePaperMistakeSummary(total);
  const modal = document.getElementById("paper-score-modal");
  if (modal) {
    modal.style.display = "flex";
    modal.style.zIndex = "99999";
  }
}

function togglePaperMistake(index) {
  const itemEl = document.getElementById(`paper-item-${index}`);
  if (selectedPaperMistakes.has(index)) {
    selectedPaperMistakes.delete(index);
    if (itemEl) itemEl.classList.remove("is-wrong");
  } else {
    selectedPaperMistakes.add(index);
    if (itemEl) itemEl.classList.add("is-wrong");
  }
  const total = activeQuizInstance ? activeQuizInstance.questions.length : 0;
  updatePaperMistakeSummary(total);
}

function updatePaperMistakeSummary(total) {
  const summaryEl = document.getElementById("paper-mistake-summary");
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
    syntheticAnswers[idx] = selectedPaperMistakes.has(idx) ? "__WRONG__" : (q.answer ? q.answer.toLowerCase() : "correct");
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
    userAnswers: syntheticAnswers,
  };

  const records = JSON.parse(localStorage.getItem("quiz_records") || "[]");
  records.unshift(record);
  localStorage.setItem("quiz_records", JSON.stringify(records));

  await renderRecordsTable();
  updateDashboardMetrics();
  closePaperScoreModal();
  finishAndReturnToLibrary();
}

function closePaperScoreModal() {
  const modal = document.getElementById("paper-score-modal");
  if (modal) modal.style.display = "none";
}

function skipPaperScoreLogging() {
  closePaperScoreModal();
  finishAndReturnToLibrary();
}

/* --------------------------------------------------------------------------
   10. RESULT BREAKDOWN & HISTORICAL ATTEMPT REVIEW
   -------------------------------------------------------------------------- */
function updateSummaryFilterPillCounts(items) {
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };
  setEl("filter-count-all", items.length);
  setEl("filter-count-correct", items.filter((i) => i.isCorrect).length);
  setEl("filter-count-incorrect", items.filter((i) => !i.isCorrect).length);
  setEl("filter-count-flagged", items.filter((i) => i.isFlagged).length);
}

function filterSummaryReview(filterType) {
  document.querySelectorAll(".summary-filter-pills .summary-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("onclick").includes(`'${filterType}'`));
  });

  const sourceItems = Array.isArray(currentSummaryReviewItems) ? currentSummaryReviewItems : [];
  let filtered = sourceItems;

  if (filterType === "correct") filtered = sourceItems.filter((i) => i.isCorrect);
  else if (filterType === "incorrect") filtered = sourceItems.filter((i) => !i.isCorrect);
  else if (filterType === "flagged") filtered = sourceItems.filter((i) => i.isFlagged);

  renderSummaryReviewItems(filtered);
}

function updateQuestionAnswerKey(questionOriginalIdx, newAnswerKey) {
  if (!activeQuizInstance || !activeQuizInstance.questions) return;

  const targetQ = activeQuizInstance.questions[questionOriginalIdx];
  if (!targetQ) return;

  targetQ.answer = newAnswerKey.toLowerCase();

  try {
    const storedQuizzes = JSON.parse(localStorage.getItem("quizzes") || "[]");
    const targetDeck = storedQuizzes.find((d) => d.id === activeQuizInstance.id);
    if (targetDeck && targetDeck.questions) {
      const deckQ = targetDeck.questions.find((q, idx) => q.id === targetQ.id || idx === questionOriginalIdx);
      if (deckQ) {
        deckQ.answer = targetQ.answer;
        localStorage.setItem("quizzes", JSON.stringify(storedQuizzes));
      }
    }
  } catch (err) {
    console.error("Failed to update permanent quiz key:", err);
  }

  let newScore = 0;
  const total = activeQuizInstance.questions.length;

  currentSummaryReviewItems.forEach((item) => {
    if (item.originalIndex === questionOriginalIdx) {
      item.answer = targetQ.answer;
    }
    const userChoice = item.chosenAnswer;
    const isCorrect = userChoice && item.answer && String(userChoice).toLowerCase() === String(item.answer).toLowerCase();
    item.isCorrect = !!isCorrect;
    if (item.isCorrect) newScore++;
  });

  const pct = total > 0 ? Math.round((newScore / total) * 100) : 0;
  const scoreDisplay = document.getElementById("result-score-display") || document.getElementById("summary-score-text");
  if (scoreDisplay) scoreDisplay.innerText = `${newScore} / ${total} (${pct}%)`;

  try {
    const localRecords = JSON.parse(localStorage.getItem("quiz_records") || "[]");
    if (localRecords.length > 0) {
      const latestRecord = localRecords[0];
      latestRecord.score = `${newScore} / ${total}`;
      latestRecord.percentage = `${pct}%`;
      latestRecord.mistakesCount = total - newScore;
      latestRecord.mistakenIndices = currentSummaryReviewItems.filter((i) => !i.isCorrect).map((i) => i.originalIndex);
      latestRecord.questions = activeQuizInstance.questions;
      localStorage.setItem("quiz_records", JSON.stringify(localRecords));
      currentRecordsCache = localRecords;
      updateRecordFilterCounts(currentRecordsCache);
      renderFilteredRecordsRows();
    }
  } catch (err) {
    console.error("Failed to update attempt record with new key:", err);
  }

  updateSummaryFilterPillCounts(currentSummaryReviewItems);
  const activePill = document.querySelector(".summary-filter-pills .summary-pill.active");
  const currentFilter = activePill ? (activePill.getAttribute("onclick").match(/'([^']+)'/) || [])[1] || "all" : "all";
  filterSummaryReview(currentFilter);
  updateDashboardMetrics();
}

function renderSummaryReviewItems(items) {
  const container = document.getElementById("summary-wrong-items-container");
  const list = document.getElementById("summary-wrong-items-list");
  if (!container || !list) return;

  container.style.display = "block";
  list.innerHTML = "";

  if (!items || items.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; background: var(--surface-alt); border-radius: 16px; border: 1px dashed var(--border-subtle); margin-top: 8px;">
        <p style="color: var(--text-muted); font-size: 0.92rem; font-weight: 600;">No questions found under this filter.</p>
      </div>`;
    return;
  }

  items.forEach((q) => {
    const card = document.createElement("div");
    card.onclick = (e) => e.stopPropagation();

    let cardClass = "review-item-card";
    if (q.isFlagged) cardClass += " is-flagged";
    else if (q.isCorrect) cardClass += " is-correct";
    else cardClass += " is-wrong";
    card.className = cardClass;

    const optionsHtml = q.options.map((opt) => {
      let extraClass = "";
      let labelTag = "";
      if (q.chosenAnswer && opt.letter.toLowerCase() === String(q.chosenAnswer).toLowerCase()) {
        extraClass = q.isCorrect ? "is-answer" : "user-wrong";
        labelTag = q.isCorrect ? " <strong>(Your Answer - Correct)</strong>" : " <strong>(Your Answer)</strong>";
      } else if (q.answer && opt.letter.toLowerCase() === q.answer.toLowerCase()) {
        extraClass = "is-answer";
        labelTag = " <strong>(Correct Answer)</strong>";
      }
      return `<div class="review-opt-row ${extraClass}"><span>${opt.letter.toUpperCase()}.</span><span>${opt.text}${labelTag}</span></div>`;
    }).join("");

    let badgesHtml = q.isFlagged ? `<span class="review-item-badge badge-flagged">🚩 Flagged</span> ` : "";
    badgesHtml += q.isCorrect
      ? `<span class="review-item-badge badge-correct">Question ${q.id} &bull; Correct</span>`
      : `<span class="review-item-badge badge-wrong">Question ${q.id} &bull; Incorrect</span>`;

    const optionsDropdownHtml = q.options.map((opt) => {
      const isSelected = q.answer && q.answer.toLowerCase() === opt.letter.toLowerCase();
      return `<option value="${opt.letter.toLowerCase()}" ${isSelected ? "selected" : ""}>Option ${opt.letter.toUpperCase()}</option>`;
    }).join("");

    card.innerHTML = `
      <div style="display: flex; gap: 6px; margin-bottom: 8px;">${badgesHtml}</div>
      <div style="font-weight: 800; font-size: 0.98rem; margin-bottom: 8px;">${q.id}. ${q.question}</div>
      <div class="review-options-list">${optionsHtml}</div>
      ${q.explanation ? `<div class="explanation-callout" style="margin-top: 10px;"><strong>Rationale:</strong> ${q.explanation}</div>` : ""}
      <div class="review-card-key-control">
        <span>Correct Key:</span>
        <select class="review-key-select" onchange="updateQuestionAnswerKey(${q.originalIndex}, this.value)">
          ${optionsDropdownHtml}
        </select>
      </div>
    `;
    list.appendChild(card);
  });
}

function openFullAttemptReview(recordId) {
  const records = JSON.parse(localStorage.getItem("quiz_records") || "[]");
  const record = records.find((r) => r.id === recordId);
  if (!record || !record.questions) {
    alert("Full question breakdown not available for this record.");
    return;
  }

  currentActiveAttemptRecord = record;
  document.getElementById("review-panel-title").innerText = `Review: ${record.title}`;
  document.getElementById("review-panel-subtitle").innerText = `Attempted on ${record.date}`;
  document.getElementById("review-score-text").innerText = record.score;
  document.getElementById("review-accuracy-text").innerText = record.percentage;

  const isPaperMode = record.mode === "paper";
  const total = record.questions.length;
  const rawFlags = record.flaggedIndices || record.flagged_indices || [];
  const flaggedSet = new Set(rawFlags.map((n) => Number(n)));
  let correctCount = 0;
  let mistakesCount = 0;

  record.questions.forEach((q, idx) => {
    let isCorrect = false;
    if (isPaperMode) {
      const isMistake = record.mistakenIndices
        ? record.mistakenIndices.includes(idx)
        : (record.userAnswers && record.userAnswers[idx] === "__WRONG__");
      isCorrect = !isMistake;
    } else {
      const userChoice = record.userAnswers && record.userAnswers[idx] ? String(record.userAnswers[idx]).toLowerCase() : null;
      isCorrect = userChoice && q.answer && userChoice === q.answer.toLowerCase();
    }
    isCorrect ? correctCount++ : mistakesCount++;
  });

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };
  setEl("review-count-all", total);
  setEl("review-count-correct", correctCount);
  setEl("review-count-mistakes", mistakesCount);
  setEl("review-count-flagged", flaggedSet.size);

  filterAttemptReview("all");
  switchView("review");
}

function filterAttemptReview(filterType) {
  currentAttemptFilter = filterType;
  document.querySelectorAll(".attempt-review-filter-pills .summary-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("onclick").includes(`'${filterType}'`));
  });
  renderAttemptReviewCards();
}

function renderAttemptReviewCards() {
  const record = currentActiveAttemptRecord;
  const container = document.getElementById("review-all-questions-list");
  if (!record || !container) return;

  container.innerHTML = "";
  const isPaperMode = record.mode === "paper";
  const rawFlags = record.flaggedIndices || record.flagged_indices || [];
  const flaggedSet = new Set(rawFlags.map((n) => Number(n)));
  let renderedCount = 0;

  record.questions.forEach((q, idx) => {
    const isFlagged = flaggedSet.has(idx);
    let isCorrect = false;

    if (isPaperMode) {
      const isMistake = record.mistakenIndices
        ? record.mistakenIndices.includes(idx)
        : (record.userAnswers && record.userAnswers[idx] === "__WRONG__");
      isCorrect = !isMistake;
    } else {
      const userChoice = record.userAnswers && record.userAnswers[idx] ? String(record.userAnswers[idx]).toLowerCase() : null;
      isCorrect = userChoice && q.answer && userChoice === q.answer.toLowerCase();
    }

    if (currentAttemptFilter === "correct" && !isCorrect) return;
    if (currentAttemptFilter === "mistakes" && isCorrect) return;
    if (currentAttemptFilter === "flagged" && !isFlagged) return;
    renderedCount++;

    const card = document.createElement("div");
    let cardClass = "review-item-card";
    if (isFlagged) cardClass += " is-flagged";
    else if (isCorrect) cardClass += " is-correct";
    else cardClass += " is-wrong";
    card.className = cardClass;

    let optionsHtml = "";
    if (isPaperMode) {
      optionsHtml = q.options.map((opt) => {
        const isAnswer = q.answer && opt.letter.toLowerCase() === q.answer.toLowerCase();
        return `<div class="review-opt-row ${isAnswer ? "is-answer" : "paper-neutral"}">
          <span>${opt.letter.toUpperCase()}.</span><span>${opt.text}${isAnswer ? " <strong>(Correct Key)</strong>" : ""}</span>
        </div>`;
      }).join("");
    } else {
      const userChoice = record.userAnswers && record.userAnswers[idx] ? String(record.userAnswers[idx]).toLowerCase() : null;
      optionsHtml = q.options.map((opt) => {
        let extraClass = "";
        let tag = "";
        if (userChoice && opt.letter.toLowerCase() === userChoice) {
          extraClass = isCorrect ? "is-answer" : "user-wrong";
          tag = isCorrect ? " <strong>(Your Correct Answer)</strong>" : " <strong>(Your Answer)</strong>";
        } else if (q.answer && opt.letter.toLowerCase() === q.answer.toLowerCase()) {
          extraClass = "is-answer";
          tag = " <strong>(Correct Answer)</strong>";
        }
        return `<div class="review-opt-row ${extraClass}">
          <span>${opt.letter.toUpperCase()}.</span><span>${opt.text}${tag}</span>
        </div>`;
      }).join("");
    }

    let badgesHtml = isFlagged ? `<span class="review-item-badge badge-flagged">🚩 Flagged</span> ` : "";
    badgesHtml += isCorrect
      ? `<span class="review-item-badge badge-correct">Question ${idx + 1} &bull; Correct</span>`
      : `<span class="review-item-badge badge-wrong">Question ${idx + 1} &bull; Mistake</span>`;

    card.innerHTML = `
      <div style="display: flex; gap: 6px; margin-bottom: 8px;">${badgesHtml}</div>
      <div style="font-weight: 800; font-size: 1rem; margin-bottom: 8px;">${q.id || idx + 1}. ${q.question}</div>
      <div class="review-options-list">${optionsHtml}</div>
      ${q.explanation ? `<div class="explanation-callout" style="margin-top: 10px;"><strong>Rationale:</strong> ${q.explanation}</div>` : ""}
    `;
    container.appendChild(card);
  });

  if (renderedCount === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; background: var(--surface-alt); border-radius: 16px; border: 1px dashed var(--border-subtle);">
        <p style="color: var(--text-muted); font-size: 0.92rem; font-weight: 600;">No questions found under this filter.</p>
      </div>`;
  }
}

/* --------------------------------------------------------------------------
   11. RECORDS TABLE, STATISTICS, STREAKS & DELETION
   -------------------------------------------------------------------------- */
function calculateRecordsStatistics(records) {
  const safeRecords = Array.isArray(records) ? records : [];
  const storedDecks = JSON.parse(localStorage.getItem("quizzes") || "[]");

  const subjectMap = {};
  storedDecks.forEach((d) => {
    if (d.title) subjectMap[d.title.trim().toLowerCase()] = d.subject || "General";
    if (d.id) subjectMap[d.id] = d.subject || "General";
  });

  const subjectScores = {};
  let totalFlaggedAnswered = 0;
  let totalFlaggedCorrect = 0;

  safeRecords.forEach((rec) => {
    const titleKey = (rec.title || "").replace(/\s*\(pen & paper\)/i, "").trim().toLowerCase();
    const resolvedSubject = subjectMap[titleKey] || "General";

    let scoreNum = 0;
    let totalNum = 0;
    if (rec.score && typeof rec.score === "string") {
      const match = rec.score.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        scoreNum = parseInt(match[1], 10);
        totalNum = parseInt(match[2], 10);
      }
    } else if (rec.questions) {
      totalNum = rec.questions.length;
      scoreNum = totalNum - (rec.mistakesCount || 0);
    }

    if (totalNum > 0) {
      if (!subjectScores[resolvedSubject]) {
        subjectScores[resolvedSubject] = { totalScore: 0, totalQuestions: 0 };
      }
      subjectScores[resolvedSubject].totalScore += scoreNum;
      subjectScores[resolvedSubject].totalQuestions += totalNum;
    }

    const flaggedIdxs = rec.flaggedIndices || rec.flagged_indices || [];
    const mistakeIdxs = new Set(rec.mistakenIndices || rec.mistaken_indices || []);

    flaggedIdxs.forEach((fIdx) => {
      totalFlaggedAnswered++;
      if (!mistakeIdxs.has(fIdx)) {
        totalFlaggedCorrect++;
      }
    });
  });

  const bestSubjEl = document.getElementById("stat-best-subject-val");
  if (bestSubjEl) {
    const subjectsList = Object.keys(subjectScores).map((s) => {
      const item = subjectScores[s];
      const pct = item.totalQuestions > 0 ? Math.round((item.totalScore / item.totalQuestions) * 100) : 0;
      return { subject: s, percentage: pct, totalQuestions: item.totalQuestions };
    });

    subjectsList.sort((a, b) => b.percentage - a.percentage);
    bestSubjEl.innerText = subjectsList.length === 0 ? "--" : `${subjectsList[0].subject} (${subjectsList[0].percentage}%)`;
  }

  const flagRateEl = document.getElementById("stat-flagged-rate-val");
  if (flagRateEl) {
    const flagPct = totalFlaggedAnswered === 0 ? 0 : Math.round((totalFlaggedCorrect / totalFlaggedAnswered) * 100);
    flagRateEl.innerText = `${flagPct}%`;
  }

  // Timezone-safe Practice Streak Calculation
  const rawDateStrings = safeRecords
    .map((r) => {
      if (!r.date) return null;
      const match = String(r.date).match(/^\d{4}-\d{2}-\d{2}/);
      return match ? match[0] : null;
    })
    .filter(Boolean);

  const uniqueDateStrings = Array.from(new Set(rawDateStrings)).sort((a, b) => b.localeCompare(a));
  let streak = 0;

  if (uniqueDateStrings.length > 0) {
    const now = new Date();
    const formatYMD = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const todayStr = formatYMD(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatYMD(yesterday);

    const latestSessionDate = uniqueDateStrings[0];

    if (latestSessionDate === todayStr || latestSessionDate === yesterdayStr) {
      streak = 1;
      const [y, m, d] = latestSessionDate.split("-").map(Number);
      let anchorDate = new Date(y, m - 1, d);

      for (let i = 1; i < uniqueDateStrings.length; i++) {
        const [ny, nm, nd] = uniqueDateStrings[i].split("-").map(Number);
        const prevSessionDate = new Date(ny, nm - 1, nd);
        const dayDifference = Math.round((anchorDate - prevSessionDate) / (1000 * 60 * 60 * 24));

        if (dayDifference === 1) {
          streak++;
          anchorDate = prevSessionDate;
        } else {
          break;
        }
      }
    }
  }

  const streakValEl = document.getElementById("stat-streak-val");
  if (streakValEl) {
    streakValEl.innerText = streak === 1 ? "1 Day" : `${streak} Days`;
  }
}

async function renderRecordsTable() {
  const tbody = document.getElementById("records-table-body");
  if (!tbody) return;

  currentRecordsCache = JSON.parse(localStorage.getItem("quiz_records") || "[]");
  calculateRecordsStatistics(currentRecordsCache);
  updateRecordFilterCounts(currentRecordsCache);
  updateSortHeaderIcons();
  renderFilteredRecordsRows();
  updateDashboardMetrics();
}

function updateRecordFilterCounts(records) {
  const safeRecords = Array.isArray(records) ? records : [];
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };
  setEl("record-count-all", safeRecords.length);
  setEl("record-count-device", safeRecords.filter((r) => (r.mode || "device") === "device").length);
  setEl("record-count-paper", safeRecords.filter((r) => r.mode === "paper").length);
}

function filterRecordsTable(filterMode) {
  currentRecordsFilter = filterMode;
  document.querySelectorAll(".records-filter-pills .summary-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("onclick").includes(`'${filterMode}'`));
  });
  renderFilteredRecordsRows();
}

function sortRecordsBy(column) {
  if (currentSortColumn === column) {
    currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
  } else {
    currentSortColumn = column;
    currentSortOrder = column === "title" ? "asc" : "desc";
  }
  updateSortHeaderIcons();
  renderFilteredRecordsRows();
}

function updateSortHeaderIcons() {
  const columns = ["title", "date", "score", "accuracy"];
  columns.forEach((col) => {
    const iconEl = document.getElementById(`sort-icon-${col}`);
    if (!iconEl) return;

    if (col === currentSortColumn) {
      iconEl.innerText = currentSortOrder === "asc" ? "▲" : "▼";
      iconEl.style.opacity = "1";
    } else {
      iconEl.innerText = "⇅";
      iconEl.style.opacity = "0.4";
    }
  });
}

function renderFilteredRecordsRows() {
  const tbody = document.getElementById("records-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  let items = [...currentRecordsCache];
  if (currentRecordsFilter !== "all") {
    items = items.filter((r) => (r.mode || "device") === currentRecordsFilter);
  }

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No records found under this filter.</td></tr>`;
    return;
  }

  items.sort((a, b) => {
    switch (currentSortColumn) {
      case "title": {
        const valA = (a.title || "").toLowerCase();
        const valB = (b.title || "").toLowerCase();
        return currentSortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      case "date": {
        const valA = new Date(a.date || 0).getTime();
        const valB = new Date(b.date || 0).getTime();
        return currentSortOrder === "asc" ? valA - valB : valB - valA;
      }
      case "score": {
        const parseNum = (str) => {
          const m = String(str || "").match(/^(\d+)/);
          return m ? parseInt(m[1], 10) : 0;
        };
        const valA = parseNum(a.score);
        const valB = parseNum(b.score);
        return currentSortOrder === "asc" ? valA - valB : valB - valA;
      }
      case "accuracy": {
        const valA = parseFloat(String(a.percentage || "0").replace("%", "")) || 0;
        const valB = parseFloat(String(b.percentage || "0").replace("%", "")) || 0;
        return currentSortOrder === "asc" ? valA - valB : valB - valA;
      }
      default:
        return 0;
    }
  });

  items.forEach((r, idx) => {
    const recordId = r.id || `rec_${idx}`;
    const row = document.createElement("tr");
    row.onclick = (e) => {
      if (e.target.closest("button")) return;
      openFullAttemptReview(recordId);
    };

    const modeBadge = r.mode === "paper"
      ? `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 9999px; background: var(--surface-alt); border: 1px solid var(--border-subtle); color: var(--text-muted); margin-left: 6px;">Paper</span>`
      : "";

    row.innerHTML = `
      <td><strong>${r.title}</strong> ${modeBadge}</td>
      <td>${r.date}</td>
      <td>${r.score}</td>
      <td><span style="color: var(--primary); font-weight: 800;">${r.percentage}</span></td>
      <td style="text-align: center;">
        <button class="btn btn-danger" style="padding: 5px 12px; font-size: 0.8rem; white-space: nowrap;" type="button" onclick="handleDeleteRecordClick('${recordId}', ${idx})">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function handleDeleteRecordClick(recordId, index) {
  const modal = document.getElementById("delete-record-modal");
  if (modal) {
    pendingDeleteRecordId = recordId;
    modal.style.display = "flex";
  } else if (confirm("Are you sure you want to permanently delete this attempt record?")) {
    executeDeleteRecord(recordId, index);
  }
}

async function executeDeleteRecord(recordId) {
  let records = JSON.parse(localStorage.getItem("quiz_records") || "[]");
  records = records.filter((r) => r.id !== recordId);
  localStorage.setItem("quiz_records", JSON.stringify(records));
  currentRecordsCache = records;

  if (currentUser) {
    try {
      await sb.from("quiz_records").delete().eq("id", recordId).eq("user_id", currentUser.id);
    } catch (err) {
      console.warn("Failed to delete record from cloud:", err);
    }
  }

  await renderRecordsTable();
  updateDashboardMetrics();
}

function closeDeleteRecordModal() {
  pendingDeleteRecordId = null;
  const modal = document.getElementById("delete-record-modal");
  if (modal) modal.style.display = "none";
}

function confirmDeleteRecord() {
  if (!pendingDeleteRecordId) return;
  executeDeleteRecord(pendingDeleteRecordId);
  closeDeleteRecordModal();
}

async function clearAllRecords() {
  const records = JSON.parse(localStorage.getItem("quiz_records") || "[]");
  if (records.length === 0) return;

  if (confirm("Are you sure you want to clear all quiz records on this device?")) {
    localStorage.removeItem("quiz_records");
    currentRecordsCache = [];

    if (currentUser) {
      try {
        await sb.from("quiz_records").delete().eq("user_id", currentUser.id);
      } catch (err) {
        console.warn("Failed to clear cloud records:", err);
      }
    }

    await renderRecordsTable();
    updateDashboardMetrics();
  }
}

/* --------------------------------------------------------------------------
   12. MANUAL QUIZ CREATOR & DECK EDITOR
   -------------------------------------------------------------------------- */
function initManualCreator() {
  populateEditQuizDropdown();
  startFreshQuizCreation();
}

function populateEditQuizDropdown() {
  const dropdown = document.getElementById("select-edit-quiz");
  if (!dropdown) return;

  const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  dropdown.innerHTML = `<option value="">-- Choose a quiz to load --</option>`;

  stored
    .filter((quiz) => quiz.isActive !== false)
    .forEach((quiz) => {
      const opt = document.createElement("option");
      opt.value = quiz.id;
      opt.innerText = `${quiz.title} (${quiz.totalQuestions} items)`;
      dropdown.appendChild(opt);
    });
}

function startFreshQuizCreation() {
  const titleInput = document.getElementById("create-quiz-title");
  if (titleInput) titleInput.value = "";

  const subjectInput = document.getElementById("create-quiz-subject");
  if (subjectInput) subjectInput.value = "General";

  const container = document.getElementById("creator-questions-container");
  if (container) {
    container.innerHTML = "";
    addQuestionBlock("creator-questions-container");
  }
}

function loadQuizForEditing(quizId) {
  const editArea = document.getElementById("edit-editor-area");
  if (!quizId) {
    if (editArea) editArea.style.display = "none";
    return;
  }

  const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  const quiz = stored.find((q) => q.id === quizId);
  if (!quiz) return;

  document.getElementById("editing-quiz-id").value = quiz.id;
  document.getElementById("edit-quiz-title").value = quiz.title;
  document.getElementById("edit-quiz-subject").value = quiz.subject || "General";

  const container = document.getElementById("editor-questions-container");
  container.innerHTML = "";
  quiz.questions.forEach((q) => {
    addQuestionBlock("editor-questions-container", {
      question: q.question,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation,
    });
  });

  if (editArea) editArea.style.display = "block";
}

function addQuestionBlock(targetContainerId, data = null) {
  const container = document.getElementById(targetContainerId);
  if (!container) return;

  const block = document.createElement("div");
  block.className = "create-question-card";

  const promptVal = data ? data.question : "";
  const expVal = data ? (data.explanation || "") : "";
  const optA = data?.options?.[0]?.text || "";
  const optB = data?.options?.[1]?.text || "";
  const optC = data?.options?.[2]?.text || "";
  const optD = data?.options?.[3]?.text || "";
  const correctOpt = data ? (data.answer || "a") : "a";

  block.innerHTML = `
    <div class="create-card-header">
      <strong>Question</strong>
      <button type="button" class="btn btn-danger" style="padding: 4px 12px; font-size: 0.78rem;" onclick="this.closest('.create-question-card').remove(); renumberQuestionBlocks('${targetContainerId}')">Remove</button>
    </div>
    <div class="form-group" style="margin-bottom: 14px;">
      <input type="text" class="q-input-prompt" placeholder="Enter question prompt..." value="${promptVal.replace(/"/g, "&quot;")}" />
    </div>
    <div class="options-input-grid">
      <div class="input-with-label"><span>A</span><input type="text" class="opt-val" data-opt="a" placeholder="Option A" value="${optA.replace(/"/g, "&quot;")}" /></div>
      <div class="input-with-label"><span>B</span><input type="text" class="opt-val" data-opt="b" placeholder="Option B" value="${optB.replace(/"/g, "&quot;")}" /></div>
      <div class="input-with-label"><span>C</span><input type="text" class="opt-val" data-opt="c" placeholder="Option C" value="${optC.replace(/"/g, "&quot;")}" /></div>
      <div class="input-with-label"><span>D</span><input type="text" class="opt-val" data-opt="d" placeholder="Option D" value="${optD.replace(/"/g, "&quot;")}" /></div>
    </div>
    <div style="display: grid; grid-template-columns: 160px 1fr; gap: 14px; align-items: start; margin-top: 14px;">
      <div class="form-group" style="margin-bottom: 0;">
        <label>Correct Answer</label>
        <select class="correct-opt-select" style="padding: 10px 14px; border-radius: var(--radius-input);">
          <option value="a" ${correctOpt === "a" ? "selected" : ""}>Option A</option>
          <option value="b" ${correctOpt === "b" ? "selected" : ""}>Option B</option>
          <option value="c" ${correctOpt === "c" ? "selected" : ""}>Option C</option>
          <option value="d" ${correctOpt === "d" ? "selected" : ""}>Option D</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <label>Rationale (Optional)</label>
        <input type="text" class="q-input-explanation" placeholder="Rationale explanation..." value="${expVal.replace(/"/g, "&quot;")}" />
      </div>
    </div>
  `;

  container.appendChild(block);
  renumberQuestionBlocks(targetContainerId);
}

function renumberQuestionBlocks(targetContainerId) {
  const container = document.getElementById(targetContainerId);
  if (!container) return;
  container.querySelectorAll(".create-question-card").forEach((card, index) => {
    const headerTitle = card.querySelector(".create-card-header strong");
    if (headerTitle) headerTitle.innerText = `Question ${index + 1}`;
  });
}

async function saveManualQuiz(mode = "create") {
  const isCreate = mode === "create";
  const prefix = isCreate ? "create" : "edit";
  const containerId = isCreate ? "creator-questions-container" : "editor-questions-container";
  const statusBoxId = `${prefix}-status`;

  const title = (document.getElementById(`${prefix}-quiz-title`)?.value || "").trim() || "Untitled Quiz";
  const subject = (document.getElementById(`${prefix}-quiz-subject`)?.value || "").trim() || "General";
  const editingId = isCreate ? null : document.getElementById("editing-quiz-id").value;

  const container = document.getElementById(containerId);
  const cards = container ? container.querySelectorAll(".create-question-card") : [];

  if (cards.length === 0) {
    showStatus(statusBoxId, "Please add at least one question before saving.", "error");
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
    optInputs.forEach((input) => {
      const val = input.value.trim();
      if (!val) hasIncomplete = true;
      options.push({ letter: input.getAttribute("data-opt"), text: val });
    });

    parsedQuestions.push({
      id: index + 1,
      question: prompt,
      options: options,
      answer: correctOpt,
      explanation: explanation,
    });
  });

  if (hasIncomplete) {
    showStatus(statusBoxId, "Please fill in all question prompts and all 4 choices.", "error");
    return;
  }

  const quizObj = {
    id: editingId || ("quiz_" + Date.now()),
    title: title,
    subject: subject,
    sortOrder: (cachedDecks || []).length,
    uploadedAt: new Date().toISOString().split("T")[0],
    totalQuestions: parsedQuestions.length,
    questions: parsedQuestions,
  };

  const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  if (editingId) {
    const idx = stored.findIndex((q) => q.id === editingId);
    if (idx !== -1) stored[idx] = quizObj;
  } else {
    stored.unshift(quizObj);
  }
  localStorage.setItem("quizzes", JSON.stringify(stored));

  populateEditQuizDropdown();
  await renderQuizList();
  updateDashboardMetrics();

  if (isCreate) {
    startFreshQuizCreation();
    switchView("take");
  } else {
    showStatus(statusBoxId, "Changes saved successfully!", "success");
    setTimeout(() => {
      const box = document.getElementById(statusBoxId);
      if (box) box.style.display = "none";
    }, 3000);
  }
}

/* --------------------------------------------------------------------------
   13. FILE UPLOAD & AI TEXT PARSING ENGINE
   -------------------------------------------------------------------------- */
async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const ext = file.name.split(".").pop().toLowerCase();
  const titleInput = document.getElementById("quiz-title-input");
  if (!titleInput.value.trim()) titleInput.value = file.name.replace(/\.[^/.]+$/, "");

  showStatus("upload-status", "Reading file: " + file.name, "success");

  try {
    if (ext === "docx") {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
      document.getElementById("raw-paste").value = result.value;
    } else if (["txt", "json", "csv"].includes(ext)) {
      document.getElementById("raw-paste").value = await file.text();
    }
    processAndLoadQuiz();
  } catch (err) {
    showStatus("upload-status", "Error reading file: " + err.message, "error");
  }
}

function parseFormattedText(rawText) {
  if (!rawText || !rawText.trim()) return [];

  const cleanedText = rawText.replace(/\\([.\-\)])/g, "$1");
  const lines = cleanedText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  let splitIndex = -1;
  const answerSectionHeaderRegex = /^(?:answer\s*keys?|answers?|solutions?|correct\s*answers?|rationales?)\b[\s\:\-\=]*$/i;

  for (let i = 0; i < lines.length; i++) {
    if (answerSectionHeaderRegex.test(lines[i])) {
      splitIndex = i;
      break;
    }
  }

  const questionLines = splitIndex !== -1 ? lines.slice(0, splitIndex) : lines;
  const answerLines = splitIndex !== -1 ? lines.slice(splitIndex + 1) : [];

  const questions = [];
  let curQ = null;

  const qStartRegex = /^(?:q(?:uestion)?\.?|item)?\s*\(?(\d+)\)?[\.\:\-\)]\s*(.*)/i;
  const inlineAnsRegex = /^(?:correct\s*)?(?:answer|ans)\s*[\:\-\=]\s*\(?([a-e])\)?[\.\:\-\)]?\s*(.*)/i;
  const inlineExpRegex = /^(?:rationale|explanation|reason)\s*[\:\-\=]\s*(.*)/i;

  for (let line of questionLines) {
    const qMatch = line.match(qStartRegex);
    const inlineAnsMatch = line.match(inlineAnsRegex);
    const inlineExpMatch = line.match(inlineExpRegex);

    if (qMatch && !inlineAnsMatch && !inlineExpMatch) {
      if (curQ) questions.push(curQ);
      curQ = {
        id: parseInt(qMatch[1], 10),
        question: qMatch[2] ? qMatch[2].trim() : "",
        options: [],
        answer: "",
        explanation: "",
      };
    } else if (inlineAnsMatch && curQ) {
      curQ.answer = inlineAnsMatch[1].toLowerCase();
      if (inlineAnsMatch[2]) {
        curQ.explanation = inlineAnsMatch[2].replace(/^(?:explanation|rationale)\s*[\:\-\=]\s*/i, "").trim();
      }
    } else if (inlineExpMatch && curQ) {
      curQ.explanation = inlineExpMatch[1].trim();
    } else if (curQ) {
      const inlineMatches = [...line.matchAll(/(?:^|\s+)(?:option\s*)?\(?([a-e])\)?[\.\:\-\)\]]\s*([^\s].*?)(?=(?:\s+(?:option\s*)?\(?[a-e]\)?[\.\:\-\)\]])|$)/gi)];

      if (inlineMatches.length > 0 && curQ.options.length === 0) {
        inlineMatches.forEach((m) => {
          if (curQ.options.length < 5) {
            curQ.options.push({
              letter: m[1].toLowerCase(),
              text: m[2].trim(),
            });
          }
        });
      } else {
        const singleOptMatch = line.match(/^(?:option\s*)?\(?([a-e])\)?[\.\:\-\)\]]\s*(.+)/i);
        if (singleOptMatch && curQ.options.length < 5) {
          curQ.options.push({
            letter: singleOptMatch[1].toLowerCase(),
            text: singleOptMatch[2].trim(),
          });
        } else if (curQ.options.length === 0) {
          curQ.question = curQ.question ? `${curQ.question} ${line}` : line;
        } else {
          const lastOpt = curQ.options[curQ.options.length - 1];
          lastOpt.text += " " + line;
        }
      }
    }
  }
  if (curQ) questions.push(curQ);

  for (let line of answerLines) {
    const ansMatch = line.match(/^(?:q(?:uestion)?\.?|item)?\s*\(?(\d+)\)?[\.\:\-\)]\s*\(?([a-e])\)?[\.\:\-\)]?\s*(.*)/i);
    if (ansMatch) {
      const num = parseInt(ansMatch[1], 10);
      const qObj = questions.find((q) => q.id === num);
      if (qObj) {
        if (ansMatch[2]) qObj.answer = ansMatch[2].toLowerCase();
        if (ansMatch[3]) {
          qObj.explanation = ansMatch[3].replace(/^(?:explanation|rationale)\s*[\:\-\=]\s*/i, "").trim();
        }
      }
    }
  }

  return questions.map((q, index) => ({
    ...q,
    id: index + 1,
  }));
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
    explanation: q.explanation || q.rationale || "",
  }));
}

async function processAndLoadQuiz() {
  const text = document.getElementById("raw-paste").value.trim();
  const title = document.getElementById("quiz-title-input").value.trim();
  const subject = (document.getElementById("quiz-subject-input")?.value || "").trim();

  if (!title) {
    showStatus("upload-status", "Please enter a Quiz Title before adding.", "error");
    document.getElementById("quiz-title-input")?.focus();
    return;
  }

  if (!subject) {
    showStatus("upload-status", "Please enter a Subject / Category before adding.", "error");
    document.getElementById("quiz-subject-input")?.focus();
    return;
  }

  if (!text) {
    showStatus("upload-status", "Please paste content or upload a valid quiz file.", "error");
    document.getElementById("raw-paste")?.focus();
    return;
  }

  let parsedQuestions = [];
  try {
    parsedQuestions = (text.startsWith("{") || text.startsWith("[")) ? parseJSON(text) : parseFormattedText(text);
    if (parsedQuestions.length === 0) {
      showStatus("upload-status", "No valid questions detected. Verify numbering format.", "error");
      return;
    }

    const quizRecord = {
      id: "quiz_" + Date.now(),
      title: title,
      subject: subject,
      sortOrder: (cachedDecks || []).length,
      uploadedAt: new Date().toISOString().split("T")[0],
      totalQuestions: parsedQuestions.length,
      questions: parsedQuestions,
    };

    const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
    stored.unshift(quizRecord);
    localStorage.setItem("quizzes", JSON.stringify(stored));

    clearUploadForm();
    await renderQuizList();
    updateDashboardMetrics();
    switchView("take");
    startQuizSession(quizRecord, "device");
  } catch (err) {
    showStatus("upload-status", "Parsing failed: " + err.message, "error");
  }
}

function populateUploadSubjectDatalist() {
  const datalist = document.getElementById("available-subjects-list");
  if (!datalist) return;

  const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  const uniqueSubjects = Array.from(
    new Set(
      stored
        .filter((q) => q.isActive !== false && q.subject)
        .map((q) => q.subject.trim())
    )
  ).sort((a, b) => a.localeCompare(b));

  datalist.innerHTML = uniqueSubjects
    .map((subj) => `<option value="${escapeHtml(subj)}"></option>`)
    .join("");
}

function clearUploadForm() {
  document.getElementById("raw-paste").value = "";
  document.getElementById("quiz-title-input").value = "";
  document.getElementById("file-input").value = "";
  const box = document.getElementById("upload-status");
  if (box) box.style.display = "none";
  const subjectInput = document.getElementById("quiz-subject-input");
  if (subjectInput) subjectInput.value = "";
}

/* --------------------------------------------------------------------------
   14. OFFLINE BACKUP (JSON IMPORT/EXPORT) & PDF PRINT EXPORT
   -------------------------------------------------------------------------- */
function exportDataBackup() {
  try {
    const rawQuizzes = JSON.parse(localStorage.getItem("quizzes") || "[]").filter((deck) => deck.isActive !== false);
    const rawRecords = JSON.parse(localStorage.getItem("quiz_records") || "[]");
    const rawMistakeBank = JSON.parse(localStorage.getItem("quiz_mistake_bank") || "{}");

    const now = new Date();
    const formattedDate = now.toISOString().split("T")[0];
    const formattedTime = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const backupMetadata = {
      backup_summary: {
        app_name: "QuizHub",
        version: "2.1",
        created_date: formattedDate,
        created_time: formattedTime,
        created_timestamp_iso: now.toISOString(),
        total_quizzes: rawQuizzes.length,
        total_attempt_records: rawRecords.length,
        total_tracked_mistakes: Object.keys(rawMistakeBank).length,
        user_account: currentUser ? currentUser.email || currentUser.id : "Local / Guest",
      },
    };

    const sanitizedQuizzes = rawQuizzes.map((deck, idx) => ({
      id: String(deck.id || `quiz_${Date.now()}_${idx}`),
      title: String(deck.title || "Untitled Assessment").trim(),
      subject: String(deck.subject || "General").trim(),
      colorAccent: deck.colorAccent || "#2563eb",
      sortOrder: Number.isInteger(deck.sortOrder) ? deck.sortOrder : idx,
      uploadedAt: deck.uploadedAt || formattedDate,
      totalQuestions: Number(deck.totalQuestions) || (deck.questions ? deck.questions.length : 0),
      questions: Array.isArray(deck.questions)
        ? deck.questions.map((q, qIdx) => ({
            id: Number(q.id) || qIdx + 1,
            question: String(q.question || "").trim(),
            options: Array.isArray(q.options)
              ? q.options.map((opt) => ({
                  letter: String(opt.letter || "").toLowerCase().trim(),
                  text: String(opt.text || "").trim(),
                }))
              : [],
            answer: String(q.answer || "").toLowerCase().trim(),
            explanation: String(q.explanation || q.rationale || "").trim(),
          }))
        : [],
    }));

    const sanitizedRecords = rawRecords.map((rec, idx) => {
      const rawFlags = rec.flaggedIndices || rec.flagged_indices || [];
      const rawMistakes = rec.mistakenIndices || rec.mistaken_indices || [];

      return {
        id: String(rec.id || `rec_${Date.now()}_${idx}`),
        title: String(rec.title || "Untitled Attempt").trim(),
        date: rec.date || formattedDate,
        score: String(rec.score || "0 / 0"),
        percentage: String(rec.percentage || "0%"),
        mode: rec.mode === "paper" ? "paper" : "device",
        mistakesCount: Number.isInteger(rec.mistakesCount) ? rec.mistakesCount : Number(rec.mistakes_count) || rawMistakes.length,
        mistakenIndices: Array.from(new Set(rawMistakes.map((n) => Number(n)))),
        flaggedIndices: Array.from(new Set(rawFlags.map((n) => Number(n)))),
        questions: Array.isArray(rec.questions) ? rec.questions : [],
        userAnswers: typeof rec.userAnswers === "object" && rec.userAnswers !== null ? rec.userAnswers : rec.user_answers || {},
      };
    });

    const backupEnvelope = {
      ...backupMetadata,
      quizzes: sanitizedQuizzes,
      quiz_records: sanitizedRecords,
      quiz_mistake_bank: rawMistakeBank,
      quiz_subject_colors: getSubjectColorsMap(),
    };

    const blob = new Blob([JSON.stringify(backupEnvelope, null, 2)], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = downloadUrl;
    downloadAnchor.download = `QuizHub_Backup_${formattedDate}.json`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();

    setTimeout(() => {
      document.body.removeChild(downloadAnchor);
      URL.revokeObjectURL(downloadUrl);
    }, 150);
  } catch (err) {
    console.error("Export error:", err);
    alert("Export failed: " + err.message);
  }
}

function triggerImportFileInput() {
  const input = document.getElementById("backup-file-input");
  if (input) {
    input.value = "";
    input.click();
  }
}

function handleBackupFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      let importedData;
      try {
        importedData = JSON.parse(e.target.result);
      } catch {
        throw new Error("The selected file is not valid JSON.");
      }

      const rawQuizzes = Array.isArray(importedData.quizzes)
        ? importedData.quizzes
        : Array.isArray(importedData)
        ? importedData
        : [];
      const rawRecords = Array.isArray(importedData.quiz_records)
        ? importedData.quiz_records
        : Array.isArray(importedData.records)
        ? importedData.records
        : [];
      const rawMistakes = typeof importedData.quiz_mistake_bank === "object" && importedData.quiz_mistake_bank !== null
        ? importedData.quiz_mistake_bank
        : {};
      const rawSubjectColors = typeof importedData.quiz_subject_colors === "object" && importedData.quiz_subject_colors !== null
        ? importedData.quiz_subject_colors
        : {};

      if (rawQuizzes.length === 0 && rawRecords.length === 0 && Object.keys(rawMistakes).length === 0) {
        alert("Import aborted: No valid quiz data found in this backup file.");
        return;
      }

      const shouldOverwrite = confirm(
        `📦 Backup Found:\n` +
        `• Decks: ${rawQuizzes.length}\n` +
        `• Attempt Records: ${rawRecords.length}\n` +
        `• Tracked Mistakes: ${Object.keys(rawMistakes).length}\n` +
        `• Subject Themes: ${Object.keys(rawSubjectColors).length}\n\n` +
        `Do you want to REPLACE your current local data?\n\n` +
        `• Click [OK] to Overwrite current data.\n` +
        `• Click [Cancel] to MERGE with existing data.`
      );

      const cleanQuizzes = rawQuizzes
        .filter((d) => d.isActive !== false)
        .map((d, i) => ({
          id: String(d.id || `quiz_${Date.now()}_${i}`),
          title: String(d.title || "Untitled Assessment").trim(),
          subject: String(d.subject || "General").trim(),
          sortOrder: d.sortOrder ?? i,
          uploadedAt: d.uploadedAt || new Date().toISOString().split("T")[0],
          totalQuestions: d.totalQuestions || (d.questions ? d.questions.length : 0),
          questions: Array.isArray(d.questions) ? d.questions : [],
          isActive: true,
        }));

      const cleanRecords = rawRecords.map((r, i) => {
        const rawFlags = r.flaggedIndices || r.flagged_indices || [];
        const rawItemMistakes = r.mistakenIndices || r.mistaken_indices || [];
        return {
          id: String(r.id || `rec_${Date.now()}_${i}`),
          title: String(r.title || "Untitled Attempt").trim(),
          date: r.date || new Date().toISOString().split("T")[0],
          score: String(r.score || "0 / 0"),
          percentage: String(r.percentage || "0%"),
          mode: r.mode === "paper" ? "paper" : "device",
          mistakesCount: r.mistakesCount ?? r.mistakes_count ?? rawItemMistakes.length,
          mistakenIndices: Array.from(new Set(rawItemMistakes.map((n) => Number(n)))),
          flaggedIndices: Array.from(new Set(rawFlags.map((n) => Number(n)))),
          questions: Array.isArray(r.questions) ? r.questions : [],
          userAnswers: r.userAnswers || r.user_answers || {},
        };
      });

      if (shouldOverwrite) {
        localStorage.setItem("quizzes", JSON.stringify(cleanQuizzes));
        localStorage.setItem("quiz_records", JSON.stringify(cleanRecords));
        localStorage.setItem("quiz_mistake_bank", JSON.stringify(rawMistakes));
        localStorage.setItem("quiz_subject_colors", JSON.stringify(rawSubjectColors));
      } else {
        const existingDecks = JSON.parse(localStorage.getItem("quizzes") || "[]");
        const existingRecords = JSON.parse(localStorage.getItem("quiz_records") || "[]");
        const existingMistakes = JSON.parse(localStorage.getItem("quiz_mistake_bank") || "{}");
        const existingSubjectColors = JSON.parse(localStorage.getItem("quiz_subject_colors") || "{}");

        const mergedDecksMap = new Map();
        existingDecks.forEach((d) => mergedDecksMap.set(d.id, d));
        cleanQuizzes.forEach((d) => mergedDecksMap.set(d.id, d));

        const mergedRecordsMap = new Map();
        existingRecords.forEach((r) => mergedRecordsMap.set(r.id, r));
        cleanRecords.forEach((r) => mergedRecordsMap.set(r.id, r));

        const mergedMistakes = { ...existingMistakes, ...rawMistakes };
        const mergedSubjectColors = { ...existingSubjectColors, ...rawSubjectColors };

        localStorage.setItem("quizzes", JSON.stringify(Array.from(mergedDecksMap.values())));
        localStorage.setItem("quiz_records", JSON.stringify(Array.from(mergedRecordsMap.values())));
        localStorage.setItem("quiz_mistake_bank", JSON.stringify(mergedMistakes));
        localStorage.setItem("quiz_subject_colors", JSON.stringify(mergedSubjectColors));
      }

      await renderQuizList();
      await renderRecordsTable();
      populateEditQuizDropdown();
      renderWeakSpotsBanner();
      updateDashboardMetrics();

      if (currentUser && confirm("Restore complete! Would you like to sync the restored items to your Supabase cloud account now?")) {
        await pushLocalDataToSupabase();
      } else {
        alert("✅ Data successfully restored into your local browser workspace!");
      }
    } catch (err) {
      console.error("Backup restoration failed:", err);
      alert("Restore failed: " + err.message);
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function exportQuizDeckToPDF(quizId) {
  const stored = JSON.parse(localStorage.getItem("quizzes") || "[]");
  const quiz = stored.find((q) => q.id === quizId);

  if (!quiz || !quiz.questions || quiz.questions.length === 0) {
    alert("Unable to export: Quiz deck contains no questions.");
    return;
  }

  const stage = document.getElementById("quiz-pdf-export-stage");
  if (!stage) return;

  const questionsHtml = quiz.questions.map((q, idx) => {
    const qNum = idx + 1;
    const optionsHtml = (q.options || []).map((opt) => `
      <div class="pdf-q-opt">
        <span class="pdf-opt-letter">${(opt.letter || "").toUpperCase()}.</span>
        <span>${escapeHtml(opt.text || "")}</span>
      </div>
    `).join("");

    return `
      <div class="pdf-q-item">
        <div class="pdf-q-prompt">${qNum}. ${escapeHtml(q.question || "")}</div>
        <div class="pdf-q-options">${optionsHtml}</div>
      </div>
    `;
  }).join("");

  const answersHtml = quiz.questions.map((q, idx) => {
    const qNum = idx + 1;
    const answerKey = (q.answer || "N/A").toUpperCase();
    const rationale = q.explanation || q.rationale || "No rationale provided.";

    return `
      <div class="pdf-ans-item">
        <span class="pdf-ans-key">${qNum}. ${answerKey}</span>
        <div class="pdf-ans-rationale">${escapeHtml(rationale)}</div>
      </div>
    `;
  }).join("");

  stage.innerHTML = `
    <div class="pdf-header">
      <div>
        <h1>${escapeHtml(quiz.title || "Quiz Assessment")}</h1>
        <div style="font-size: 0.85rem; font-weight: 700; color: #475569; margin-top: 2px;">
          Subject: ${escapeHtml(quiz.subject || "General")}
        </div>
      </div>
      <div class="pdf-meta">
        <div><strong>Total Items:</strong> ${quiz.questions.length}</div>
        <div>Date: ${new Date().toISOString().split("T")[0]}</div>
      </div>
    </div>

    <div class="pdf-questions-grid">
      ${questionsHtml}
    </div>

    <div class="pdf-answers-section">
      <div class="pdf-answers-header">Answer Key & Rationales</div>
      <div class="pdf-answers-grid">
        ${answersHtml}
      </div>
    </div>
  `;

  const originalTitle = document.title;
  document.title = `${quiz.title.replace(/[\\/:*?"<>|]/g, "_")}_Assessment`;

  window.print();

  setTimeout(() => {
    document.title = originalTitle;
    stage.innerHTML = "";
  }, 1000);
}

/* --------------------------------------------------------------------------
   15. CLOUD SYNCHRONIZATION (SUPABASE PUSH & PULL)
   -------------------------------------------------------------------------- */
async function pushLocalDataToSupabase() {
  if (!currentUser) {
    openAuthModal(pushLocalDataToSupabase);
    return;
  }

  const syncButtons = document.querySelectorAll('.sidebar-footer-card button, .nav-btn[onclick*="pushLocalDataToSupabase"]');
  syncButtons.forEach((btn) => (btn.disabled = true));

  try {
    const rawQuizzes = JSON.parse(localStorage.getItem("quizzes") || "[]");
    const rawRecords = JSON.parse(localStorage.getItem("quiz_records") || "[]");
    const rawSubjectColors = JSON.parse(localStorage.getItem("quiz_subject_colors") || "{}");

    const hasDecks = rawQuizzes.length > 0;
    const hasRecords = rawRecords.length > 0;
    const hasColors = Object.keys(rawSubjectColors).length > 0;

    if (!hasDecks && !hasRecords && !hasColors) {
      typeof showToast === "function" ? showToast("No local data found to push.") : alert("No local data found to push.");
      return;
    }

    const decksPayload = rawQuizzes.map((d, idx) => ({
      id: String(d.id),
      user_id: currentUser.id,
      title: d.title || "Untitled Assessment",
      subject: d.subject || "General",
      sort_order: Number.isInteger(d.sortOrder) ? d.sortOrder : idx,
      total_questions: Number(d.totalQuestions) || (d.questions ? d.questions.length : 0),
      questions: d.questions || [],
      uploaded_at: d.uploadedAt || new Date().toISOString(),
      is_active: d.isActive !== false,
    }));

    const recordsPayload = rawRecords.map((r) => ({
      id: String(r.id),
      user_id: currentUser.id,
      title: r.title || "Untitled Attempt",
      date: r.date || new Date().toISOString().split("T")[0],
      score: String(r.score || "0 / 0"),
      percentage: String(r.percentage || "0%"),
      mode: r.mode === "paper" ? "paper" : "device",
      mistakes_count: Number(r.mistakesCount) || 0,
      mistaken_indices: r.mistakenIndices || [],
      flagged_indices: r.flaggedIndices || [],
      questions: r.questions || [],
      user_answers: r.userAnswers || {},
    }));

    const subjectColorsPayload = Object.keys(rawSubjectColors).map((subjectKey) => ({
      user_id: currentUser.id,
      subject: subjectKey.toLowerCase(),
      color_accent: rawSubjectColors[subjectKey],
      updated_at: new Date().toISOString(),
    }));

    if (decksPayload.length > 0) {
      const { error: deckErr } = await sb.from("quiz_decks").upsert(decksPayload, { onConflict: "id" });
      if (deckErr) throw deckErr;
    }

    if (recordsPayload.length > 0) {
      const { error: recErr } = await sb.from("quiz_records").upsert(recordsPayload, { onConflict: "id" });
      if (recErr) throw recErr;
    }

    if (subjectColorsPayload.length > 0) {
      const { error: colorErr } = await sb
        .from("quiz_subject_colors")
        .upsert(subjectColorsPayload, { onConflict: "user_id,subject" });
      if (colorErr) throw colorErr;
    }

    const summaryMsg = `Cloud sync complete!\n• Decks synced: ${decksPayload.length}\n• Attempt records synced: ${recordsPayload.length}\n• Subject themes synced: ${subjectColorsPayload.length}`;
    typeof showToast === "function" ? showToast(summaryMsg) : alert(summaryMsg);
  } catch (err) {
    console.error("Cloud push failed:", err);
    typeof showToast === "function" ? showToast("Push failed: " + err.message) : alert("Push failed: " + err.message);
  } finally {
    syncButtons.forEach((btn) => (btn.disabled = false));
  }
}

async function pullCloudDataToLocalStorage() {
  if (!currentUser) {
    openAuthModal(pullCloudDataToLocalStorage);
    return;
  }

  try {
    const [decksRes, recordsRes, colorsRes] = await Promise.all([
      sb.from("quiz_decks").select("*").eq("user_id", currentUser.id),
      sb.from("quiz_records").select("*").eq("user_id", currentUser.id),
      sb.from("quiz_subject_colors").select("*").eq("user_id", currentUser.id),
    ]);

    if (decksRes.error) throw decksRes.error;
    if (recordsRes.error) throw recordsRes.error;
    if (colorsRes.error) throw colorsRes.error;

    const cloudDecks = decksRes.data || [];
    const cloudRecords = recordsRes.data || [];
    const cloudColors = colorsRes.data || [];

    if (cloudDecks.length === 0 && cloudRecords.length === 0 && cloudColors.length === 0) {
      typeof showToast === "function"
        ? showToast("No cloud backups found for your account.")
        : alert("No cloud backups found for your account.");
      return;
    }

    const normalizedDecks = cloudDecks.map((d) => ({
      id: d.id,
      title: d.title,
      subject: d.subject,
      sortOrder: d.sort_order ?? 0,
      totalQuestions: d.total_questions || (d.questions ? d.questions.length : 0),
      questions: d.questions || [],
      uploadedAt: d.uploaded_at,
      isActive: d.is_active !== false,
    }));

    const normalizedRecords = cloudRecords.map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      score: r.score,
      percentage: r.percentage,
      mode: r.mode || "device",
      mistakesCount: r.mistakes_count ?? 0,
      mistakenIndices: r.mistaken_indices || [],
      flaggedIndices: r.flagged_indices || [],
      questions: r.questions || [],
      userAnswers: r.user_answers || {},
    }));

    const localDecks = JSON.parse(localStorage.getItem("quizzes") || "[]");
    const localRecords = JSON.parse(localStorage.getItem("quiz_records") || "[]");

    const deckMap = new Map();
    localDecks.forEach((d) => deckMap.set(d.id, d));
    normalizedDecks.forEach((d) => deckMap.set(d.id, d));

    const recordMap = new Map();
    localRecords.forEach((r) => recordMap.set(r.id, r));
    normalizedRecords.forEach((r) => recordMap.set(r.id, r));

    const localSubjectColors = JSON.parse(localStorage.getItem("quiz_subject_colors") || "{}");
    cloudColors.forEach((entry) => {
      if (entry.subject && entry.color_accent) {
        localSubjectColors[entry.subject.toLowerCase()] = entry.color_accent;
      }
    });

    localStorage.setItem("quizzes", JSON.stringify(Array.from(deckMap.values())));
    localStorage.setItem("quiz_records", JSON.stringify(Array.from(recordMap.values())));
    localStorage.setItem("quiz_subject_colors", JSON.stringify(localSubjectColors));

    await renderQuizList();
    await renderRecordsTable();
    if (typeof populateEditQuizDropdown === "function") populateEditQuizDropdown();
    updateDashboardMetrics();

    const pullSummary = `Successfully pulled from cloud!\n• Decks: ${normalizedDecks.length}\n• Attempt Records: ${normalizedRecords.length}\n• Subject Themes: ${cloudColors.length}`;
    typeof showToast === "function" ? showToast(pullSummary) : alert(pullSummary);
  } catch (err) {
    console.error("Cloud pull failed:", err);
    typeof showToast === "function"
      ? showToast("Pull failed: " + err.message)
      : alert("Pull failed: " + err.message);
  }
}
