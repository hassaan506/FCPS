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
let isMistakeReview = false;
let currentIndex = 0; 
let testTimer = null;
let testAnswers = {}; 
let testFlags = {}; // NEW: Stores Flagged Questions { q_uid: true }
let testTimeRemaining = 0;

// ======================================================
// 3. AUTH & DASHBOARD
// ======================================================

/* --- AUTH LISTENER (THE TRAFFIC COP) --- */
/* --- AUTH LISTENER (THE TRAFFIC COP) --- */
auth.onAuthStateChanged((user) => {
    if (user) {
        // User is Logged In (or just signed up)
        console.log("User detected:", user.email);
        currentUser = user;
        
        // 1. HIDE Login Screen / SHOW Dashboard
        showScreen('dashboard-screen'); 
        
        // 2. Load their data
        loadUserData();

        // 3. LOAD QUESTIONS (This was missing!)
        loadQuestions(); 

    } else {
        // User is Logged Out
        console.log("No user signed in.");
        currentUser = null;
        
        // 1. SHOW Login Screen / HIDE Dashboard
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

    // --- FIX START: Restore the Name on Refresh ---
    if (currentUser.displayName) {
        document.getElementById('user-display').innerText = currentUser.displayName;
    }
    // --- FIX END ---

    try {
        // 1. Show "Loading..."
        const statsBox = document.getElementById('quick-stats');
        if(statsBox) statsBox.style.opacity = "0.5"; 

        // 2. FORCE FETCH FROM SERVER
        const userDoc = await db.collection('users').doc(currentUser.uid).get({ source: 'server' });
        let userData = userDoc.exists ? userDoc.data() : {};

        userBookmarks = userData.bookmarks || [];
        userSolvedIDs = userData.solved || [];
        userMistakes = userData.mistakes || []; 

        checkStreak(userData);

        // 3. FORCE FETCH RESULTS
        const resultsSnap = await db.collection('users').doc(currentUser.uid).collection('results').get({ source: 'server' });
        let totalTests = 0, totalScore = 0;
        resultsSnap.forEach(doc => { totalTests++; totalScore += doc.data().score; });
        const avgScore = totalTests > 0 ? Math.round(totalScore / totalTests) : 0;
        
        // 4. Update UI
        if(statsBox) {
            statsBox.style.opacity = "1"; 
            statsBox.innerHTML = `
                <div class="stat-row"><span class="stat-lbl">Test Average:</span> <span class="stat-val" style="color:${avgScore>=70?'#2ecc71':'#e74c3c'}">${avgScore}%</span></div>
                <div class="stat-row"><span class="stat-lbl">Mistakes Pending:</span> <span class="stat-val" style="color:#e74c3c; font-weight:bold;">${userMistakes.length}</span></div>
                <div class="stat-row" style="border:none;"><span class="stat-lbl">Practice Solved:</span> <span class="stat-val">${userSolvedIDs.length}</span></div>`;
        }

        // --- NEW LINE: Update the Badge Icon on Dashboard ---
        updateBadgeButton(); 

    } catch (e) { 
        console.error("Load Error:", e); 
    }
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
    const sortedSubjects = Array.from(subjects).sort();

    sortedSubjects.forEach(subj => {
        // --- Subject Stats ---
        const subjQuestions = allQuestions.filter(q => q.Subject === subj);
        const totalSubj = subjQuestions.length;
        const solvedSubj = subjQuestions.filter(q => userSolvedIDs.includes(q._uid)).length;
        const percentSubj = totalSubj > 0 ? Math.round((solvedSubj / totalSubj) * 100) : 0;
        
        // 1. Create Dropdown
        const details = document.createElement('details');
        details.className = "subject-dropdown-card";

        // 2. Header
        details.innerHTML = `
            <summary class="subject-summary">
                <div class="summary-header">
                    <span class="subj-name">${subj}</span>
                    <span class="subj-stats">${solvedSubj}/${totalSubj} (${percentSubj}%)</span>
                </div>
                <div class="progress-bar-thin">
                    <div class="fill" style="width:${percentSubj}%"></div>
                </div>
            </summary>
        `;

        // 3. Content
        const contentDiv = document.createElement('div');
        contentDiv.className = "dropdown-content";

        // "Practice All" Button
        const allBtn = document.createElement('div');
        allBtn.className = "practice-all-row";
        allBtn.innerHTML = `<span>Practice All ${subj}</span> <span>⭐</span>`;
        allBtn.onclick = () => startPractice(subj, null);
        contentDiv.appendChild(allBtn);

        // --- TOPICS GRID WITH PROGRESS BARS ---
        const sortedTopics = Array.from(map[subj] || []).sort();
        
        if (sortedTopics.length > 0) {
            const gridContainer = document.createElement('div');
            gridContainer.className = "topics-text-grid";
            
            sortedTopics.forEach(topic => {
                // Calculate Topic Stats
                const topQuestions = subjQuestions.filter(q => q.Topic === topic);
                const totalTop = topQuestions.length;
                const solvedTop = topQuestions.filter(q => userSolvedIDs.includes(q._uid)).length;
                const percentTop = totalTop > 0 ? Math.round((solvedTop / totalTop) * 100) : 0;
                
                // Create Item
                const item = document.createElement('div');
                item.className = "topic-item-container";
                item.onclick = () => startPractice(subj, topic);

                // HTML structure: Name TOP, Bar BOTTOM
                item.innerHTML = `
                    <span class="topic-name">${topic}</span>
                    <div class="topic-mini-track">
                        <div class="topic-mini-fill" style="width:${percentTop}%"></div>
                    </div>
                `;
                
                gridContainer.appendChild(item);
            });
            contentDiv.appendChild(gridContainer);
        } else {
            contentDiv.innerHTML += `<div style="text-align:center; padding:10px; opacity:0.5;">(No specific topics)</div>`;
        }

        details.appendChild(contentDiv);
        container.appendChild(details);
    });
}

/* =========================================
   2. EXAM MODE: DROPDOWN + SELECTABLE GRID
   ========================================= */

function renderTestFilters(subjects, map) {
    const container = document.getElementById('filter-container');
    if (!container) return; 
    container.innerHTML = "";
    
    const sortedSubjects = Array.from(subjects).sort();

    sortedSubjects.forEach(subj => {
        // 1. Create Dropdown Card
        const details = document.createElement('details');
        details.className = "subject-dropdown-card"; // Reuse same style

        // 2. Header (With "Select All" Checkbox)
        details.innerHTML = `
            <summary class="subject-summary">
                <div class="summary-header">
                    <span class="subj-name">${subj}</span>
                    <label class="select-all-label" onclick="event.stopPropagation()">
                        <input type="checkbox" onchange="toggleSubjectAll(this, '${subj}')"> Select All
                    </label>
                </div>
            </summary>
        `;

        // 3. Content (Grid of Topics)
        const contentDiv = document.createElement('div');
        contentDiv.className = "dropdown-content";
        
        const sortedTopics = Array.from(map[subj] || []).sort();
        
        if (sortedTopics.length > 0) {
            const gridContainer = document.createElement('div');
            gridContainer.className = "topics-text-grid"; // Reuse same grid style
            
            sortedTopics.forEach(topic => {
                // Create Selectable Item
                const item = document.createElement('div');
                item.className = "topic-text-item exam-selectable"; 
                item.innerText = topic;
                // Store data for retrieval
                item.dataset.subject = subj;
                item.dataset.topic = topic;
                
                item.onclick = function() {
                    this.classList.toggle('selected');
                    // Uncheck "Select All" if we uncheck one item
                    if(!this.classList.contains('selected')) {
                        details.querySelector('input[type="checkbox"]').checked = false;
                    }
                };
                
                gridContainer.appendChild(item);
            });
            contentDiv.appendChild(gridContainer);
        }

        details.appendChild(contentDiv);
        container.appendChild(details);
    });
}

// Helper: Toggle ALL topics in a subject
function toggleSubjectAll(checkbox, subjName) {
    // Find the dropdown that contains this checkbox
    const header = checkbox.closest('.subject-dropdown-card');
    const items = header.querySelectorAll('.exam-selectable');
    
    items.forEach(item => {
        if (checkbox.checked) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

/* =========================================
   3. START TEST (Updated to read new Grid)
   ========================================= */
function startTest() {
    const count = parseInt(document.getElementById('q-count').value);
    const mins = parseInt(document.getElementById('t-limit').value);
    
    // Find all selected items (Blue ones)
    const selectedElements = document.querySelectorAll('.exam-selectable.selected');
    
    let pool = [];

    if (selectedElements.length === 0) {
        // If nothing selected, ask user
        if(!confirm("No specific topics selected. Test from ALL questions?")) return;
        pool = [...allQuestions];
    } else {
        // 1. Build a list of selected "Subject|Topic" strings for easy matching
        const selectedPairs = new Set();
        selectedElements.forEach(el => {
            selectedPairs.add(el.dataset.subject + "|" + el.dataset.topic);
        });

        // 2. Filter the Master List
        pool = allQuestions.filter(q => {
            const key = q.Subject + "|" + q.Topic;
            return selectedPairs.has(key);
        });
    }

    if(pool.length === 0) return alert("No questions found matching your selection.");
    
    // Shuffle and Slice
    filteredQuestions = pool.sort(() => Math.random() - 0.5).slice(0, count);
    
    // Start Mode
    currentMode = 'test';
    currentIndex = 0;
    testAnswers = {};
    testFlags = {}; 
    testTimeRemaining = mins * 60;
    
    showScreen('quiz-screen');
    document.getElementById('timer').classList.remove('hidden');
    document.getElementById('test-sidebar').classList.add('active');
    renderNavigator();

    clearInterval(testTimer);
    testTimer = setInterval(updateTimer, 1000);
    renderPage();
}


// ======================================================
// 5. QUIZ LOGIC
// ======================================================

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if(event && event.target) event.target.classList.add('active');
    
    // Toggle Sections
    document.getElementById('test-settings').classList.toggle('hidden', mode !== 'test');
    document.getElementById('dynamic-menus').classList.toggle('hidden', mode === 'test');
    
    // Toggle the new Filter Checkbox (Hide in Exam Mode)
    const filterControls = document.getElementById('practice-filter-controls');
    if(filterControls) {
        filterControls.style.display = (mode === 'test') ? 'none' : 'flex';
    }
}

function startPractice(subject, topic) {
    // 1. Get the checkbox state
    const onlyUnattempted = document.getElementById('unattempted-only').checked;

    // 2. Filter by Subject & Topic FIRST
    let pool = allQuestions.filter(q => q.Subject === subject && (!topic || q.Topic === topic));
    
    // 3. Apply "Unattempted Only" Filter if checked
    if (onlyUnattempted) {
        const initialCount = pool.length;
        pool = pool.filter(q => !userSolvedIDs.includes(q._uid));
        
        console.log(`Filter Active: Reduced from ${initialCount} to ${pool.length} questions.`);
        
        if (pool.length === 0) {
            // Check if it was empty BEFORE or AFTER filtering
            if (initialCount === 0) {
                return alert("No questions found for this topic.");
            } else {
                return alert("🎉 Amazing! You have already solved ALL questions in this section.");
            }
        }
    } else {
        // Standard check for empty topic
        if (pool.length === 0) return alert("No questions available.");
    }

    // 4. Assign to Global Variable
    filteredQuestions = pool;

    // --- CHANGE: AUTO-RESUME LOGIC ---
    // If we are filtering unattempted, we naturally start at 0.
    // If NOT filtering, we try to jump to the first unsolved one.
    let startIndex = 0;
    
    if (!onlyUnattempted) {
        // Find the first question we haven't solved yet to be helpful
        startIndex = filteredQuestions.findIndex(q => !userSolvedIDs.includes(q._uid));
        if (startIndex === -1) startIndex = 0;
    }

    currentMode = 'practice';
    isMistakeReview = false;
    currentIndex = startIndex;
    
    showScreen('quiz-screen');
    renderPage();
    
    // Render the bottom numbers
    renderPracticeNavigator();
}
function startSavedQuestions() {
    if(userBookmarks.length === 0) return alert("No bookmarks!");
    filteredQuestions = allQuestions.filter(q => userBookmarks.includes(q._uid));
    if(filteredQuestions.length === 0) return alert("No matching bookmarks found.");
    
    currentMode = 'practice';
    isMistakeReview = false; // <--- ADD THIS
    currentIndex = 0;
    
    showScreen('quiz-screen');
    renderPage();
}


window.startMistakePractice = function() {
    console.log("Button Clicked!"); 

    // 1. Check if we have mistakes
    if (typeof userMistakes === 'undefined' || userMistakes.length === 0) {
        alert("🎉 Good job! You have 0 pending mistakes to review.");
        return;
    }

    // 2. Filter Questions
    // We only want questions that match the IDs in userMistakes
    filteredQuestions = allQuestions.filter(q => userMistakes.includes(q._uid));
    
    if (filteredQuestions.length === 0) {
        alert("Wait! Questions are still loading. Please wait 5 seconds and try again.");
        return;
    }
    
    alert(`📝 Loading ${filteredQuestions.length} mistakes.`);
    
    // 3. Set Mode
    currentMode = 'practice';
    isMistakeReview = true; // Flag that we are reviewing mistakes
    currentIndex = 0;
    
    // 4. SHOW SCREEN CORRECTLY (The Fix)
    showScreen('quiz-screen'); // This removes 'hidden' and adds 'active'
    
    // 5. Render
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
    const flagBtn = document.getElementById('flag-btn'); 
    
    // --- 1. PREVIOUS BUTTON LOGIC (Same for both modes) ---
    // Hide if we are at the very first question (Index 0)
    prevBtn.classList.toggle('hidden', currentIndex === 0);

    if (currentMode === 'practice') {
        // --- PRACTICE MODE SETUP ---
        document.getElementById('timer').classList.add('hidden');
        document.getElementById('test-sidebar').classList.remove('active'); 
        flagBtn.classList.add('hidden'); 
        submitBtn.classList.add('hidden');
        
        // --- 2. NEXT BUTTON LOGIC (THE FIX) ---
        // Show Next button if we are NOT at the last question.
        // This allows you to skip questions.
        if (currentIndex < filteredQuestions.length - 1) {
            nextBtn.classList.remove('hidden');
        } else {
            nextBtn.classList.add('hidden');
        }
        
        // Render the Single Card
        container.appendChild(createQuestionCard(filteredQuestions[currentIndex], currentIndex, false));
        
        // Update Bottom Navigator
        renderPracticeNavigator(); 

    } else {
        // --- EXAM MODE SETUP ---
        document.getElementById('timer').classList.remove('hidden');
        flagBtn.classList.remove('hidden'); 

        // Render 5 Questions per page
        const start = currentIndex;
        const end = Math.min(start + 5, filteredQuestions.length);
        for (let i = start; i < end; i++) {
            container.appendChild(createQuestionCard(filteredQuestions[i], i, true));
        }
        
        // NEXT / SUBMIT LOGIC for Exam
        if (end === filteredQuestions.length) {
            nextBtn.classList.add('hidden');
            submitBtn.classList.remove('hidden');
        } else {
            nextBtn.classList.remove('hidden');
            submitBtn.classList.add('hidden');
        }
        
        renderNavigator(); 
    }
}


/* =========================================
   CREATE QUESTION CARD (Safe Version)
   ========================================= */
function createQuestionCard(q, index, showNumber = true) {
    const block = document.createElement('div');
    block.className = "test-question-block";

    // 1. Question Text
    const qText = document.createElement('div');
    qText.className = "test-q-text";
    qText.innerHTML = `${showNumber ? (index + 1) + ". " : ""}${q.Question}`;
    block.appendChild(qText);

    // 2. Options Container
    const optionsDiv = document.createElement('div');
    optionsDiv.className = "options-group";

    // SAFETY CHECK: If options are missing, show error instead of crashing
    if (!q.Options || !Array.isArray(q.Options)) {
        console.error("Missing options for Q:", q.Question);
        return block;
    }

    // 3. Create Options
    // Using [...q.Options] to create a safe copy
    [...q.Options].forEach(opt => {
        const btn = document.createElement('button');
        btn.className = "option-btn";
        
        // --- LAYOUT: Text Span + Eye Span ---
        // We wrap the text in a span so CSS can position it
        btn.innerHTML = `<span class="opt-text">${opt}</span>`;
        
        // Create the Eye Icon
        const eyeIcon = document.createElement('span');
        eyeIcon.className = "elim-eye";
        eyeIcon.innerHTML = "👁️"; 
        eyeIcon.title = "Eliminate this option";
        
        // --- CLICK EYE to Eliminate ---
        eyeIcon.onclick = (e) => {
            e.stopPropagation(); // Don't select the answer
            btn.classList.toggle('eliminated');
        };

        // Append Eye to Button
        btn.appendChild(eyeIcon);

        // --- RIGHT CLICK (Desktop Shortcut) ---
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault(); 
            btn.classList.toggle('eliminated');
            return false;
        });

        // --- NORMAL SELECTION ---
        btn.onclick = (e) => {
            if (e.target.classList.contains('elim-eye')) return; // Ignore eye clicks

            // Auto-uneliminate if selected
            if (btn.classList.contains('eliminated')) {
                btn.classList.remove('eliminated');
            }
            
            // Check Answer (Make sure checkAnswer exists in your code!)
            if (typeof checkAnswer === "function") {
                checkAnswer(opt, btn, q);
            }
        };

        // Restore saved state (if reviewing)
        if (typeof testAnswers !== 'undefined' && testAnswers[q._uid] === opt) {
            btn.classList.add('selected');
        }

        optionsDiv.appendChild(btn);
    });

    block.appendChild(optionsDiv);
    return block;
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
            // 1. If Correct: Add to Solved
            if (!data.solved.includes(q._uid)) data.solved.push(q._uid);
            
            // --- THE FIX ---
            // Only remove from mistakes if we are specifically in "Mistake Practice Mode"
            if (isMistakeReview) {
                data.mistakes = data.mistakes.filter(id => id !== q._uid);
                console.log("✅ Fixed a mistake! Removed from list.");
            }
            // ----------------
            
        } else {
            // 2. If Wrong: ALWAYS Add to Mistakes (even if you solve it later in the same session)
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
        
        // Update Local Variables
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
/* --- AGGRESSIVE SCREEN SWITCHER --- */
/* --- SPECIFIC SCREEN SWITCHER --- */
function showScreen(screenId) {
    console.log("📺 Switching to:", screenId);

    // 1. Get the two main screens specifically
    const authScreen = document.getElementById('auth-screen');
    const dashScreen = document.getElementById('dashboard-screen');
    const quizScreen = document.getElementById('quiz-screen');
    const resultScreen = document.getElementById('result-screen');

    // 2. HARD RESET: Hide EVERYTHING first
    if(authScreen) authScreen.classList.add('hidden');
    if(authScreen) authScreen.classList.remove('active');
    
    if(dashScreen) dashScreen.classList.add('hidden');
    if(dashScreen) dashScreen.classList.remove('active');

    if(quizScreen) quizScreen.classList.add('hidden');
    if(quizScreen) quizScreen.classList.remove('active');
    
    if(resultScreen) resultScreen.classList.add('hidden');
    if(resultScreen) resultScreen.classList.remove('active');

    // 3. Show ONLY the target
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }
}

function goHome() {
    // 1. Stop the timer if running
    clearInterval(testTimer);
    
    // 2. Hide quiz elements
    document.getElementById('timer').classList.add('hidden');
    document.getElementById('test-sidebar').classList.remove('active');
    
    // 3. Switch to Dashboard
    showScreen('dashboard-screen');
    
    // 4. THE FIX: Reload Data immediately!
    console.log("🔄 Refreshing Dashboard Data...");
    loadUserData(); // <--- This updates your Stats, Streak, and Mistake Count
    
    // 5. Optional: Reset questions if you want fresh random ones next time
    // loadQuestions(); 
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
    
    container.innerHTML = "<p style='padding:20px; text-align:center;'>🔄 Fetching latest data...</p>";
    if(modal) modal.classList.remove('hidden');

    if (!currentUser) return;

    try {
        // FORCE SERVER FETCH
        const doc = await db.collection('users').doc(currentUser.uid).get({ source: 'server' });
        
        if (!doc.exists || !doc.data().stats) {
            container.innerHTML = "<p style='padding:20px;'>No data yet. Go solve some questions!</p>";
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
    // 1. Check if logged in
    if (!currentUser) {
        alert("❌ Error: You are not logged in.");
        return;
    }
    
    // 2. Get the text you wrote
    const reasonInput = document.getElementById('report-reason');
    const reason = reasonInput.value;
    
    if (!reason) {
        alert("❌ Error: Reason box is empty.");
        return;
    }
    
    // 3. Identify the current question
    let q = null;
    if (typeof filteredQuestions !== 'undefined' && filteredQuestions[currentIndex]) {
        q = filteredQuestions[currentIndex];
    }
    
    // 4. Send to Database
    try {
        await db.collection('reports').add({
            questionID: q ? q._uid : "unknown",
            questionText: q ? q.Question : "No Text Found",
            reportReason: reason,
            reportedBy: currentUser.email,
            timestamp: new Date()
        });

        // 5. Success Feedback
        alert("✅ Thank you! Report sent successfully.");
        
        // Clear the box and hide it
        reasonInput.value = ""; 
        document.getElementById('report-form').classList.add('hidden'); 

    } catch (error) {
        console.error(error);
        alert("❌ Error sending report: " + error.message);
    }
}

/* --- GLOBAL AUTH VARIABLES --- */
let isSignupMode = false;

/* --- 1. TOGGLE FUNCTION (SWITCH LOGIN <-> SIGNUP) --- */
window.toggleAuthMode = function() {
    console.log("Toggle clicked!"); // Debug check

    isSignupMode = !isSignupMode; // Flip the switch

    // Get all the elements we need to change
    const title = document.getElementById('auth-title');
    const sub = document.getElementById('auth-subtitle');
    const btnContainer = document.getElementById('auth-btn-container');
    const toggleText = document.getElementById('auth-toggle-text');
    const toggleLink = document.getElementById('auth-toggle-link');
    const msg = document.getElementById('auth-msg');

    // Reset error messages
    if(msg) msg.innerText = "";

    // Safety check: Do these elements actually exist?
    if (!title || !btnContainer || !toggleLink) {
        alert("Error: HTML elements are missing. Please check Step 2.");
        return;
    }

    if (isSignupMode) {
        // --- SHOW SIGNUP MODE ---
        title.innerText = "Create Account";
        sub.innerText = "Join FCPS Prep";
        
        // Green Button
        btnContainer.innerHTML = `<button class="primary" onclick="window.signup()" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);">✨ Sign Up</button>`;
        
        // Link Text
        toggleText.innerText = "Already have an ID?";
        toggleLink.innerText = "Log In here";
        
    } else {
        // --- SHOW LOGIN MODE ---
        title.innerText = "FCPS PREP";
        sub.innerText = "By Dr Shaggy";
        
        // Blue Button
        btnContainer.innerHTML = `<button class="primary" onclick="login()">Log In</button>`;
        
        // Link Text
        toggleText.innerText = "New here?";
        toggleLink.innerText = "Create New ID";
    }
};

/* --- 2. SIGNUP FUNCTION (CREATE THE USER) --- */
window.signup = function() {
    console.log("🚀 Signup started...");
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const msg = document.getElementById('auth-msg');

    if (!email || !password) {
        if(msg) msg.innerText = "⚠️ Please fill in all boxes.";
        return;
    }

    if(msg) msg.innerText = "⏳ Creating ID... Please wait.";

    auth.createUserWithEmailAndPassword(email, password)
        .then((cred) => {
            // Create Database Profile
            return db.collection('users').doc(cred.user.uid).set({
                email: email,
                role: 'student',
                joined: new Date(),
                bookmarks: [],
                solved: [],
                mistakes: [],
                stats: {}
            });
        })
        .then(() => {
            // --- THE FIX: MANUALLY HIDE THE PARENT CONTAINER ---
            const authScreen = document.getElementById('auth-screen');
            const dashScreen = document.getElementById('dashboard-screen');

            // 1. Hard Hide Auth
            if(authScreen) {
                authScreen.style.display = 'none';
                authScreen.classList.remove('active');
                authScreen.classList.add('hidden');
            }

            // 2. Hard Show Dashboard
            if(dashScreen) {
                dashScreen.style.display = 'block'; // or flex
                dashScreen.classList.remove('hidden');
                dashScreen.classList.add('active');
            }

            loadUserData();
            alert("🎉 Account Created!");
        })
        .catch((error) => {
            console.error("Signup Error:", error);
            if(msg) msg.innerText = "❌ Error: " + error.message;
        });
};

/* =========================================
   UPDATE DASHBOARD BADGE ICON
   ========================================= */
function updateBadgeButton() {
    // 1. Define Badges (Same as in your modal)
    const badges = [
        { limit: 10, icon: "👶" },
        { limit: 100, icon: "🥉" },
        { limit: 500, icon: "🥈" },
        { limit: 1000, icon: "🥇" },
        { limit: 2000, icon: "💎" },
        { limit: 5000, icon: "👑" }
    ];

    // 2. Find Highest Unlocked Badge
    const totalSolved = userSolvedIDs.length;
    let currentIcon = "🏆"; // Default if beginner

    badges.forEach(b => {
        if (totalSolved >= b.limit) {
            currentIcon = b.icon;
        }
    });

    // 3. Update the Button on Dashboard
    // We need to give the button an ID first (See Step 3 below)
    const btn = document.getElementById('main-badge-btn');
    if (btn) btn.innerText = currentIcon;
}

/* =========================================
   PRACTICE NAVIGATOR (Bottom Bar)
   ========================================= */
function renderPracticeNavigator() {
    const container = document.getElementById('practice-nav-container');
    if (!container) return;

    // Only show in Practice Mode
    if (currentMode !== 'practice') {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    container.innerHTML = "";

    filteredQuestions.forEach((q, idx) => {
        const btn = document.createElement('button');
        btn.className = "prac-nav-btn";
        btn.innerText = idx + 1;
        
        // Color Logic
        if (idx === currentIndex) {
            btn.classList.add('active'); // Blue (Current)
        } else if (userSolvedIDs.includes(q._uid)) {
            btn.classList.add('solved'); // Green (Done)
        } else if (userMistakes.includes(q._uid)) {
            btn.classList.add('wrong'); // Red (Mistake)
        }
        
        btn.onclick = () => {
            currentIndex = idx;
            renderPage();
            renderPracticeNavigator(); // Re-render to update the Blue active circle
        };
        
        container.appendChild(btn);
    });
    
    // Auto-scroll the bar to the current question
    // This ensures if you are on Q 50, the bar starts scrolled to 50.
    setTimeout(() => {
        const activeBtn = container.querySelector('.active');
        if (activeBtn) {
            activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center' });
        }
    }, 100);
}






