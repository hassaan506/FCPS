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
// 2. STATE
// ======================================================

let currentUser = null;
let allQuestions = [];
let filteredQuestions = [];
let userBookmarks = [];
let userSolvedIDs = [];

let currentMode = 'practice';
let currentIndex = 0; 
let testTimer = null;
let testAnswers = {}; // { q_uid: "A" }
let testTimeRemaining = 0;

// ======================================================
// 3. AUTH
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

async function loadUserData() {
    if (!currentUser) return;
    try {
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        if (userDoc.exists) {
            userBookmarks = userDoc.data().bookmarks || [];
            userSolvedIDs = userDoc.data().solved || [];
        }
        const resultsSnap = await db.collection('users').doc(currentUser.uid).collection('results').get();
        let totalTests = 0, totalScore = 0;
        resultsSnap.forEach(doc => { totalTests++; totalScore += doc.data().score; });
        const avgScore = totalTests > 0 ? Math.round(totalScore / totalTests) : 0;
        
        const statsBox = document.getElementById('stats-box');
        if(statsBox) {
            statsBox.innerHTML = `
                <h3>Your Progress</h3>
                <div class="stat-row"><span class="stat-lbl">Test Average:</span> <span class="stat-val" style="color:${avgScore>=70?'#2ecc71':'#e74c3c'}">${avgScore}%</span></div>
                <div class="stat-row"><span class="stat-lbl">Tests Taken:</span> <span class="stat-val">${totalTests}</span></div>
                <div class="stat-row" style="border:none;"><span class="stat-lbl">Practice Solved:</span> <span class="stat-val">${userSolvedIDs.length}</span></div>`;
        }
    } catch (e) { console.error(e); }
}

async function resetAccountData() {
    if(!currentUser) return;
    if (!confirm("⚠️ WARNING: This will delete ALL progress. Continue?")) return;
    try {
        const resultsRef = db.collection('users').doc(currentUser.uid).collection('results');
        const snapshot = await resultsRef.get();
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        await db.collection('users').doc(currentUser.uid).delete();
        window.location.reload();
    } catch (e) { alert(e.message); }
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
    let uniqueCounter = 0; 

    data.forEach(row => {
        if (!row.Question) return;
        const sig = row.Question.trim().toLowerCase();
        if (seen.has(sig)) return;
        seen.add(sig);

        row._uid = "q_" + uniqueCounter++; 
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
    testTimeRemaining = mins * 60;
    
    showScreen('quiz-screen');
    document.getElementById('timer').classList.remove('hidden');
    
    // Show Sidebar
    document.getElementById('test-sidebar').classList.add('active');
    renderNavigator();

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

// --- RENDERING ---

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
        document.getElementById('test-sidebar').classList.remove('active'); // Hide sidebar in practice
        submitBtn.classList.add('hidden');
        nextBtn.classList.add('hidden'); 
        container.appendChild(createQuestionCard(filteredQuestions[currentIndex], currentIndex, false));
    } else {
        // Test Mode
        document.getElementById('timer').classList.remove('hidden');
        nextBtn.classList.remove('hidden');
        submitBtn.classList.add('hidden');

        // Logic for 5 per page
        const start = currentIndex; // currentIndex tracks the START of the current page in Test Mode?
        // Wait, if we jump to Q17, currentIndex should probably align to page start (15).
        // Let's ensure currentIndex is always a multiple of 5 if we are rendering a page.
        // Actually, let's keep currentIndex as the "First Question of the Page".
        
        const end = Math.min(start + 5, filteredQuestions.length);
        
        for (let i = start; i < end; i++) {
            container.appendChild(createQuestionCard(filteredQuestions[i], i, true));
        }

        if (end === filteredQuestions.length) {
            nextBtn.classList.add('hidden');
            submitBtn.classList.remove('hidden');
        }
        
        renderNavigator(); // Update highlights
    }
}

function createQuestionCard(q, index, isTest) {
    const card = document.createElement('div');
    card.className = "test-question-block"; 
    card.id = `q-card-${index}`; // Add ID for scrolling

    let headerHTML = "";
    
    // CLEAN EXAM MODE: If Test, NO Subject/Topic
    if (!isTest) {
        const isSaved = userBookmarks.includes(q.ID);
        headerHTML = `<div style="font-size:0.85em; color:#999; margin-bottom:10px; text-transform:uppercase; letter-spacing:1px;">${q.Subject} • ${q.Topic} 
        <span onclick="toggleBookmark('${q.ID}', this)" class="bookmark-icon" style="color:${isSaved ? '#ffc107' : '#e2e8f0'}">${isSaved ? '★' : '☆'}</span></div>`;
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

// --- NAVIGATOR SIDEBAR GENERATOR ---
function renderNavigator() {
    if(currentMode !== 'test') return;
    
    const navGrid = document.getElementById('nav-grid');
    navGrid.innerHTML = "";
    
    // Determine current page range (e.g., 0-4, 5-9)
    const pageStart = currentIndex; 
    const pageEnd = Math.min(currentIndex + 5, filteredQuestions.length);

    filteredQuestions.forEach((q, idx) => {
        const btn = document.createElement('div');
        btn.className = "nav-btn";
        btn.innerText = idx + 1;
        
        // Is it answered?
        if (testAnswers[q._uid]) btn.classList.add('answered');
        
        // Is it on the current page?
        if (idx >= pageStart && idx < pageEnd) btn.classList.add('current');
        
        // Click to Jump
        btn.onclick = () => jumpToQuestion(idx);
        
        navGrid.appendChild(btn);
    });
}

function jumpToQuestion(targetIndex) {
    // 1. Calculate which page this question belongs to
    // e.g. Target 17 (index 16). 16 / 5 = 3.2 -> Floor 3. 3 * 5 = 15. Page starts at 15.
    const newPageStart = Math.floor(targetIndex / 5) * 5;
    
    // 2. Set index and render
    currentIndex = newPageStart;
    renderPage();
    
    // 3. Scroll to specific question
    setTimeout(() => {
        const el = document.getElementById(`q-card-${targetIndex}`);
        if(el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100); // Small delay to allow DOM to build
}

function handleClick(index, opt) {
    const q = filteredQuestions[index];
    if (currentMode === 'test') {
        testAnswers[q._uid] = opt; 
        const container = document.getElementById(`opts-${index}`);
        container.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        document.getElementById(`btn-${index}-${opt}`).classList.add('selected');
        renderNavigator();
    } else {
        const correct = getCorrectLetter(q);
        const btn = document.getElementById(`btn-${index}-${opt}`);
        
        if (opt === correct) {
            btn.classList.add('correct');
            const container = document.getElementById(`opts-${index}`);
            container.querySelectorAll('.option-btn').forEach(b => b.disabled = true);

            if (currentIndex < filteredQuestions.length - 1) document.getElementById('next-btn').classList.remove('hidden');
            document.getElementById(`reopen-exp-${index}`).classList.remove('hidden');
            
            // Show Popup
            const modal = document.getElementById('explanation-modal');
            const content = document.getElementById('modal-content');
            content.innerHTML = q.Explanation || "No explanation provided.";
            modal.classList.remove('hidden');

            // --- ANALYTICS UPDATE START ---
            if (currentUser) {
                // 1. Mark as Solved
                if (!userSolvedIDs.includes(q.ID)) {
                    userSolvedIDs.push(q.ID);
                    db.collection('users').doc(currentUser.uid).set({ solved: userSolvedIDs }, { merge: true });
                }
                
                // 2. Update Subject Stats (Increment Correct Count)
                const subj = q.Subject || "General";
                const statsRef = db.collection('users').doc(currentUser.uid);
                
                // We use a specific dot notation to update nested map fields in Firestore
                let updateData = {};
                updateData[`stats.${subj}.correct`] = firebase.firestore.FieldValue.increment(1);
                updateData[`stats.${subj}.total`] = firebase.firestore.FieldValue.increment(1);
                
                statsRef.set(updateData, { merge: true });
            }
            // --- ANALYTICS UPDATE END ---

        } else {
            btn.classList.add('wrong');
            
            // --- ANALYTICS UPDATE (WRONG) ---
            if (currentUser) {
                const subj = q.Subject || "General";
                const statsRef = db.collection('users').doc(currentUser.uid);
                let updateData = {};
                // Only increment total, not correct
                updateData[`stats.${subj}.total`] = firebase.firestore.FieldValue.increment(1);
                statsRef.set(updateData, { merge: true });
            }
            // -------------------------------
        }
    }
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
        const user = testAnswers[q._uid];
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
    document.getElementById('test-sidebar').classList.remove('active'); // Hide sidebar
    showScreen('dashboard-screen');
    loadQuestions();
}


// ==========================================
// DARK MODE LOGIC
// ==========================================

// 1. Check for saved preference on load
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
        // Switch to Light
        document.body.removeAttribute('data-theme');
        localStorage.setItem('fcps-theme', 'light');
        btn.innerText = '🌙';
    } else {
        // Switch to Dark
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('fcps-theme', 'dark');
        btn.innerText = '☀️';
    }
}


// ==========================================
// ANALYTICS SYSTEM
// ==========================================

async function openAnalytics() {
    const modal = document.getElementById('analytics-modal');
    const container = document.getElementById('analytics-content');
    container.innerHTML = "<p>Crunching numbers...</p>";
    modal.classList.remove('hidden');

    if (!currentUser) return;

    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (!doc.exists || !doc.data().stats) {
            container.innerHTML = "<p>No detailed data available yet. Start solving questions in Practice Mode!</p>";
            return;
        }

        const stats = doc.data().stats;
        let html = "";

        // Convert object to array and sort by weak performance
        const subjects = Object.keys(stats).map(key => {
            return { name: key, ...stats[key] };
        }).sort((a, b) => (a.correct / a.total) - (b.correct / b.total));

        subjects.forEach(subj => {
            const percent = Math.round((subj.correct / subj.total) * 100);
            let color = "#2ecc71"; // Green
            if (percent < 50) color = "#e74c3c"; // Red
            else if (percent < 75) color = "#f1c40f"; // Yellow

            html += `
                <div class="stat-item">
                    <div class="stat-header">
                        <span>${subj.name}</span>
                        <span>${percent}%</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${percent}%; background: ${color};"></div>
                    </div>
                    <div class="stat-meta">
                        ${subj.correct} correct out of ${subj.total} attempted
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

    } catch (e) {
        container.innerHTML = "Error loading stats: " + e.message;
    }
}
