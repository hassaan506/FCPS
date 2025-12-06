// ======================================================
// 1. CONFIGURATION (I have filled this for you)
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
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ======================================================
// 2. STATE VARIABLES
// ======================================================

let currentUser = null;
let allQuestions = [];
let filteredQuestions = [];
let userBookmarks = []; // Stores IDs of bookmarked questions

// Quiz State
let currentMode = 'practice'; // 'practice' or 'test'
let currentQuestionIndex = 0;
let testTimer = null;
let testAnswers = {}; // { qID: "A", qID: "B" }
let testTimeRemaining = 0;

// ======================================================
// 3. AUTHENTICATION & STARTUP
// ======================================================

// Listen for login state changes
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
        .catch(error => document.getElementById('auth-msg').innerText = error.message);
}

function signup() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    auth.createUserWithEmailAndPassword(email, pass)
        .catch(error => document.getElementById('auth-msg').innerText = error.message);
}

function logout() {
    auth.signOut();
}

async function loadUserData() {
    // Load Bookmarks from Database
    const doc = await db.collection('users').doc(currentUser.uid).get();
    if (doc.exists) {
        userBookmarks = doc.data().bookmarks || [];
    }
}

// ======================================================
// 4. DATA LOADING (GOOGLE SHEETS)
// ======================================================

function loadQuestions() {
    Papa.parse(GOOGLE_SHEET_URL, {
        download: true,
        header: true,
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
        // Validation: Must have Question and Correct Answer
        if (!row.Question || !row.CorrectAnswer) return;

        // DUPLICATE REMOVER logic
        const qSignature = row.Question.trim().toLowerCase();
        if (seenQuestions.has(qSignature)) return; // Skip if already seen
        seenQuestions.add(qSignature);

        // Fallback for empty categories
        const subj = row.Subject ? row.Subject.trim() : "General";
        const topic = row.Topic ? row.Topic.trim() : "Mixed";

        // Add to main list
        row.Subject = subj;
        row.Topic = topic;
        allQuestions.push(row);

        // Build Menu Structure
        subjects.add(subj);
        if (!subjectTopicMap[subj]) subjectTopicMap[subj] = new Set();
        subjectTopicMap[subj].add(topic);
    });

    renderMenus(subjects, subjectTopicMap);
}

function renderMenus(subjects, map) {
    const container = document.getElementById('dynamic-menus');
    container.innerHTML = ""; // Clear "Loading..."

    subjects.forEach(subj => {
        // Create Subject Section
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = subj + " (Subject)";
        summary.style.cursor = "pointer";
        summary.style.padding = "10px";
        summary.style.fontWeight = "bold";
        
        details.appendChild(summary);

        // Button to practice WHOLE subject
        const subBtn = document.createElement('button');
        subBtn.textContent = `Practice All ${subj}`;
        subBtn.className = "category-btn";
        subBtn.style.background = "#333";
        subBtn.style.color = "#fff";
        subBtn.onclick = () => startSession(subj, null);
        details.appendChild(subBtn);

        // Buttons for TOPICS
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
// 5. SESSION MANAGEMENT (PRACTICE VS TEST)
// ======================================================

function setMode(mode) {
    currentMode = mode;
    // Update tabs UI
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');

    // Show/Hide Test Settings
    if (mode === 'test') {
        document.getElementById('test-settings').classList.remove('hidden');
        document.getElementById('dynamic-menus').classList.add('hidden');
    } else {
        document.getElementById('test-settings').classList.add('hidden');
        document.getElementById('dynamic-menus').classList.remove('hidden');
    }
}

// Start Practice Mode (Immediate Feedback)
function startSession(subject, topic) {
    // Filter questions
    filteredQuestions = allQuestions.filter(q => {
        const subjMatch = q.Subject === subject;
        const topicMatch = topic ? q.Topic === topic : true;
        return subjMatch && topicMatch;
    });

    if (filteredQuestions.length === 0) {
        alert("No questions found for this selection!");
        return;
    }

    // Shuffle questions
    filteredQuestions.sort(() => Math.random() - 0.5);
    
    currentQuestionIndex = 0;
    currentMode = 'practice';
    showScreen('quiz-screen');
    renderQuestion();
}

// Start Test Mode (Timer, Blind)
function startTest() {
    // 1. Get Questions (For now, random from ALL. You can add subject filter to test later)
    const count = parseInt(document.getElementById('q-count').value);
    const mins = parseInt(document.getElementById('t-limit').value);

    filteredQuestions = [...allQuestions].sort(() => Math.random() - 0.5).slice(0, count);
    
    if (filteredQuestions.length === 0) {
        alert("No questions loaded yet!");
        return;
    }

    // 2. Setup Test State
    currentMode = 'test';
    currentQuestionIndex = 0;
    testAnswers = {};
    testTimeRemaining = mins * 60; // Convert to seconds

    // 3. UI Setup
    showScreen('quiz-screen');
    document.getElementById('timer').classList.remove('hidden');
    document.getElementById('submit-btn').classList.remove('hidden');
    document.getElementById('next-btn').innerText = "Next"; // Ensure it says Next
    
    // 4. Start Timer
    clearInterval(testTimer);
    testTimer = setInterval(updateTimer, 1000);
    
    renderQuestion();
}

// Start Saved Questions Review
function startSavedQuestions() {
    if (userBookmarks.length === 0) {
        alert("No bookmarks saved yet.");
        return;
    }
    // Filter to only bookmarked questions
    filteredQuestions = allQuestions.filter(q => userBookmarks.includes(q.ID));
    currentMode = 'practice';
    currentQuestionIndex = 0;
    showScreen('quiz-screen');
    renderQuestion();
}

// ======================================================
// 6. QUIZ ENGINE
// ======================================================

function renderQuestion() {
    const q = filteredQuestions[currentQuestionIndex];
    
    // UI Reset
    document.getElementById('q-subject').innerText = q.Subject;
    document.getElementById('q-topic').innerText = q.Topic;
    document.getElementById('q-text').innerText = q.Question;
    document.getElementById('explanation-box').classList.add('hidden');
    document.getElementById('q-progress').innerText = `${currentQuestionIndex + 1} / ${filteredQuestions.length}`;
    
    // Bookmark State
    const bmBtn = document.getElementById('bookmark-btn');
    if (userBookmarks.includes(q.ID)) {
        bmBtn.classList.add('saved');
        bmBtn.innerText = "★ Saved";
    } else {
        bmBtn.classList.remove('saved');
        bmBtn.innerText = "☆ Save";
    }

    // Buttons
    const container = document.getElementById('options-container');
    container.innerHTML = "";

    // Determine Options (Handle Option E)
    const options = ['A', 'B', 'C', 'D'];
    if (q.OptionE && q.OptionE.trim() !== "") options.push('E');

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = "option-btn";
        btn.innerHTML = `<b>${opt}.</b> ${q['Option' + opt]}`;
        btn.id = `btn-${opt}`;
        btn.onclick = () => handleOptionClick(opt);
        
        // If in test mode, maintain selection visually
        if (currentMode === 'test' && testAnswers[q.ID] === opt) {
            btn.classList.add('selected');
        }
        
        container.appendChild(btn);
    });

    // Navigation Buttons Logic
    document.getElementById('prev-btn').classList.toggle('hidden', currentQuestionIndex === 0);
    
    if (currentMode === 'test') {
        // Last question handling
        if (currentQuestionIndex === filteredQuestions.length - 1) {
            document.getElementById('next-btn').classList.add('hidden');
            document.getElementById('submit-btn').classList.remove('hidden');
        } else {
            document.getElementById('next-btn').classList.remove('hidden');
            document.getElementById('submit-btn').classList.add('hidden');
        }
    } else {
        // Practice Mode
        document.getElementById('submit-btn').classList.add('hidden');
        document.getElementById('next-btn').classList.add('hidden'); // Only show after correct answer
    }
}

function handleOptionClick(selectedOpt) {
    const q = filteredQuestions[currentQuestionIndex];

    if (currentMode === 'test') {
        // Just record answer, no feedback
        testAnswers[q.ID] = selectedOpt;
        // Update UI selection
        document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        document.getElementById(`btn-${selectedOpt}`).classList.add('selected');
    } 
    else {
        // Practice Mode: Immediate Feedback
        const correctOpt = q.CorrectAnswer.trim().toUpperCase();
        const selectedBtn = document.getElementById(`btn-${selectedOpt}`);
        const correctBtn = document.getElementById(`btn-${correctOpt}`);

        if (selectedOpt === correctOpt) {
            selectedBtn.classList.add('correct');
            // Show Explanation
            document.getElementById('explanation-box').classList.remove('hidden');
            document.getElementById('exp-text').innerText = q.Explanation;
            document.getElementById('next-btn').classList.remove('hidden');
            
            // Disable buttons
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
// 7. TEST SUBMISSION & TIMER
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
    
    // Calculate Score
    let score = 0;
    let wrongList = [];

    filteredQuestions.forEach(q => {
        const userAns = testAnswers[q.ID];
        const correctAns = q.CorrectAnswer.trim().toUpperCase();
        if (userAns === correctAns) {
            score++;
        } else {
            wrongList.push({ q: q, user: userAns, correct: correctAns });
        }
    });

    const percentage = Math.round((score / filteredQuestions.length) * 100);

    // Save Result to DB (Optional: You can add this if you want history)
    db.collection('users').doc(currentUser.uid).collection('results').add({
        date: new Date(),
        score: percentage,
        total: filteredQuestions.length
    });

    // Show Results Screen
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
        
        div.innerHTML = `
            <p><b>Q:</b> ${item.q.Question}</p>
            <p style="color:red">Your Answer: ${item.user || "Skipped"}</p>
            <p style="color:green">Correct Answer: ${item.correct}</p>
            <p style="background:#f8f9fa; padding:5px"><i>${item.q.Explanation}</i></p>
        `;
        list.appendChild(div);
    });
}

// ======================================================
// 8. UTILITIES (Bookmarks & Navigation)
// ======================================================

function toggleBookmark() {
    const qID = filteredQuestions[currentQuestionIndex].ID;
    const btn = document.getElementById('bookmark-btn');

    if (userBookmarks.includes(qID)) {
        // Remove
        userBookmarks = userBookmarks.filter(id => id !== qID);
        btn.classList.remove('saved');
        btn.innerText = "☆ Save";
    } else {
        // Add
        userBookmarks.push(qID);
        btn.classList.add('saved');
        btn.innerText = "★ Saved";
    }

    // Sync with Firebase
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
    loadQuestions(); // Reload to refresh bookmark icons if changed
}