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

// Initialize
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
let currentIndex = 0; // Tracks which question (or page start) we are on
let testTimer = null;
let testAnswers = {}; // { qID: "A" }
let testTimeRemaining = 0;

// ======================================================
// 3. AUTH & DASHBOARD
// ======================================================

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        showScreen('dashboard-screen');
        document.getElementById('user-display').innerText = user.email;
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

async function loadUserData() {
    if (!currentUser) return;
    
    // Load Profile
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    if (userDoc.exists) {
        userBookmarks = userDoc.data().bookmarks || [];
        userSolvedIDs = userDoc.data().solved || [];
    } else {
        userBookmarks = [];
        userSolvedIDs = [];
    }

    // Load Test Stats
    const resultsSnap = await db.collection('users').doc(currentUser.uid).collection('results').get();
    let totalTests = 0, totalScore = 0;
    resultsSnap.forEach(doc => { totalTests++; totalScore += doc.data().score; });
    const avgScore = totalTests > 0 ? Math.round(totalScore / totalTests) : 0;

    // Update Dashboard
    const statsBox = document.getElementById('stats-box');
    if (statsBox) {
        statsBox.innerHTML = `
            <h3>Your Progress</h3>
            <p>Test Average: <b style="color:${avgScore >= 70 ? 'green' : 'red'}">${avgScore}%</b> (${totalTests} tests)</p>
            <p style="border-top:1px solid #eee; padding-top:5px; margin-top:5px;">
               Practice Solved: <b>${userSolvedIDs.length}</b> Questions
            </p>
        `;
    }
}

async function resetAccountData() {
    if (!confirm("⚠️ Are you sure? This will delete ALL your test history, solved questions, and bookmarks. This cannot be undone.")) return;
    
    // 1. Delete Subcollection (Results)
    const results = await db.collection('users').doc(currentUser.uid).collection('results').get();
    const batch = db.batch();
    results.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // 2. Delete Main Profile
    await db.collection('users').doc(currentUser.uid).delete();

    alert("Progress Reset Complete.");
    loadUserData(); // Refresh UI
}

// ======================================================
// 4. DATA LOADING
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
}

function renderMenus(subjects, map) {
    const container = document.getElementById('dynamic-menus');
    container.innerHTML = "";
    subjects.forEach(subj => {
        const details = document.createElement('details');
        details.innerHTML = `<summary style="padding:10px; font-weight:bold; cursor:pointer;">${subj}</summary>`;
        
        const allBtn = document.createElement('button');
        allBtn.textContent = `Practice All ${subj}`;
        allBtn.className = "category-btn";
        allBtn.style.cssText = "width:100%; background:#2c3e50; color:white; margin-top:10px;";
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

// ======================================================
// 5. QUIZ LOGIC (PAGINATION SYSTEM)
// ======================================================

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if(event.target) event.target.classList.add('active');
    
    document.getElementById('test-settings').classList.toggle('hidden', mode !== 'test');
    document.getElementById('dynamic-menus').classList.toggle('hidden', mode === 'test');
}

// --- START FUNCTIONS ---

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
    
    // Get random questions
    filteredQuestions = [...allQuestions].sort(() => Math.random() - 0.5).slice(0, count);
    
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

// --- RENDERING ENGINE ---

function renderPage() {
    const container = document.getElementById('quiz-content-area');
    container.innerHTML = "";
    window.scrollTo(0,0);

    // NAVIGATION BUTTONS LOGIC
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const submitBtn = document.getElementById('submit-btn');
    
    prevBtn.classList.toggle('hidden', currentIndex === 0);

    if (currentMode === 'practice') {
        // --- PRACTICE MODE: 1 QUESTION PER PAGE ---
        document.getElementById('timer').classList.add('hidden');
        submitBtn.classList.add('hidden');
        
        // Hide NEXT if it's the last question
        if (currentIndex >= filteredQuestions.length - 1) {
            nextBtn.classList.add('hidden');
        } else {
            // Only show Next if they answered correctly (handled in click logic) OR initially hidden
            nextBtn.classList.add('hidden'); 
        }
        
        document.getElementById('q-progress').innerText = `Question ${currentIndex + 1} of ${filteredQuestions.length}`;
        
        // Render Single Question
        const q = filteredQuestions[currentIndex];
        container.appendChild(createQuestionCard(q, currentIndex, false));

    } else {
        // --- TEST MODE: 5 QUESTIONS PER PAGE ---
        document.getElementById('timer').classList.remove('hidden');
        nextBtn.classList.remove('hidden');
        submitBtn.classList.add('hidden');

        // Calculate Range
        const start = currentIndex;
        const end = Math.min(start + 5, filteredQuestions.length);
        
        document.getElementById('q-progress').innerText = `Questions ${start + 1}-${end} of ${filteredQuestions.length}`;

        // Loop to render 5 questions
        for (let i = start; i < end; i++) {
            container.appendChild(createQuestionCard(filteredQuestions[i], i, true));
        }

        // If this is the last page, Swap Next for Submit
        if (end === filteredQuestions.length) {
            nextBtn.classList.add('hidden');
            submitBtn.classList.remove('hidden');
        }
    }
}

// --- CARD BUILDER ---
function createQuestionCard(q, index, isTest) {
    const card = document.createElement('div');
    if (isTest) card.className = "test-question-block"; 
    else card.className = ""; // Plain for practice

    // Header (Subject/Topic/Bookmark)
    let headerHTML = `<div style="font-size:0.85em; color:#666; margin-bottom:10px;">${q.Subject} • ${q.Topic}`;
    if (!isTest) {
        // Add bookmark star only in practice mode
        const isSaved = userBookmarks.includes(q.ID);
        headerHTML += ` <span onclick="toggleBookmark('${q.ID}', this)" style="cursor:pointer; float:right; font-size:1.2em; color:${isSaved ? '#ffc107' : '#ccc'}">${isSaved ? '★' : '☆'}</span>`;
    }
    headerHTML += `</div>`;
    
    // Question Text
    let html = headerHTML + `<div class="test-q-text">${index+1}. ${q.Question}</div>`;
    
    // Options
    html += `<div class="options-group" id="opts-${q.ID}">`;
    const opts = ['A','B','C','D'];
    if(q.OptionE) opts.push('E');
    
    opts.forEach(opt => {
        let isSelected = false;
        if(isTest && testAnswers[q.ID] === opt) isSelected = true;
        
        html += `<button class="option-btn ${isSelected ? 'selected' : ''}" 
                  onclick="handleClick('${q.ID}', '${opt}', ${index})" 
                  id="btn-${q.ID}-${opt}">
                  <b>${opt}.</b> ${q['Option'+opt]}
                 </button>`;
    });
    html += `</div>`;

    // Explanation Box (Hidden initially)
    html += `<div id="exp-${q.ID}" class="dynamic-explanation hidden"></div>`;

    card.innerHTML = html;
    return card;
}

// --- INTERACTION ---

function handleClick(qID, opt, index) {
    if (currentMode === 'test') {
        // Just select, no colors
        testAnswers[qID] = opt;
        // Update UI
        const container = document.getElementById(`opts-${qID}`);
        container.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        document.getElementById(`btn-${qID}-${opt}`).classList.add('selected');
    } else {
        // PRACTICE MODE: Colors & Explanation
        const q = filteredQuestions[index];
        const correct = getCorrectLetter(q);
        
        const btn = document.getElementById(`btn-${qID}-${opt}`);
        const correctBtn = document.getElementById(`btn-${qID}-${correct}`);
        
        if (opt === correct) {
            btn.classList.add('correct');
            // Show Explanation
            const expBox = document.getElementById(`exp-${qID}`);
            expBox.innerHTML = `<strong>EXPLANATION</strong><br>` + (q.Explanation || "No explanation.");
            expBox.classList.remove('hidden');
            
            // Show NEXT button (if not last question)
            if (currentIndex < filteredQuestions.length - 1) {
                document.getElementById('next-btn').classList.remove('hidden');
            }

            // Disable all buttons for this Q
            const container = document.getElementById(`opts-${qID}`);
            container.querySelectorAll('.option-btn').forEach(b => b.disabled = true);

            // SAVE PROGRESS
            if (currentUser && !userSolvedIDs.includes(qID)) {
                userSolvedIDs.push(qID);
                db.collection('users').doc(currentUser.uid).set({ solved: userSolvedIDs }, { merge: true });
            }
        } else {
            btn.classList.add('wrong');
        }
    }
}

// --- NAVIGATION ---

function nextPage() {
    if (currentMode === 'practice') {
        currentIndex++; 
    } else {
        currentIndex += 5; // Jump 5 for test
    }
    renderPage();
}

function prevPage() {
    if (currentMode === 'practice') {
        currentIndex--;
    } else {
        currentIndex -= 5;
    }
    renderPage();
}

// --- UTILS ---

function getCorrectLetter(q) {
    let dbAns = String(q.CorrectAnswer || "?").trim();
    if (/^[a-eA-E]$/.test(dbAns)) return dbAns.toUpperCase();
    
    // Fuzzy logic (stripped for brevity, assuming you use letters mostly now)
    return dbAns.charAt(0).toUpperCase(); 
}

function toggleBookmark(qID, span) {
    if(userBookmarks.includes(qID)) {
        userBookmarks = userBookmarks.filter(id => id !== qID);
        span.innerText = "☆";
        span.style.color = "#ccc";
    } else {
        userBookmarks.push(qID);
        span.innerText = "★";
        span.style.color = "#ffc107";
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
    
    // Render Review
    const list = document.getElementById('review-list');
    list.innerHTML = "";
    wrongList.forEach(item => {
        list.innerHTML += `
            <div style="background:white; padding:15px; margin-bottom:10px; border-left:4px solid red;">
                <b>${item.q.Question}</b><br>
                <span style="color:red">You: ${item.user||'-'}</span> | 
                <span style="color:green">Correct: ${item.correct}</span>
                <div style="background:#f9f9f9; padding:5px; margin-top:5px; font-size:0.9em;">${item.q.Explanation}</div>
            </div>`;
    });
}

// --- HELPERS ---
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
function goHome() {
    clearInterval(testTimer);
    document.getElementById('timer').classList.add('hidden');
    showScreen('dashboard-screen');
}
