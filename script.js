// ======================================================
// 1. CONFIGURATION
// ======================================================

const GOOGLE_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR8aw1eGppF_fgvI5VAOO_3XEONyI-4QgWa0IgQg7K-VdxeFyn4XBpWT9tVDewbQ6PnMEQ80XpwbASh/pub?output=csv";

const firebaseConfig = {
  apiKey: "AIzaSyAhrX36_mEA4a3VIuSq3rYYZi0PH5Ap_ks",
  authDomain: "fcps-prep.firebaseapp.com",
  projectId: "fcps-prep",
  storageBucket: "fcps-prep.firebasestorage.app",
  messagingSenderId: "949920276784",
  appId: "1:949920276784:web:c9af3432814c0f80e028f5"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ======================================================
// 2. STATE VARIABLES
// ======================================================

let currentUser = null;
let allQuestions = [];
let filteredQuestions = [];
let userBookmarks = [];
let userSolvedIDs = [];
let userMistakes = [];

let currentMode = 'practice';
let currentIndex = 0; 
let testTimer = null;
let testAnswers = {}; 
let testFlags = {}; // NEW: Stores Flagged Questions { q_uid: true }
let testTimeRemaining = 0;

// ======================================================
// 3. AUTH & DASHBOARD
// ======================================================

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        showScreen('dashboard-screen');
        document.getElementById('user-display').innerText = user.displayName || "Doctor";
        loadUserData();
        loadQuestions();
    } else {
        currentUser = null;
        showScreen('auth-screen');
    }
});

function login() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    auth.signInWithEmailAndPassword(email, pass).catch(e => document.getElementById('auth-msg').innerText = e.message);
}
function signup() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    auth.createUserWithEmailAndPassword(email, pass).catch(e => document.getElementById('auth-msg').innerText = e.message);
}
function logout() { auth.signOut(); }

// --- PROFILE & DATA ---
function openProfileModal() {
    document.getElementById('profile-modal').classList.remove('hidden');
    if (currentUser.displayName) document.getElementById('new-display-name').value = currentUser.displayName;
}
function saveProfile() {
    const newName = document.getElementById('new-display-name').value;
    if (!newName) return;
    currentUser.updateProfile({ displayName: newName }).then(() => {
        document.getElementById('user-display').innerText = newName;
        document.getElementById('profile-modal').classList.add('hidden');
    });
}

// ... (Keep your existing configuration and top variables) ...

// === REPLACE FROM HERE DOWN ===

async function loadUserData() {
    if (!currentUser) return;
    try {
        console.log("📥 Loading User Data..."); // Debug Log
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        let userData = userDoc.exists ? userDoc.data() : {};

        userBookmarks = userData.bookmarks || [];
        userSolvedIDs = userData.solved || [];
        
        // --- CRITICAL FIX: LOAD MISTAKES ---
        userMistakes = userData.mistakes || []; 
        console.log(`🧐 Found ${userMistakes.length} mistakes saved in database.`);

        // Gamification & Stats
        checkStreak(userData);

        const resultsSnap = await db.collection('users').doc(currentUser.uid).collection('results').get();
        let totalTests = 0, totalScore = 0;
        resultsSnap.forEach(doc => { totalTests++; totalScore += doc.data().score; });
        const avgScore = totalTests > 0 ? Math.round(totalScore / totalTests) : 0;
        
        const statsBox = document.getElementById('quick-stats');
        if(statsBox) {
            statsBox.innerHTML = `
                <div class="stat-row"><span class="stat-lbl">Test Average:</span> <span class="stat-val" style="color:${avgScore>=70?'#2ecc71':'#e74c3c'}">${avgScore}%</span></div>
                <div class="stat-row"><span class="stat-lbl">Mistakes Pending:</span> <span class="stat-val" style="color:#e74c3c; font-weight:bold;">${userMistakes.length}</span></div>
                <div class="stat-row" style="border:none;"><span class="stat-lbl">Practice Solved:</span> <span class="stat-val">${userSolvedIDs.length}</span></div>`;
        }
    } catch (e) { console.error("Load Error:", e); }
}
// === NEW: STREAK CALCULATOR ===
function checkStreak(data) {
    const today = new Date().toDateString();
    const lastLogin = data.lastLoginDate;
    let currentStreak = data.streak || 0;

    // Logic:
    // 1. If last login was yesterday, streak + 1
    // 2. If last login was today, streak stays same
    // 3. If last login was older, streak resets to 1
    
    if (lastLogin !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (lastLogin === yesterday.toDateString()) {
            currentStreak++;
        } else {
            currentStreak = 1; // Reset or Start new
        }
        
        // Save new streak
        db.collection('users').doc(currentUser.uid).set({
            lastLoginDate: today,
            streak: currentStreak
        }, { merge: true });
    }

    // Update UI
    if(currentStreak > 0) {
        document.getElementById('streak-display').classList.remove('hidden');
        document.getElementById('streak-count').innerText = currentStreak + " Day Streak";
    }
}

// === NEW: BADGE SYSTEM ===
function openBadges() {
    const modal = document.getElementById('badges-modal');
    const container = document.getElementById('badge-list');
    modal.classList.remove('hidden');
    
    const totalSolved = userSolvedIDs.length;
    
    // Define Badges
    const badges = [
        { limit: 10, icon: "👶", name: "Novice", desc: "Solve 10 Question" },
        { limit: 100, icon: "🥉", name: "Bronze", desc: "Solve 100 Questions" },
        { limit: 500, icon: "🥈", name: "Silver", desc: "Solve 500 Questions" },
        { limit: 1000, icon: "🥇", name: "Gold", desc: "Solve 1000 Questions" },
        { limit: 2000, icon: "💎", name: "Diamond", desc: "Solve 2000 Questions" },
        { limit: 5000, icon: "👑", name: "Master", desc: "Solve 5000 Questions" }
    ];

    let html = "";
    badges.forEach(b => {
        const isUnlocked = totalSolved >= b.limit;
        html += `
            <div class="badge-item ${isUnlocked ? 'unlocked' : ''}">
                <span class="badge-icon">${b.icon}</span>
                <span class="badge-name">${b.name}</span>
                <span class="badge-desc">${b.desc}</span>
            </div>
        `;
    });
    container.innerHTML = html;
}

// ... (Keep the rest of your functions: resetAccountData, loadQuestions, etc.) ...
async function resetAccountData() {
    if(!currentUser) return;
    if (!confirm("⚠️ WARNING: This will delete ALL progress. Continue?")) return;
    try {
        const batch = db.batch();
        const resultsSnap = await db.collection('users').doc(currentUser.uid).collection('results').get();
        resultsSnap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        await db.collection('users').doc(currentUser.uid).delete();
        window.location.reload();
    } catch (e) { alert(e.message); }
}

// ======================================================
// 4. DATA LOADING & ID GENERATION
// ======================================================

function loadQuestions() {
    Papa.parse(GOOGLE_SHEET_URL, {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results) { processData(results.data); }
    });
}

function generateStableID(str) {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; 
    }
    return "id_" + Math.abs(hash);
}

function processData(data) {
    const seen = new Set();
    allQuestions = [];
    const subjects = new Set();
    const map = {}; 

    data.forEach(row => {
        if (!row.Question || !row.CorrectAnswer) return;

        const qSignature = row.Question.trim().toLowerCase();
        if (seen.has(qSignature)) return;
        seen.add(qSignature);

        row._uid = generateStableID(qSignature);

        const subj = row.Subject ? row.Subject.trim() : "General";
        const topic = row.Topic ? row.Topic.trim() : "Mixed";
        row.Subject = subj; row.Topic = topic;
        allQuestions.push(row);

        subjects.add(subj);
        if (!map[subj]) map[subj] = new Set();
        map[subj].add(topic);
    });

    renderMenus(subjects, map); 
    renderTestFilters(subjects, map); 
}

function renderMenus(subjects, map) {
    const container = document.getElementById('dynamic-menus');
    container.innerHTML = "";
    subjects.forEach(subj => {
        const details = document.createElement('details');
        details.innerHTML = `<summary>${subj}</summary>`;
        const allBtn = document.createElement('button');
        allBtn.textContent = `Practice All ${subj}`;
        allBtn.className = "category-btn";
        allBtn.onclick = () => startPractice(subj, null);
        details.appendChild(allBtn);
        map[subj].forEach(topic => {
            const btn = document.createElement('button');
            btn.textContent = topic;
            btn.className = "category-btn";
            btn.onclick = () => startPractice(subj, topic);
            details.appendChild(btn);
        });
        container.appendChild(details);
    });
}

function renderTestFilters(subjects, map) {
    const container = document.getElementById('filter-container');
    if (!container) return; 
    container.innerHTML = "";
    subjects.forEach(subj => {
        const group = document.createElement('div');
        group.className = 'filter-group';
        const subLabel = document.createElement('label');
        subLabel.className = 'filter-subject-label';
        subLabel.innerHTML = `<input type="checkbox" class="filter-checkbox subj-chk" value="${subj}"> ${subj}`;
        const topicList = document.createElement('div');
        topicList.className = 'filter-topic-list';
        map[subj].forEach(topic => {
            const topLabel = document.createElement('label');
            topLabel.className = 'filter-topic-label';
            topLabel.innerHTML = `<input type="checkbox" class="filter-checkbox topic-chk" value="${topic}" data-subject="${subj}"> ${topic}`;
            topicList.appendChild(topLabel);
        });
        const subInput = subLabel.querySelector('input');
        subInput.onchange = (e) => {
            const topicInputs = topicList.querySelectorAll('input');
            topicInputs.forEach(inp => inp.checked = e.target.checked);
        };
        group.appendChild(subLabel);
        group.appendChild(topicList);
        container.appendChild(group);
    });
}

// ======================================================
// 5. QUIZ LOGIC
// ======================================================

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if(event.target) event.target.classList.add('active');
    document.getElementById('test-settings').classList.toggle('hidden', mode !== 'test');
    document.getElementById('dynamic-menus').classList.toggle('hidden', mode === 'test');
}

function startPractice(subject, topic) {
    filteredQuestions = allQuestions.filter(q => q.Subject === subject && (!topic || q.Topic === topic));
    if (filteredQuestions.length === 0) return alert("No questions!");
    filteredQuestions.sort(() => Math.random() - 0.5);
    currentMode = 'practice';
    currentIndex = 0;
    showScreen('quiz-screen');
    renderPage();
}

function startTest() {
    const count = parseInt(document.getElementById('q-count').value);
    const mins = parseInt(document.getElementById('t-limit').value);
    const selectedSubjects = Array.from(document.querySelectorAll('.subj-chk:checked')).map(cb => cb.value);
    const selectedTopics = Array.from(document.querySelectorAll('.topic-chk:checked')).map(cb => cb.value);

    let pool = [];
    if (selectedSubjects.length === 0 && selectedTopics.length === 0) pool = [...allQuestions];
    else pool = allQuestions.filter(q => selectedSubjects.includes(q.Subject) || selectedTopics.includes(q.Topic));

    if(pool.length === 0) return alert("No questions found.");
    filteredQuestions = pool.sort(() => Math.random() - 0.5).slice(0, count);
    
    currentMode = 'test';
    currentIndex = 0;
    testAnswers = {};
    testFlags = {}; // RESET FLAGS
    testTimeRemaining = mins * 60;
    
    showScreen('quiz-screen');
    document.getElementById('timer').classList.remove('hidden');
    document.getElementById('test-sidebar').classList.add('active');
    renderNavigator();

    clearInterval(testTimer);
    testTimer = setInterval(updateTimer, 1000);
    renderPage();
}

function startSavedQuestions() {
    if(userBookmarks.length === 0) return alert("No bookmarks!");
    filteredQuestions = allQuestions.filter(q => userBookmarks.includes(q._uid));
    if(filteredQuestions.length === 0) return alert("No matching bookmarks found.");
    currentMode = 'practice';
    currentIndex = 0;
    showScreen('quiz-screen');
    renderPage();
}

/* --- SAFE MISTAKE BUTTON LOGIC --- */
window.startMistakePractice = function() {
    console.log("Button Clicked!"); 

    // 1. Check userMistakes list
    if (typeof userMistakes === 'undefined') {
        alert("❌ Error: 'userMistakes' variable is missing at top of file.");
        return;
    }

    if (userMistakes.length === 0) {
        alert("🎉 Good job! You have 0 pending mistakes to review.");
        return;
    }

    // 2. Check Questions Data
    if (typeof allQuestions === 'undefined' || allQuestions.length === 0) {
        alert("Wait! Questions are still loading...");
        return;
    }

    // 3. Filter the questions
    filteredQuestions = allQuestions.filter(q => userMistakes.includes(q._uid));
    
    if (filteredQuestions.length === 0) {
        alert("⚠️ Found mistake IDs, but couldn't find the questions. (Maybe the question IDs changed?)");
        // Optional: Reset mistakes if they are invalid
        // userMistakes = [];
        return;
    }
    
    // 4. Start Session
    alert(`📝 Loading ${filteredQuestions.length} mistakes. You can do this!`);
    currentMode = 'practice';
    currentIndex = 0;
    
    // Force switch to quiz screen
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('quiz-screen').classList.add('active');
    
    renderPage();
};
// --- RENDERING ---

function renderPage() {
    const container = document.getElementById('quiz-content-area');
    container.innerHTML = "";
    window.scrollTo(0,0);

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const submitBtn = document.getElementById('submit-btn');
    const flagBtn = document.getElementById('flag-btn'); // NEW FLAG BUTTON
    
    prevBtn.classList.toggle('hidden', currentIndex === 0);

    if (currentMode === 'practice') {
        document.getElementById('timer').classList.add('hidden');
        document.getElementById('test-sidebar').classList.remove('active'); 
        flagBtn.classList.add('hidden'); // Hide flag in practice
        submitBtn.classList.add('hidden');
        nextBtn.classList.add('hidden'); 
        container.appendChild(createQuestionCard(filteredQuestions[currentIndex], currentIndex, false));
    } else {
        document.getElementById('timer').classList.remove('hidden');
        nextBtn.classList.remove('hidden');
        submitBtn.classList.add('hidden');
        flagBtn.classList.remove('hidden'); // Show flag in Test

        // Update Flag Button State for current page
        // Note: With 5 questions per page, the "Flag" button applies to WHICH question?
        // Ah, tricky. Usually Flag is per question. 
        // For 5-per-page, we need a flag button ON EACH CARD, not in the header.
        // OR, we assume header flag is disabled or we remove it from header and put it on cards.
        // Let's put a flag icon ON EACH CARD for Test Mode.
        // I will hide the header flag button for now to avoid confusion.
        flagBtn.classList.add('hidden'); 

        const start = currentIndex;
        const end = Math.min(start + 5, filteredQuestions.length);
        for (let i = start; i < end; i++) {
            container.appendChild(createQuestionCard(filteredQuestions[i], i, true));
        }
        if (end === filteredQuestions.length) {
            nextBtn.classList.add('hidden');
            submitBtn.classList.remove('hidden');
        }
        renderNavigator(); 
    }
}

function createQuestionCard(q, index, isTest) {
    const card = document.createElement('div');
    card.className = "test-question-block"; 
    card.id = `q-card-${index}`; 

    let headerHTML = "";
    
    // HEADER LOGIC
    if (!isTest) {
        // PRACTICE MODE
        const isSaved = userBookmarks.includes(q._uid);
        headerHTML = `<div style="font-size:0.85em; color:#999; margin-bottom:10px; text-transform:uppercase; letter-spacing:1px;">${q.Subject} • ${q.Topic} 
        <span onclick="toggleBookmark('${q._uid}', this)" class="bookmark-icon" style="color:${isSaved ? '#ffc107' : '#e2e8f0'}">${isSaved ? '★' : '☆'}</span></div>`;
    } else {
        // TEST MODE: Add Flag Icon Here
        const isFlagged = testFlags[q._uid];
        headerHTML = `<div style="text-align:right; margin-bottom:10px;">
            <button onclick="toggleFlag('${q._uid}', this)" class="flag-btn ${isFlagged ? 'active' : ''}" style="display:inline-flex; width:auto; margin:0;">
                🚩 Mark Review
            </button>
        </div>`;
    }
    
    let html = headerHTML + `<div class="test-q-text">${index+1}. ${q.Question}</div>`;
    
    html += `<div class="options-group" id="opts-${index}">`;
    const opts = ['A','B','C','D'];
    if(q.OptionE) opts.push('E');
    
    opts.forEach(opt => {
        let isSelected = false;
        if(isTest && testAnswers[q._uid] === opt) isSelected = true;
        html += `<button class="option-btn ${isSelected ? 'selected' : ''}" 
                  onclick="handleClick(${index}, '${opt}')" 
                  id="btn-${index}-${opt}">
                  <b>${opt}.</b> ${q['Option'+opt]}
                 </button>`;
    });
    html += `</div>`;

    if (!isTest) {
        html += `<button id="reopen-exp-${index}" class="secondary hidden" style="margin-top:15px; width:auto; font-size:13px;" onclick="reOpenModal(${index})">📖 View Explanation Again</button>`;
    }

    card.innerHTML = html;
    return card;
}

// --- NEW: FLAG LOGIC ---
function toggleFlag(uid, btn) {
    if (testFlags[uid]) {
        delete testFlags[uid];
        btn.classList.remove('active');
    } else {
        testFlags[uid] = true;
        btn.classList.add('active');
    }
    renderNavigator(); // Update sidebar color immediately
}

// --- INTERACTION ---

function handleClick(index, opt) {
    const q = filteredQuestions[index];
    
    if (currentMode === 'test') {
        testAnswers[q._uid] = opt; 
        const container = document.getElementById(`opts-${index}`);
        container.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        document.getElementById(`btn-${index}-${opt}`).classList.add('selected');
        renderNavigator(); 
    } else {
        // PRACTICE MODE
        const correct = getCorrectLetter(q);
        const btn = document.getElementById(`btn-${index}-${opt}`);
        const subj = q.Subject || "General";
        const cleanSubj = subj.replace(/[^a-zA-Z0-9]/g, "_");

        if (opt === correct) {
            btn.classList.add('correct');
            const container = document.getElementById(`opts-${index}`);
            container.querySelectorAll('.option-btn').forEach(b => b.disabled = true);

            if (currentIndex < filteredQuestions.length - 1) document.getElementById('next-btn').classList.remove('hidden');
            document.getElementById(`reopen-exp-${index}`).classList.remove('hidden');

            const modal = document.getElementById('explanation-modal');
            const content = document.getElementById('modal-content');
            content.innerHTML = q.Explanation || "No explanation provided.";
            modal.classList.remove('hidden');

            saveProgressToDB(q, true);
        } else {
            btn.classList.add('wrong');
            saveProgressToDB(q, false);
        }
    }
}

async function saveProgressToDB(q, isCorrect) {
    if (!currentUser) return;
    const userRef = db.collection('users').doc(currentUser.uid);
    try {
        const doc = await userRef.get();
        let data = doc.exists ? doc.data() : {};
        
        // Ensure lists exist
        if (!data.stats) data.stats = {};
        if (!data.solved) data.solved = [];
        if (!data.mistakes) data.mistakes = []; 

        if (isCorrect) {
            // 1. If Correct: Add to Solved, Remove from Mistakes
            if (!data.solved.includes(q._uid)) data.solved.push(q._uid);
            data.mistakes = data.mistakes.filter(id => id !== q._uid);
            console.log("✅ Fixed a mistake! Removed from list.");
        } else {
            // 2. If Wrong: Add to Mistakes
            if (!data.mistakes.includes(q._uid)) {
                data.mistakes.push(q._uid);
                console.log("❌ Mistake added to list.");
            }
        }

        // Update Stats counts
        const cleanSubj = (q.Subject || "General").replace(/[^a-zA-Z0-9]/g, "_");
        if (!data.stats[cleanSubj]) {
            data.stats[cleanSubj] = { correct: 0, total: 0 };
        }
        data.stats[cleanSubj].total += 1;
        if (isCorrect) data.stats[cleanSubj].correct += 1;

        // Save to Database
        await userRef.set(data, { merge: true });
        
        // Update Local Variables (So the button works immediately)
        userSolvedIDs = data.solved;
        userMistakes = data.mistakes;

    } catch (error) { console.error("Save failed", error); }
}

// --- NAVIGATOR ---
function renderNavigator() {
    if(currentMode !== 'test') return;
    const navGrid = document.getElementById('nav-grid');
    navGrid.innerHTML = "";
    const pageStart = currentIndex; 
    const pageEnd = Math.min(currentIndex + 5, filteredQuestions.length);

    filteredQuestions.forEach((q, idx) => {
        const btn = document.createElement('div');
        btn.className = "nav-btn";
        btn.innerText = idx + 1;
        
        // Priority Colors: Flagged > Answered > Normal
        if (testFlags[q._uid]) btn.classList.add('flagged');
        else if (testAnswers[q._uid]) btn.classList.add('answered');
        
        if (idx >= pageStart && idx < pageEnd) btn.classList.add('current');
        btn.onclick = () => jumpToQuestion(idx);
        navGrid.appendChild(btn);
    });
}

function jumpToQuestion(targetIndex) {
    const newPageStart = Math.floor(targetIndex / 5) * 5;
    currentIndex = newPageStart;
    renderPage();
    setTimeout(() => {
        const el = document.getElementById(`q-card-${targetIndex}`);
        if(el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

// --- UTILS ---
function closeModal() { document.getElementById('explanation-modal').classList.add('hidden'); }
function reOpenModal(index) {
    const q = filteredQuestions[index];
    const modal = document.getElementById('explanation-modal');
    const content = document.getElementById('modal-content');
    content.innerHTML = q.Explanation || "No explanation provided.";
    modal.classList.remove('hidden');
}
function nextPageFromModal() { closeModal(); setTimeout(() => { nextPage(); }, 200); }

function nextPage() {
    currentIndex += (currentMode === 'practice') ? 1 : 5;
    renderPage();
}
function prevPage() {
    currentIndex -= (currentMode === 'practice') ? 1 : 5;
    renderPage();
}

function getCorrectLetter(q) {
    let dbAns = String(q.CorrectAnswer || "?").trim();
    if (/^[a-eA-E]$/.test(dbAns)) return dbAns.toUpperCase();
    function clean(str) { return str.toLowerCase().replace(/[^a-z0-9]/g, ""); }
    let cleanTarget = clean(dbAns);
    const options = ['A', 'B', 'C', 'D', 'E'];
    for (let opt of options) {
        let optText = q['Option' + opt];
        if (!optText) continue;
        if (clean(optText) === cleanTarget) return opt;
        if (cleanTarget.length > 3 && clean(optText).includes(cleanTarget)) return opt;
    }
    return '?';
}

function toggleBookmark(uid, span) {
    if(userBookmarks.includes(uid)) {
        userBookmarks = userBookmarks.filter(id => id !== uid);
        span.innerText = "☆"; span.style.color = "#e2e8f0";
    } else {
        userBookmarks.push(uid);
        span.innerText = "★"; span.style.color = "#ffc107";
    }
    db.collection('users').doc(currentUser.uid).set({ bookmarks: userBookmarks }, { merge: true });
}

// --- SUBMISSION ---
function updateTimer() {
    testTimeRemaining--;
    const m = Math.floor(testTimeRemaining/60);
    const s = testTimeRemaining%60;
    document.getElementById('timer').innerText = `${m}:${s<10?'0':''}${s}`;
    if(testTimeRemaining <= 0) submitTest();
}

function submitTest() {
    clearInterval(testTimer);
    let score = 0;
    let wrongList = [];
    let sessionStats = {}; 

    // 1. Calculate Score & identify Wrong Answers
    filteredQuestions.forEach(q => {
        const user = testAnswers[q._uid];
        const correct = getCorrectLetter(q);
        const subj = q.Subject || "General";
        const cleanSubj = subj.replace(/[^a-zA-Z0-9]/g, "_");

        if (!sessionStats[cleanSubj]) sessionStats[cleanSubj] = { correct: 0, total: 0 };
        sessionStats[cleanSubj].total++;

        if(user === correct) {
            score++;
            sessionStats[cleanSubj].correct++;
            if(!userSolvedIDs.includes(q._uid)) userSolvedIDs.push(q._uid);
        } else {
            wrongList.push({q, user, correct});
        }
    });

    const percent = Math.round((score/filteredQuestions.length)*100);
    
    // 2. Save to Database (Including Mistakes)
    if(currentUser) {
        // Save the result history
        db.collection('users').doc(currentUser.uid).collection('results').add({
            date: new Date(), score: percent, total: filteredQuestions.length
        });

        // --- MISTAKE BANK LOGIC START ---
        // A. Add WRONG answers to the mistakes list
        wrongList.forEach(item => {
            if(!userMistakes.includes(item.q._uid)) {
                userMistakes.push(item.q._uid);
            }
        });

        // B. Remove CORRECT answers from the mistakes list
        // (If you finally got it right, you don't need to practice it anymore)
        const correctIDsInThisTest = filteredQuestions
            .filter(q => testAnswers[q._uid] === getCorrectLetter(q))
            .map(q => q._uid);
            
        userMistakes = userMistakes.filter(id => !correctIDsInThisTest.includes(id));
        // --- MISTAKE BANK LOGIC END ---

        // Prepare the update object
        let updates = { 
            solved: userSolvedIDs,
            mistakes: userMistakes // <--- SAVE THE UPDATED MISTAKES
        };

        // Add Subject Stats
        for (const [subject, data] of Object.entries(sessionStats)) {
            updates[`stats.${subject}.correct`] = firebase.firestore.FieldValue.increment(data.correct);
            updates[`stats.${subject}.total`] = firebase.firestore.FieldValue.increment(data.total);
        }
        
        // Push everything to Firebase
        db.collection('users').doc(currentUser.uid).set(updates, { merge: true })
          .then(() => loadUserData());
    }

    // 3. Show Results Screen
    showScreen('result-screen');
    document.getElementById('final-score').innerText = `${percent}% (${score}/${filteredQuestions.length})`;
    
    const list = document.getElementById('review-list');
    list.innerHTML = "";
    wrongList.forEach(item => {
        list.innerHTML += `
            <div style="background:white; padding:15px; margin-bottom:10px; border-left:4px solid #ef4444; border-radius:5px;">
                <b>${item.q.Question}</b><br>
                <span style="color:#ef4444">You: ${item.user||'-'}</span> | 
                <span style="color:#22c55e">Correct: ${item.correct}</span>
                <div style="background:#f9f9f9; padding:10px; margin-top:5px; font-size:0.9em; white-space: pre-wrap;">${item.q.Explanation || 'No explanation.'}</div>
            </div>`;
    });
}
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
function goHome() {
    clearInterval(testTimer);
    document.getElementById('timer').classList.add('hidden');
    document.getElementById('test-sidebar').classList.remove('active');
    showScreen('dashboard-screen');
    loadQuestions();
}

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('fcps-theme');
    if (savedTheme === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
        document.getElementById('theme-btn').innerText = '☀️';
    }
});
function toggleTheme() {
    const currentTheme = document.body.getAttribute('data-theme');
    const btn = document.getElementById('theme-btn');
    if (currentTheme === 'dark') {
        document.body.removeAttribute('data-theme');
        localStorage.setItem('fcps-theme', 'light');
        btn.innerText = '🌙';
    } else {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('fcps-theme', 'dark');
        btn.innerText = '☀️';
    }
}

// ANALYTICS MODAL (ROBUST)
async function openAnalytics() {
    const modal = document.getElementById('analytics-modal');
    const container = document.getElementById('analytics-content');
    container.innerHTML = "<p>Crunching numbers...</p>";
    modal.classList.remove('hidden');

    if (!currentUser) return;

    try {
        const doc = await db.collection('users').doc(currentUser.uid).get({ source: 'server' });
        
        if (!doc.exists || !doc.data().stats) {
            container.innerHTML = "<p>No detailed data available yet. Solve a question!</p>";
            return;
        }

        const stats = doc.data().stats;
        let html = "";
        
        const subjects = Object.keys(stats).map(key => {
            return { name: key.replace(/_/g, " "), ...stats[key] };
        }).sort((a, b) => (a.correct / a.total) - (b.correct / b.total));

        subjects.forEach(subj => {
            const percent = Math.round((subj.correct / subj.total) * 100);
            const displayWidth = percent === 0 ? 5 : percent; 
            
            let color = "#2ecc71"; 
            if (percent < 50) color = "#e74c3c"; 
            else if (percent < 75) color = "#f1c40f"; 

            html += `
                <div class="stat-item">
                    <div class="stat-header">
                        <span>${subj.name}</span>
                        <span>${percent}%</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${displayWidth}%; background: ${color};"></div>
                    </div>
                    <div class="stat-meta">
                        ${subj.correct} correct out of ${subj.total} attempted
                    </div>
                </div>`;
        });
        container.innerHTML = html;
    } catch (e) { container.innerHTML = "Error loading stats: " + e.message; }
}

/* --- FIXED GLOBAL SEARCH LOGIC (MATCHES YOUR VARIABLES) --- */
const searchInput = document.getElementById('global-search');
const searchResults = document.getElementById('search-results');

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const text = e.target.value.toLowerCase();
        
        // 1. Hide if empty
        if (text.length < 2) {
            searchResults.style.display = 'none';
            searchResults.innerHTML = '';
            return;
        }

        // 2. USE THE CORRECT VARIABLE (allQuestions)
        // Check if data is loaded
        if (typeof allQuestions === 'undefined' || allQuestions.length === 0) {
            console.log("Data not loaded yet");
            return; 
        }

        // 3. SEARCH EVERYTHING 
        const matches = allQuestions.filter(row => {
            // Join all values (Question, Options, Explanation) into one string to search
            const allText = Object.values(row).join(" ").toLowerCase();
            return allText.includes(text);
        });

        // 4. Show Results
        searchResults.style.display = 'block';
        searchResults.innerHTML = '';

        if (matches.length === 0) {
            searchResults.innerHTML = '<div class="search-item" style="color:gray;">No matches found</div>';
        } else {
            // Limit to top 20 results
            matches.slice(0, 20).forEach(match => {
                const div = document.createElement('div');
                div.className = 'search-item';
                
                // Display Question Text
                div.innerText = (match.Question || "Question").substring(0, 60) + "...";
                
                div.onclick = () => {
                    // --- THE FIX: USE YOUR SPECIFIC VARIABLES ---
                    
                    // 1. Set the filtered list to ONLY this question
                    filteredQuestions = [match];
                    
                    // 2. Set mode to practice so it shows the answer instantly
                    currentMode = 'practice';
                    currentIndex = 0;
                    
                    // 3. Switch Screen and Render
                    showScreen('quiz-screen');
                    renderPage(); // <--- This is the function your code uses!
                    
                    // 4. Reset search bar
                    searchInput.value = '';
                    searchResults.style.display = 'none';
                };
                searchResults.appendChild(div);
            });
        }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (searchInput && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.style.display = 'none';
        }
    });
}

/* --- FINAL PWA LOGIC (SHOW BY DEFAULT) --- */
const installBtn = document.getElementById('install-btn');
let deferredPrompt;

// 1. Check if App is ALREADY Installed
const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

if (installBtn) {
    // If already installed, HIDE the button
    if (isStandalone) {
        installBtn.style.display = 'none';
    }

    // Capture the Android/PC install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
    });

    // Handle Click
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            // Android/PC: Show the automatic prompt
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                installBtn.style.display = 'none';
            }
            deferredPrompt = null;
        } else {
            // iOS / Manual Install Instructions
            const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
            if (isIos) {
                alert("To install on iPhone/iPad:\n\n1. Tap the 'Share' button (square with arrow up)\n2. Scroll down and tap 'Add to Home Screen' ➕");
            } else {
                alert("To install:\nOpen your browser menu and select 'Add to Home Screen' or 'Install App'.");
            }
        }
    });
}


/* --- REPORT ERROR LOGIC --- */
function toggleReportForm() {
    const form = document.getElementById('report-form');
    if (form) form.classList.toggle('hidden');
}

async function submitReport() {
    alert("Step 1: Button Clicked! Function started.");

    // 1. Get User
    if (!currentUser) {
        alert("❌ Error: You are not logged in.");
        return;
    }
    
    // 2. Get Input
    const reasonInput = document.getElementById('report-reason');
    const reason = reasonInput.value;
    
    if (!reason) {
        alert("❌ Error: Reason box is empty.");
        return;
    }
    
    // 3. Get Question
    // We try to grab the question safely
    let q = null;
    if (typeof filteredQuestions !== 'undefined' && filteredQuestions[currentIndex]) {
        q = filteredQuestions[currentIndex];
    }
    
    alert("Step 2: Sending to Firebase...");

    // 4. Send to Firebase
    try {
        await db.collection('reports').add({
            questionID: q ? q._uid : "unknown",
            questionText: q ? q.Question : "No Text Found",
            reportReason: reason,
            reportedBy: currentUser.email,
            timestamp: new Date()
        });

        alert("✅ Success! Report saved to database.");
        reasonInput.value = ""; 
        document.getElementById('report-form').classList.add('hidden'); 

    } catch (error) {
        console.error(error);
        alert("❌ DATABASE ERROR: " + error.message);
    }
}





