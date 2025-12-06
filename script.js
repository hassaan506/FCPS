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

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();

// ======================================================
// 2. STATE VARIABLES
// ======================================================

let currentUser = null;
let allQuestions = [];
let filteredQuestions = [];
let userBookmarks = []; 

// Quiz State
let currentMode = 'practice'; 
let currentQuestionIndex = 0;
let testTimer = null;
let testAnswers = {}; 
let testTimeRemaining = 0;

// ======================================================
// 3. AUTHENTICATION & STARTUP
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
        .catch(error => document.getElementById('auth-msg').innerText = "Error: " + error.message);
}

function signup() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    auth.createUserWithEmailAndPassword(email, pass)
        .catch(error => document.getElementById('auth-msg').innerText = "Error: " + error.message);
}

function logout() {
    auth.signOut();
}

async function loadUserData() {
    if(!currentUser) return;

    // 1. Load Bookmarks
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    if (userDoc.exists) {
        userBookmarks = userDoc.data().bookmarks || [];
    }

    // 2. Load Test Results & Calculate Average
    const statsSnapshot = await db.collection('users').doc(currentUser.uid).collection('results').get();
    
    let totalTests = 0;
    let totalScore = 0;

    statsSnapshot.forEach(doc => {
        totalTests++;
        totalScore += doc.data().score;
    });

    // Avoid dividing by zero if new user
    const avgScore = totalTests > 0 ? Math.round(totalScore / totalTests) : 0;

    // 3. Update the Dashboard Box
    const statsBox = document.getElementById('stats-box');
    if (statsBox) {
        statsBox.innerHTML = `
            <h3>Your Progress</h3>
            <p style="font-size: 1.1rem; margin: 5px 0;">Tests Taken: <b>${totalTests}</b></p>
            <p style="font-size: 1.1rem; margin: 0;">Average Score: <b style="color: ${avgScore >= 70 ? 'green' : 'red'}">${avgScore}%</b></p>
        `;
    }
}

// ======================================================
// 4. DATA LOADING
// ======================================================

function loadQuestions() {
    Papa.parse(GOOGLE_SHEET_URL, {
        download: true,
        header: true,
        skipEmptyLines: true, 
        complete: function(results) {
            processData(results.data);
        }
    });
}

function processData(rawData) {
    const seenQuestions = new Set();
    allQuestions = [];
    const subjects = new Set();
    const subjectTopicMap = {};

    rawData.forEach(row => {
        if (!row.Question) return;
        
        // Remove duplicates
        const qSignature = row.Question.trim().toLowerCase();
        if (seenQuestions.has(qSignature)) return; 
        seenQuestions.add(qSignature);

        const subj = row.Subject ? row.Subject.trim() : "General";
        const topic = row.Topic ? row.Topic.trim() : "Mixed";

        row.Subject = subj;
        row.Topic = topic;
        allQuestions.push(row);

        subjects.add(subj);
        if (!subjectTopicMap[subj]) subjectTopicMap[subj] = new Set();
        subjectTopicMap[subj].add(topic);
    });

    renderMenus(subjects, subjectTopicMap);
}

function renderMenus(subjects, map) {
    const container = document.getElementById('dynamic-menus');
    container.innerHTML = ""; 

    if (subjects.size === 0) {
        container.innerHTML = "<p>No questions found. Check your Google Sheet link.</p>";
        return;
    }

    subjects.forEach(subj => {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = subj;
        summary.style.cursor = "pointer";
        summary.style.padding = "10px";
        summary.style.fontWeight = "bold";
        summary.style.borderBottom = "1px solid #ddd";
        
        details.appendChild(summary);

        const subBtn = document.createElement('button');
        subBtn.textContent = `Practice All ${subj}`;
        subBtn.className = "category-btn";
        subBtn.style.background = "#2c3e50";
        subBtn.style.color = "#fff";
        subBtn.style.width = "100%";
        subBtn.style.marginTop = "10px";
        subBtn.onclick = () => startSession(subj, null);
        details.appendChild(subBtn);

        map[subj].forEach(topic => {
            const btn = document.createElement('button');
            btn.textContent = topic;
            btn.className = "category-btn";
            btn.onclick = () => startSession(subj, topic);
            details.appendChild(btn);
        });

        container.appendChild(details);
    });
}

// ======================================================
// 5. HELPER: SMART ANSWER RESOLVER
// ======================================================

function getCorrectLetter(q) {
    if (!q.CorrectAnswer) return "?";
    let dbAns = String(q.CorrectAnswer).trim();
    
    // 1. Direct Letter Match (A, B, C, D, E)
    if (/^[a-eA-E]$/.test(dbAns)) {
        return dbAns.toUpperCase();
    }
    
    // 2. FUZZY TEXT MATCHING
    function clean(str) { return str.toLowerCase().replace(/[^a-z0-9]/g, ""); }

    let cleanTarget = clean(dbAns);
    const options = ['A', 'B', 'C', 'D', 'E'];
    
    for (let opt of options) {
        let optText = q['Option' + opt];
        if (!optText) continue;
        
        let cleanOpt = clean(optText);
        
        if (cleanOpt === cleanTarget) return opt;
        if (cleanTarget.length > 3 && cleanOpt.includes(cleanTarget)) return opt;
    }
    
    return '?'; 
}

// ======================================================
// 6. SESSION MANAGEMENT
// ======================================================

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if(event.target) event.target.classList.add('active');

    if (mode === 'test') {
        document.getElementById('test-settings').classList.remove('hidden');
        document.getElementById('dynamic-menus').classList.add('hidden');
    } else {
        document.getElementById('test-settings').classList.add('hidden');
        document.getElementById('dynamic-menus').classList.remove('hidden');
    }
}

function startSession(subject, topic) {
    filteredQuestions = allQuestions.filter(q => {
        const subjMatch = q.Subject === subject;
        const topicMatch = topic ? q.Topic === topic : true;
        return subjMatch && topicMatch;
    });

    if (filteredQuestions.length === 0) {
        alert("No questions found!");
        return;
    }

    filteredQuestions.sort(() => Math.random() - 0.5);
    currentQuestionIndex = 0;
    currentMode = 'practice';
    showScreen('quiz-screen');
    renderQuestion();
}

function startTest() {
    const count = parseInt(document.getElementById('q-count').value);
    const mins = parseInt(document.getElementById('t-limit').value);

    filteredQuestions = [...allQuestions].sort(() => Math.random() - 0.5).slice(0, count);
    
    if (filteredQuestions.length === 0) {
        alert("No questions loaded yet!");
        return;
    }

    currentMode = 'test';
    currentQuestionIndex = 0;
    testAnswers = {};
    testTimeRemaining = mins * 60; 

    showScreen('quiz-screen');
    document.getElementById('timer').classList.remove('hidden');
    document.getElementById('submit-btn').classList.remove('hidden');
    
    clearInterval(testTimer);
    testTimer = setInterval(updateTimer, 1000);
    
    renderQuestion();
}

function startSavedQuestions() {
    if (userBookmarks.length === 0) {
        alert("No bookmarks saved yet.");
        return;
    }
    filteredQuestions = allQuestions.filter(q => userBookmarks.includes(q.ID));
    currentMode = 'practice';
    currentQuestionIndex = 0;
    showScreen('quiz-screen');
    renderQuestion();
}

// ======================================================
// 7. QUIZ ENGINE
// ======================================================

function renderQuestion() {
    const q = filteredQuestions[currentQuestionIndex];
    
    document.getElementById('q-subject').innerText = q.Subject;
    document.getElementById('q-topic').innerText = q.Topic;
    document.getElementById('q-text').innerText = q.Question;
    document.getElementById('explanation-box').classList.add('hidden');
    document.getElementById('q-progress').innerText = `${currentQuestionIndex + 1} / ${filteredQuestions.length}`;
    
    const bmBtn = document.getElementById('bookmark-btn');
    if (userBookmarks.includes(q.ID)) {
        bmBtn.classList.add('saved');
        bmBtn.innerText = "★ Saved";
    } else {
        bmBtn.classList.remove('saved');
        bmBtn.innerText = "☆ Save";
    }

    const container = document.getElementById('options-container');
    container.innerHTML = "";

    const options = ['A', 'B', 'C', 'D'];
    if (q.OptionE && q.OptionE.trim() !== "") options.push('E');

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = "option-btn";
        btn.innerHTML = `<b>${opt}.</b> ${q['Option' + opt]}`;
        btn.id = `btn-${opt}`;
        
        btn.onclick = function() { handleOptionClick(opt); };
        
        if (currentMode === 'test' && testAnswers[q.ID] === opt) {
            btn.classList.add('selected');
        }
        
        container.appendChild(btn);
    });

    document.getElementById('prev-btn').classList.toggle('hidden', currentQuestionIndex === 0);
    
    if (currentMode === 'test') {
        if (currentQuestionIndex === filteredQuestions.length - 1) {
            document.getElementById('next-btn').classList.add('hidden');
            document.getElementById('submit-btn').classList.remove('hidden');
        } else {
            document.getElementById('next-btn').classList.remove('hidden');
            document.getElementById('submit-btn').classList.add('hidden');
        }
    } else {
        document.getElementById('submit-btn').classList.add('hidden');
        document.getElementById('next-btn').classList.add('hidden'); 
    }
}

function handleOptionClick(selectedOpt) {
    const q = filteredQuestions[currentQuestionIndex];

    if (currentMode === 'test') {
        testAnswers[q.ID] = selectedOpt;
        document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        document.getElementById(`btn-${selectedOpt}`).classList.add('selected');
    } 
    else {
        // === PRACTICE MODE LOGIC ===
        let correctOpt = getCorrectLetter(q);
        
        const selectedBtn = document.getElementById(`btn-${selectedOpt}`);
        const correctBtn = document.getElementById(`btn-${correctOpt}`);

        if (correctOpt === '?') {
            alert("Check Sheet: CorrectAnswer column must match one of the options.");
            return;
        }

        if (selectedOpt === correctOpt) {
            selectedBtn.classList.add('correct');
            document.getElementById('explanation-box').classList.remove('hidden');
            
            // --- FIX: USE INNERHTML TO SHOW BOLD/COLORS ---
            document.getElementById('exp-text').innerHTML = q.Explanation || "No explanation provided.";
            // ----------------------------------------------
            
            document.getElementById('next-btn').classList.remove('hidden');
            document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
        } else {
            selectedBtn.classList.add('wrong');
        }
    }
}

function nextQuestion() {
    if (currentQuestionIndex < filteredQuestions.length - 1) {
        currentQuestionIndex++;
        renderQuestion();
    }
}

function prevQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        renderQuestion();
    }
}

// ======================================================
// 8. TEST SUBMISSION & TIMER
// ======================================================

function updateTimer() {
    testTimeRemaining--;
    const m = Math.floor(testTimeRemaining / 60);
    const s = testTimeRemaining % 60;
    document.getElementById('timer').innerText = `${m}:${s < 10 ? '0' : ''}${s}`;

    if (testTimeRemaining <= 0) {
        submitTest();
    }
}

function submitTest() {
    clearInterval(testTimer);
    
    let score = 0;
    let wrongList = [];

    filteredQuestions.forEach(q => {
        const userAns = testAnswers[q.ID];
        const correctAns = getCorrectLetter(q); 
        
        if (userAns === correctAns) {
            score++;
        } else {
            wrongList.push({ q: q, user: userAns, correct: correctAns });
        }
    });

    const percentage = Math.round((score / filteredQuestions.length) * 100);

    // Save Result to DB
    if(currentUser) {
        db.collection('users').doc(currentUser.uid).collection('results').add({
            date: new Date(),
            score: percentage,
            total: filteredQuestions.length
        });
    }

    showScreen('result-screen');
    document.getElementById('final-score').innerText = `${percentage}% (${score}/${filteredQuestions.length})`;
    renderReviewList(wrongList);
}

function renderReviewList(wrongQuestions) {
    const list = document.getElementById('review-list');
    list.innerHTML = "";

    if (wrongQuestions.length === 0) {
        list.innerHTML = "<p>Perfect Score! Great job.</p>";
        return;
    }

    wrongQuestions.forEach(item => {
        const div = document.createElement('div');
        div.style.background = "#fff";
        div.style.padding = "15px";
        div.style.marginBottom = "10px";
        div.style.borderLeft = "5px solid #dc3545";
        div.style.borderRadius = "5px";
        div.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
        
        // --- FIX: Ensure Explanation here also supports HTML ---
        div.innerHTML = `
            <p><b>Q:</b> ${item.q.Question}</p>
            <p style="color:red">Your Answer: ${item.user || "Skipped"}</p>
            <p style="color:green">Correct Answer: ${item.correct}</p>
            <div style="background:#f8f9fa; padding:10px; border-radius:4px; font-size:0.9em; margin-top:5px; white-space: pre-wrap;">
                <i>${item.q.Explanation || "No explanation."}</i>
            </div>
        `;
        list.appendChild(div);
    });
}

// ======================================================
// 9. UTILITIES
// ======================================================

function toggleBookmark() {
    const qID = filteredQuestions[currentQuestionIndex].ID;
    const btn = document.getElementById('bookmark-btn');

    if (userBookmarks.includes(qID)) {
        userBookmarks = userBookmarks.filter(id => id !== qID);
        btn.classList.remove('saved');
        btn.innerText = "☆ Save";
    } else {
        userBookmarks.push(qID);
        btn.classList.add('saved');
        btn.innerText = "★ Saved";
    }

    db.collection('users').doc(currentUser.uid).set({
        bookmarks: userBookmarks
    }, { merge: true });
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function goHome() {
    clearInterval(testTimer);
    document.getElementById('timer').classList.add('hidden');
    showScreen('dashboard-screen');
    loadQuestions(); 
}

