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
    
    try {
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
    } catch (e) {
        console.error("Load Data Error", e);
    }
}

// --- FIXED RESET FUNCTION ---
async function resetAccountData() {
    if(!currentUser) return alert("Please log in first.");
    
    if (!confirm("⚠️ WARNING: This will permanently delete ALL your progress, scores, and bookmarks.\n\nAre you sure you want to continue?")) return;
    
    try {
        // 1. Delete Results Subcollection (Must loop through them)
        const resultsRef = db.collection('users').doc(currentUser.uid).collection('results');
        const snapshot = await resultsRef.get();
        
        // Use a batch to delete properly
        if (!snapshot.empty) {
            const batch = db.batch();
            snapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        }

        // 2. Delete Main User Document
        await db.collection('users').doc(currentUser.uid).delete();

        alert("✅ Progress has been reset successfully. The page will now reload.");
        window.location.reload(); // Force refresh to clear memory

    } catch (error) {
        console.error(error);
        alert("Error resetting data: " + error.message);
    }
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
    
    filteredQuestions = [...allQuestions].sort(() => Math.random() - 0.5).slice(0, count);
    if(filteredQuestions.length === 0) return alert("Questions loading, please wait...");
    
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

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const submitBtn = document.getElementById('submit-btn');
    
    prevBtn.classList.toggle('hidden', currentIndex === 0);

    if (currentMode === 'practice') {
        // 1 Q per page
        document.getElementById('timer').classList.add('hidden');
        submitBtn.classList.add('hidden');
        nextBtn.classList.add('hidden'); // Initially hidden until answered
        
        // But if it's NOT the last question, we allow showing Next later
        // If it IS the last question, Next stays hidden forever
        
        document.getElementById('q-progress').innerText = `Question ${currentIndex + 1} of ${filteredQuestions.length}`;
        container.appendChild(createQuestionCard(filteredQuestions[currentIndex], currentIndex, false));

    } else {
        // 5 Q per page
        document.getElementById('timer').classList.remove('hidden');
        nextBtn.classList.remove('hidden');
        submitBtn.classList.add('hidden');

        const start = currentIndex;
        const end = Math.min(start + 5, filteredQuestions.length);
        
        document.getElementById('q-progress').innerText = `Questions ${start + 1}-${end} of ${filteredQuestions.length}`;

        for (let i = start; i < end; i++) {
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
    if (isTest) card.className = "test-question-block"; 
    else card.className = ""; 

    let headerHTML = `<div style="font-size:0.85em; color:#666; margin-bottom:10px;">${q.Subject} • ${q.Topic}`;
    if (!isTest) {
        const isSaved = userBookmarks.includes(q.ID);
        headerHTML += ` <span onclick="toggleBookmark('${q.ID}', this)" style="cursor:pointer; float:right; font-size:1.2em; color:${isSaved ? '#ffc107' : '#ccc'}">${isSaved ? '★' : '☆'}</span>`;
    }
    headerHTML += `</div>`;
    
    // Justified Question Text
    let html = headerHTML + `<div class="test-q-text">${index+1}. ${q.Question}</div>`;
    
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

    html += `<div id="exp-${q.ID}" class="dynamic-explanation hidden"></div>`;

    card.innerHTML = html;
    return card;
}

// --- INTERACTION ---

// --- INTERACTION ---

function handleClick(qID, opt, index) {
    if (currentMode === 'test') {
        // Test Mode: Just select
        testAnswers[qID] = opt;
        const container = document.getElementById(`opts-${qID}`);
        container.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        document.getElementById(`btn-${qID}-${opt}`).classList.add('selected');
    } else {
        // PRACTICE MODE: Popup Logic
        const q = filteredQuestions[index];
        const correct = getCorrectLetter(q);
        
        const btn = document.getElementById(`btn-${qID}-${opt}`);
        
        if (opt === correct) {
            // 1. Visual Feedback
            btn.classList.add('correct');
            
            // 2. Disable buttons so they can't double click
            const container = document.getElementById(`opts-${qID}`);
            container.querySelectorAll('.option-btn').forEach(b => b.disabled = true);

            // 3. Show Next Button on Main Screen (in case they close modal)
            if (currentIndex < filteredQuestions.length - 1) {
                document.getElementById('next-btn').classList.remove('hidden');
            }

            // 4. OPEN THE POPUP!
            openModal(q.Explanation);

            // 5. Save Progress
            if (currentUser && !userSolvedIDs.includes(qID)) {
                userSolvedIDs.push(qID);
                db.collection('users').doc(currentUser.uid).set({ solved: userSolvedIDs }, { merge: true });
            }
        } else {
            // Wrong Answer
            btn.classList.add('wrong');
        }
    }
}

// --- MODAL FUNCTIONS ---

function openModal(explanationText) {
    const modal = document.getElementById('explanation-modal');
    const content = document.getElementById('modal-content');
    
    // Inject text (using innerHTML for bold/colors)
    content.innerHTML = explanationText || "No explanation provided.";
    
    // Show Modal
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('explanation-modal').classList.add('hidden');
}

function nextPageFromModal() {
    closeModal();
    // Small delay to make it look smooth
    setTimeout(() => {
        nextPage();
    }, 200);
}

// --- NAVIGATION (Existing code, just ensuring it matches) ---
function nextPage() {
    if (currentMode === 'practice') {
        currentIndex++; 
    } else {
        currentIndex += 5; 
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

// --- NAVIGATION ---

function nextPage() {
    if (currentMode === 'practice') {
        currentIndex++; 
    } else {
        currentIndex += 5; 
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
    
    // Fuzzy Match
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
    
    const list = document.getElementById('review-list');
    list.innerHTML = "";
    wrongList.forEach(item => {
        list.innerHTML += `
            <div style="background:white; padding:15px; margin-bottom:10px; border-left:4px solid red; border-radius:5px;">
                <b>${item.q.Question}</b><br>
                <span style="color:red">You: ${item.user||'-'}</span> | 
                <span style="color:green">Correct: ${item.correct}</span>
                <div style="background:#f9f9f9; padding:10px; margin-top:5px; font-size:0.9em; white-space: pre-wrap;">${item.q.Explanation || 'No explanation.'}</div>
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

