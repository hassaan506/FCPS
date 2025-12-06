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

// Quiz State
let currentMode = 'practice';
let currentIndex = 0; 
let testTimer = null;
let testAnswers = {}; 
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
    auth.signInWithEmailAndPassword(email, pass)
        .catch(err => document.getElementById('auth-msg').innerText = err.message);
}

function signup() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    auth.createUserWithEmailAndPassword(email, pass)
        .catch(err => document.getElementById('auth-msg').innerText = err.message);
}

function logout() { auth.signOut(); }

// --- PROFILE & DATA ---
function openProfileModal() {
    document.getElementById('profile-modal').classList.remove('hidden');
    if (currentUser.displayName) document.getElementById('new-display-name').value = currentUser.displayName;
}

function saveProfile() {
    const newName = document.getElementById('new-display-name').value;
    if (!newName) return alert("Please enter a name.");
    currentUser.updateProfile({ displayName: newName }).then(() => {
        document.getElementById('user-display').innerText = newName;
        document.getElementById('profile-modal').classList.add('hidden');
    }).catch(e => alert(e.message));
}

async function loadUserData() {
    if (!currentUser) return;
    try {
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        if (userDoc.exists) {
            userBookmarks = userDoc.data().bookmarks || [];
            userSolvedIDs = userDoc.data().solved || [];
        } else {
            userBookmarks = []; userSolvedIDs = [];
        }

        const resultsSnap = await db.collection('users').doc(currentUser.uid).collection('results').get();
        let totalTests = 0, totalScore = 0;
        resultsSnap.forEach(doc => { totalTests++; totalScore += doc.data().score; });
        const avgScore = totalTests > 0 ? Math.round(totalScore / totalTests) : 0;

        const statsBox = document.getElementById('stats-box');
        if (statsBox) {
            statsBox.innerHTML = `
                <h3>Your Progress</h3>
                <div class="stat-row"><span class="stat-lbl">Test Average:</span> <span class="stat-val" style="color:${avgScore>=70?'#2ecc71':'#e74c3c'}">${avgScore}%</span></div>
                <div class="stat-row"><span class="stat-lbl">Tests Taken:</span> <span class="stat-val">${totalTests}</span></div>
                <div class="stat-row" style="border:none;"><span class="stat-lbl">Practice Solved:</span> <span class="stat-val">${userSolvedIDs.length}</span></div>
            `;
        }
    } catch (e) { console.error(e); }
}

async function resetAccountData() {
    if(!currentUser) return alert("Please log in.");
    if (!confirm("⚠️ WARNING: This will delete ALL progress/bookmarks. Continue?")) return;
    try {
        const resultsRef = db.collection('users').doc(currentUser.uid).collection('results');
        const snapshot = await resultsRef.get();
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        await db.collection('users').doc(currentUser.uid).delete();
        alert("✅ Reset Complete."); window.location.reload();
    } catch (e) { alert(e.message); }
}

// ======================================================
// 4. DATA LOADING & FILTER GENERATION
// ======================================================

function loadQuestions() {
    Papa.parse(GOOGLE_SHEET_URL, {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results) { processData(results.data); }
    });
}

function processData(data) {
    const seen = new Set();
    allQuestions = [];
    const subjects = new Set();
    const map = {}; 

    data.forEach(row => {
        if (!row.Question) return;
        const sig = row.Question.trim().toLowerCase();
        if (seen.has(sig)) return;
        seen.add(sig);

        const subj = row.Subject ? row.Subject.trim() : "General";
        const topic = row.Topic ? row.Topic.trim() : "Mixed";
        row.Subject = subj; 
        row.Topic = topic;
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
        allBtn.style.fontWeight = "bold";
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
    if (!container) return; // Logic check if element exists
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
// 5. QUIZ LOGIC (FIXED)
// ======================================================

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if(event.target) event.target.classList.add('active');
    
    document.getElementById('test-settings').classList.toggle('hidden', mode !== 'test');
    document.getElementById('dynamic-menus').classList.toggle('hidden', mode === 'test');
}

function startPractice(subject, topic) {
    filteredQuestions = allQuestions.filter(q => {
        return q.Subject === subject && (!topic || q.Topic === topic);
    });
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
    
    // 1. Gather Filters
    const selectedSubjects = Array.from(document.querySelectorAll('.subj-chk:checked')).map(cb => cb.value);
    const selectedTopics = Array.from(document.querySelectorAll('.topic-chk:checked')).map(cb => cb.value);

    // 2. Filter Pool
    let pool = [];
    if (selectedSubjects.length === 0 && selectedTopics.length === 0) {
        pool = [...allQuestions];
    } else {
        pool = allQuestions.filter(q => {
            return selectedSubjects.includes(q.Subject) || selectedTopics.includes(q.Topic);
        });
    }

    if(pool.length === 0) return alert("No questions found for selection.");
    
    // 3. Randomize
    filteredQuestions = pool.sort(() => Math.random() - 0.5).slice(0, count);
    
    currentMode = 'test';
    currentIndex = 0;
    testAnswers = {};
    testTimeRemaining = mins * 60;
    
    showScreen('quiz-screen');
    document.getElementById('timer').classList.remove('hidden');
    clearInterval(testTimer);
    testTimer = setInterval(updateTimer, 1000);
    renderPage();
}

function startSavedQuestions() {
    if(userBookmarks.length === 0) return alert("No bookmarks!");
    filteredQuestions = allQuestions.filter(q => userBookmarks.includes(q.ID));
    currentMode = 'practice';
    currentIndex = 0;
    showScreen('quiz-screen');
    renderPage();
}

// --- RENDERING ENGINE (FIXED ID CONFLICTS) ---

function renderPage() {
    const container = document.getElementById('quiz-content-area');
    container.innerHTML = "";
    window.scrollTo(0,0);

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const submitBtn = document.getElementById('submit-btn');
    
    prevBtn.classList.toggle('hidden', currentIndex === 0);

    if (currentMode === 'practice') {
        document.getElementById('timer').classList.add('hidden');
        submitBtn.classList.add('hidden');
        nextBtn.classList.add('hidden'); // Initially hidden
        
        // Pass 'currentIndex' as ID to ensure uniqueness
        container.appendChild(createQuestionCard(filteredQuestions[currentIndex], currentIndex, false));

    } else {
        document.getElementById('timer').classList.remove('hidden');
        nextBtn.classList.remove('hidden');
        submitBtn.classList.add('hidden');

        const start = currentIndex;
        const end = Math.min(start + 5, filteredQuestions.length);
        
        for (let i = start; i < end; i++) {
            // Pass 'i' as ID to ensure uniqueness
            container.appendChild(createQuestionCard(filteredQuestions[i], i, true));
        }

        if (end === filteredQuestions.length) {
            nextBtn.classList.add('hidden');
            submitBtn.classList.remove('hidden');
        }
    }
}

function createQuestionCard(q, index, isTest) {
    const card = document.createElement('div');
    card.className = "test-question-block"; 

    let headerHTML = `<div style="font-size:0.85em; color:#999; margin-bottom:10px; text-transform:uppercase; letter-spacing:1px;">${q.Subject} • ${q.Topic}`;
    if (!isTest) {
        const isSaved = userBookmarks.includes(q.ID);
        headerHTML += ` <span onclick="toggleBookmark('${q.ID}', this)" class="bookmark-icon" style="color:${isSaved ? '#ffc107' : '#e2e8f0'}">${isSaved ? '★' : '☆'}</span>`;
    }
    headerHTML += `</div>`;
    
    let html = headerHTML + `<div class="test-q-text">${index+1}. ${q.Question}</div>`;
    
    // IMPORTANT: ID uses 'index' now, not q.ID, to prevent Test Mode duplicate ID bugs
    html += `<div class="options-group" id="opts-${index}">`;
    const opts = ['A','B','C','D'];
    if(q.OptionE) opts.push('E');
    
    opts.forEach(opt => {
        let isSelected = false;
        // Check using real ID for logic
        if(isTest && testAnswers[q.ID] === opt) isSelected = true;
        
        // Button ID uses unique INDEX to prevent conflicts
        html += `<button class="option-btn ${isSelected ? 'selected' : ''}" 
                  onclick="handleClick('${q.ID}', '${opt}', ${index})" 
                  id="btn-${index}-${opt}">
                  <b>${opt}.</b> ${q['Option'+opt]}
                 </button>`;
    });
    html += `</div>`;

    // New: Hidden "Show Explanation" button for Practice Mode re-opening
    if (!isTest) {
        html += `<button id="reopen-exp-${index}" class="secondary hidden" style="margin-top:15px; width:auto; font-size:13px;" onclick="reOpenModal(${index})">📖 View Explanation Again</button>`;
    }

    card.innerHTML = html;
    return card;
}

function handleClick(qID, opt, index) {
    // We use 'index' to find the DOM elements to avoid ID conflicts
    if (currentMode === 'test') {
        // Test Mode: Just select
        testAnswers[qID] = opt; // Save using real ID
        const container = document.getElementById(`opts-${index}`); // Target using Page Index
        container.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        document.getElementById(`btn-${index}-${opt}`).classList.add('selected');
    } else {
        // PRACTICE MODE
        const q = filteredQuestions[index];
        const correct = getCorrectLetter(q);
        const btn = document.getElementById(`btn-${index}-${opt}`); // Target using Page Index
        
        if (opt === correct) {
            // Correct
            btn.classList.add('correct');
            
            // Disable buttons
            const container = document.getElementById(`opts-${index}`);
            container.querySelectorAll('.option-btn').forEach(b => b.disabled = true);

            // Show Next Button
            if (currentIndex < filteredQuestions.length - 1) {
                document.getElementById('next-btn').classList.remove('hidden');
            }

            // Show "View Exp Again" button
            document.getElementById(`reopen-exp-${index}`).classList.remove('hidden');

            // OPEN POPUP
            const modal = document.getElementById('explanation-modal');
            const content = document.getElementById('modal-content');
            content.innerHTML = q.Explanation || "No explanation provided.";
            modal.classList.remove('hidden');

            // Save Progress
            if (currentUser && !userSolvedIDs.includes(qID)) {
                userSolvedIDs.push(qID);
                db.collection('users').doc(currentUser.uid).set({ solved: userSolvedIDs }, { merge: true });
            }
        } else {
            // Wrong
            btn.classList.add('wrong');
        }
    }
}

// --- MODAL HELPERS ---
function closeModal() {
    document.getElementById('explanation-modal').classList.add('hidden');
}

// New function to re-open modal if user closed it
function reOpenModal(index) {
    const q = filteredQuestions[index];
    const modal = document.getElementById('explanation-modal');
    const content = document.getElementById('modal-content');
    content.innerHTML = q.Explanation || "No explanation provided.";
    modal.classList.remove('hidden');
}

function nextPageFromModal() {
    closeModal();
    setTimeout(() => { nextPage(); }, 200);
}

// --- NAV & UTILS ---
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

function toggleBookmark(qID, span) {
    if(userBookmarks.includes(qID)) {
        userBookmarks = userBookmarks.filter(id => id !== qID);
        span.innerText = "☆"; span.style.color = "#e2e8f0";
    } else {
        userBookmarks.push(qID);
        span.innerText = "★"; span.style.color = "#ffc107";
    }
    db.collection('users').doc(currentUser.uid).set({ bookmarks: userBookmarks }, { merge: true });
}

// --- TEST SUBMISSION ---
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
    filteredQuestions.forEach(q => {
        const user = testAnswers[q.ID];
        const correct = getCorrectLetter(q);
        if(user === correct) score++;
        else wrongList.push({q, user, correct});
    });
    const percent = Math.round((score/filteredQuestions.length)*100);
    if(currentUser) {
        db.collection('users').doc(currentUser.uid).collection('results').add({
            date: new Date(), score: percent, total: filteredQuestions.length
        }).then(() => loadUserData());
    }
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
    showScreen('dashboard-screen');
    loadQuestions();
}
