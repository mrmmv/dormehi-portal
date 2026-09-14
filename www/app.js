const API_URL = '/api/student';
const LIS_SERVER_URL = ''; // Use relative path since portal serves uploads directly
let authToken = localStorage.getItem('studentToken');
let currentStudent = null;
let profileData = null;
let examTimer = null;
let currentExam = null;
let tabSwitchCount = 0;
let isExamInProgress = false;

// Helper to resolve media URLs to LIS server
function resolveMediaUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:') || path.startsWith('blob:')) {
        return path; // Already absolute or data URL
    }
    return `${LIS_SERVER_URL}${path}`; // Prepend LIS server URL
}

function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return unsafe
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatMathOption(text) {
    if (text === undefined || text === null) return '';
    let str = String(text);

    // If text already has HTML sub/sup or TeX delimiters \( ... \), return untouched
    if (str.includes('\\(') || str.includes('$$') || str.includes('<sub') || str.includes('<sup')) {
        return str;
    }

    const hasCaret = /\^/.test(str);
    const hasSqrt = /√|\\sqrt/.test(str);
    const hasSubscripts = /\b[a-zA-Z][0-9]\b|_/.test(str);

    if (hasCaret || hasSqrt || hasSubscripts) {
        let formatted = escapeHtml(str);

        // 1. Variable subscripts: x1 -> x<sub>1</sub>, y2 -> y<sub>2</sub>
        formatted = formatted.replace(/\b([a-zA-Z])([0-9]+)\b/g, '$1<sub>$2</sub>');

        // 2. Underscores: x_1 -> x<sub>1</sub>, y_2 -> y<sub>2</sub>
        formatted = formatted.replace(/([a-zA-Z])_([0-9a-zA-Z]+)/g, '$1<sub>$2</sub>');

        // 3. Caret exponents: ^2 -> <sup>2</sup>, ^(abc) -> <sup>abc</sup>
        formatted = formatted.replace(/\^\((.*?)\)/g, '<sup>$1</sup>');
        formatted = formatted.replace(/\^([0-9a-zA-Z+\-]+)/g, '<sup>$1</sup>');

        // 4. Square root radical symbol with overline
        formatted = formatted.replace(/√\s*\((.*?)\)/g, '&radic;<span style="border-top: 1.5px solid currentColor; padding-top: 1px; margin-left: 1px; padding-left: 2px;">($1)</span>');
        formatted = formatted.replace(/√\s*([a-zA-Z0-9_&#;<>/\s\+\-\*\.]+)/g, '&radic;<span style="border-top: 1.5px solid currentColor; padding-top: 1px; margin-left: 1px; padding-left: 2px;">$1</span>');

        return formatted;
    }

    return escapeHtml(str);
}

function formatMathText(str) {
    if (str === undefined || str === null) return '';
    let text = String(str);
    if (text.includes('\\(') || text.includes('$$')) return text;

    const hasCaret = /\^/.test(text);
    const hasSqrt = /√|\\sqrt/.test(text);
    const hasSubscripts = /\b[a-zA-Z][0-9]\b/.test(text);

    if (!hasCaret && !hasSqrt && !hasSubscripts) return text;

    let formatted = text;
    formatted = formatted.replace(/\b([a-zA-Z])([0-9]+)\b/g, '$1<sub>$2</sub>');
    formatted = formatted.replace(/([a-zA-Z])_([0-9a-zA-Z]+)/g, '$1<sub>$2</sub>');
    formatted = formatted.replace(/\^\((.*?)\)/g, '<sup>$1</sup>');
    formatted = formatted.replace(/\^([0-9a-zA-Z+\-]+)/g, '<sup>$1</sup>');
    formatted = formatted.replace(/√\s*\((.*?)\)/g, '&radic;<span style="border-top: 1.5px solid currentColor; padding-top: 1px; margin-left: 1px; padding-left: 2px;">($1)</span>');
    formatted = formatted.replace(/√\s*([a-zA-Z0-9_&#;<>/\s\+\-\*\.]+)/g, '&radic;<span style="border-top: 1.5px solid currentColor; padding-top: 1px; margin-left: 1px; padding-left: 2px;">$1</span>');
    return formatted;
}

function renderSafeQuestionHtml(html) {
    if (html === undefined || html === null) return '';
    const raw = html.toString();
    const hasHtml = /<[a-z/][^>]*>/i.test(raw);
    if (!hasHtml) {
        return formatMathText(escapeHtml(raw));
    }
    try {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = raw;
        const allowedTags = ['b', 'i', 'u', 'br', 'strong', 'em', 'span', 'p', 'pre', 'code', 'sub', 'sup', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'img', 'svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'figure', 'figcaption', 'math', 'mrow', 'mi', 'mn', 'mo', 'msup', 'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'blockquote', 'ol', 'ul', 'li'];
        function sanitize(node) {
            const children = Array.from(node.childNodes);
            children.forEach(child => {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    const tagName = child.tagName.toLowerCase();
                    if (allowedTags.includes(tagName)) {
                        sanitize(child);
                    } else {
                        const textNode = document.createTextNode(child.outerHTML);
                        node.replaceChild(textNode, child);
                    }
                }
            });
        }
        sanitize(tempDiv);
        return formatMathText(tempDiv.innerHTML);
    } catch (e) {
        console.error('Error parsing question HTML:', e);
        return formatMathText(escapeHtml(raw));
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (authToken) {
        loadProfile();
        showScreen('portalApp');
    } else {
        showScreen('loginScreen');
    }

    // Login Form
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const lrn = document.getElementById('lrn').value;
        const birthdate = document.getElementById('birthdate').value;
        const errorEl = document.getElementById('loginError');

        try {
            const response = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lrn, birthdate })
            });

            const data = await response.json();
            if (response.ok) {
                localStorage.setItem('studentToken', data.token);
                authToken = data.token;
                currentStudent = data.student;
                await loadProfile();
                showScreen('portalApp');
            } else {
                errorEl.textContent = data.error || 'Login failed';
            }
        } catch (error) {
            errorEl.textContent = 'Server error. Please try again.';
        }
    });

    // Mobile Menu Toggle
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            sidebarOverlay.classList.toggle('active');
        });

        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });
    }

    // Swipe Gestures for Mobile Sidebar
    let touchStartX = 0;
    let touchEndX = 0;

    document.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    });

    document.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });

    function handleSwipe() {
        const swipeThreshold = 50;
        const diff = touchEndX - touchStartX;

        // Swipe right to open (from left edge)
        if (diff > swipeThreshold && touchStartX < 50) {
            sidebar.classList.add('open');
            sidebarOverlay.classList.add('active');
        }

        // Swipe left to close (when sidebar is open)
        if (diff < -swipeThreshold && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        }
    }

    // Tab monitoring for anti-cheat
    window.addEventListener('blur', () => {
        if (isExamInProgress) {
            // Allow interacting with embedded video iframes
            if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
                return;
            }
            triggerSpecificViolation('TAB_SWITCH', 'Learner switched tab or lost window focus');
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && isExamInProgress) {
            triggerSpecificViolation('TAB_SWITCH', 'Learner minimized or hid exam page');
        }
    });

    // Detect split-screen / window snapping / resizing
    let lastHeight = window.innerHeight;
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
        if (isExamInProgress) {
            const currentHeight = window.innerHeight;
            const currentWidth = window.innerWidth;
            const widthChanged = Math.abs(currentWidth - lastWidth) > 50;
            const heightChanged = Math.abs(currentHeight - lastHeight) > 150;
            const isInputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
            
            // Check if window width is significantly less than full screen width
            const isSplitScreen = window.innerWidth < screen.width * 0.85;

            if (isSplitScreen || widthChanged || (heightChanged && !isInputFocused)) {
                triggerSpecificViolation('SPLIT_SCREEN', 'Learner used split-screen mode or resized exam window');
            }
            lastHeight = currentHeight;
            lastWidth = currentWidth;
        } else {
            lastHeight = window.innerHeight;
            lastWidth = window.innerWidth;
        }
    });

    // Intercept refresh keys (F5, Ctrl+R, Alt+Left)
    window.addEventListener('keydown', (e) => {
        if (isExamInProgress) {
            const isF5 = e.key === 'F5' || e.keyCode === 116;
            const isCtrlR = (e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R' || e.keyCode === 82);
            const isAltLeft = e.altKey && (e.key === 'ArrowLeft' || e.keyCode === 37);

            if (isF5 || isCtrlR || isAltLeft) {
                e.preventDefault();
                e.stopPropagation();
                alert('⚠️ ACTION BLOCKED: Page refresh is strictly disabled during active examinations.');
                return false;
            }
        }
    });

    // Prevent page exit / reload
    window.addEventListener('beforeunload', (e) => {
        if (isExamInProgress) {
            e.preventDefault();
            e.returnValue = 'Warning: An exam is currently in progress. Refreshing will trigger security locking!';
            return e.returnValue;
        }
    });

    // Fullscreen Exit Monitor
    const onFullscreenChange = () => {
        if (isExamInProgress && !document.fullscreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
            triggerSpecificViolation('FULLSCREEN_EXIT', 'Learner exited full screen mode');
        }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
});

async function apiRequest(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(`${API_URL}${endpoint}`, options);
        if (response.status === 401) {
            logout();
            return null;
        }
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch(e) {
            console.warn(`Non-JSON response from ${endpoint} (Status ${response.status}):`, text.substring(0, 100));
            return { error: `Server endpoint error (${response.status})`, status: response.status };
        }
    } catch(err) {
        console.error(`API request network error on ${endpoint}:`, err);
        return { error: 'Network request failed' };
    }
}

// Submission Logic
document.addEventListener('DOMContentLoaded', () => {
    const subForm = document.getElementById('submissionForm');
    if (subForm) {
        subForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = subForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
            btn.disabled = true;

            try {
                const formData = new FormData(subForm);
                // Manual append activity_id if needed, but FormData usually grabs it from hidden input

                const response = await fetch('/api/lms/submit', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${authToken}` }, // No Content-Type for FormData
                    body: formData
                });

                const result = await response.json();
                if (response.ok) {
                    alert('Submission successful!');
                    document.getElementById('submissionModal').style.display = 'none';
                    subForm.reset();
                    loadStudentModular(); // Reload list
                } else {
                    alert(result.error || 'Submission failed');
                }
            } catch (error) {
                console.error(error);
                alert('Error submitting work.');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }
});

window.openSubmissionModal = (id) => {
    document.getElementById('sub_activity_id').value = id;
    document.getElementById('submissionModal').style.display = 'block';
};

async function loadProfile() {
    const profile = await apiRequest('/profile');
    if (!profile) return;
    profileData = profile;
    currentStudent = profile; // Ensure currentStudent is available globally after refresh

    // Fix Section Property Case (Sequelize might return 'section' or 'Section')
    const sectionObj = profile.Section || profile.section;
    const ayObj = profile.academic_year || profile.AcademicYear;

    // Update Sidebar
    document.getElementById('studentName').textContent = `${profile.first_name} ${profile.last_name}`;
    document.getElementById('studentLrn').textContent = `LRN: ${profile.lrn}`;

    // Update Dashboard Header
    document.getElementById('welcomeName').textContent = profile.first_name;
    document.getElementById('currentSection').textContent = `${sectionObj?.section_name || 'No Section'}`;
    document.getElementById('currentSY').textContent = `SY ${ayObj?.year || '---'}`;

    // Update Profile Section
    document.getElementById('profileFullName').textContent = `${profile.first_name} ${profile.middle_name || ''} ${profile.last_name}`;
    document.getElementById('profileLrn').textContent = `LRN: ${profile.lrn}`;
    document.getElementById('profileSectionName').textContent = sectionObj?.section_name || 'N/A';
    document.getElementById('profileGradeLevel').textContent = `Grade ${profile.grade_level}`;
    document.getElementById('p_birthdate').textContent = profile.birthdate;
    document.getElementById('p_email').textContent = profile.email || 'None';
    document.getElementById('p_mobile').textContent = profile.mobile || 'None';
    document.getElementById('p_address').textContent = profile.address || 'None';
    document.getElementById('p_father').textContent = profile.father_name || 'None';
    document.getElementById('p_mother').textContent = profile.mother_name || 'None';
    document.getElementById('p_p_contact').textContent = profile.guardian_mobile || profile.mother_mobile || profile.father_mobile || 'None';

    loadDashboardData();
    checkEnrollmentStatus();
    
    // Show Aral Tutor Menu if tagged
    const aralMenu = document.getElementById('aralTutorMenu');
    if (aralMenu) {
        if (profile.is_aral) {
            aralMenu.style.display = 'flex';
        } else {
            aralMenu.style.display = 'none';
        }
    }

    const photoSrc = profile.photo_url ? resolveMediaUrl(profile.photo_url) : null;
    const sidebarAvatar = document.querySelector('.student-avatar');
    const profileAvatar = document.querySelector('.profile-avatar');
    if (photoSrc) {
        const imgHtml = `<img src="${photoSrc}" alt="Profile Photo" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
        if (sidebarAvatar) sidebarAvatar.innerHTML = imgHtml;
        if (profileAvatar) profileAvatar.innerHTML = imgHtml;
    }
}

async function loadDashboardData() {
    const [gradesData, attendance] = await Promise.all([
        apiRequest('/grades'),
        apiRequest('/attendance')
    ]);

    const grades = Array.isArray(gradesData) ? gradesData : (gradesData?.grades || []);
    const releases = Array.isArray(gradesData) ? [] : (gradesData?.releases || []);

    renderRecentGrades(grades);
    renderAttendance(attendance);
    calculateStats(grades, attendance);
    renderFullGrades(grades, releases);
}

function renderRecentGrades(grades) {
    const tbody = document.querySelector('#recentGradesTable tbody');
    if (!grades || !Array.isArray(grades) || grades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No grades released yet.</td></tr>';
        return;
    }

    tbody.innerHTML = grades.slice(0, 5).map(g => `
        <tr>
            <td>${g.subject}</td>
            <td>${g.quarters[1] || '--'}</td>
            <td>${g.quarters[2] || '--'}</td>
            <td>${g.quarters[3] || '--'}</td>
            <td><span class="status-badge ${getStatusClass(g.quarters[1] || g.quarters[2] || g.quarters[3])}">${(g.quarters[1] || g.quarters[2] || g.quarters[3]) >= 75 ? 'Passed' : '---'}</span></td>
        </tr>
    `).join('');
}

function renderFullGrades(grades, releases) {
    const tbody = document.querySelector('#fullGradesTable tbody');
    if (!Array.isArray(grades) || grades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">No grades available.</td></tr>';
    } else {
        tbody.innerHTML = grades.map(g => {
            const q1 = parseFloat(g.quarters[1]) || 0;
            const q2 = parseFloat(g.quarters[2]) || 0;
            const q3 = parseFloat(g.quarters[3]) || 0;
            const manualFinal = g.quarters[5];

            let final = manualFinal;
            if (!final && q1 && q2 && q3) {
                final = (q1 + q2 + q3) / 3;
            }

            return `
                <tr>
                    <td><strong>${g.subject}</strong><br><small>${g.code}</small></td>
                    <td>${g.quarters[1] || '--'}</td>
                    <td>${g.quarters[2] || '--'}</td>
                    <td>${g.quarters[3] || '--'}</td>
                    <td style="font-weight: bold; color: var(--primary)">${final ? parseFloat(final).toFixed(2) : '--'}</td>
                    <td><span class="${final >= 75 ? 'text-success' : 'text-danger'}">${final ? (final >= 75 ? 'Passed' : 'Failed') : '--'}</span></td>
                </tr>
            `;
        }).join('');
    }

    if (releases && document.getElementById('gradesSignatureSection')) {
        updateGradesSignatureSection(releases, grades);
    }
}

function generateConstructiveRemarks(gradesList, termNum, student = {}) {
    if (!Array.isArray(gradesList) || gradesList.length === 0) {
        return "Magpakita ng patuloy na sipag sa lahat ng asignatura.";
    }

    const validScores = [];
    gradesList.forEach(g => {
        const val = g.quarters ? g.quarters[termNum] : null;
        if (val !== undefined && val !== null && val !== '') {
            const num = parseFloat(val);
            if (!isNaN(num) && num > 0) {
                validScores.push({ name: g.subject, score: num });
            }
        }
    });

    if (validScores.length === 0) {
        return "Magpakita ng patuloy na sipag sa lahat ng asignatura.";
    }

    validScores.sort((a, b) => b.score - a.score);
    const highest = validScores[0];
    const lowest = validScores[validScores.length - 1];

    let seed = (parseInt(student.id || 1, 10) * 17) + (termNum * 31);
    if (student.first_name) {
        for (let i = 0; i < student.first_name.length; i++) seed += student.first_name.charCodeAt(i);
    }
    const pick = (arr) => arr[seed % arr.length];

    const highPhrases = [
        `natatangi ang husay at dedikasyon sa ${highest.name}`,
        `mahusay ang pagganap at partisipasyon sa ${highest.name}`,
        `nagpakita ng mataas na antas ng pag-unawa sa ${highest.name}`,
        `kahanga-hanga ang ipinakitang lakas at kakayahan sa ${highest.name}`
    ];

    const lowPhrasesNeedHelp = [
        `nangangailangan ng karagdagang pagsasanay at gabay sa ${lowest.name}`,
        `maglaan ng karagdagang oras sa pag-aaral ng ${lowest.name}`,
        `sikaping bigyang-pansin ang mga aralin sa ${lowest.name}`,
        `pagtuunan ng mas matinding sipag ang ${lowest.name}`
    ];

    const lowPhrasesGood = [
        `ipagpatuloy ang pagsisikap sa ${lowest.name}`,
        `patuloy na pag-ibayuhin ang pag-aaral sa ${lowest.name}`,
        `sikaping paunlarin pa ang kakayahan sa ${lowest.name}`
    ];

    const constructiveClosings = [
        "Ipagpatuloy ang magandang pagsisikap at huwag sumuko!",
        "Patuloy na magsumikap; malayo ang iyong mararating sa iyong dedikasyon!",
        "Panatilihin ang sipag sa pag-aaral at magtiwala sa sariling kakayahan!",
        "Ipagmalaki ang iyong pag-unlad at patuloy na magsikap!",
        "Magtiwala sa sariling kakayahan at magtanong sa guro kapag may hindi nauunawaan."
    ];

    const highText = pick(highPhrases);
    const closing = pick(constructiveClosings);
    const studentPrefix = student.first_name ? `${student.first_name}, ` : '';

    if (highest.name === lowest.name || highest.score === lowest.score) {
        return `${studentPrefix}${highText}. Maganda ang pangkalahatang pagganap sa klase. ${closing}`;
    }

    const lowText = lowest.score < 75 ? pick(lowPhrasesNeedHelp) : pick(lowPhrasesGood);
    return `${studentPrefix}${highText}; subalit ${lowText}. ${closing}`;
}

let currentGradesQuarterToSign = null;
let gradesSignatureCanvas = null;
let gradesSignatureCtx = null;

function updateGradesSignatureSection(releases, grades = []) {
    const section = document.getElementById('gradesSignatureSection');
    if (!section || !releases || releases.length === 0) return;

    const released = releases.filter(r => r.is_released).sort((a, b) => b.quarter - a.quarter);
    if (released.length === 0) {
        section.style.display = 'none';
        return;
    }

    const latest = released[0];
    currentGradesQuarterToSign = latest.quarter;

    section.style.display = 'block';
    document.getElementById('signatureTermNumber').textContent = latest.quarter;

    const commentEl = document.getElementById('portalAdviserComment');
    if (commentEl) {
        if (latest.remark) {
            commentEl.textContent = latest.remark;
        } else {
            commentEl.textContent = generateConstructiveRemarks(grades, latest.quarter, currentStudent || profileData || {});
        }
    }

    const displayDiv = document.getElementById('gradesSignatureDisplay');
    const inputDiv = document.getElementById('gradesSignaturePadContainer');

    if (latest.has_signature) {
        displayDiv.style.display = 'block';
        inputDiv.style.display = 'none';

        const sigImg = document.getElementById('gradesSavedSignature');
        if (latest.signature) {
            sigImg.src = latest.signature;
            sigImg.style.display = 'block';
        } else {
            sigImg.style.display = 'none';
        }

        document.getElementById('gradesSignedDate').textContent = latest.signed_at
            ? new Date(latest.signed_at).toLocaleDateString()
            : 'N/A';
    } else {
        displayDiv.style.display = 'none';
        inputDiv.style.display = 'block';
        initGradesSignaturePad();
    }
}

function initGradesSignaturePad() {
    const canvas = document.getElementById('gradesSignCanvas');
    if (!canvas) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = (canvas.offsetWidth || 400) * ratio;
    canvas.height = (canvas.offsetHeight || 200) * ratio;
    canvas.getContext('2d').scale(ratio, ratio);

    gradesSignatureCanvas = canvas;
    gradesSignatureCtx = canvas.getContext('2d');
    gradesSignatureCtx.lineWidth = 2;
    gradesSignatureCtx.lineCap = 'round';
    gradesSignatureCtx.strokeStyle = '#000';

    let isDrawing = false;

    const getPos = (e) => {
        const rect = gradesSignatureCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    };

    const startDraw = (e) => {
        isDrawing = true;
        gradesSignatureCtx.beginPath();
        const { x, y } = getPos(e);
        gradesSignatureCtx.moveTo(x, y);
    };

    const draw = (e) => {
        if (!isDrawing) return;
        e.preventDefault();
        const { x, y } = getPos(e);
        gradesSignatureCtx.lineTo(x, y);
        gradesSignatureCtx.stroke();
    };

    const stopDraw = () => {
        isDrawing = false;
    };

    canvas.removeEventListener('mousedown', startDraw);
    canvas.removeEventListener('mousemove', draw);
    canvas.removeEventListener('mouseup', stopDraw);
    canvas.removeEventListener('mouseout', stopDraw);
    canvas.removeEventListener('touchstart', startDraw);
    canvas.removeEventListener('touchmove', draw);
    canvas.removeEventListener('touchend', stopDraw);

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseout', stopDraw);

    canvas.addEventListener('touchstart', startDraw);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', stopDraw);
}

function clearGradesSignature() {
    if (gradesSignatureCtx) {
        gradesSignatureCtx.clearRect(0, 0, gradesSignatureCanvas.width, gradesSignatureCanvas.height);
    }
}

async function saveGradesSignature() {
    if (!gradesSignatureCanvas || !currentGradesQuarterToSign) return;

    const signatureData = gradesSignatureCanvas.toDataURL('image/png');

    if (confirm('Are you sure you want to submit this signature? This cannot be undone.')) {
        try {
            const result = await apiRequest('/grades/signature', 'POST', {
                quarter: currentGradesQuarterToSign,
                signature: signatureData
            });

            if (result.success) {
                alert('Signature saved successfully!');
                loadDashboardData(); // Reload to show the signature
            } else {
                alert(result.error || 'Failed to save signature.');
            }
        } catch (e) {
            console.error(e);
            alert('Error saving signature.');
        }
    }
}


function renderAttendance(logs) {
    const timeline = document.getElementById('recentAttendance');
    const fullTable = document.querySelector('#fullAttendanceTable tbody');

    if (!Array.isArray(logs) || logs.length === 0) {
        timeline.innerHTML = '<div class="loading">No attendance records found.</div>';
        fullTable.innerHTML = '<tr><td colspan="4">No logs available.</td></tr>';
        return;
    }

    timeline.innerHTML = logs.slice(0, 5).map(log => `
        <div class="timeline-item">
            <div class="dot"></div>
            <div class="timeline-details">
                <p>${(log.status || 'SCANNED').toUpperCase()}</p>
                <span>${log.attendance_date} ${log.time_in || ''}</span>
            </div>
        </div>
    `).join('');

    fullTable.innerHTML = logs.map(log => `
        <tr>
            <td>${log.attendance_date}</td>
            <td>${log.time_in || '--:--'}</td>
            <td><span class="badge">${(log.status || 'PRESENT').toUpperCase()}</span></td>
            <td>${log.scanner_location || 'Main Gate'}</td>
        </tr>
    `).join('');
}

async function checkEnrollmentStatus() {
    const status = await apiRequest('/enrollment-status');
    const menu = document.getElementById('enrollmentMenu');
    const container = document.getElementById('enrollmentStatus');

    if (status?.enabled) {
        menu.style.display = 'flex';
        document.getElementById('nextGradeLevel').textContent = (profileData.grade_level || 0) + 1;
        document.getElementById('nextSY').textContent = status.targetSY || profileData.academic_year?.year || '---';
    } else if (status?.isAlreadyEnrolled) {
        menu.style.display = 'flex'; // Still show menu so they can see the status
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 20px; background: rgba(37, 99, 235, 0.1); border-radius: 12px; border: 1px solid var(--primary);">
                    <i class="fas fa-check-circle" style="font-size: 2.5rem; color: var(--primary); margin-bottom: 15px;"></i>
                    <h3 style="color: var(--primary); margin-bottom: 10px;">Enrollment Completed</h3>
                    <p style="font-weight: 600; color: #1e293b;">${status.message}</p>
                    <p style="font-size: 0.9rem; color: #64748b; margin-top: 10px;">Please contact the school registrar for further assistance.</p>
                </div>
            `;
        }
    } else {
        menu.style.display = 'none';
    }
}

// Exam Logic & Multi-Level Folder System
let studentExamsData = [];
let examFolderState = {
    term: null,      // null, '1', '2', '3'
    category: null,  // null, 'Summative 1', 'Summative 2', 'Term Examinations', 'Quizzes & Assessments'
    subject: null    // null, e.g. 'ROBOTICS'
};

function determineExamCategory(exam) {
    const title = (exam.title || '').toLowerCase();
    const type = (exam.type || '').toLowerCase();

    if (title.includes('summative 1') || title.includes('summative assessment 1') || title.includes('summative test 1') || title.includes('summative-1') || title.includes('summative_1')) return 'Summative 1';
    if (title.includes('summative 2') || title.includes('summative assessment 2') || title.includes('summative test 2') || title.includes('summative-2') || title.includes('summative_2')) return 'Summative 2';
    if (title.includes('summative 3') || title.includes('summative assessment 3') || title.includes('summative test 3') || title.includes('summative-3') || title.includes('summative_3')) return 'Summative 3';
    
    if (type === 'periodical' || title.includes('periodical') || title.includes('term exam') || title.includes('quarterly exam') || title.includes('quarter exam')) return 'Term Examinations';
    
    if (title.includes('summative')) return 'Summative Examinations';
    
    return 'Quizzes & Assessments';
}

function onExamTermFilterChange(selectedTerm) {
    examFolderState.term = selectedTerm ? String(selectedTerm) : null;
    examFolderState.category = null;
    examFolderState.subject = null;
    renderStudentExamsFolders();
}

function examFolderGoBack() {
    if (examFolderState.subject !== null) {
        examFolderState.subject = null;
    } else if (examFolderState.category !== null) {
        examFolderState.category = null;
    } else if (examFolderState.term !== null) {
        examFolderState.term = null;
        const termSelect = document.getElementById('examTermFilter');
        if (termSelect) termSelect.value = '';
    }
    renderStudentExamsFolders();
}

function selectExamTermFolder(term) {
    examFolderState.term = String(term);
    examFolderState.category = null;
    examFolderState.subject = null;
    const termSelect = document.getElementById('examTermFilter');
    if (termSelect) termSelect.value = String(term);
    renderStudentExamsFolders();
}

function selectExamCategoryFolder(cat) {
    examFolderState.category = cat;
    examFolderState.subject = null;
    renderStudentExamsFolders();
}

function selectExamSubjectFolder(subj) {
    examFolderState.subject = subj;
    renderStudentExamsFolders();
}

function examResetFolders() {
    examFolderState = { term: null, category: null, subject: null };
    const termSelect = document.getElementById('examTermFilter');
    if (termSelect) termSelect.value = '';
    renderStudentExamsFolders();
}

let examUnlockPollInterval = null;

function startLockedExamAutoPolling() {
    stopLockedExamAutoPolling();

    if (!Array.isArray(studentExamsData) || studentExamsData.length === 0) return;

    const hasLocked = studentExamsData.some(exam =>
        exam.responses && exam.responses.some(r => r.status === 'locked' || r.status === 'on hold')
    );

    if (!hasLocked) return;

    examUnlockPollInterval = setInterval(async () => {
        if (isExamInProgress) {
            stopLockedExamAutoPolling();
            return;
        }

        try {
            const exams = await apiRequest('/exams');
            if (!exams || !Array.isArray(exams)) return;

            let unlockedDetected = false;
            exams.forEach(newExam => {
                const oldExam = (studentExamsData || []).find(e => e.id === newExam.id);
                const oldResp = oldExam && oldExam.responses && oldExam.responses[0] ? oldExam.responses[0] : null;
                const newResp = newExam && newExam.responses && newExam.responses[0] ? newExam.responses[0] : null;

                if (oldResp && (oldResp.status === 'locked' || oldResp.status === 'on hold')) {
                    if (!newResp || newResp.status === 'ongoing' || newResp.status === 'active') {
                        unlockedDetected = true;
                    }
                }
            });

            studentExamsData = exams;

            if (unlockedDetected) {
                stopLockedExamAutoPolling();
                renderStudentExamsFolders();
                showExamNoticeModal(
                    '🎉 Exam Session Unlocked!',
                    'Your Subject Teacher has unblocked your exam session. You can now click "Continue Examination" to resume taking your exam.',
                    null
                );
            }
        } catch(err) {
            console.warn('Auto-poll check error:', err);
        }
    }, 3000);
}

function stopLockedExamAutoPolling() {
    if (examUnlockPollInterval) {
        clearInterval(examUnlockPollInterval);
        examUnlockPollInterval = null;
    }
}

async function checkExamUnlockStatus(examId, btn) {
    let originalHtml = '';
    if (btn) {
        originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
    }

    try {
        await loadExams();
        const updatedExam = (studentExamsData || []).find(e => String(e.id) === String(examId));
        const resp = updatedExam && updatedExam.responses && updatedExam.responses[0] ? updatedExam.responses[0] : null;

        if (!resp || resp.status === 'ongoing' || resp.status === 'active' || (resp.status !== 'locked' && resp.status !== 'on hold')) {
            showExamNoticeModal(
                '🎉 Exam Session Unlocked!',
                'Great news! Your exam session has been unlocked by your teacher. Click "Continue Examination" to resume.',
                null
            );
        } else {
            alert('ℹ️ Status: Exam is still locked. Please ask your Subject Teacher to click "Unlock" in their portal.');
        }
    } catch(e) {
        console.error('Check unlock error:', e);
        alert('Failed to check status. Please try again.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

async function loadExams() {
    let exams = null;
    if (navigator.onLine) {
        try {
            exams = await apiRequest('/exams');
        } catch (e) {
            console.warn('Network error loading exams, trying offline cache:', e);
        }
    }

    // Offline fallback: load cached exams from IndexedDB
    if (!exams || exams.length === 0) {
        if (window.offlineExamManager) {
            try {
                const db = await window.offlineExamManager.getDB();
                const cachedExams = await new Promise(resolve => {
                    const tx = db.transaction('exams', 'readonly');
                    const req = tx.objectStore('exams').getAll();
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => resolve([]);
                });
                if (cachedExams && cachedExams.length > 0) {
                    exams = cachedExams.map(ce => ({
                        id: ce.id,
                        title: ce.title,
                        quarter: ce.quarter || 1,
                        subject: { subject_name: ce.subject },
                        time_limit: ce.time_limit,
                        type: ce.type || 'periodical',
                        status: 'active',
                        responses: []
                    }));
                }
            } catch (err) {
                console.warn('Error reading offline cached exams:', err);
            }
        }
    }

    const container = document.getElementById('availableExams');

    if (!exams || exams.length === 0) {
        if (container) container.innerHTML = '<div class="glass" style="padding: 40px; text-align: center; width: 100%;"><h3>No active exams found for your grade level.</h3></div>';
        studentExamsData = [];
        stopLockedExamAutoPolling();
        return;
    }

    studentExamsData = exams;
    renderStudentExamsFolders();
    if (navigator.onLine) startLockedExamAutoPolling();
}

function renderStudentExamsFolders() {
    const container = document.getElementById('availableExams');
    const backBtn = document.getElementById('examFolderBackBtn');
    const breadcrumb = document.getElementById('examFolderBreadcrumb');

    if (!container) return;

    // 1. Update Back Button visibility
    const isFiltered = (examFolderState.term !== null || examFolderState.category !== null || examFolderState.subject !== null);
    if (backBtn) backBtn.style.display = isFiltered ? 'inline-flex' : 'none';

    // 2. Build Breadcrumb
    let breadcrumbHtml = `<span onclick="examResetFolders()" style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px;"><i class="fas fa-folder-open" style="color: #3b82f6;"></i> All Terms</span>`;
    
    if (examFolderState.term !== null) {
        breadcrumbHtml += ` <i class="fas fa-chevron-right" style="font-size:0.75rem; color:#94a3b8;"></i> <span onclick="selectExamTermFolder('${examFolderState.term}')" style="cursor: pointer; color: #2563eb;">Term ${examFolderState.term}</span>`;
    }
    if (examFolderState.category !== null) {
        breadcrumbHtml += ` <i class="fas fa-chevron-right" style="font-size:0.75rem; color:#94a3b8;"></i> <span onclick="selectExamCategoryFolder('${examFolderState.category}')" style="cursor: pointer; color: #d97706;">${examFolderState.category}</span>`;
    }
    if (examFolderState.subject !== null) {
        breadcrumbHtml += ` <i class="fas fa-chevron-right" style="font-size:0.75rem; color:#94a3b8;"></i> <span style="color: #059669;">${examFolderState.subject}</span>`;
    }
    if (breadcrumb) breadcrumb.innerHTML = breadcrumbHtml;

    // 3. Filter Exams
    let filteredExams = studentExamsData.filter(exam => {
        const examTerm = String(exam.quarter || 1);
        if (examFolderState.term !== null && examTerm !== String(examFolderState.term)) return false;
        
        const cat = determineExamCategory(exam);
        if (examFolderState.category !== null && cat !== examFolderState.category) return false;
        
        const subjName = exam.subject ? exam.subject.subject_name : 'General';
        if (examFolderState.subject !== null && subjName !== examFolderState.subject) return false;

        return true;
    });

    // 4. LEVEL 1: Root View (No Term Selected)
    if (examFolderState.term === null) {
        const terms = ['1', '2', '3'];
        let html = '';
        
        terms.forEach(t => {
            const termExams = studentExamsData.filter(e => String(e.quarter || 1) === t);
            const submittedCount = termExams.filter(e => e.responses && e.responses.length > 0 && e.responses[0].status === 'submitted').length;

            html += `
                <div class="glass" onclick="selectExamTermFolder('${t}')" style="padding: 25px; border-radius: 16px; cursor: pointer; transition: all 0.25s ease; border: 1px solid rgba(59, 130, 246, 0.2); background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(239, 246, 255, 0.9)); position: relative; overflow: hidden;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 10px 25px rgba(59, 130, 246, 0.2)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                        <div style="width: 55px; height: 55px; border-radius: 14px; background: rgba(59, 130, 246, 0.12); display: flex; align-items: center; justify-content: center; color: #2563eb; font-size: 1.8rem;">
                            <i class="fas fa-folder"></i>
                        </div>
                        <span class="badge" style="background: #2563eb; color: white; padding: 5px 12px; border-radius: 20px; font-size: 0.85rem;">Term ${t}</span>
                    </div>
                    <h3 style="font-size: 1.3rem; margin-bottom: 6px; color: #1e293b; font-weight: 700;">Term ${t} Examinations</h3>
                    <p style="color: #64748b; font-size: 0.9rem; margin-bottom: 15px;">Includes Summative Tests and Term Examinations</p>
                    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 0.85rem; color: #475569; font-weight: 600;">
                        <span><i class="fas fa-file-signature text-primary"></i> ${termExams.length} Exams Total</span>
                        <span style="color: #059669;"><i class="fas fa-check-circle"></i> ${submittedCount} Completed</span>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        return;
    }

    // 5. LEVEL 2: Term Selected, No Category Selected
    if (examFolderState.category === null) {
        const categoryMap = {
            'Summative 1': [],
            'Summative 2': [],
            'Term Examinations': [],
            'Quizzes & Assessments': []
        };

        filteredExams.forEach(e => {
            const cat = determineExamCategory(e);
            if (!categoryMap[cat]) categoryMap[cat] = [];
            categoryMap[cat].push(e);
        });

        const availableCategories = Object.keys(categoryMap).filter(cat => categoryMap[cat].length > 0);
        
        if (availableCategories.length === 0) {
            container.innerHTML = `<div class="glass" style="padding: 40px; text-align: center; width: 100%;"><h3>No exams found under Term ${examFolderState.term}.</h3></div>`;
            return;
        }

        let html = '';
        const catIcons = {
            'Summative 1': { icon: 'fa-list-check', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
            'Summative 2': { icon: 'fa-tasks', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.12)' },
            'Summative 3': { icon: 'fa-clipboard-check', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)' },
            'Term Examinations': { icon: 'fa-graduation-cap', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)' },
            'Quizzes & Assessments': { icon: 'fa-pen-to-square', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' }
        };

        availableCategories.forEach(cat => {
            const items = categoryMap[cat];
            const info = catIcons[cat] || { icon: 'fa-folder-open', color: '#6366f1', bg: 'rgba(99, 102, 241, 0.12)' };
            const submittedCount = items.filter(e => e.responses && e.responses.length > 0 && e.responses[0].status === 'submitted').length;

            html += `
                <div class="glass" onclick="selectExamCategoryFolder('${cat}')" style="padding: 25px; border-radius: 16px; cursor: pointer; transition: all 0.25s ease; border: 1px solid ${info.color}33; background: white; position: relative;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 10px 25px ${info.color}33';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                        <div style="width: 55px; height: 55px; border-radius: 14px; background: ${info.bg}; display: flex; align-items: center; justify-content: center; color: ${info.color}; font-size: 1.8rem;">
                            <i class="fas ${info.icon}"></i>
                        </div>
                        <span class="badge" style="background: ${info.color}; color: white; padding: 4px 10px; border-radius: 20px; font-size: 0.8rem;">Folder</span>
                    </div>
                    <h3 style="font-size: 1.25rem; margin-bottom: 6px; color: #1e293b; font-weight: 700;">${cat}</h3>
                    <p style="color: #64748b; font-size: 0.85rem; margin-bottom: 15px;">Category folder for Term ${examFolderState.term}</p>
                    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f1f5f9; padding-top: 12px; font-size: 0.85rem; color: #475569; font-weight: 600;">
                        <span><i class="fas fa-file-lines" style="color: ${info.color};"></i> ${items.length} ${items.length === 1 ? 'Exam' : 'Exams'}</span>
                        <span style="color: #059669;"><i class="fas fa-check-double"></i> ${submittedCount} Done</span>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        return;
    }

    // 6. LEVEL 3: Category Selected, No Subject Selected
    if (examFolderState.subject === null) {
        const subjectMap = {};
        filteredExams.forEach(e => {
            const subjName = e.subject ? e.subject.subject_name : 'General';
            if (!subjectMap[subjName]) subjectMap[subjName] = [];
            subjectMap[subjName].push(e);
        });

        const subjectNames = Object.keys(subjectMap);

        if (subjectNames.length === 0) {
            container.innerHTML = `<div class="glass" style="padding: 40px; text-align: center; width: 100%;"><h3>No examinations found in ${examFolderState.category}.</h3></div>`;
            return;
        }

        let html = '';
        subjectNames.forEach(subj => {
            const items = subjectMap[subj];
            const submittedCount = items.filter(e => e.responses && e.responses.length > 0 && e.responses[0].status === 'submitted').length;

            html += `
                <div class="glass" onclick="selectExamSubjectFolder('${subj}')" style="padding: 25px; border-radius: 16px; cursor: pointer; transition: all 0.25s ease; border: 1px solid #10b98133; background: white; position: relative;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 10px 25px rgba(16, 185, 129, 0.2)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                        <div style="width: 55px; height: 55px; border-radius: 14px; background: rgba(16, 185, 129, 0.12); display: flex; align-items: center; justify-content: center; color: #059669; font-size: 1.8rem;">
                            <i class="fas fa-book-bookmark"></i>
                        </div>
                        <span class="badge" style="background: #059669; color: white; padding: 4px 10px; border-radius: 20px; font-size: 0.8rem;">Subject</span>
                    </div>
                    <h3 style="font-size: 1.25rem; margin-bottom: 6px; color: #1e293b; font-weight: 700;">${subj}</h3>
                    <p style="color: #64748b; font-size: 0.85rem; margin-bottom: 15px;">${examFolderState.category} subject folder</p>
                    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f1f5f9; padding-top: 12px; font-size: 0.85rem; color: #475569; font-weight: 600;">
                        <span><i class="fas fa-layer-group text-primary"></i> ${items.length} ${items.length === 1 ? 'Exam' : 'Exams'}</span>
                        <span style="color: #059669;"><i class="fas fa-check-circle"></i> ${submittedCount} Submitted</span>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        return;
    }

    // 7. LEVEL 4: Subject Selected -> Render Individual Exam Cards
    if (filteredExams.length === 0) {
        container.innerHTML = `<div class="glass" style="padding: 40px; text-align: center; width: 100%;"><h3>No examinations found for this selection.</h3></div>`;
        return;
    }

    container.innerHTML = filteredExams.map(exam => {
        const hasTaken = exam.responses && exam.responses.length > 0;
        const response = hasTaken ? exam.responses[0] : null;
        const isRemedial = exam.type === 'periodical' && exam.title.toLowerCase().includes('remedial');

        return `
            <div class="glass" style="padding: 25px; border-radius: 15px; position: relative; ${isRemedial ? 'border: 2px solid #f59e0b;' : ''}">
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;">
                        <span class="badge" style="background: #2563eb; color: white;">Term ${exam.quarter || 1}</span>
                        ${isRemedial ? '<span class="badge" style="background: #f59e0b; color: white;">REMEDIAL</span>' : ''}
                    </div>
                    <h3 style="font-size: 1.3rem; margin-bottom: 4px;">${exam.title}</h3>
                    <p style="color: var(--secondary); font-weight: 600;">${exam.subject ? exam.subject.subject_name : 'General'}</p>
                </div>
                <div style="display: flex; gap: 20px; font-size: 0.9rem; margin-bottom: 25px; flex-wrap: wrap;">
                    <span><i class="far fa-clock"></i> ${exam.time_limit} mins</span>
                    <span><i class="far fa-file-alt"></i> Multiple Choice</span>
                    ${exam.scheduled_start ? `<span class="text-info"><i class="far fa-calendar-alt"></i> ${new Date(exam.scheduled_start).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' })}</span>` : ''}
                </div>
                ${hasTaken ? (() => {
                if (response.status === 'submitted') {
                    if (response.allow_remedial) {
                        return `
                            <div style="color: var(--success); font-weight: 600; margin-bottom: 10px;">
                                <i class="fas fa-check-circle"></i> Previous Score: ${response.score}
                            </div>
                            <button class="btn-warning" style="background-color: #f59e0b; color: white;" onclick="startExam('${exam.id}')">Take Remedial Exam</button>
                        `;
                    }
                    return `
                        <div style="color: var(--success); font-weight: 600;">
                            <i class="fas fa-check-circle"></i> Submitted (Score: ${response.score})
                        </div>
                    `;
                }
                if (response.status === 'locked' || response.status === 'on hold') {
                    return `
                        <div style="color: var(--danger); font-weight: 600; margin-bottom: 8px;">
                            <i class="fas fa-lock"></i> On Hold - Contact Subject Teacher
                        </div>
                        <button class="btn-sm btn-secondary" style="background: #2563eb; color: white; border: none; padding: 7px 14px; border-radius: 8px; font-weight: 600; font-size: 0.85rem; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;" onclick="checkExamUnlockStatus('${exam.id}', this)">
                            <i class="fas fa-sync-alt"></i> Check Unlock Status
                        </button>
                    `;
                }
                return `<button class="btn-primary" onclick="startExam('${exam.id}')">Continue Examination</button>`;
            })() : (() => {
                const isPeriodical = exam.type === 'periodical';
                const isActive = exam.status === 'active';

                if (!isActive) {
                    return `<button class="btn-primary" disabled style="opacity: 0.6; cursor: not-allowed;">Closed</button>`;
                }

                if (isPeriodical) {
                    if (!exam.scheduled_start || !exam.scheduled_end) {
                        return `<button class="btn-primary" disabled style="opacity: 0.6; cursor: not-allowed;">Waiting for Schedule</button>`;
                    }
                    const now = new Date();
                    const start = new Date(exam.scheduled_start);
                    const end = new Date(exam.scheduled_end);

                    if (now < start) {
                        return `<button class="btn-primary" disabled style="opacity: 0.6; cursor: not-allowed;">Starts: ${start.toLocaleTimeString()}</button>`;
                    }
                    if (now > end) {
                        return `<button class="btn-primary" disabled style="opacity: 0.6; cursor: not-allowed; background-color: #ef4444;">Expired</button>`;
                    }
                }

                return `
                    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                        <button class="btn-primary" onclick="startExam('${exam.id}')"><i class="fas fa-play"></i> Start Examination</button>
                        <button id="dl_btn_${exam.id}" class="btn-sm" style="background: #0284c7; color: white; border: none; padding: 10px 14px; border-radius: 8px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;" onclick="triggerDownloadExam('${exam.id}', this)">
                            <i class="fas fa-cloud-arrow-down"></i> Download for Offline
                        </button>
                    </div>
                `;
            })()}
            </div>
        `;
    }).join('');

    // Check downloaded exams asynchronously and show offline-ready badges
    if (window.offlineExamManager) {
        setTimeout(async () => {
            for (const exam of filteredExams) {
                const isDl = await window.offlineExamManager.isExamDownloaded(exam.id);
                if (isDl) {
                    const dlBtn = document.getElementById(`dl_btn_${exam.id}`);
                    if (dlBtn) {
                        dlBtn.style.background = '#059669';
                        dlBtn.innerHTML = '<i class="fas fa-check-circle"></i> Downloaded (Offline Ready)';
                        dlBtn.disabled = true;
                    }
                }
            }
        }, 100);
    }
}

async function triggerDownloadExam(examId, btn) {
    if (!navigator.onLine) {
        alert('You need an active internet connection to download this exam for offline taking.');
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Downloading...';
    }
    try {
        await window.offlineExamManager.downloadExamForOffline(examId, (pct, status) => {
            if (btn) btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${pct}%`;
        });
        alert('✅ Exam downloaded successfully!\nYou can now take this examination completely offline without internet.');
        renderStudentExamsFolders();
    } catch (e) {
        console.error('Download error:', e);
        alert('Failed to download exam: ' + (e.message || 'Network error'));
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-cloud-arrow-down"></i> Download for Offline';
        }
    }
}

async function startExam(id) {
    if (!confirm('🛡️ EXAM SECURITY NOTICE 🛡️\n\nThis examination is protected by Window Lockdown.\n\n• Automatic Full-Screen mode will be enabled.\n• Tab-switching will trigger security locks.\n\nPress OK to start your examination.')) return;

    let exam = null;
    // Check if exam is pre-downloaded offline
    if (window.offlineExamManager) {
        exam = await window.offlineExamManager.getDownloadedExam(id);
    }

    if (!exam) {
        if (!navigator.onLine) {
            alert('You are currently offline. Please connect to internet to download this exam first, or choose an already downloaded exam.');
            return;
        }
        exam = await apiRequest(`/exams/${id}/questions`);
    }

    if (!exam) return;

    if (exam.error) {
        alert(exam.error);
        showSection('exams');
        return;
    }

    // CAMERA FACE DETECTION DISABLED
    // Camera checks and stream acquisition have been disabled.
    const hasWebcam = false;
    const isExempt = true;
    let preStream = null;


    // 3. Force Fullscreen Mode AFTER camera permission is confirmed
    try {
        if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
            await document.documentElement.webkitRequestFullscreen();
        } else if (document.documentElement.msRequestFullscreen) {
            await document.documentElement.msRequestFullscreen();
        }
    } catch (e) {
        console.warn('Fullscreen entry notice:', e);
    }

    // Detect if exam is Mathematics related
    const subjStr = (exam.subject?.subject_name || exam.title || '').toLowerCase();
    const isMathExam = subjStr.includes('math') || subjStr.includes('alg') || subjStr.includes('geom') || subjStr.includes('trig') || subjStr.includes('calc') || subjStr.includes('stat') || subjStr.includes('numer');
    exam.isMathExam = isMathExam;

    currentExam = exam;
    isExamInProgress = true;
    tabSwitchCount = 0;

    // Activate Mobile Anti-Cheat & Background AI Detection Engine
    initMobileExamSecurity();

    // Expand layout: hide sidebar & top nav for clean full-screen exam focus
    applyExamLayout(true);

    document.getElementById('availableExams').style.display = 'none';
    document.getElementById('examInterface').style.display = 'block';
    document.getElementById('examTitleTitle').textContent = exam.title;
    document.getElementById('examSubjectTitle').textContent = exam.subject?.subject_name || 'General';

    // Show Math scratchpad & calculator tools based on subject & teacher configuration
    const scratchBtn = document.getElementById('mathScratchpadBtn');
    const calcBtn = document.getElementById('mathCalcBtn');

    // Scratchpad: Auto-enabled for Math exams, OR if explicitly enabled by subject teacher
    const showScratchpad = isMathExam || !!exam.allow_scratchpad;
    // Calculator: Enabled if teacher explicitly checked allow_calculator
    const showCalculator = !!exam.allow_calculator;

    if (scratchBtn) scratchBtn.style.display = showScratchpad ? 'inline-flex' : 'none';
    if (calcBtn) calcBtn.style.display = showCalculator ? 'inline-flex' : 'none';

    const questions = exam.exam_questions || exam.ExamQuestions || [];
    renderExamQuestions(questions);

    // Restore any previously auto-saved answers for this exam
    window._currentExamAnswers = {};
    if (window.offlineExamManager && exam) {
        window.offlineExamManager.getProgress(exam.id).then(saved => {
            if (saved && saved.answers) {
                window._currentExamAnswers = saved.answers;
                Object.keys(saved.answers).forEach(qId => {
                    selectOption(qId, saved.answers[qId]);
                });
            }
        });
    }

    startExamTimer(exam.time_limit);

    // 4. Camera Face Detection is DISABLED - skip webcam AI tracker
    // if (hasWebcam && preStream) {
    //     initExamWebcamAIWithStream(id, preStream);
    // } else if (isExempt) {
    //     showExemptionFloatingBadge();
    // }
}


let currentQuestionIndex = 0;

function renderExamQuestions(questions) {
    const container = document.getElementById('examQuestionsContainer');
    currentQuestionIndex = 0;
    if (!questions) questions = [];

    const getEmbedUrl = (url) => {
        if (!url) return '';
        try {
            let videoId = '';
            if (url.includes('youtube.com/watch')) {
                const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
                videoId = urlObj.searchParams.get('v');
            } else if (url.includes('youtu.be/')) {
                videoId = url.split('youtu.be/')[1].split('?')[0];
            }
            if (videoId) return `https://www.youtube.com/embed/${videoId}?modestbranding=1&rel=0`;
        } catch(e) {}
        
        if (url.includes('youtube.com/watch?v=')) {
            return url.replace('watch?v=', 'embed/').split('&')[0] + '?modestbranding=1&rel=0';
        }
        if (url.includes('youtu.be/')) {
            return url.replace('youtu.be/', 'youtube.com/embed/').split('?')[0] + '?modestbranding=1&rel=0';
        }
        return url;
    };

    const questionsHtml = questions.map((q, index) => `
        <div class="question-card glass" id="question_${q.id}" style="display: ${index === 0 ? 'block' : 'none'}; min-height: 300px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <span class="badge" style="font-size: 1rem;">Question ${index + 1} of ${questions.length}</span>
                <span class="text-muted" style="font-size: 0.9rem;">${currentExam.subject?.subject_name || 'General'}</span>
            </div>
            
            <div style="font-size: 1.3rem; margin: 10px 0 20px 0; font-weight: 500;">${renderSafeQuestionHtml(q.question_text)}</div>
            
            ${q.image ? `<div style="margin: 15px 0; text-align: center;"><img src="${resolveMediaUrl(q.image)}" style="max-width: 100%; max-height: 300px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);"></div>` : ''}
            
            ${q.audio ? `<div style="margin: 15px 0; background: #f0f9ff; padding: 15px; border-radius: 8px; border: 1px solid #bae6fd;"><div style="font-weight:bold; margin-bottom:5px; color:#0288d1;"><i class="fas fa-volume-up"></i> Audio Clip</div><audio controls src="${resolveMediaUrl(q.audio)}" style="width: 100%;"></audio></div>` : ''}
            
            ${q.video ? (q.video.startsWith('data:') || q.video.startsWith('blob:') ?
            `<div style="margin: 15px 0;"><div style="font-weight:bold; margin-bottom:5px; color:#d32f2f;"><i class="fas fa-video"></i> Video Reference</div><video controls src="${resolveMediaUrl(q.video)}" style="max-width: 100%; max-height: 300px; width: 100%; border-radius: 8px;"></video></div>` :
            `<div style="margin: 15px 0;"><div style="font-weight:bold; margin-bottom:5px; color:#d32f2f;"><i class="fas fa-video"></i> Video Reference</div><div class="video-responsive" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.2);"><iframe src="${getEmbedUrl(q.video)}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen></iframe></div></div>`)
            : ''}

            <div class="options-list" style="display: flex; flex-direction: column; gap: 12px; margin-top: 20px;">
                ${q.type === 'multiple_choice' || !q.type ? `
                    <label class="option-item" onclick="selectOption(${q.id}, 'A')" style="padding: 15px; border: 1px solid #e2e8f0; border-radius: 10px; cursor: pointer; transition: all 0.2s;">
                        <input type="radio" name="q_${q.id}" value="A" style="margin-right: 10px;">
                        <span class="option-label">A. ${formatMathOption(q.option_a)}</span>
                        ${q.option_a_image ? `<div style="margin-top: 8px;"><img src="${resolveMediaUrl(q.option_a_image)}" style="max-width: 100%; max-height: 150px; border-radius: 6px; border: 1px solid #e2e8f0;"></div>` : ''}
                    </label>
                    <label class="option-item" onclick="selectOption(${q.id}, 'B')" style="padding: 15px; border: 1px solid #e2e8f0; border-radius: 10px; cursor: pointer; transition: all 0.2s;">
                        <input type="radio" name="q_${q.id}" value="B" style="margin-right: 10px;">
                        <span class="option-label">B. ${formatMathOption(q.option_b)}</span>
                        ${q.option_b_image ? `<div style="margin-top: 8px;"><img src="${resolveMediaUrl(q.option_b_image)}" style="max-width: 100%; max-height: 150px; border-radius: 6px; border: 1px solid #e2e8f0;"></div>` : ''}
                    </label>
                    <label class="option-item" onclick="selectOption(${q.id}, 'C')" style="padding: 15px; border: 1px solid #e2e8f0; border-radius: 10px; cursor: pointer; transition: all 0.2s;">
                        <input type="radio" name="q_${q.id}" value="C" style="margin-right: 10px;">
                        <span class="option-label">C. ${formatMathOption(q.option_c)}</span>
                        ${q.option_c_image ? `<div style="margin-top: 8px;"><img src="${resolveMediaUrl(q.option_c_image)}" style="max-width: 100%; max-height: 150px; border-radius: 6px; border: 1px solid #e2e8f0;"></div>` : ''}
                    </label>
                    <label class="option-item" onclick="selectOption(${q.id}, 'D')" style="padding: 15px; border: 1px solid #e2e8f0; border-radius: 10px; cursor: pointer; transition: all 0.2s;">
                        <input type="radio" name="q_${q.id}" value="D" style="margin-right: 10px;">
                        <span class="option-label">D. ${formatMathOption(q.option_d)}</span>
                        ${q.option_d_image ? `<div style="margin-top: 8px;"><img src="${resolveMediaUrl(q.option_d_image)}" style="max-width: 100%; max-height: 150px; border-radius: 6px; border: 1px solid #e2e8f0;"></div>` : ''}
                    </label>
                ` : q.type === 'true_false' ? `
                    <label class="option-item" onclick="selectOption(${q.id}, 'TRUE')" style="padding: 15px; border: 1px solid #e2e8f0; border-radius: 10px; cursor: pointer; transition: all 0.2s;">
                        <input type="radio" name="q_${q.id}" value="TRUE" style="margin-right: 10px;">
                        <span class="option-label">TRUE</span>
                    </label>
                    <label class="option-item" onclick="selectOption(${q.id}, 'FALSE')" style="padding: 15px; border: 1px solid #e2e8f0; border-radius: 10px; cursor: pointer; transition: all 0.2s;">
                        <input type="radio" name="q_${q.id}" value="FALSE" style="margin-right: 10px;">
                        <span class="option-label">FALSE</span>
                    </label>
                ` : `
                    <div style="padding: 10px;">
                        <input type="text" class="form-control" name="q_${q.id}" placeholder="Type your answer here..." onchange="selectOption(${q.id}, this.value)" style="width: 100%; padding: 10px; border: 2px solid #e2e8f0; border-radius: 8px;">
                    </div>
                `}
            </div>
        </div>
    `).join('');

    // Navigation Buttons
    const navHtml = `
        <div class="exam-navigation" style="display: flex; justify-content: space-between; margin-top: 30px; gap: 15px;">
            <button id="prevBtn" class="btn-secondary" onclick="prevQuestion()" disabled style="width: 120px;">
                <i class="fas fa-arrow-left"></i> Previous
            </button>
            <div style="flex-grow: 1;"></div>
            <button id="nextBtn" class="btn-primary" onclick="nextQuestion()" style="width: 120px;">
                Next <i class="fas fa-arrow-right"></i>
            </button>
            <button id="submitExamBtn" class="btn-primary" onclick="submitExam()" style="display: none; width: 170px; margin-top: 0;">
                Submit Examination <i class="fas fa-paper-plane"></i>
            </button>
        </div>
    `;

    container.innerHTML = questionsHtml + navHtml;

    // Remove duplicate/phantom buttons
    setTimeout(() => {
        document.querySelectorAll('button').forEach(btn => {
            if (btn.textContent.toLowerCase().includes('submit examination') && btn.id !== 'submitExamBtn') {
                btn.style.display = 'none';
            }
        });
    }, 100);

    updateNavButtons(questions.length);
    updateReadingTextDisplay(0);

    if (window.MathJax) {
        MathJax.typesetPromise([container]).catch(function (err) {
            console.log('MathJax error: ', err.message);
        });
    }
}

function selectOption(questionId, option) {
    const container = document.getElementById(`question_${questionId}`);
    if (!container) return;
    container.querySelectorAll('.option-item').forEach(el => {
        el.classList.remove('selected');
        el.style.backgroundColor = '';
        el.style.borderColor = '#e2e8f0';
    });

    const selected = Array.from(container.querySelectorAll('.option-item')).find(el => {
        const text = el.innerText.trim();
        return text.startsWith(option + '.') || text === option;
    });
    if (selected) {
        selected.classList.add('selected');
        selected.style.backgroundColor = '#eff6ff'; // Light blue
        selected.style.borderColor = '#3b82f6'; // Blue border
    }

    const input = container.querySelector(`input[value="${option}"]`);
    if (input) input.checked = true;

    // Auto-save answer to offline storage
    if (window.offlineExamManager && currentExam) {
        if (!window._currentExamAnswers) window._currentExamAnswers = {};
        window._currentExamAnswers[questionId] = option;
        window.offlineExamManager.saveProgress(currentExam.id, {
            answers: window._currentExamAnswers
        }).catch(e => console.warn('Offline auto-save warning:', e));
    }
}

function nextQuestion() {
    const total = document.querySelectorAll('.question-card').length;
    if (currentQuestionIndex < total - 1) {
        document.querySelectorAll('.question-card')[currentQuestionIndex].style.display = 'none';
        currentQuestionIndex++;
        document.querySelectorAll('.question-card')[currentQuestionIndex].style.display = 'block';
        updateNavButtons(total);
        updateReadingTextDisplay(currentQuestionIndex);
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const mainContent = document.querySelector('.main-content');
        if (mainContent) mainContent.scrollTop = 0;
    }
}

function prevQuestion() {
    if (currentQuestionIndex > 0) {
        document.querySelectorAll('.question-card')[currentQuestionIndex].style.display = 'none';
        currentQuestionIndex--;
        document.querySelectorAll('.question-card')[currentQuestionIndex].style.display = 'block';
        const total = document.querySelectorAll('.question-card').length;
        updateNavButtons(total);
        updateReadingTextDisplay(currentQuestionIndex);

        window.scrollTo({ top: 0, behavior: 'smooth' });
        const mainContent = document.querySelector('.main-content');
        if (mainContent) mainContent.scrollTop = 0;
    }
}

function updateReadingTextDisplay(index) {
    const q = (currentExam.exam_questions || currentExam.ExamQuestions || [])[index];
    const header = document.getElementById('examReadingText');
    const content = document.getElementById('readingTextContent');

    if (q && q.reading_text) {
        content.innerHTML = q.reading_text.replace(/\n/g, '<br>');
        header.style.display = 'block';
    } else {
        header.style.display = 'none';
    }
}

function updateNavButtons(total) {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const submitBtn = document.getElementById('submitExamBtn');

    prevBtn.disabled = currentQuestionIndex === 0;

    if (currentQuestionIndex === total - 1) {
        nextBtn.style.display = 'none';
        submitBtn.style.display = 'block';
    } else {
        nextBtn.style.display = 'block';
        submitBtn.style.display = 'none';
    }
}

function startExamTimer(minutes) {
    let seconds = minutes * 60;
    const display = document.getElementById('timeRemaining');

    if (examTimer) clearInterval(examTimer);

    examTimer = setInterval(() => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        display.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        if (seconds <= 0) {
            clearInterval(examTimer);
            alert('Time is up! Your exam will be submitted automatically.');
            submitExam(true); // Force submit
        }
        seconds--;
    }, 1000);
}
// Custom Non-Blocking Exam In-DOM Modals (Prevents Browser Window Blur Violations)
function showExamNoticeModal(title, message, callback) {
    const existing = document.getElementById('customExamNoticeModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'customExamNoticeModal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 999999; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 20px; color: #1e293b; font-family: system-ui, -apple-system, sans-serif;';
    
    modal.innerHTML = `
        <div style="background: #ffffff; border-radius: 16px; padding: 24px; max-width: 420px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.3); text-align: center; border: 1px solid #e2e8f0; animation: modalPop 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);">
            <div style="width: 52px; height: 52px; background: #eff6ff; color: #2563eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto; font-size: 24px;">
                <i class="fas fa-exclamation-triangle" style="color: #f59e0b;"></i>
            </div>
            <h3 style="margin: 0 0 10px 0; font-size: 1.15rem; font-weight: 700; color: #0f172a;">${escapeHtml(title)}</h3>
            <p style="margin: 0 0 20px 0; font-size: 0.9rem; color: #475569; line-height: 1.5; text-align: left; white-space: pre-line;">${escapeHtml(message)}</p>
            <button id="examNoticeOkBtn" style="width: 100%; padding: 12px; background: #2563eb; color: white; border: none; border-radius: 10px; font-weight: 600; font-size: 0.95rem; cursor: pointer; transition: background 0.2s; box-shadow: 0 4px 12px rgba(37,99,235,0.25);">
                Got it, answer missed question
            </button>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('examNoticeOkBtn').onclick = function() {
        modal.remove();
        if (typeof callback === 'function') callback();
    };
}

function showExamConfirmModal(title, message, callback) {
    const existing = document.getElementById('customExamNoticeModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'customExamNoticeModal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 999999; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 20px; color: #1e293b; font-family: system-ui, -apple-system, sans-serif;';
    
    modal.innerHTML = `
        <div style="background: #ffffff; border-radius: 16px; padding: 24px; max-width: 420px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.3); text-align: center; border: 1px solid #e2e8f0; animation: modalPop 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);">
            <div style="width: 52px; height: 52px; background: #ecfdf5; color: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px auto; font-size: 24px;">
                <i class="fas fa-paper-plane"></i>
            </div>
            <h3 style="margin: 0 0 10px 0; font-size: 1.15rem; font-weight: 700; color: #0f172a;">${escapeHtml(title)}</h3>
            <p style="margin: 0 0 20px 0; font-size: 0.9rem; color: #475569; line-height: 1.5;">${escapeHtml(message)}</p>
            <div style="display: flex; gap: 10px;">
                <button id="examConfirmCancelBtn" style="flex: 1; padding: 12px; background: #f1f5f9; color: #475569; border: none; border-radius: 10px; font-weight: 600; font-size: 0.92rem; cursor: pointer;">
                    Cancel
                </button>
                <button id="examConfirmOkBtn" style="flex: 1; padding: 12px; background: #2563eb; color: white; border: none; border-radius: 10px; font-weight: 600; font-size: 0.92rem; cursor: pointer; box-shadow: 0 4px 12px rgba(37,99,235,0.25);">
                    Yes, Submit
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('examConfirmCancelBtn').onclick = function() {
        modal.remove();
    };

    document.getElementById('examConfirmOkBtn').onclick = function() {
        modal.remove();
        if (typeof callback === 'function') callback();
    };
}

async function submitExam(force = false) {
    if (!currentExam) return;

    const questions = currentExam.exam_questions || currentExam.ExamQuestions || [];
    const answers = {};
    let unansweredCount = 0;
    const unansweredNumbers = [];
    let firstUnansweredIndex = -1;

    const questionCards = document.querySelectorAll('.question-card');
    questions.forEach((q, index) => {
        const qId = q.id;
        const selectedRadio = document.querySelector(`input[name="q_${qId}"]:checked`);
        const textInput = document.querySelector(`input[name="q_${qId}"][type="text"], textarea[name="q_${qId}"]`);

        if (selectedRadio) {
            answers[qId] = selectedRadio.value;
        } else if (textInput && textInput.value.trim() !== '') {
            answers[qId] = textInput.value.trim();
        } else {
            unansweredCount++;
            unansweredNumbers.push(index + 1);
            if (firstUnansweredIndex === -1) firstUnansweredIndex = index;
        }
    });

    if (!force && unansweredCount > 0) {
        showExamNoticeModal(
            'Unanswered Questions Remaining',
            `You missed question number(s): ${unansweredNumbers.join(', ')}.\n\nPlease answer all questions before submitting.`,
            () => {
                if (firstUnansweredIndex !== -1 && questionCards[firstUnansweredIndex]) {
                    questionCards[currentQuestionIndex].style.display = 'none';
                    currentQuestionIndex = firstUnansweredIndex;
                    questionCards[currentQuestionIndex].style.display = 'block';
                    updateNavButtons(questionCards.length);
                    updateReadingTextDisplay(currentQuestionIndex);
                }
            }
        );
        return;
    }

    if (!force) {
        showExamConfirmModal(
            'Submit Examination?',
            'Are you sure you want to submit your exam? Please review your answers carefully before confirming.',
            () => {
                executeActualExamSubmit(answers);
            }
        );
        return;
    }

    executeActualExamSubmit(answers);
}

async function executeActualExamSubmit(answers) {
    clearInterval(examTimer);
    isExamInProgress = false;
    removeMobileExamSecurity();

    const submitBtn = document.getElementById('submitExamBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
    }

    try {
        // Collect violations log & count from offline storage
        let violationsLog = [];
        let violationCount = tabSwitchCount || 0;
        if (window.offlineExamManager && currentExam) {
            const prog = await window.offlineExamManager.getProgress(currentExam.id);
            if (prog && prog.violationsLog) {
                violationsLog = prog.violationsLog;
                violationCount = prog.violationCount || violationCount;
            }
        }

        // Check if device is offline
        if (!navigator.onLine) {
            if (window.offlineExamManager && currentExam) {
                await window.offlineExamManager.queueForSync(
                    currentExam.id,
                    answers,
                    new Date().toISOString(),
                    new Date().toISOString(),
                    violationsLog,
                    violationCount
                );
            }
            showExamNoticeModal(
                'Exam Saved Offline! 🎉',
                'Your examination answers have been securely recorded on your device.\n\nBecause you are currently offline, your exam will automatically sync to your teacher as soon as an internet connection is detected.',
                () => { location.reload(); }
            );
            return;
        }

        // Attempt online submission
        let result = null;
        try {
            result = await apiRequest(`/exams/${currentExam.id}/submit`, 'POST', { answers });
        } catch (netErr) {
            console.warn('Network submission failed, falling back to offline sync queue:', netErr);
        }

        if (result && result.success) {
            if (window.offlineExamManager && currentExam) {
                const db = await window.offlineExamManager.getDB();
                const tx = db.transaction(['sync_queue', 'progress'], 'readwrite');
                tx.objectStore('sync_queue').delete(currentExam.id);
                tx.objectStore('progress').delete(currentExam.id);
                window.offlineExamManager.updateSyncUI();
            }
            showExamNoticeModal(
                'Submission Successful! 🎉',
                `Your examination has been submitted. Your score: ${result.score}`,
                () => { location.reload(); }
            );
        } else if (result && result.error && !result.error.toLowerCase().includes('failed to fetch')) {
            alert('Submission notice: ' + result.error);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Submit Examination <i class="fas fa-paper-plane"></i>';
            }
            isExamInProgress = true;
            initMobileExamSecurity();
        } else {
            // Network failure or offline fallback
            if (window.offlineExamManager && currentExam) {
                await window.offlineExamManager.queueForSync(
                    currentExam.id,
                    answers,
                    new Date().toISOString(),
                    new Date().toISOString(),
                    violationsLog,
                    violationCount
                );
            }
            showExamNoticeModal(
                'Saved to Offline Sync Queue! 💾',
                'Internet was interrupted during submission. Your answers are safely stored on your device and will sync automatically when your connection is restored.',
                () => { location.reload(); }
            );
        }
    } catch (e) {
        console.error("Submit error:", e);
        if (window.offlineExamManager && currentExam) {
            await window.offlineExamManager.queueForSync(
                currentExam.id,
                answers,
                new Date().toISOString(),
                new Date().toISOString()
            );
            showExamNoticeModal(
                'Saved Offline! 💾',
                'Your answers have been stored locally on your device and will sync automatically when connected to internet.',
                () => { location.reload(); }
            );
        } else {
            alert('An error occurred during submission. Please try again.');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Submit Examination <i class="fas fa-paper-plane"></i>';
            }
            isExamInProgress = true;
            initMobileExamSecurity();
        }
    }
}

// Anti-Cheat Engine & AI Vision Tracker
let webcamStream = null;
let webcamInterval = null;
let lookingAwayTime = 0; // seconds looking away continuously
let prevFrameData = null;
let staticRoomCounter = 0;

async function initExamWebcamAIWithStream(examId, stream) {
    // Remove existing widget if any
    const oldWidget = document.getElementById('examWebcamWidget');
    if (oldWidget) oldWidget.remove();

    const isMathMode = currentExam && currentExam.isMathExam;

    // Create Floating Widget
    const widget = document.createElement('div');
    widget.id = 'examWebcamWidget';
    widget.style.cssText = 'position: fixed; top: 15px; right: 15px; z-index: 99999; background: rgba(15, 23, 42, 0.95); border: 2px solid ' + (isMathMode ? '#f59e0b' : '#3b82f6') + '; border-radius: 12px; padding: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); backdrop-filter: blur(10px); width: 170px; text-align: center; color: white; font-family: sans-serif;';
    widget.innerHTML = `
        <div style="font-size: 11px; font-weight: bold; margin-bottom: 5px; display: flex; align-items: center; justify-content: center; gap: 5px;" id="webcamBadge">
            <span style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%; display: inline-block;" id="webcamDot"></span>
            <span id="webcamText">${isMathMode ? '📐 Math Guard Active' : 'AI Guard Active'}</span>
        </div>
        <div style="position: relative; width: 154px; height: 115px; background: #000; border-radius: 8px; overflow: hidden;">
            <video id="examWebcamVideo" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1);"></video>
            <canvas id="examWebcamCanvas" width="154" height="115" style="position: absolute; top:0; left:0; pointer-events:none;"></canvas>
        </div>
        <div id="webcamGraceTimer" style="font-size: 10px; color: #fbbf24; margin-top: 4px; display: none; font-weight: bold; background: rgba(239,68,68,0.2); padding: 2px; border-radius: 4px;">
            ⚠️ Look at screen: <span id="graceSecs">${isMathMode ? '12.0' : '3.0'}</span>s
        </div>
    `;
    document.body.appendChild(widget);

    const video = document.getElementById('examWebcamVideo');
    const canvas = document.getElementById('examWebcamCanvas');
    const ctx = canvas.getContext('2d');

    try {
        if (stream) {
            webcamStream = stream;
        } else {
            webcamStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 320, height: 240, facingMode: 'user' },
                audio: false
            });
        }

        video.srcObject = webcamStream;
        await video.play();

        // Report camera present to backend (non-blocking)
        try {
            await apiRequest(`/exams/${examId}/camera-status`, 'POST', { has_camera: true });
        } catch(err) {
            console.warn('Camera status report warning:', err);
        }

        lookingAwayTime = 0;

        // Run frame analysis every 150ms (~7 fps) for instant response
        webcamInterval = setInterval(() => {
            if (!isExamInProgress) {
                stopExamWebcam();
                return;
            }

            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                analyzeFrameHeadPose(frameData);
            }
        }, 150);

    } catch (e) {
        console.error('Camera setup error during exam:', e);
    }
}

async function initExamWebcamAI(examId) {
    return initExamWebcamAIWithStream(examId, null);
}

function applyExamLayout(isExam) {
    const sidebar = document.getElementById('sidebar');
    const topNav = document.querySelector('.top-nav');
    const mainContent = document.querySelector('.main-content');
    const menuToggle = document.getElementById('menuToggle');
    const controlsBar = document.getElementById('examFolderControlsBar');

    if (isExam) {
        if (sidebar) sidebar.style.display = 'none';
        if (topNav) topNav.style.display = 'none';
        if (menuToggle) menuToggle.style.display = 'none';
        if (controlsBar) controlsBar.style.display = 'none';
        if (mainContent) {
            mainContent.style.marginLeft = '0';
            mainContent.style.padding = window.innerWidth <= 768 ? '5px 8px 50px 8px' : '15px 25px';
            mainContent.style.width = '100%';
            mainContent.style.maxWidth = '100%';
            mainContent.style.boxSizing = 'border-box';
        }
    } else {
        if (sidebar) sidebar.style.display = '';
        if (topNav) topNav.style.display = '';
        if (menuToggle) menuToggle.style.display = '';
        if (controlsBar) controlsBar.style.display = '';
        if (mainContent) {
            mainContent.style.marginLeft = '';
            mainContent.style.padding = '';
            mainContent.style.width = '';
            mainContent.style.maxWidth = '';
        }
    }
}

function analyzeFrameHeadPose(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    let facePixelCount = 0;
    let sumX = 0;
    let sumY = 0;
    let leftFacePixels = 0;
    let rightFacePixels = 0;
    let frameMotionDiff = 0;

    // Math Mode Detection & Relaxed Constraints
    const isMathMode = currentExam && currentExam.isMathExam;
    const maxGracePeriod = isMathMode ? 12.0 : 3.0; // 12 seconds grace for Math paper calculations
    const maxVerticalShift = isMathMode ? 0.65 : 0.42; // Allow downward tilt to write on scratch paper

    // 1. Motion Delta Check (150ms interval)
    if (prevFrameData && prevFrameData.length === data.length) {
        for (let i = 0; i < data.length; i += 32) {
            frameMotionDiff += Math.abs(data[i] - prevFrameData[i]);
        }
    }
    prevFrameData = new Uint8ClampedArray(data);

    const sampledPixelCount = (data.length / 32);
    const avgMotionPerPixel = frameMotionDiff / sampledPixelCount;

    // Static room check: 5 frames at 150ms = ~0.75s responsiveness
    if (avgMotionPerPixel < 0.6) {
        staticRoomCounter++;
    } else {
        staticRoomCounter = Math.max(0, staticRoomCounter - 1);
    }

    const midX = width / 2;

    // 2. Strict Skin Color & Feature Texture Scan (filters out beige walls, green curtains, light glare)
    for (let y = 2; y < height - 2; y += 4) {
        for (let x = 2; x < width - 2; x += 4) {
            const i = (y * width + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const isBeigeWall = Math.abs(r - g) < 8;
            const isGreenCurtain = (g > r);
            const isGlare = (r > 215 && g > 215 && b > 215);

            // Valid Human Skin Hue
            const isSkinHue = (r >= 40 && g >= 20 && b >= 15 && (r - g >= 8) && (r - b >= 14) && !isBeigeWall && !isGreenCurtain && !isGlare);

            if (isSkinHue) {
                const rightIdx = (y * width + (x + 2)) * 4;
                const downIdx = ((y + 2) * width + x) * 4;
                const rDiff = Math.abs(data[rightIdx] - r) + Math.abs(data[downIdx] - r);

                if (rDiff >= 2) {
                    facePixelCount++;
                    sumX += x;
                    sumY += y;

                    if (x < midX) leftFacePixels++;
                    else rightFacePixels++;
                }
            }
        }
    }

    const totalGridPixels = ((height / 4) * (width / 4));
    const faceRatio = facePixelCount / totalGridPixels;

    let isLookingAway = false;
    let issueReason = '';

    // Trigger violation if face ratio is < 1.2% OR room has zero motion for 4 intervals (0.60s empty room)
    if (faceRatio < 0.012 || staticRoomCounter >= 4) {
        isLookingAway = true;
        issueReason = staticRoomCounter >= 4 ? 'No student motion detected in camera view' : 'No face detected in camera view';
    } else {
        const avgX = sumX / facePixelCount;
        const avgY = sumY / facePixelCount;
        const centerX = width / 2;
        const centerY = height / 2;
        const offsetX = Math.abs(avgX - centerX) / width;
        const offsetY = Math.abs(avgY - centerY) / height;

        // Profile Asymmetry check (detects turning head left/right/down to look at phones/gadgets)
        const minSide = Math.min(leftFacePixels, rightFacePixels);
        const maxSide = Math.max(leftFacePixels, rightFacePixels);
        const asymmetryRatio = minSide > 0 ? (maxSide / minSide) : 5.0;

        // Head pose & gadget detection:
        // In Math Mode, offsetY threshold is increased to 0.65 to allow writing on scratch paper while keeping horizontal side-turns locked
        if (offsetX > 0.42 || offsetY > maxVerticalShift || asymmetryRatio > 4.0) {
            isLookingAway = true;
            issueReason = 'Student turned head completely away / looking away from device screen';
        }
    }

    const graceEl = document.getElementById('webcamGraceTimer');
    const graceSecs = document.getElementById('graceSecs');
    const badgeText = document.getElementById('webcamText');
    const badgeDot = document.getElementById('webcamDot');

    if (isLookingAway) {
        lookingAwayTime += 0.15; // 150ms interval

        if (graceEl && graceSecs) {
            graceEl.style.display = 'block';
            graceSecs.textContent = Math.max(0, (maxGracePeriod - lookingAwayTime)).toFixed(1);
        }
        if (badgeText) badgeText.textContent = isMathMode ? '📐 Scratch Work Gaze' : '⚠️ Focus Warning';
        if (badgeDot) badgeDot.style.background = '#ef4444';

        if (lookingAwayTime >= maxGracePeriod) {
            stopExamWebcam();
            triggerSpecificViolation(faceRatio < 0.012 || staticRoomCounter >= 4 ? 'NO_FACE' : 'LOOKING_AWAY', issueReason);
        }
    } else {
        // Reset grace timer when student is facing front
        lookingAwayTime = 0;
        if (graceEl) graceEl.style.display = 'none';
        if (badgeText) badgeText.textContent = isMathMode ? '📐 Math Guard Active' : 'AI Guard Active';
        if (badgeDot) badgeDot.style.background = '#22c55e';
    }
}

function stopExamWebcam() {
    if (webcamInterval) {
        clearInterval(webcamInterval);
        webcamInterval = null;
    }
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    prevFrameData = null;
    staticRoomCounter = 0;
    const widget = document.getElementById('examWebcamWidget');
    if (widget) widget.remove();
}

function showExemptionFloatingBadge() {
    const oldWidget = document.getElementById('examWebcamWidget');
    if (oldWidget) oldWidget.remove();

    const widget = document.createElement('div');
    widget.id = 'examWebcamWidget';
    widget.style.cssText = 'position: fixed; top: 15px; right: 15px; z-index: 99999; background: rgba(30, 58, 138, 0.95); border: 2px solid #10b981; border-radius: 10px; padding: 10px 14px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); color: white; font-family: sans-serif; font-size: 12px; font-weight: bold; text-align: center;';
    widget.innerHTML = `<i class="fas fa-user-shield" style="color: #34d399; margin-right: 5px;"></i> In-Person Supervised Exam`;
    document.body.appendChild(widget);
}

// ==================== MATH SCRATCHPAD & CALCULATOR TOOLS ====================
let scratchpadCanvas = null;
let scratchpadCtx = null;
let isDrawingScratch = false;
let scratchColor = '#ffffff';
let scratchTool = 'pen'; // 'pen' or 'eraser'
let lastScratchX = 0;
let lastScratchY = 0;

function toggleScratchpadModal() {
    const modal = document.getElementById('mathScratchpadModal');
    if (!modal) return;
    if (modal.style.display === 'none' || !modal.style.display) {
        modal.style.display = 'block';
        initScratchpadCanvas();
    } else {
        modal.style.display = 'none';
    }
}

function initScratchpadCanvas() {
    if (!scratchpadCanvas) {
        scratchpadCanvas = document.getElementById('scratchpadCanvas');
        if (!scratchpadCanvas) return;
        scratchpadCtx = scratchpadCanvas.getContext('2d');

        // Mouse Events
        scratchpadCanvas.addEventListener('mousedown', startScratchDraw);
        scratchpadCanvas.addEventListener('mousemove', drawScratch);
        scratchpadCanvas.addEventListener('mouseup', stopScratchDraw);
        scratchpadCanvas.addEventListener('mouseleave', stopScratchDraw);

        // Touch Events
        scratchpadCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            scratchpadCanvas.dispatchEvent(mouseEvent);
        }, { passive: false });

        scratchpadCanvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            scratchpadCanvas.dispatchEvent(mouseEvent);
        }, { passive: false });

        scratchpadCanvas.addEventListener('touchend', stopScratchDraw);

        // Make modal draggable by header
        makeElementDraggable(document.getElementById('mathScratchpadModal'), document.getElementById('scratchpadHeader'));
    }
}

function startScratchDraw(e) {
    isDrawingScratch = true;
    const rect = scratchpadCanvas.getBoundingClientRect();
    lastScratchX = e.clientX - rect.left;
    lastScratchY = e.clientY - rect.top;
}

function drawScratch(e) {
    if (!isDrawingScratch || !scratchpadCtx) return;
    const rect = scratchpadCanvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    scratchpadCtx.beginPath();
    scratchpadCtx.moveTo(lastScratchX, lastScratchY);
    scratchpadCtx.lineTo(currentX, currentY);

    if (scratchTool === 'eraser') {
        scratchpadCtx.strokeStyle = '#1e293b'; // Canvas background color
        scratchpadCtx.lineWidth = 16;
    } else {
        scratchpadCtx.strokeStyle = scratchColor;
        scratchpadCtx.lineWidth = 2.5;
    }

    scratchpadCtx.lineCap = 'round';
    scratchpadCtx.stroke();

    lastScratchX = currentX;
    lastScratchY = currentY;
}

function stopScratchDraw() {
    isDrawingScratch = false;
}

function setScratchColor(color) {
    scratchColor = color;
    scratchTool = 'pen';
    const eraserBtn = document.getElementById('scratchEraserBtn');
    if (eraserBtn) eraserBtn.style.background = '#334155';
}

function setScratchTool(tool) {
    scratchTool = tool;
    const eraserBtn = document.getElementById('scratchEraserBtn');
    if (eraserBtn) eraserBtn.style.background = tool === 'eraser' ? '#f59e0b' : '#334155';
}

function clearScratchpadCanvas() {
    if (scratchpadCanvas && scratchpadCtx) {
        scratchpadCtx.clearRect(0, 0, scratchpadCanvas.width, scratchpadCanvas.height);
    }
}

// Calculator Logic
function toggleCalculatorModal() {
    const modal = document.getElementById('mathCalcModal');
    if (!modal) return;
    if (modal.style.display === 'none' || !modal.style.display) {
        modal.style.display = 'block';
        makeElementDraggable(modal, document.getElementById('calcHeader'));
    } else {
        modal.style.display = 'none';
    }
}

function calcPress(val) {
    const display = document.getElementById('calcDisplay');
    if (!display) return;

    if (val === 'C') {
        display.value = '0';
    } else if (val === '=') {
        try {
            // Safe math evaluation
            const exp = display.value.replace(/×/g, '*').replace(/÷/g, '/');
            display.value = Function('"use strict";return (' + exp + ')')();
        } catch(e) {
            display.value = 'Error';
        }
    } else if (val === 'sqrt') {
        try {
            const num = parseFloat(display.value);
            display.value = Math.sqrt(num);
        } catch(e) {
            display.value = 'Error';
        }
    } else {
        if (display.value === '0' || display.value === 'Error') {
            display.value = val;
        } else {
            display.value += val;
        }
    }
}

function makeElementDraggable(elmnt, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    if (handle) {
        handle.onmousedown = dragMouseDown;
    } else {
        elmnt.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
        elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
        elmnt.style.bottom = 'auto';
        elmnt.style.right = 'auto';
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

// ==================== MOBILE ANTI-CHEAT & BACKGROUND AI DETECTION ENGINE ====================
let initialScreenWidth = window.innerWidth;
let initialScreenHeight = window.innerHeight;
let blurTimer = null;
let securityListenersAttached = false;

function initMobileExamSecurity() {
    initialScreenWidth = window.innerWidth;
    initialScreenHeight = window.innerHeight;

    if (securityListenersAttached) return;
    securityListenersAttached = true;

    document.body.classList.add('exam-mode');

    // 1. App Switcher / Shortcut Keys / Background AI Apps (visibilitychange & pagehide)
    document.addEventListener('visibilitychange', handleMobileVisibilityChange);
    window.addEventListener('pagehide', handleMobilePageHide);

    // 2. Window Blur / Floating AI Overlay / Focus Loss
    window.addEventListener('blur', handleMobileWindowBlur);
    window.addEventListener('focus', handleMobileWindowFocus);

    // 3. Split-Screen & Multi-Window AI Detection (resize)
    window.addEventListener('resize', handleMobileWindowResize);

    // 4. Anti-Copy, Anti-Cut, Anti-Paste & Anti-Right-Click
    document.addEventListener('copy', preventExamCopy);
    document.addEventListener('cut', preventExamCopy);
    document.addEventListener('paste', preventExamPaste);
    document.addEventListener('contextmenu', preventExamContextMenu);

    // 5. Shortcut Keys & Laptop PrintScreen Interception (keydown & keyup)
    document.addEventListener('keydown', preventExamShortcutKeys);
    document.addEventListener('keyup', handleLaptopScreenshotKeyUp);
    window.addEventListener('keyup', handleLaptopScreenshotKeyUp);

    // 6. Automatic Fullscreen Exit Lock
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    // 7. Multi-Touch Screenshot Gesture Interception (3-finger swipe / palm swipe)
    document.addEventListener('touchstart', handleMobileTouchSecurity, { passive: false });
    document.addEventListener('touchmove', handleMobileTouchSecurity, { passive: false });

    // 8. Text Selection & Magnifier Block
    document.addEventListener('selectionchange', preventExamTextSelection);
    document.addEventListener('selectstart', preventExamTextSelection);
}

function removeMobileExamSecurity() {
    securityListenersAttached = false;
    document.body.classList.remove('exam-mode');
    document.removeEventListener('visibilitychange', handleMobileVisibilityChange);
    window.removeEventListener('pagehide', handleMobilePageHide);
    window.removeEventListener('blur', handleMobileWindowBlur);
    window.removeEventListener('focus', handleMobileWindowFocus);
    window.removeEventListener('resize', handleMobileWindowResize);
    document.removeEventListener('copy', preventExamCopy);
    document.removeEventListener('cut', preventExamCopy);
    document.removeEventListener('paste', preventExamPaste);
    document.removeEventListener('contextmenu', preventExamContextMenu);
    document.removeEventListener('keydown', preventExamShortcutKeys);
    document.removeEventListener('keyup', handleLaptopScreenshotKeyUp);
    window.removeEventListener('keyup', handleLaptopScreenshotKeyUp);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.removeEventListener('touchstart', handleMobileTouchSecurity);
    document.removeEventListener('touchmove', handleMobileTouchSecurity);
    document.removeEventListener('selectionchange', preventExamTextSelection);
    document.removeEventListener('selectstart', preventExamTextSelection);
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
}

function handleMobileTouchSecurity(e) {
    if (!isExamInProgress) return;

    // Detect 3 or more multi-touch fingers (common Android/iOS screenshot swipe gestures)
    if (e.touches && e.touches.length >= 3) {
        if (e.preventDefault) e.preventDefault();
        document.body.classList.add('blur-exam');
        triggerSpecificViolation('SCREENSHOT', 'Multi-finger screenshot gesture detected on mobile device.');
        return false;
    }
}

function preventExamTextSelection(e) {
    if (!isExamInProgress) return;
    if (window.getSelection) {
        const sel = window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
    }
}

function handleFullscreenChange() {
    if (!isExamInProgress) return;
    const isFS = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    if (!isFS) {
        triggerSpecificViolation('FULLSCREEN_EXIT', 'Exited full-screen lockdown mode during active examination.');
    }
}

function handleMobileVisibilityChange() {
    if (isExamInProgress && document.visibilityState === 'hidden') {
        triggerSpecificViolation('TAB_SWITCH', 'Switched to background AI app or minimized exam window using shortcut keys/swipe gestures.');
    }
}

function handleMobilePageHide() {
    if (isExamInProgress) {
        triggerSpecificViolation('TAB_SWITCH', 'Left examination page or navigated away on mobile device.');
    }
}

function handleMobileWindowBlur() {
    if (!isExamInProgress) return;
    if (blurTimer) clearTimeout(blurTimer);

    // Immediately blur & darken content to block hardware/mobile screenshot captures & laptop Snipping Tool overlays
    document.body.classList.add('blur-exam');

    // On mobile devices or hardware button presses, trigger screenshot / focus loss violation rapidly
    const isMobileDevice = ('ontouchstart' in window) || (window.innerWidth <= 768);
    const delay = isMobileDevice ? 300 : 1000;

    blurTimer = setTimeout(() => {
        if (isExamInProgress && !document.hasFocus()) {
            triggerSpecificViolation('SCREENSHOT', 'Hardware screenshot button (Power + Volume Down) or window focus loss detected.');
        }
    }, delay);
}

function handleMobileWindowFocus() {
    document.body.classList.remove('blur-exam');
    if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
    }
}

function handleMobileWindowResize() {
    if (!isExamInProgress) return;

    const currentWidth = window.innerWidth;
    const currentHeight = window.innerHeight;

    const widthShrunk = (initialScreenWidth - currentWidth) > 120;
    const heightShrunk = (initialScreenHeight - currentHeight) > 180;

    const activeElem = document.activeElement;
    const isTypingInput = activeElem && (activeElem.tagName === 'INPUT' || activeElem.tagName === 'TEXTAREA');

    if (!isTypingInput && (widthShrunk || heightShrunk)) {
        triggerSpecificViolation('SPLIT_SCREEN', 'Split-screen mode or window resize detected during examination.');
    }
}

function preventExamCopy(e) {
    if (isExamInProgress) {
        e.preventDefault();
        alert('⚠️ Security Notice: Copying question text during examination is strictly prohibited.');
        return false;
    }
}

function preventExamPaste(e) {
    if (isExamInProgress) {
        e.preventDefault();
        alert('⚠️ Security Notice: Pasting external/AI answers into exam inputs is disabled.');
        return false;
    }
}

function preventExamContextMenu(e) {
    if (isExamInProgress) {
        e.preventDefault();
        return false;
    }
}

function handleLaptopScreenshotKeyUp(e) {
    if (!isExamInProgress) return;

    const key = (e.key || '').toLowerCase();
    const code = (e.code || '').toLowerCase();
    const keyCode = e.keyCode || e.which;

    // Detect Laptop PrintScreen (PrtScn, Fn+PrtScn, Win+Shift+S, Cmd+Shift+3/4/5)
    const isPrtScn = key === 'printscreen' || code === 'printscreen' || keyCode === 44 || key === 'snapshot';
    const isWinSnipping = (key === 's') && e.shiftKey && (e.metaKey || e.ctrlKey);
    const isMacScreenshot = e.metaKey && e.shiftKey && (key === '3' || key === '4' || key === '5');

    if (isPrtScn || isWinSnipping || isMacScreenshot) {
        if (e.preventDefault) e.preventDefault();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText('');
            }
        } catch(err){}
        document.body.classList.add('blur-exam');
        triggerSpecificViolation('SCREENSHOT', 'Attempted to take a laptop PrintScreen, snip, or screen capture.');
        return false;
    }
}

function preventExamShortcutKeys(e) {
    if (!isExamInProgress) return;

    const key = (e.key || '').toLowerCase();
    const code = (e.code || '').toLowerCase();
    const keyCode = e.keyCode || e.which;

    // Detect Laptop PrintScreen & Snipping Tool (PrtScn, Fn+PrtScn, Win+Shift+S, Cmd+Shift+3/4/5)
    const isPrtScn = key === 'printscreen' || code === 'printscreen' || keyCode === 44 || key === 'snapshot';
    const isWinSnipping = (key === 's') && e.shiftKey && (e.metaKey || e.ctrlKey);
    const isMacScreenshot = e.metaKey && e.shiftKey && (key === '3' || key === '4' || key === '5');

    if (isPrtScn || isWinSnipping || isMacScreenshot) {
        if (e.preventDefault) e.preventDefault();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText('');
            }
        } catch(err){}
        document.body.classList.add('blur-exam');
        triggerSpecificViolation('SCREENSHOT', 'Attempted to take a laptop PrintScreen, snip, or screen capture.');
        return false;
    }

    if (
        (e.altKey && key === 'tab') ||
        (e.metaKey && key === 'tab') ||
        (e.ctrlKey && (key === 'c' || key === 'v' || key === 'a' || key === 'p')) ||
        (e.metaKey && (key === 'c' || key === 'v' || key === 'a' || key === 'p')) ||
        key === 'f12' ||
        (e.ctrlKey && e.shiftKey && (key === 'i' || key === 'c'))
    ) {
        if (e.preventDefault) e.preventDefault();
        triggerSpecificViolation('TAB_SWITCH', 'Keyboard shortcut key for app switching, printing, or copying used during exam.');
        return false;
    }
}

async function triggerSpecificViolation(violationType, details) {
    if (!isExamInProgress) return;

    // Immediately halt exam & cleanup
    isExamInProgress = false;
    document.body.classList.remove('blur-exam');
    if (examTimer) clearInterval(examTimer);
    stopExamWebcam();
    removeMobileExamSecurity();
    applyExamLayout(false);

    // Exit Fullscreen safely if active
    if (document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement) {
        try {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
        } catch(e){}
    }

    document.getElementById('examInterface').style.display = 'none';

    // Record to offline storage
    if (window.offlineExamManager && currentExam) {
        await window.offlineExamManager.logOfflineViolation(currentExam.id, violationType, details);
    }

    try {
        if (navigator.onLine) {
            await apiRequest(`/exams/${currentExam.id}/violation`, 'POST', {
                violation_type: violationType,
                details: details
            });
        }
    } catch(e) {
        console.error('Failed to send specific violation log:', e);
    }

    let alertTitle = '❌ EXAM LOCKED: SECURITY VIOLATION ❌\n\n';
    let alertMsg = details || 'Suspicious activity detected.';

    if (violationType === 'LOOKING_AWAY') {
        alertMsg = 'You were detected looking away from your screen or at another device for more than 3 seconds continuously.';
    } else if (violationType === 'NO_FACE') {
        alertMsg = 'No face was detected in your camera view for more than 3 seconds continuously.';
    } else if (violationType === 'SPLIT_SCREEN') {
        alertMsg = 'Split-screen or window resizing was detected during your active exam session.';
    } else if (violationType === 'FULLSCREEN_EXIT') {
        alertMsg = 'Full-screen mode was exited before exam completion.';
    } else if (violationType === 'TAB_SWITCH') {
        alertMsg = 'Tab switching, minimizing, or using background AI apps was detected.';
    } else if (violationType === 'SCREENSHOT') {
        alertMsg = 'Attempting to take a screenshot, snip, or screen capture of examination content is strictly prohibited.';
    }

    // Show Teacher In-Person Override Unlock Modal
    const teacherModal = document.getElementById('teacherOverrideModal');
    if (teacherModal) {
        teacherModal.style.display = 'flex';
        const pinInput = document.getElementById('teacherOverridePinInput');
        if (pinInput) { pinInput.value = ''; pinInput.focus(); }
        const pinErr = document.getElementById('teacherPinError');
        if (pinErr) pinErr.style.display = 'none';
    } else {
        alert(`${alertTitle}${alertMsg}\n\nYour exam status is now "ON HOLD". Please contact your Subject Teacher to unlock your exam session.`);
        showSection('exams');
        loadProfile();
    }
}

window.submitTeacherOverridePin = async function() {
    const pinInput = document.getElementById('teacherOverridePinInput');
    const err = document.getElementById('teacherPinError');
    if (!pinInput || !currentExam) return;
    const enteredPin = pinInput.value.trim();
    if (!enteredPin) {
        if (err) { err.textContent = 'Please enter the teacher 4-digit PIN.'; err.style.display = 'block'; }
        return;
    }

    let isValid = false;
    if (window.offlineExamManager) {
        isValid = await window.offlineExamManager.verifyTeacherPin(currentExam.id, enteredPin);
    }

    if (isValid) {
        const teacherModal = document.getElementById('teacherOverrideModal');
        if (teacherModal) teacherModal.style.display = 'none';
        alert('✅ Exam Unlocked by Proctor!\nYou may now continue your examination.');
        isExamInProgress = true;
        initMobileExamSecurity();
        applyExamLayout(true);
        document.getElementById('examInterface').style.display = 'block';
    } else {
        if (err) {
            err.textContent = '❌ Incorrect Teacher PIN for this examination.';
            err.style.display = 'block';
        }
    }
};

async function triggerViolation() {
    triggerSpecificViolation('TAB_SWITCH', 'Learner tab switch or window blur detected');
}

function showSection(section) {
    // If in exam, prevent leaving
    if (isExamInProgress && section !== 'exams') {
        if (!confirm('Leave exam? Your current progress might be lost or submitted.')) return;
        submitExam();
    }

    // Close mobile sidebar when menu item is clicked
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar && overlay) {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('onclick') && item.getAttribute('onclick').includes(section)) {
            item.classList.add('active');
        }
    });

    document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));
    const targetSection = document.getElementById(section + 'Section');
    if (targetSection) targetSection.classList.add('active');

    const titles = {
        'dashboard': 'Dashboard',
        'grades': 'My Academic Grades',
        'learnerRecord': 'Learner Individual Record',
        'attendance': 'Attendance Records',
        'schedule': 'Weekly Class Program',
        'profile': 'Student Profile',
        'exams': 'Online Examination',
        'examResults': 'Examination Results',
        'enrollment': 'Online Enrollment',
        'ptaAccountability': 'PTA Voluntary Contribution',
        'bmi': 'Nutritional Status'
    };
    document.getElementById('currentSectionTitle').textContent = titles[section] || 'Dashboard';

    if (section === 'exams') {
        document.getElementById('availableExams').style.display = 'grid';
        document.getElementById('examInterface').style.display = 'none';
        loadExams();
    } else {
        stopLockedExamAutoPolling();
        if (section === 'learnerRecord') {
            loadStudentLearnerRecord();
        } else if (section === 'examResults') {
            loadExamResults();
        } else if (section === 'schedule') {
            loadStudentSchedule();
        } else if (section === 'grades') {
            setTimeout(initGradesSignaturePad, 50);
        }
    }
}

async function loadExamResults() {
    const results = await apiRequest('/exam-results'); // New Endpoint
    const tbody = document.querySelector('#examResultsTable tbody');

    if (!results || results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No examination results recorded yet.</td></tr>';
        return;
    }

    // Store all results globally for filtering
    window.allExamResults = results;

    // Populate subject filter
    populateSubjectFilter(results);

    // Display all results initially
    displayExamResults(results);
}

function populateSubjectFilter(results) {
    const subjectFilter = document.getElementById('examResultsSubjectFilter');
    if (!subjectFilter) return;

    // Get unique subjects
    const subjects = [...new Set(results.map(r => r.subject))].filter(s => s);

    // Keep "All Subjects" option and add unique subjects
    subjectFilter.innerHTML = '<option value="">All Subjects</option>' +
        subjects.map(subject => `<option value="${subject}">${subject}</option>`).join('');
}

function displayExamResults(results) {
    const tbody = document.querySelector('#examResultsTable tbody');

    if (!results || results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No results match the selected filters.</td></tr>';
        return;
    }

    tbody.innerHTML = results.map(r => {
        const date = new Date(r.date).toLocaleDateString();
        const percent = ((r.score / (r.total || 1)) * 100).toFixed(1);
        const signedBadge = r.signed
            ? '<span class="badge badge-success" style="background:#10b981"><i class="fas fa-check"></i> Signed</span>'
            : '<span class="badge badge-warning" style="background:#f59e0b; color: white"><i class="fas fa-pen"></i> Pending</span>';

        return `
            <tr>
                <td>${date}</td>
                <td><strong>${r.title}</strong></td>
                <td>${r.subject}</td>
                <td>Q${r.quarter}</td>
                <td style="font-weight: bold;">${r.score} / ${r.total}</td>
                <td>${signedBadge}</td>
                <td>
                    <button class="btn-primary" style="padding: 5px 15px; font-size: 0.8em;" onclick="viewExamResult(${r.id})">
                        View Details
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterExamResults() {
    const quarterFilter = document.getElementById('examResultsQuarterFilter').value;
    const subjectFilter = document.getElementById('examResultsSubjectFilter').value;

    if (!window.allExamResults) return;

    let filtered = window.allExamResults;

    // Filter by quarter
    if (quarterFilter) {
        filtered = filtered.filter(r => r.quarter == quarterFilter);
    }

    // Filter by subject
    if (subjectFilter) {
        filtered = filtered.filter(r => r.subject === subjectFilter);
    }

    displayExamResults(filtered);
}


let signatureCanvas, signatureCtx;
let isSigning = false;
let currentResultId = null;

function decodeHtml(html) {
    if (!html) return '';
    const txt = document.createElement("textarea");
    txt.innerHTML = html;
    return txt.value;
}

async function viewExamResult(id) {
    currentResultId = id;
    const data = await apiRequest(`/exam-results/${id}`);

    if (!data) return;

    // Toggle Views
    document.getElementById('examResultsList').style.display = 'none';
    document.getElementById('examResultDetails').style.display = 'block';

    // Populate Header
    document.getElementById('detailExamTitle').textContent = data.exam.title;
    document.getElementById('detailExamInfo').textContent = `Quarter ${data.exam.quarter}`;
    document.getElementById('detailExamScore').textContent = `Score: ${data.score} / ${data.total}`;

    // Populate Items
    const tbody = document.getElementById('detailItemsBody');
    tbody.innerHTML = data.questions.map((q, idx) => {
        const isRight = q.is_correct;
        return `
            <tr style="background: ${isRight ? '#f0fdf4' : '#fef2f2'}">
                <td>${idx + 1}</td>
                <td>${renderSafeQuestionHtml(q.text)}</td>
                <td style="font-weight: bold; color: ${isRight ? 'green' : 'red'}">
                    ${escapeHtml(q.student_answer || 'No Answer')}
                </td>
                <td style="font-weight: bold;">${escapeHtml(q.correct_answer)}</td>
                <td>
                    ${isRight
                ? '<i class="fas fa-check text-success"></i>'
                : '<i class="fas fa-times text-danger"></i>'}
                </td>
            </tr>
        `;
    }).join('');

    if (window.MathJax) {
        MathJax.typesetPromise([tbody]).catch(function (err) {
            console.log('MathJax error: ', err.message);
        });
    }

    // Handle Signature Display
    const displayDiv = document.getElementById('signatureDisplay');
    const inputDiv = document.getElementById('signaturePadContainer');
    const commentInput = document.getElementById('parentComment');

    if (data.signed) {
        displayDiv.style.display = 'block';
        inputDiv.style.display = 'none';
        document.getElementById('signedDate').textContent = new Date(data.signature_date).toLocaleDateString();
        document.getElementById('savedSignature').style.display = 'none';
        
        if (commentInput) {
            commentInput.disabled = true;
            commentInput.value = data.parent_comment || 'No comment provided.';
        }
    } else {
        displayDiv.style.display = 'none';
        inputDiv.style.display = 'block';
        
        if (commentInput) {
            commentInput.disabled = false;
            commentInput.value = '';
        }
        
        initSignaturePad();
    }
}

function closeExamDetails() {
    document.getElementById('examResultsList').style.display = 'block';
    document.getElementById('examResultDetails').style.display = 'none';
    currentResultId = null;
    loadExamResults(); // Refresh list
}

function initSignaturePad() {
    const canvas = document.getElementById('signCanvas');
    if (!canvas) return;

    // Adjust for high resolution
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);

    signatureCanvas = canvas;
    signatureCtx = canvas.getContext('2d');
    signatureCtx.lineWidth = 2;
    signatureCtx.lineCap = 'round';
    signatureCtx.strokeStyle = '#000';

    let isDrawing = false;

    const startDraw = (e) => {
        isDrawing = true;
        signatureCtx.beginPath();
        const { x, y } = getPos(e);
        signatureCtx.moveTo(x, y);
    };

    const draw = (e) => {
        if (!isDrawing) return;
        e.preventDefault();
        const { x, y } = getPos(e);
        signatureCtx.lineTo(x, y);
        signatureCtx.stroke();
    };

    const stopDraw = () => {
        isDrawing = false;
    };

    // Mouse Events
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseout', stopDraw);

    // Touch Events
    canvas.addEventListener('touchstart', startDraw);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', stopDraw);
}

function getPos(e) {
    const rect = signatureCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

function clearSignature() {
    if (signatureCtx) {
        signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    }
}

async function saveSignature() {
    if (!signatureCanvas || !currentResultId) return;

    // Check if empty
    // (Simple check)
    // const blank = document.createElement('canvas');
    // blank.width = signatureCanvas.width;
    // blank.height = signatureCanvas.height;
    // if (signatureCanvas.toDataURL() === blank.toDataURL()) {
    //    alert('Please sign first.');
    //    return;
    //}

    const signatureData = signatureCanvas.toDataURL('image/png');
    const commentInput = document.getElementById('parentComment');
    const parentComment = commentInput ? commentInput.value : '';

    if (confirm('Are you sure you want to submit this signature? This cannot be undone.')) {
        try {
            const result = await apiRequest(`/exam-results/${currentResultId}/sign`, 'POST', {
                signature: signatureData,
                parent_comment: parentComment
            });

            if (result.success) {
                alert('Signature saved successfully!');
                viewExamResult(currentResultId); // Reload details
            } else {
                alert(result.error || 'Failed to save signature.');
            }
        } catch (e) {
            console.error(e);
            alert('Error saving signature.');
        }
    }
}

function calculateStats(grades, logs) {
    const finalGrades = grades.map(g => {
        const q1 = parseFloat(g.quarters[1]) || 0;
        const q2 = parseFloat(g.quarters[2]) || 0;
        const q3 = parseFloat(g.quarters[3]) || 0;
        const q4 = parseFloat(g.quarters[4]) || 0;
        return g.quarters[5] || (q1 && q2 && q3 && q4 ? (q1 + q2 + q3 + q4) / 4 : 0);
    }).filter(v => v > 0);

    if (finalGrades.length > 0) {
        const gwa = finalGrades.reduce((a, b) => a + b, 0) / finalGrades.length;
        document.getElementById('gwaValue').textContent = gwa.toFixed(2);
    }

    if (logs && logs.length > 0) {
        const uniqueDays = new Set(logs.map(l => l.attendance_date)).size;
        const rate = (uniqueDays / 20) * 100;
        document.getElementById('attendanceRate').textContent = `${Math.min(rate, 100).toFixed(1)}%`;
    }
}

function getStatusClass(grade) {
    if (!grade) return '';
    return grade >= 75 ? 'pass' : 'fail';
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function logout() {
    localStorage.removeItem('studentToken');
    window.location.reload();
}

// Print & Download Logic
function getSlipContent() {
    const examTitle = document.getElementById('detailExamTitle').textContent;
    const infoText = document.getElementById('detailExamInfo').textContent || ''; // "Subject | Quarter X"
    const scoreText = document.getElementById('detailExamScore').textContent.replace('Score: ', '');
    const [score, total] = scoreText.split('/').map(n => parseFloat(n));
    const percentage = total ? ((score / total) * 100).toFixed(0) : 0;

    // Student Info
    const studentName = document.getElementById('profileFullName').textContent;
    const signedDate = document.getElementById('signedDate').textContent || new Date().toLocaleDateString();

    // Signature
    const sigImg = document.getElementById('savedSignature');
    const hasSignature = sigImg && sigImg.src && sigImg.src !== window.location.href && sigImg.style.display !== 'none';

    return `
        <div class="slip-container">
            <div class="slip-header">
                <img src="logo.png" style="width: 20px; height: 20px; display: block; margin: 0 auto 5px;">
                <h2>Learner Exam Result</h2>
                <p>Doroteo S. Mendoza Sr. MNHS</p>
            </div>
            <div class="slip-details">
                <p style="font-weight: bold; margin-bottom: 5px; border-bottom: 1px solid #eee; padding-bottom: 2px;">${examTitle}</p>
                <div style="display: flex; justify-content: space-between;">
                    <span>Name:</span>
                    <strong>${studentName.split(' ')[0]}...</strong> <!-- Truncate for space if needed -->
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Date:</span>
                    <span>${signedDate}</span>
                </div>
            </div>
            <div class="slip-score">
                <span>SCORE</span>
                <h1>${scoreText}</h1>
                <p style="font-size: 8px; margin: 0;">${percentage}%</p>
            </div>
            <div class="slip-signature" style="margin-top: auto; padding-bottom: 5px;">
                ${hasSignature ? `<img src="${sigImg.src}">` : '<div style="height: 20px;"></div>'}
                <div style="border-top: 1px solid black; width: 90%; margin: 0 auto;"></div>
                <p style="text-align: center; font-size: 6px; margin-top: 2px; text-transform: uppercase;">Parent / Guardian Signature</p>
            </div>
        </div>
    `;
}

function printResultSlip() {
    const container = document.getElementById('printSlip');
    container.innerHTML = getSlipContent();
    window.print();
}

function downloadResultPdf() {
    // Generate content
    const content = getSlipContent();
    const element = document.createElement('div');
    element.innerHTML = content;
    element.style.width = '2in';
    element.style.height = '2in';
    element.style.background = 'white';
    // Append to body temporarily to ensure rendering if needed, but html2pdf can handle off-screen
    // Actually, html2pdf works best with visible or at least rendered DOM.
    // We can use the #printSlip container.
    const container = document.getElementById('printSlip');
    container.innerHTML = content;
    container.style.display = 'block'; // Make visible for capture (but hidden by other styles?)
    // Actually our CSS hides .print-slip unless @media print.
    // formatting for pdf generation might need overriding that.

    // Better: create a temporary visible container off-screen
    const temp = document.createElement('div');
    temp.innerHTML = content;
    document.body.appendChild(temp);

    const opt = {
        margin: 0,
        filename: `ExamResult_${new Date().getTime()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 4, useCORS: true },
        jsPDF: { unit: 'in', format: [2, 2], orientation: 'portrait' }
    };

    html2pdf().set(opt).from(temp.firstChild).save().then(() => {
        document.body.removeChild(temp);
    });
}

// ==================== SSLG ELECTION FUNCTIONS ====================

let currentElectionData = null;
let selectedCandidates = {}; // { positionId: [candidateIds] }

// Check if election menu should be shown
async function checkElectionStatus() {
    try {
        const response = await fetch(`${API_URL}/election/status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        const electionMenu = document.getElementById('electionMenu');
        if (data.enabled && data.has_active_election) {
            electionMenu.style.display = 'flex';
        } else {
            electionMenu.style.display = 'none';
        }
    } catch (error) {
        console.error('Check election status error:', error);
        document.getElementById('electionMenu').style.display = 'none';
    }
}

// Load election data
async function loadElectionData() {
    try {
        const response = await fetch(`${API_URL}/election/active`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) {
            const error = await response.json();
            showNoElection(error.error || 'No active election');
            return;
        }

        const data = await response.json();

        if (data.has_voted) {
            showAlreadyVoted(data);
            return;
        }

        currentElectionData = data;
        displayElection(data);
    } catch (error) {
        console.error('Load election error:', error);
        showNoElection('Failed to load election data');
    }
}

function showNoElection(message) {
    document.getElementById('electionHeader').style.display = 'none';
    document.getElementById('votingForm').style.display = 'none';
    document.getElementById('alreadyVotedMessage').style.display = 'none';
    document.getElementById('electionResultsView').style.display = 'none';

    document.getElementById('noElectionMessage').style.display = 'block';
    document.querySelector('#noElectionMessage p').textContent = message;
}

function showAlreadyVoted(data) {
    document.getElementById('electionHeader').style.display = 'flex';
    document.getElementById('votingForm').style.display = 'none';
    document.getElementById('noElectionMessage').style.display = 'none';
    document.getElementById('electionResultsView').style.display = 'none';

    document.getElementById('electionTitle').textContent = data.election.title;
    document.getElementById('electionDescription').textContent = data.election.description || '';
    document.getElementById('electionStatus').textContent = 'Vote Submitted';
    document.getElementById('electionStatus').style.background = '#10b981';

    document.getElementById('alreadyVotedMessage').style.display = 'block';

    // Show results button if enabled
    if (data.election.show_realtime_results) {
        document.getElementById('viewResultsBtn').style.display = 'flex';
    }
}

function displayElection(data) {
    document.getElementById('electionHeader').style.display = 'flex';
    document.getElementById('votingForm').style.display = 'block';
    document.getElementById('noElectionMessage').style.display = 'none';
    document.getElementById('alreadyVotedMessage').style.display = 'none';
    document.getElementById('electionResultsView').style.display = 'none';

    // Set header info
    document.getElementById('electionTitle').textContent = data.election.title;
    document.getElementById('electionDescription').textContent = data.election.description || 'Cast your vote for your student leaders';
    document.getElementById('electionStatus').textContent = 'Active';
    document.getElementById('electionStatus').style.background = '#10b981';

    if (data.election.start_date && data.election.end_date) {
        const start = new Date(data.election.start_date).toLocaleDateString();
        const end = new Date(data.election.end_date).toLocaleDateString();
        document.getElementById('electionSchedule').textContent = `${start} - ${end}`;
    }

    // Show results button if enabled
    if (data.election.show_realtime_results) {
        document.getElementById('viewResultsBtn').style.display = 'flex';
    }

    // Reset selections
    selectedCandidates = {};

    // Render positions and candidates
    const container = document.getElementById('positionsContainer');
    container.innerHTML = data.positions.map(position => `
        <div class="position-card" data-position-id="${position.id}" data-max-votes="${position.max_votes}">
            <div class="position-header">
                <h3>${position.name}</h3>
                <span class="vote-count">Select ${position.max_votes > 1 ? 'up to ' + position.max_votes : '1'}</span>
            </div>
            <div class="candidates-grid">
                ${position.candidates.map(candidate => `
                    <div class="candidate-option" 
                         data-candidate-id="${candidate.id}"
                         onclick="toggleCandidate(${position.id}, ${candidate.id}, ${position.max_votes})">
                        <div class="candidate-check">
                            <i class="fas fa-check"></i>
                        </div>
                        <div class="candidate-photo">
                            ${candidate.photo
            ? `<img src="${candidate.photo}" alt="${candidate.name}" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-user-circle\\'></i>'">`
            : '<i class="fas fa-user-circle"></i>'
        }
                        </div>
                        <div class="candidate-name">${candidate.name}</div>
                        ${candidate.partylist ? `<div class="candidate-partylist">${candidate.partylist}</div>` : ''}
                        ${candidate.motto ? `<div class="candidate-motto">"${candidate.motto}"</div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function toggleCandidate(positionId, candidateId, maxVotes) {
    if (!selectedCandidates[positionId]) {
        selectedCandidates[positionId] = [];
    }

    const index = selectedCandidates[positionId].indexOf(candidateId);

    if (index > -1) {
        // Deselect
        selectedCandidates[positionId].splice(index, 1);
    } else {
        // Select (if under limit)
        if (selectedCandidates[positionId].length >= maxVotes) {
            // Remove first if at limit (or could show error)
            if (maxVotes === 1) {
                selectedCandidates[positionId] = [candidateId];
            } else {
                alert(`You can only select up to ${maxVotes} candidates for this position.`);
                return;
            }
        } else {
            selectedCandidates[positionId].push(candidateId);
        }
    }

    // Update UI
    updateCandidateSelection(positionId);
}

function updateCandidateSelection(positionId) {
    const positionCard = document.querySelector(`.position-card[data-position-id="${positionId}"]`);
    if (!positionCard) return;

    const candidateOptions = positionCard.querySelectorAll('.candidate-option');
    candidateOptions.forEach(option => {
        const candidateId = parseInt(option.dataset.candidateId);
        if (selectedCandidates[positionId] && selectedCandidates[positionId].includes(candidateId)) {
            option.classList.add('selected');
        } else {
            option.classList.remove('selected');
        }
    });
}

async function submitVotes() {
    // Validate that all positions have at least one vote
    if (!currentElectionData || !currentElectionData.positions) {
        alert('Election data not loaded. Please refresh the page.');
        return;
    }

    const missingPositions = currentElectionData.positions.filter(pos => {
        return !selectedCandidates[pos.id] || selectedCandidates[pos.id].length === 0;
    });

    if (missingPositions.length > 0) {
        const names = missingPositions.map(p => p.name).join(', ');
        if (!confirm(`You haven't selected candidates for: ${names}. Do you want to submit anyway?`)) {
            return;
        }
    }

    if (!confirm('Are you sure you want to submit your vote? This action cannot be undone.')) {
        return;
    }

    // Disable submit button
    const submitBtn = document.getElementById('submitVoteBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

    try {
        // Build votes array
        const votes = [];
        for (const [positionId, candidateIds] of Object.entries(selectedCandidates)) {
            candidateIds.forEach(candidateId => {
                votes.push({
                    position_id: parseInt(positionId),
                    candidate_id: candidateId
                });
            });
        }

        const response = await fetch(`${API_URL}/election/vote`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                election_id: currentElectionData.election.id,
                votes
            })
        });

        const data = await response.json();

        if (response.ok) {
            alert('🗳️ Your vote has been submitted successfully! Thank you for participating.');
            loadElectionData(); // Reload to show "already voted" state
        } else {
            alert(data.error || 'Failed to submit vote. Please try again.');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-vote-yea"></i> Submit My Vote';
        }
    } catch (error) {
        console.error('Submit vote error:', error);
        alert('Failed to submit vote. Please check your connection and try again.');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-vote-yea"></i> Submit My Vote';
    }
}

async function showElectionResults() {
    try {
        const response = await fetch(`${API_URL}/election/${currentElectionData?.election?.id || 'active'}/results`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) {
            const error = await response.json();
            alert(error.error || 'Failed to load results');
            return;
        }

        const data = await response.json();

        // Hide other content, show results
        document.getElementById('electionHeader').style.display = 'none';
        document.getElementById('votingForm').style.display = 'none';
        document.getElementById('alreadyVotedMessage').style.display = 'none';
        document.getElementById('noElectionMessage').style.display = 'none';
        document.getElementById('electionResultsView').style.display = 'block';

        // Render results
        const container = document.getElementById('resultsContent');
        container.innerHTML = data.positions.map(pos => `
            <div class="result-position-card">
                <div class="result-position-header">
                    <i class="fas fa-award"></i>
                    <span>${pos.position_name}</span>
                    ${pos.grade_restriction ? `<small style="margin-left: auto; color: #64748b;">(Grade ${pos.grade_restriction} only)</small>` : ''}
                </div>
                <div class="result-candidates-list">
                    ${pos.candidates.map((c, index) => `
                        <div class="result-candidate-item ${index < pos.max_votes ? 'winner' : ''}">
                            <div class="result-rank">${index + 1}</div>
                            <div class="result-candidate-photo">
                                ${c.photo
                ? `<img src="${c.photo}" alt="${c.name}">`
                : '<i class="fas fa-user-circle"></i>'
            }
                            </div>
                            <div class="result-candidate-info">
                                <div class="name">${c.name} ${index < pos.max_votes ? '🏆' : ''}</div>
                                ${c.partylist ? `<div class="partylist">${c.partylist}</div>` : ''}
                            </div>
                            <div class="result-votes">
                                <div class="count">${c.votes}</div>
                                <div class="percent">${c.percentage}%</div>
                            </div>
                            <div class="result-bar">
                                <div class="result-bar-fill" style="width: ${c.percentage}%"></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Show results error:', error);
        alert('Failed to load results');
    }
}

function hideElectionResults() {
    document.getElementById('electionResultsView').style.display = 'none';
    loadElectionData(); // Reload main view
}

// Update showSection to include election
const originalShowSection = showSection;
showSection = function (section) {
    // Handle election section specially
    if (section === 'election') {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.id === 'electionMenu') {
                item.classList.add('active');
            }
        });

        document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));
        document.getElementById('electionSection').classList.add('active');
        document.getElementById('currentSectionTitle').textContent = 'SSLG Election';

        // Close mobile sidebar
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (sidebar && overlay) {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        }
        return;
    }

    // Call original for other sections
    originalShowSection(section);
};

// Check election status on load
document.addEventListener('DOMContentLoaded', () => {
    // Defer check until after profile loads
    setTimeout(() => {
        if (authToken) {
            checkElectionStatus();
        }
    }, 1000);
});


// ==================== PTA LOGIC ====================

async function loadPTAData() {
    try {
        const response = await apiRequest('/pta-account');
        if (!response.has_account) {
            document.getElementById('ptaPlanName').textContent = response.plan_name || 'No Account';
            document.getElementById('ptaAmountDue').textContent = response.plan_amount ? '₱' + formatNumber(response.plan_amount) : '₱0.00';
            document.getElementById('ptaBalance').textContent = '₱' + formatNumber(0);

            // Also render empty lists for consistency
            const tbody = document.querySelector('#ptaPaymentsTable tbody');
            tbody.innerHTML = "<tr><td colspan='5' class='text-center'>No payment history found.</td></tr>";
            renderSiblingsList([]);
            return;
        }

        const account = response.account;
        document.getElementById('ptaPlanName').textContent = account.plan_name || 'Standard';
        document.getElementById('ptaAmountDue').textContent = '₱' + formatNumber(account.total_amount_due);
        document.getElementById('ptaBalance').textContent = '₱' + formatNumber(account.balance);

        // Payments
        const tbody = document.querySelector('#ptaPaymentsTable tbody');
        if (response.payments && response.payments.length > 0) {
            tbody.innerHTML = response.payments.map(p => `
                <tr>
                    <td>${new Date(p.payment_date).toLocaleDateString()}</td>
                    <td>${p.receipt_number}</td>
                    <td><span class='badge badge-info'>${p.payment_type}</span></td>
                    <td>${p.payment_method}</td>
                    <td style='font-weight: bold;'>₱${formatNumber(p.amount_paid)}</td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = "<tr><td colspan='5' class='text-center'>No payment history found.</td></tr>";
        }

        // Siblings
        renderSiblingsList(response.siblings);

    } catch (error) {
        console.error('Error loading PTA data:', error);
    }
}

function renderSiblingsList(siblings) {
    const list = document.getElementById('ptaSiblingsList');
    if (!siblings || siblings.length === 0) {
        list.innerHTML = '<p class="text-muted" style="width: 100%;">No siblings tagged.</p>';
        return;
    }

    list.innerHTML = siblings.map(kid => `
        <div class='glass' style='padding: 10px 15px; display: inline-flex; align-items: center; gap: 10px; border-radius: 50px; font-size: 0.9rem;'>
            <i class='fas fa-user-graduate'></i>
            <div>
                <strong>${kid.name}</strong>
                <small>(Grade ${kid.grade_level})</small>
            </div>
        </div>
    `).join('');
}

function showSiblingModal() {
    document.getElementById('siblingModal').style.display = 'block';
    loadSiblingSections(); // Init options
}

function closeSiblingModal() {
    document.getElementById('siblingModal').style.display = 'none';
    // Clear search
    document.getElementById('siblingSearchInput').value = '';
    document.getElementById('siblingSearchResults').innerHTML = '';
}

async function loadSiblingSections() {
    const select = document.getElementById('siblingSearchSection');
    select.innerHTML = '<option value="">All Sections</option>';

    const sections = await apiRequest('/sections'); // Fetch all sections
    // Filter by grade if selected
    const grade = document.getElementById('siblingSearchGrade').value;

    if (sections) {
        const filtered = grade ? sections.filter(s => s.grade_level == grade) : sections;
        filtered.forEach(s => {
            select.innerHTML += `<option value="${s.id}">${s.section_name}</option>`;
        });
    }
}

let searchTimeout = null;
function searchSiblings() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(doSearchSiblings, 500);
}

async function doSearchSiblings() {
    const term = document.getElementById('siblingSearchInput').value;
    const grade = document.getElementById('siblingSearchGrade').value;
    const section = document.getElementById('siblingSearchSection').value;

    if (!term && !grade && !section) {
        document.getElementById('siblingSearchResults').innerHTML = '';
        return;
    }

    const params = new URLSearchParams();
    if (term) params.append('search', term);
    if (grade) params.append('grade_level', grade);
    if (section) params.append('section_id', section);

    const students = await apiRequest(`/search-siblings?${params.toString()}`);

    const resultsDiv = document.getElementById('siblingSearchResults');
    if (!students || students.length === 0) {
        resultsDiv.innerHTML = '<p style="padding: 10px; text-align: center;">No students found.</p>';
        return;
    }

    resultsDiv.innerHTML = students.map(s => `
        <div style='padding: 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;'>
            <div>
                <strong>${s.first_name} ${s.last_name}</strong>
                <div style='font-size: 0.8rem; color: #666;'>LRN: ${s.lrn} | Grade ${s.grade_level}</div>
            </div>
            <button class='btn-primary btn-sm' onclick='tagSibling(${s.id})'>Tag</button>
        </div>
    `).join('');
}

async function tagSibling(id) {
    if (!confirm('Are you sure you want to tag this student as your sibling?')) return;

    try {
        const res = await apiRequest('/pta-siblings', 'POST', { sibling_student_id: id });
        if (res.success) {
            alert('Sibling tagged successfully!');
            closeSiblingModal();
            loadPTAData(); // Reload to show new sibling
        } else {
            alert(res.error || 'Failed to tag sibling');
        }
    } catch (e) {
        console.error(e);
        alert('Error tagging sibling');
    }
}

function formatNumber(num) {
    return parseFloat(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ================= LMS Logic for Student ================= */

async function loadStudentLms() {
    console.log("Loading Student LMS...");
    switchStudentLmsTab('modular');
}

function switchStudentLmsTab(tabName) {
    ['modular', 'materials', 'remedial'].forEach(t => {
        const btn = document.getElementById(`tab-btn-${t}`);
        const content = document.getElementById(`studentLms-${t}`);

        if (btn && content) {
            if (t === tabName) {
                btn.classList.remove('btn-secondary');
                btn.classList.add('btn-primary');
                content.style.display = 'block';
            } else {
                btn.classList.add('btn-secondary');
                btn.classList.remove('btn-primary');
                content.style.display = 'none';
            }
        }
    });

    if (tabName === 'modular') loadStudentModular();
    else if (tabName === 'materials') loadStudentMaterials();
    else if (tabName === 'remedial') loadStudentRemedial();
}

async function loadStudentModular() {
    const list = document.getElementById('studentModularList');
    if (!list) return;
    list.innerHTML = '<div class="col-span-full text-center p-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i> <p class="mt-2 text-muted">Loading activities...</p></div>';

    try {
        const params = new URLSearchParams({
            view: 'student',
            grade: profileData?.grade_level || '',
            section: profileData?.section_id || '',
            student: currentStudent?.id || ''
        });

        const token = localStorage.getItem('studentToken');
        const res = await fetch(`/api/lms/modular-activities?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const activities = await res.json();

        if (!res.ok) throw new Error(activities.message || 'Failed');

        const modularItems = activities.filter(a => ['activity', 'quiz'].includes(a.type));

        if (modularItems.length === 0) {
            list.innerHTML = `
                <div class="empty-state-lms" style="grid-column: 1/-1;">
                    <i class="fas fa-clipboard-check"></i>
                    <h3>All Caught Up!</h3>
                    <p>No pending modular activities assigned to you.</p>
                </div>`;
            return;
        }

        list.innerHTML = modularItems.map(item => `
            <div class="lms-card">
                <div class="card-top-accent accent-${item.type}"></div>
                <div class="lms-card-header">
                    <div class="lms-icon-box ${item.type}">
                        <i class="fas ${item.type === 'quiz' ? 'fa-question-circle' : 'fa-tasks'}"></i>
                    </div>
                    <div style="flex-grow:1">
                        <h4>${item.title}</h4>
                        <div class="lms-date">
                            <i class="far fa-clock"></i>
                            ${new Date(item.createdAt || item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            ${item.deadline ? `<br><span style="color: #ef4444; font-size: 0.8rem;">Due: ${new Date(item.deadline).toLocaleString()}</span>` : ''}
                             <span style="margin-left:auto; font-size:0.7rem; background:#f1f5f9; padding:2px 8px; border-radius:4px; opacity:0.8;">${item.type.toUpperCase()}</span>
                        </div>
                    </div>
                </div>
                <p class="lms-desc">${item.description || ''}</p>
                
                ${item.attachment_path && item.attachment_path.length > 0 ? `
                    <div class="lms-attachments">
                        ${item.attachment_path.map(f => `
                            <a href="${f.url}" target="_blank" class="attachment-pill">
                                <i class="fas fa-paperclip"></i> ${f.name || 'Attachment'}
                            </a>
                        `).join('')}
                    </div>
                ` : ''}

                <div style="margin-top:15px; border-top:1px solid #eee; padding-top:10px; display:flex; justify-content:space-between; align-items:center;">
                    ${item.submissions && item.submissions.length > 0 ?
                `<span class="badge" style="background:#10b981; color:white;"><i class="fas fa-check-circle"></i> Submitted</span>` :
                `<button onclick="openSubmissionModal(${item.id})" class="btn-primary btn-sm" style="margin-left:auto;"><i class="fas fa-upload"></i> Submit Work</button>`
            }
                </div>
            </div>
        `).join('');

    } catch (e) {
        console.error(e);
        list.innerHTML = '<div class="alert alert-danger">Failed to load activities. Please try again.</div>';
    }
}

async function loadStudentMaterials() {
    const list = document.getElementById('studentMaterialsList');
    if (!list) return;
    list.innerHTML = '<div class="col-span-full text-center p-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i> <p class="mt-2 text-muted">Loading materials...</p></div>';

    try {
        const params = new URLSearchParams({
            grade: profileData?.grade_level || '',
            section: profileData?.section_id || '',
        });

        const token = localStorage.getItem('studentToken');
        const res = await fetch(`/api/lms/modular-activities?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const activities = await res.json();
        if (!res.ok) throw new Error('Failed');

        const materials = activities.filter(a => a.type === 'material');

        if (materials.length === 0) {
            list.innerHTML = `
                <div class="empty-state-lms" style="grid-column: 1/-1;">
                    <i class="fas fa-book-reader"></i>
                    <h3>No Materials Yet</h3>
                    <p>Your teachers haven't posted any learning materials.</p>
                </div>`;
            return;
        }

        list.innerHTML = materials.map(item => `
            <div class="lms-card">
                <div class="card-top-accent accent-material"></div>
                <div class="lms-card-header">
                    <div class="lms-icon-box material">
                        <i class="fas fa-book-open"></i>
                    </div>
                     <div style="flex-grow:1">
                        <h4>${item.title}</h4>
                        <div class="lms-date">
                            <i class="far fa-clock"></i>
                            ${new Date(item.createdAt || item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                    </div>
                </div>
                <p class="lms-desc">${item.description || ''}</p>
                 ${item.attachment_path && item.attachment_path.length > 0 ? `
                    <div class="lms-attachments">
                        ${item.attachment_path.map(f => `
                            <a href="${f.url}" target="_blank" class="attachment-pill">
                                <i class="fas fa-download"></i> ${f.name || 'Download Material'}
                            </a>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('');

    } catch (e) {
        console.error(e);
        list.innerHTML = '<div class="alert alert-danger">Failed to load materials.</div>';
    }
}

let currentRemedialProgram = null;
let currentTutorChatHistory = [];
let allStudentRemedials = [];
let currentSelectedSubject = null;
let currentSelectedCategory = null;

function getExamCategory(item) {
    const exam = item.exam || item.Exam;
    if (!exam) return "Term Examination";
    if (exam.type === 'summative') {
        if (exam.exam_no === 2) return "Summative Test 2";
        return "Summative Test 1";
    }
    return "Term Examination";
}

async function loadStudentRemedial() {
    const list = document.getElementById('studentRemedialList');
    if (!list) return;
    list.innerHTML = '<div class="col-span-full text-center p-5"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i> <p class="mt-2 text-muted">Loading remediation tasks...</p></div>';

    try {
        const token = localStorage.getItem('studentToken');
        const res = await fetch('/api/student/remedial/active', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const remedials = await res.json();
        if (!res.ok) throw new Error(remedials.error || 'Failed to fetch remedials');

        allStudentRemedials = remedials;
        currentSelectedSubject = null;
        currentSelectedCategory = null;

        exitRemedialRoom();
        renderStudentRemedialFolders();
    } catch (e) {
        console.error('Load remedial error:', e);
        list.innerHTML = `<div class="alert alert-danger">Failed to load remedial activities: ${e.message}</div>`;
    }
}

window.renderStudentRemedialFolders = function () {
    const list = document.getElementById('studentRemedialList');
    const breadcrumb = document.getElementById('remedialBreadcrumbContainer');
    const termSelect = document.getElementById('remedialTermFilter');
    if (!list) return;

    const term = termSelect ? termSelect.value : '';

    // Step 1: Filter by Term
    let filtered = allStudentRemedials;
    if (term) {
        filtered = allStudentRemedials.filter(item => {
            const exam = item.exam || item.Exam;
            return exam && String(exam.quarter) === String(term);
        });
    }

    // Step 2: Handle Empty State
    if (filtered.length === 0) {
        breadcrumb.style.display = 'none';
        list.innerHTML = `
            <div class="empty-state-lms" style="grid-column: 1/-1;">
                <i class="fas fa-check-circle"></i>
                <h3>No Remediation</h3>
                <p>You have no pending remedial activities for the selected filters.</p>
            </div>`;
        return;
    }

    // Step 3: Render based on folder level
    if (currentSelectedSubject === null) {
        // Root View: Subject folders
        breadcrumb.style.display = 'none';

        const subjectGroups = {};
        filtered.forEach(item => {
            const subjectName = item.subject ? item.subject.subject_name : (item.Subject ? item.Subject.subject_name : 'General Subject');
            if (!subjectGroups[subjectName]) {
                subjectGroups[subjectName] = [];
            }
            subjectGroups[subjectName].push(item);
        });

        list.innerHTML = Object.entries(subjectGroups).map(([subjectName, items]) => {
            const total = items.length;
            const completed = items.filter(i => ['quiz_completed', 'evaluated'].includes(String(i.status).toLowerCase())).length;
            return `
            <div class="lms-card folder-card" onclick="enterSubjectFolder('${subjectName.replace(/'/g, "\\'")}')" style="cursor: pointer; border: 1px solid #cbd5e1; border-radius: 12px; transition: transform 0.2s; background: #ffffff; padding: 20px; display: flex; align-items: center; gap: 15px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                 <i class="fas fa-folder" style="font-size: 3rem; color: #f59e0b;"></i>
                 <div style="flex-grow: 1;">
                      <h4 style="font-size: 1.1rem; font-weight: bold; margin: 0; color: #1e293b;">${subjectName}</h4>
                      <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: #64748b;">${total} Remediation Rooms (${completed} completed)</p>
                 </div>
                 <i class="fas fa-chevron-right" style="color: #94a3b8;"></i>
            </div>
            `;
        }).join('');

    } else if (currentSelectedCategory === null) {
        // Level 2: Category folders inside subject
        breadcrumb.style.display = 'block';
        const backBtn = breadcrumb.querySelector('button');
        if (backBtn) backBtn.innerHTML = `<i class="fas fa-arrow-left"></i> Back to Subjects`;

        const subjectItems = filtered.filter(item => {
            const subjectName = item.subject ? item.subject.subject_name : (item.Subject ? item.Subject.subject_name : 'General Subject');
            return subjectName === currentSelectedSubject;
        });

        const categoryGroups = { "Summative Test 1": [], "Summative Test 2": [], "Term Examination": [] };
        subjectItems.forEach(item => {
            const catName = getExamCategory(item);
            if (categoryGroups[catName]) {
                categoryGroups[catName].push(item);
            } else {
                categoryGroups["Term Examination"].push(item);
            }
        });

        const categoriesToRender = Object.entries(categoryGroups).filter(([_, items]) => items.length > 0);

        list.innerHTML = categoriesToRender.map(([catName, items]) => {
            const total = items.length;
            const completed = items.filter(i => ['quiz_completed', 'evaluated'].includes(String(i.status).toLowerCase())).length;
            return `
            <div class="lms-card folder-card" onclick="enterCategoryFolder('${catName}')" style="cursor: pointer; border: 1px solid #cbd5e1; border-radius: 12px; transition: transform 0.2s; background: #ffffff; padding: 20px; display: flex; align-items: center; gap: 15px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                 <i class="fas fa-folder-open" style="font-size: 3rem; color: #3b82f6;"></i>
                 <div style="flex-grow: 1;">
                      <h4 style="font-size: 1.1rem; font-weight: bold; margin: 0; color: #1e293b;">${catName}</h4>
                      <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: #64748b;">${total} Competency Rooms (${completed} completed)</p>
                 </div>
                 <i class="fas fa-chevron-right" style="color: #94a3b8;"></i>
            </div>
            `;
        }).join('');

    } else {
        // Level 3: Competency cards inside selected category
        breadcrumb.style.display = 'block';
        const backBtn = breadcrumb.querySelector('button');
        if (backBtn) backBtn.innerHTML = `<i class="fas fa-arrow-left"></i> Back to Categories`;

        const roomItems = filtered.filter(item => {
            const subjectName = item.subject ? item.subject.subject_name : (item.Subject ? item.Subject.subject_name : 'General Subject');
            const catName = getExamCategory(item);
            return subjectName === currentSelectedSubject && catName === currentSelectedCategory;
        });

        list.innerHTML = roomItems.map(item => {
            const isCompleted = ['quiz_completed', 'evaluated'].includes(String(item.status).toLowerCase());
            return `
            <div class="lms-card">
                 <div class="card-top-accent accent-remedial" style="background: ${isCompleted ? '#10b981' : '#f59e0b'};"></div>
                 <div class="lms-card-header">
                     <div class="lms-icon-box" style="background: ${isCompleted ? '#d1fae5' : '#fef3c7'}; color: ${isCompleted ? '#059669' : '#d97706'};">
                          <i class="fas ${isCompleted ? 'fa-check-circle' : 'fa-user-clock'}"></i>
                     </div>
                     <div style="flex-grow:1">
                          <h4 style="font-size:0.95rem; font-weight:bold; color: #1e293b;">${item.competency.substring(0, 50)}...</h4>
                          <div class="lms-date">
                               <i class="fas fa-book"></i> ${currentSelectedSubject}
                               <span class="badge" style="margin-left:auto; background:${isCompleted ? '#10b981' : '#f59e0b'}; color:white; font-size:0.7rem;">${item.status.toUpperCase()}</span>
                          </div>
                     </div>
                 </div>
                 <p class="lms-desc" style="font-size: 0.85rem; color:#64748b;">${item.competency}</p>
                 
                 <div style="margin-top:15px; text-align:right; border-top:1px solid #e2e8f0; padding-top:10px;">
                     <button class="btn-primary btn-sm" onclick="openRemedialRoom(${JSON.stringify(item).replace(/"/g, '&quot;')})">
                        <i class="fas fa-door-open"></i> Enter Remedial Room
                     </button>
                 </div>
            </div>
        `;
        }).join('');
    }
};

window.enterSubjectFolder = function (subjectName) {
    currentSelectedSubject = subjectName;
    currentSelectedCategory = null;
    renderStudentRemedialFolders();
};

window.enterCategoryFolder = function (catName) {
    currentSelectedCategory = catName;
    renderStudentRemedialFolders();
};

window.remedialBackNavigation = function () {
    if (currentSelectedCategory !== null) {
        currentSelectedCategory = null;
    } else if (currentSelectedSubject !== null) {
        currentSelectedSubject = null;
    }
    renderStudentRemedialFolders();
};

window.openRemedialRoom = function (item) {
    currentRemedialProgram = item;
    currentTutorChatHistory = [];

    // Hide filter bar during interactive session
    const filterBar = document.querySelector('.remedial-filters-bar');
    if (filterBar) filterBar.style.display = 'none';

    document.getElementById('studentRemedialList').style.display = 'none';
    document.getElementById('studentRemedialRoomView').style.display = 'grid';

    document.getElementById('remedialCompetencyTitle').innerText = item.competency;
    document.getElementById('remedialSubjectTitle').innerText = `Subject: ${item.subject ? item.subject.subject_name : (item.Subject ? item.Subject.subject_name : 'General')} | Exam: ${item.exam ? item.exam.title : (item.Exam ? item.Exam.title : 'Summative Test')}`;

    const chatBox = document.getElementById('tutorChatMessages');
    chatBox.innerHTML = `
        <div style="background: #e2e8f0; padding: 8px 12px; border-radius: 8px; align-self: flex-start; max-width: 85%; font-size: 0.9rem; color: #334155;">
            Hello! I am Kortix AI, your tutor. How can I help you understand this learning competency today?
        </div>
    `;

    renderRemedialRoomContent();
};

window.exitRemedialRoom = function () {
    currentRemedialProgram = null;

    // Show filter bar back
    const filterBar = document.querySelector('.remedial-filters-bar');
    if (filterBar) filterBar.style.display = 'flex';

    document.getElementById('studentRemedialList').style.display = 'grid';
    document.getElementById('studentRemedialRoomView').style.display = 'none';

    // Refresh display
    renderStudentRemedialFolders();
};

window.renderRemedialRoomContent = function () {
    const item = currentRemedialProgram;
    const accordion = document.getElementById('activitiesAccordion');
    const quizSection = document.getElementById('remedialQuizSection');
    const feedbackSection = document.getElementById('remedialFeedbackSection');
    const activitiesSection = document.getElementById('remedialActivitiesSection');

    if (!accordion || !quizSection || !feedbackSection || !activitiesSection) {
        console.error('renderRemedialRoomContent: Required DOM elements not found');
        return;
    }

    quizSection.style.display = 'none';
    feedbackSection.style.display = 'none';
    activitiesSection.style.display = 'block';

    const activities = item.activities || [];
    const submissions = item.activity_submissions || {};

    console.log('[Remedial] renderRemedialRoomContent called', {
        status: item.status,
        activitiesCount: activities.length,
        submissionsKeys: Object.keys(submissions)
    });

    let allActivitiesSubmitted = true;
    let currentActiveStep = -1;

    // Determine the current active step (first unsubmitted activity)
    // Use loose comparison for step values to handle string/number type mismatches from AI
    for (let i = 0; i < activities.length; i++) {
        const stepVal = activities[i].step;
        const stepKey = `activity${stepVal}`;
        console.log(`[Remedial] Checking step ${i}: stepVal=${stepVal} (${typeof stepVal}), stepKey=${stepKey}, exists=${!!submissions[stepKey]}`);
        if (!submissions[stepKey]) {
            currentActiveStep = stepVal;
            allActivitiesSubmitted = false;
            console.log(`[Remedial] Setting currentActiveStep to ${stepVal} (type: ${typeof stepVal})`);
            break;
        }
    }

    console.log('[Remedial] After loop:', { currentActiveStep, allActivitiesSubmitted });

    try {
        accordion.innerHTML = activities.map(act => {
            const stepVal = act.step;
            const stepKey = `activity${stepVal}`;
            const feedbackKey = `activity${stepVal}_feedback`;
            const stepSub = submissions[stepKey] || '';
            const stepFeedback = submissions[feedbackKey] || '';
            const hasSubmitted = stepSub.trim().length > 0;
            // Use loose equality (==) to handle string vs number type mismatches from AI-generated data
            const isActive = stepVal == currentActiveStep;
            const isLocked = !hasSubmitted && !isActive;

            console.log(`[Remedial] Step ${stepVal}: hasSubmitted=${hasSubmitted}, isActive=${isActive}, isLocked=${isLocked}, currentActiveStep=${currentActiveStep} (${typeof currentActiveStep})`);

            // Determine border color and background based on state
            let borderColor = '#94a3b8'; // locked - gray
            let bgColor = '#f8fafc';      // locked - light gray
            if (hasSubmitted) {
                borderColor = '#10b981';  // completed - green
                bgColor = '#f0fdf4';
            } else if (isActive) {
                borderColor = '#3b82f6';  // active - blue
                bgColor = '#faf5ff';
            }

            if (!isActive) {
                return '';
            }

            return `
            <div class="glass" style="padding: 18px; border-radius: 10px; border-left: 5px solid ${borderColor}; background: ${bgColor}; margin-bottom: 18px; ${isLocked ? 'opacity: 0.7;' : ''}">
                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
                    <h4 style="font-weight: bold; font-size: 1.1rem; margin: 0; color: #1e293b;">
                        Step ${stepVal}: ${act.title || ''}
                    </h4>
                    ${hasSubmitted ? '<span style="color:#10b981; font-size:0.85rem; background:#d1fae5; padding:3px 10px; border-radius:12px;"><i class="fas fa-check-circle"></i> Completed</span>' : ''}
                    ${isLocked ? '<span style="color:#94a3b8; font-size:0.85rem; background:#f1f5f9; padding:3px 10px; border-radius:12px;"><i class="fas fa-lock"></i> Locked</span>' : ''}
                    ${isActive && !hasSubmitted ? '<span style="color:#3b82f6; font-size:0.85rem; background:#dbeafe; padding:3px 10px; border-radius:12px;"><i class="fas fa-arrow-right"></i> Current Step</span>' : ''}
                </div>
                <p style="font-size: 0.9rem; color: #475569; margin-bottom: 12px; line-height: 1.5;"><strong>Objective:</strong> ${(act.objective || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                
                ${act.materials ? `
                <div style="font-size: 0.9rem; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 12px; line-height: 1.6;">
                    <strong style="color: #1e3a8a;"><i class="fas fa-book-open"></i> Reading Materials / Source:</strong><br>
                    ${String(act.materials).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}
                </div>
                ` : ''}

                <div style="font-size: 0.95rem; background: #fffbeb; padding: 14px; border-radius: 8px; border: 1px solid #fde68a; margin-bottom: 14px; line-height: 1.6; color: #92400e;">
                    <strong style="color: #b45309;"><i class="fas fa-list-check"></i> Instructions:</strong><br>
                    ${(act.instructions || act.instruction || act.step_instructions || 'Please read the objective and materials above carefully, then write your detailed answer and explanation in the input box below.').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
                </div>

                ${hasSubmitted ? `
                    <div style="font-size: 0.95rem; padding: 14px; background: #f1f5f9; border-radius: 8px; border-left: 4px solid #94a3b8; color: #334155; line-height: 1.5;">
                        <strong><i class="fas fa-pen"></i> Your Submission:</strong><br>
                        <span style="font-style: italic;">"${stepSub}"</span>
                        ${submissions['activity' + stepVal + '_attachment'] ? `<br><a href="${submissions['activity' + stepVal + '_attachment']}" target="_blank" style="display:inline-block; margin-top:8px; padding:6px 12px; background:#e2e8f0; color:#334155; text-decoration:none; border-radius:6px; font-size:0.85rem;"><i class="fas fa-paperclip"></i> View Attached File</a>` : ''}
                    </div>
                    ${stepFeedback ? `
                    <div style="margin-top: 12px; font-size: 0.9rem; padding: 12px; background: #dcfce7; border-radius: 8px; color: #166534; border-left: 4px solid #22c55e; line-height: 1.5;">
                        <strong><i class="fas fa-robot"></i> AI Feedback:</strong><br>${stepFeedback}
                    </div>
                    ` : ''}
                ` : isActive ? `
                    <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 5px;">
                        <label for="activityInput-${stepVal}" style="font-weight: 600; font-size: 0.9rem; color: #1e293b;">
                            <i class="fas fa-edit"></i> Your Answer:
                        </label>
                        <textarea id="activityInput-${stepVal}" class="form-control" style="width: 100%; min-height: 180px; border: 2px solid #3b82f6; border-radius: 10px; padding: 12px; font-size: 1rem; line-height: 1.5; resize: vertical;" placeholder="Type your own understanding and answers here..."></textarea>
                        
                        <!-- File Attachment -->
                        <div style="display: flex; align-items: center; gap: 10px; margin-top: 5px; margin-bottom: 5px;">
                            <label for="activityAttachment-${stepVal}" class="btn btn-secondary" style="background: #e2e8f0; color: #334155; padding: 8px 12px; border-radius: 8px; cursor: pointer; display: inline-block;">
                                <i class="fas fa-paperclip"></i> Attach File (Image/Doc)
                            </label>
                            <input type="file" id="activityAttachment-${stepVal}" accept="image/*,.pdf,.doc,.docx" style="display: none;" onchange="document.getElementById('activityAttachmentName-${stepVal}').innerText = this.files[0] ? this.files[0].name : ''">
                            <span id="activityAttachmentName-${stepVal}" style="font-size: 0.85rem; color: #64748b;"></span>
                        </div>

                        <button id="submitBtn-${stepVal}" class="btn btn-primary" onclick="submitRemedialActivity(${JSON.stringify(stepVal)})" style="align-self: flex-end; background: #3b82f6; color: white; border: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; font-size: 1rem; cursor: pointer; transition: background 0.2s;">
                            <i class="fas fa-paper-plane"></i> Submit Step ${stepVal}
                        </button>
                    </div>
                ` : isLocked ? `
                    <div style="font-size: 0.9rem; padding: 14px; background: #f1f5f9; border-radius: 8px; border-left: 4px solid #94a3b8; color: #94a3b8; text-align: center;">
                        <i class="fas fa-lock"></i> Complete the current step first to unlock this activity.
                    </div>
                ` : ''}
            </div>
            `;
        }).join('');
    } catch (e) {
        console.error('[Remedial] Error rendering activities:', e);
        accordion.innerHTML = `<div class="alert alert-danger">Error rendering activities: ${e.message}</div>`;
    }

    if (allActivitiesSubmitted) {
        const currentItemStatus = String(item.status).trim().toLowerCase();
        if (currentItemStatus === 'pending' || currentItemStatus === 'in_progress') {
            activitiesSection.style.display = 'none';
            quizSection.style.display = 'block';
            window.renderRemedialQuiz();
        } else if (currentItemStatus === 'quiz_completed') {
            activitiesSection.style.display = 'none';
            feedbackSection.style.display = 'block';
            document.getElementById('remedialFeedbackText').innerText = "You have completed the activities and quiz. Awaiting your teacher's final AI qualitative review and grade evaluation.";
            document.getElementById('remedialStatusText').innerHTML = `Quiz Score: <span style="color:#10b981;">${item.quiz_score}/10</span>`;
        } else if (currentItemStatus === 'evaluated') {
            activitiesSection.style.display = 'none';
            feedbackSection.style.display = 'block';
            document.getElementById('remedialFeedbackText').innerHTML = `<strong>Teacher Feedback:</strong><br>${item.feedback || 'Great job!'}`;
            document.getElementById('remedialStatusText').innerHTML = `
                Quiz Score: <span style="color:#10b981;">${item.quiz_score}/10</span><br>
                Remedial Grade: <span style="color:${item.passed ? '#10b981' : '#ef4444'};">${item.passed ? 'PASSED (Mastered)' : 'FAILED (Needs Review)'}</span>
            `;
        }
    }
};

window.submitRemedialActivity = async function (step) {
    // Normalize step to number for consistent key generation
    const stepNum = Number(step);
    const textVal = document.getElementById(`activityInput-${stepNum}`).value;
    const fileInput = document.getElementById(`activityAttachment-${stepNum}`);
    const file = fileInput ? fileInput.files[0] : null;
    const btn = document.getElementById(`submitBtn-${stepNum}`);
    
    if (!textVal.trim() && !file) {
        alert('Please write your submission answer or attach a file.');
        return;
    }

    const originalBtnText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
    btn.disabled = true;

    try {
        const token = localStorage.getItem('studentToken');
        const formData = new FormData();
        formData.append('activityStep', stepNum);
        formData.append('studentAnswer', textVal);
        if (file) {
            formData.append('attachment', file);
        }

        const res = await fetch(`/api/student/remedial/${currentRemedialProgram.id}/submit-activity`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        const data = await res.json();
        if (res.ok) {
            currentRemedialProgram.activity_submissions[`activity${stepNum}`] = textVal || 'Attached File';
            currentRemedialProgram.activity_submissions[`activity${stepNum}_feedback`] = data.feedback;
            if (data.attachment) {
                currentRemedialProgram.activity_submissions[`activity${stepNum}_attachment`] = data.attachment;
            }

            // Update status to in_progress after any successful submission (backend also does this)
            currentRemedialProgram.status = 'in_progress';

            // Celebration - use non-blocking confetti if available, otherwise just re-render
            if (typeof confetti === 'function') {
                confetti();
            }

            window.renderRemedialRoomContent();

            // Scroll to the newly revealed step
            setTimeout(() => {
                const nextStepNum = stepNum + 1;
                const nextInput = document.getElementById(`activityInput-${nextStepNum}`);
                if (nextInput) {
                    nextInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    nextInput.focus();
                }
            }, 100);
        } else {
            alert(data.error || 'Failed to submit activity.');
            btn.innerHTML = originalBtnText;
            btn.disabled = false;
        }
    } catch (e) {
        console.error(e);
        alert('Error submitting activity. Please try again.');
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
    }
};

window.renderRemedialQuiz = function () {
    const container = document.getElementById('quizQuestionsContainer');
    const questions = currentRemedialProgram.quiz_questions || [];

    container.innerHTML = questions.map(q => {
        // Safe extraction of options/choices
        let opts = q.options || q.choices || {};
        
        // If opts is a string, try parsing it
        if (typeof opts === 'string') {
            try {
                opts = JSON.parse(opts);
            } catch (e) {
                // Ignore
            }
        }

        // Convert to standard object: { A: "...", B: "...", C: "...", D: "..." }
        let optionsObj = {};
        if (Array.isArray(opts)) {
            const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
            opts.forEach((val, idx) => {
                const label = labels[idx] || `Choice ${idx + 1}`;
                optionsObj[label] = val;
            });
        } else if (typeof opts === 'object' && opts !== null) {
            Object.entries(opts).forEach(([key, val]) => {
                optionsObj[key.toUpperCase()] = val;
            });
        } else {
            optionsObj = {
                "A": opts || "Option A",
                "B": "Option B",
                "C": "Option C",
                "D": "Option D"
            };
        }

        return `
            <div class="quiz-question" style="background: #ffffff; padding: 20px; border-radius: 12px; border: 1px solid #cbd5e1; color: #1e293b; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); margin-bottom: 15px;">
                <p style="font-weight: 700; margin-bottom: 15px; font-size: 1.05rem; color: #1e3a8a;">${q.number}. ${q.question}</p>
                <div class="remedial-options-list" style="display: flex; flex-direction: column; gap: 10px;">
                    ${Object.entries(optionsObj).map(([opt, val]) => {
                        const name = `remedial-q-${q.number}`;
                        const uniqueId = `remedial-q-${q.number}-${opt}`;
                        return `
                            <label class="remedial-option-item" for="${uniqueId}" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: #f8fafc; color: #334155;">
                                <input type="radio" id="${uniqueId}" name="${name}" value="${opt}" required style="width: 18px; height: 18px; cursor: pointer; accent-color: #10b981; margin: 0;">
                                <span style="font-size: 0.95rem; line-height: 1.4; color: #334155;">
                                    <strong style="color: #1e293b; margin-right: 5px;">${opt}.</strong> ${val}
                                </span>
                            </label>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');

    // Add interactivity to the labels when selected (similar to exam view)
    container.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', function () {
            const name = this.getAttribute('name');
            // Reset all options for this question
            container.querySelectorAll(`input[name="${name}"]`).forEach(r => {
                const parentLabel = r.closest('.remedial-option-item');
                if (parentLabel) {
                    parentLabel.style.borderColor = '#e2e8f0';
                    parentLabel.style.background = '#f8fafc';
                    parentLabel.style.color = '#334155';
                    const spanText = parentLabel.querySelector('span');
                    if (spanText) spanText.style.color = '#334155';
                }
            });
            // Highlight selected option
            if (this.checked) {
                const parentLabel = this.closest('.remedial-option-item');
                if (parentLabel) {
                    parentLabel.style.borderColor = '#10b981';
                    parentLabel.style.background = '#f0fdf4';
                    parentLabel.style.color = '#15803d';
                    const spanText = parentLabel.querySelector('span');
                    if (spanText) spanText.style.color = '#15803d';
                }
            }
        });
    });
};

window.submitRemedialQuiz = async function () {
    const questions = currentRemedialProgram.quiz_questions || [];
    const answers = {};

    for (const q of questions) {
        const selected = document.querySelector(`input[name="remedial-q-${q.number}"]:checked`);
        if (!selected) {
            alert(`Please answer question number ${q.number}.`);
            return;
        }
        answers[q.number] = selected.value;
    }

    if (!confirm('Are you sure you want to submit your quiz? This will lock your remedial answers.')) return;

    try {
        const token = localStorage.getItem('studentToken');
        const res = await fetch(`/api/student/remedial/${currentRemedialProgram.id}/submit-quiz`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ answers })
        });

        const data = await res.json();
        if (res.ok) {
            currentRemedialProgram.quiz_score = data.score;
            currentRemedialProgram.passed = data.passed;
            currentRemedialProgram.status = data.passed ? 'evaluated' : 'quiz_completed';

            if (data.passed) {
                if (typeof confetti === 'function') {
                    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                }
                alert(`🎉 Congratulations! You scored ${data.score}/10 and have PASSED the remediation!`);
            } else {
                alert(`You scored ${data.score}/10. Please wait for your teacher's feedback.`);
            }

            window.renderRemedialRoomContent();
        } else {
            alert(data.error || 'Failed to submit quiz.');
        }
    } catch (e) {
        console.error(e);
        alert('Error submitting quiz.');
    }
};

let pendingTutorImageBase64 = null;
let pendingTutorImageMime = null;
let pendingTutorImageName = null;

window.handleTutorChatImageSelect = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file.');
        event.target.value = '';
        return;
    }

    pendingTutorImageName = file.name;
    pendingTutorImageMime = file.type;

    const reader = new FileReader();
    reader.onload = function (e) {
        pendingTutorImageBase64 = e.target.result;
        
        const previewContainer = document.getElementById('tutorImagePreviewContainer');
        const fileNameSpan = document.getElementById('tutorImageFileName');
        if (fileNameSpan) fileNameSpan.textContent = file.name;
        if (previewContainer) previewContainer.style.display = 'flex';

        // Dynamically update model badge UI to Gemini
        const modelBadge = document.getElementById('kortixModelBadge');
        if (modelBadge) {
            modelBadge.style.background = '#fef3c7';
            modelBadge.style.color = '#b45309';
            modelBadge.innerHTML = '<i class="fas fa-eye"></i> Powered by Gemini';
        }
    };
    reader.readAsDataURL(file);
};

window.clearTutorChatImage = function () {
    pendingTutorImageBase64 = null;
    pendingTutorImageMime = null;
    pendingTutorImageName = null;

    const fileInput = document.getElementById('tutorChatImageInput');
    if (fileInput) fileInput.value = '';

    const previewContainer = document.getElementById('tutorImagePreviewContainer');
    if (previewContainer) previewContainer.style.display = 'none';

    // Reset model badge UI back to DeepSeek
    const modelBadge = document.getElementById('kortixModelBadge');
    if (modelBadge) {
        modelBadge.style.background = '#e0e7ff';
        modelBadge.style.color = '#3730a3';
        modelBadge.innerHTML = '<i class="fas fa-bolt"></i> Powered by DeepSeek';
    }
};

window.sendTutorChatMessage = async function () {
    const input = document.getElementById('tutorChatInput');
    const msg = input.value.trim();
    const hasImage = !!pendingTutorImageBase64;

    if (!msg && !hasImage) return;

    input.value = '';

    const imgBase64ToSend = pendingTutorImageBase64;
    const imgMimeToSend = pendingTutorImageMime;

    // Clear attachment state and reset badge
    clearTutorChatImage();

    const chatBox = document.getElementById('tutorChatMessages');
    let userMsgHtml = `<div style="background: #3b82f6; color: white; padding: 8px 12px; border-radius: 8px; align-self: flex-end; max-width: 85%; font-size: 0.9rem;">`;
    if (hasImage && imgBase64ToSend) {
        userMsgHtml += `<div style="margin-bottom: 6px;"><img src="${imgBase64ToSend}" style="max-width: 100%; max-height: 150px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.3);" /></div>`;
    }
    userMsgHtml += `${msg || '<i>[Sent an image for analysis]</i>'}</div>`;

    chatBox.innerHTML += userMsgHtml;
    chatBox.scrollTop = chatBox.scrollHeight;

    const loadingId = 'tutor-chat-loading-' + Date.now();
    const isGeminiCall = hasImage;
    chatBox.innerHTML += `
        <div id="${loadingId}" style="background: #e2e8f0; padding: 8px 12px; border-radius: 8px; align-self: flex-start; max-width: 85%; font-size: 0.9rem; color: #64748b;">
            <i class="fas fa-spinner fa-spin"></i> ${isGeminiCall ? 'Kortix AI (Powered by Gemini) is analyzing image...' : 'Kortix AI is thinking...'}
        </div>
    `;
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        const token = localStorage.getItem('studentToken');
        const res = await fetch(`/api/student/remedial/${currentRemedialProgram.id}/chat`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: msg,
                chatHistory: currentTutorChatHistory,
                imageBase64: imgBase64ToSend,
                mimeType: imgMimeToSend
            })
        });

        const data = await res.json();

        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        if (res.ok) {
            const badgeLabel = data.modelUsed === 'Gemini' 
                ? '<span style="font-size: 0.75rem; font-weight: 600; color: #b45309; background: #fef3c7; padding: 2px 6px; border-radius: 6px; margin-bottom: 4px; display: inline-block;"><i class="fas fa-eye"></i> Gemini Vision</span><br/>'
                : '';

            chatBox.innerHTML += `
                <div style="background: #e2e8f0; padding: 8px 12px; border-radius: 8px; align-self: flex-start; max-width: 85%; font-size: 0.9rem; color: #334155;">
                    ${badgeLabel}${data.reply}
                </div>
            `;
            chatBox.scrollTop = chatBox.scrollHeight;

            currentTutorChatHistory.push({ role: 'user', text: msg + (hasImage ? ' [Attached Image]' : '') });
            currentTutorChatHistory.push({ role: 'assistant', text: data.reply });
        } else {
            chatBox.innerHTML += `
                <div style="background: #fee2e2; padding: 8px 12px; border-radius: 8px; align-self: flex-start; max-width: 85%; font-size: 0.9rem; color: #b91c1c;">
                    Error: ${data.error || 'Failed to send message.'}
                </div>
            `;
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    } catch (e) {
        console.error(e);
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        chatBox.innerHTML += `
            <div style="background: #fee2e2; padding: 8px 12px; border-radius: 8px; align-self: flex-start; max-width: 85%; font-size: 0.9rem; color: #b91c1c;">
                Error: Connection failed.
            </div>
        `;
        chatBox.scrollTop = chatBox.scrollHeight;
    }
};

// Account Settings Methods
window.uploadProfilePhoto = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('photo', file);

    try {
        const response = await fetch(`${API_URL}/upload-photo`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });

        const data = await response.json();
        if (response.ok) {
            alert('Profile picture updated successfully!');
            loadProfile(); // Reload profile to show new picture
        } else {
            alert(data.error || 'Failed to upload photo');
        }
    } catch (error) {
        console.error('Photo upload error:', error);
        alert('An error occurred during upload.');
    }
};

window.showChangePasswordModal = () => {
    document.getElementById('changePasswordModal').style.display = 'block';
    document.getElementById('passwordError').style.display = 'none';
};

window.hideChangePasswordModal = () => {
    document.getElementById('changePasswordModal').style.display = 'none';
    document.getElementById('changePasswordForm').reset();
};

window.submitChangePassword = async (event) => {
    event.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;
    const errorDiv = document.getElementById('passwordError');

    if (newPassword !== confirmPassword) {
        errorDiv.textContent = 'New passwords do not match!';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword
            })
        });

        const data = await response.json();
        if (response.ok) {
            alert('Password changed successfully!');
            hideChangePasswordModal();
        } else {
            errorDiv.textContent = data.error || 'Failed to change password';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Change password error:', error);
        errorDiv.textContent = 'Server error. Please try again.';
        errorDiv.style.display = 'block';
    }
};

window.processEnrollment = () => {
    if (!profileData || !profileData.lrn) {
        alert('Unable to load student data. Please try again.');
        return;
    }

    const lrn = profileData.lrn;
    const nextGrade = (profileData.grade_level || 0) + 1;
    // Redirect to the Regular Enrollment portal
    let baseUrl;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        baseUrl = `http://${window.location.hostname}:3008`;
    } else {
        const enrollHost = window.location.hostname.replace('-portal', '-enrollment');
        baseUrl = `https://${enrollHost}`;
    }
    const url = `${baseUrl}/index.html?lrn=${lrn}&grade_level=${nextGrade}&enrollment_type=Old Student`;

    if (confirm(`You will be redirected to the Regular Enrollment Registration page for Grade ${nextGrade}. Proceed?`)) {
        window.open(url, '_blank');
    }
};

// ==================== BMI LOGIC ====================
window.loadBMIData = async () => {
    try {
        const heightInput = document.getElementById('studentInputHeight');
        const weightInput = document.getElementById('studentInputWeight');

        // Auto-fill from profileData if available
        if (profileData) {
            if (profileData.height_m) heightInput.value = profileData.height_m;
            if (profileData.weight_kg) weightInput.value = profileData.weight_kg;
            updateBMIResult();
        }
    } catch (e) {
        console.error('Error loading BMI data:', e);
    }
};

function updateBMIResult() {
    const h = parseFloat(document.getElementById('studentInputHeight').value);
    const w = parseFloat(document.getElementById('studentInputWeight').value);
    const resultDiv = document.getElementById('studentBMIResult');

    if (h > 0 && w > 0) {
        const bmi = (w / (h * h)).toFixed(2);
        let status = 'Normal';
        let color = '#2ecc71';

        if (bmi < 14.0) { status = 'Severely Wasted'; color = '#e74c3c'; }
        else if (bmi < 15.0) { status = 'Wasted'; color = '#f39c12'; }
        else if (bmi >= 25.0) { status = 'Obese'; color = '#e74c3c'; }
        else if (bmi >= 22.0) { status = 'Overweight'; color = '#f39c12'; }

        resultDiv.innerHTML = `Your BMI is <span style="font-size: 1.2em;">${bmi}</span> (<span style="color: ${color};">${status}</span>)`;
        resultDiv.style.display = 'block';
        resultDiv.style.backgroundColor = color + '22';
        resultDiv.style.color = '#333';
    } else {
        resultDiv.style.display = 'none';
    }
}

// Add event listeners for auto-calculation
document.addEventListener('DOMContentLoaded', () => {
    const hInput = document.getElementById('studentInputHeight');
    const wInput = document.getElementById('studentInputWeight');
    if (hInput) hInput.addEventListener('input', updateBMIResult);
    if (wInput) wInput.addEventListener('input', updateBMIResult);
});

window.submitStudentBMI = async () => {
    const height = parseFloat(document.getElementById('studentInputHeight').value);
    const weight = parseFloat(document.getElementById('studentInputWeight').value);

    if (!height || !weight || height <= 0 || weight <= 0) {
        alert('Please enter valid height and weight.');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/bmi`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ height_m: height, weight_kg: weight })
        });

        const data = await response.json();

        if (response.ok) {
            alert('Your Nutritional Status has been updated and sent to your adviser successfully!');
            // Update local profile data
            if (profileData) {
                profileData.height_m = height;
                profileData.weight_kg = weight;
            }
        } else {
            alert(data.error || 'Failed to update nutritional data.');
        }
    } catch (e) {
        console.error('Error submitting BMI:', e);
        alert('Server error while saving BMI data. Please try again.');
    }
};

let lastStudentScheduleData = null;

window.loadStudentSchedule = async function () {
    const container = document.getElementById('studentScheduleContainer');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center; padding:30px; color:#cbd5e1;"><i class="fas fa-spinner fa-spin"></i> Loading schedule...</div>';

    try {
        const data = await apiRequest('/schedule');
        if (!data || !data.section) {
            container.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8; font-style:italic;"><i class="fas fa-info-circle" style="font-size:1.5rem; margin-bottom:10px; display:block;"></i> You are not assigned to a section. Please contact your adviser.</div>';
            return;
        }

        lastStudentScheduleData = data;
        const { schedules, templates, section, signatories, activeAY } = data;
        const yearText = activeAY ? (activeAY.year || activeAY.year_range) : '2026-2027';

        function formatShortName(firstName, lastName) {
            if (!firstName || !lastName) return firstName || lastName || '';
            return `${firstName[0].toUpperCase()}. ${lastName}`;
        }

        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const timeBlocks = templates && templates.length > 0 ? templates : [
            { start_time: '06:45:00', end_time: '07:00:00', label: 'Flag Ceremony', is_break: true },
            { start_time: '07:00:00', end_time: '08:00:00', label: 'Period 1' },
            { start_time: '08:00:00', end_time: '09:00:00', label: 'Period 2' },
            { start_time: '09:00:00', end_time: '10:00:00', label: 'Period 3' },
            { start_time: '10:00:00', end_time: '10:15:00', label: 'RECESS', is_break: true },
            { start_time: '10:15:00', end_time: '11:15:00', label: 'Period 4' },
            { start_time: '11:15:00', end_time: '12:15:00', label: 'Period 5' }
        ];

        let html = `
            <div class="report-document" style="padding: 30px; font-family: 'Times New Roman', serif; max-width: 950px; margin: auto; background: white; color: black; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #ddd; overflow-x: auto;">
                <div class="report-header" style="text-align: center; margin-bottom: 15px; color: black;">
                    <div style="display: flex; justify-content: center; align-items: center; gap: 15px; margin-bottom: 5px;">
                        <img src="/logo.png" style="width: 65px; height: auto; object-fit: contain;" onerror="this.style.display='none'">
                        <div style="text-align: center;">
                            <p style="margin:0; font-size: 11px; color: black;">Republic of the Philippines</p>
                            <p style="margin:0; font-weight:bold; font-size: 13px; color: black;">DEPARTMENT OF EDUCATION</p>
                            <p style="margin:0; font-size: 11px; color: black;">Region IV-B MIMAROPA</p>
                            <p style="margin:0; font-size: 11px; color: black;">Division of Oriental Mindoro</p>
                        </div>
                        <div style="width: 65px;"></div>
                    </div>
                    <h3 style="margin: 5px 0; font-size: 14px; font-weight: bold; color: #000; letter-spacing: 0.5px;">DOROTEO S. MENDOZA SR. MEMORIAL NATIONAL HIGH SCHOOL</h3>
                    <p style="margin:0; font-size: 10px; color: #4b5563;">Pagkakaisa, Naujan, Oriental Mindoro</p>
                    <div style="border-bottom: 2px solid black; margin: 8px auto; width: 100%;"></div>
                    <h2 style="margin: 5px 0; font-size: 18px; font-weight: bold; color: black;">CLASS PROGRAM</h2>
                    <p style="font-size: 12px; color: black; margin: 2px 0;">S. Y. ${yearText}</p>
                </div>

                <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 6px; color: black;">
                    <div>
                        <p style="margin:2px 0; color: black;"><strong>Grade & Section:</strong> Grade ${section.grade_level} - ${section.section_name}</p>
                        <p style="margin:2px 0; color: black;"><strong>Program:</strong> ${section.program_type || 'Regular'}</p>
                    </div>
                    <div style="text-align: right;">
                        <p style="margin:2px 0; color: black;"><strong>Room:</strong> ${section.room || 'TBA'}</p>
                        <p style="margin:2px 0; color: black;"><strong>Adviser:</strong> ${section.adviser ? (section.adviser.last_name + ', ' + section.adviser.first_name + (section.adviser.middle_name ? ' ' + section.adviser.middle_name[0].toUpperCase() + '.' : '')).toUpperCase() : 'TBA'}</p>
                    </div>
                </div>

                <table style="width: 100%; border-collapse: collapse; border: 2px solid black; font-size: 11px; color: black; background: white; margin-bottom: 20px;">
                    <thead>
                        <tr style="background: #f1f5f9; color: black;">
                            <th style="border: 1px solid black; padding: 6px; width: 110px; text-align: center; font-weight: bold; color: black;">Time</th>
                            ${days.map(d => `<th style="border: 1px solid black; padding: 6px; text-align: center; font-weight: bold; color: black;">${d}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
        `;

        timeBlocks.forEach(block => {
            const startLabel = block.start_time.slice(0, 5);
            const endLabel = block.end_time.slice(0, 5);
            const blockLabel = block.label || `${startLabel} - ${endLabel}`;

            html += `<tr>
                <td style="border: 1px solid black; padding: 6px; text-align: center; font-weight: bold; color: black; white-space: nowrap;">${startLabel} - ${endLabel}</td>`;

            if (block.is_break) {
                html += `<td colspan="5" style="border: 1px solid black; padding: 6px; text-align: center; font-style: italic; background: #e2e8f0; font-weight: bold; color: black; letter-spacing: 2px;">
                    ${blockLabel.toUpperCase()}
                </td>`;
            } else {
                days.forEach(day => {
                    const match = schedules.filter(s =>
                        s.day === day &&
                        s.start_time.startsWith(startLabel)
                    );

                    html += `<td style="border: 1px solid black; padding: 6px; text-align: center; min-height: 45px; color: black; vertical-align: middle;">`;
                    if (match.length > 0) {
                        const tleSlots = match.filter(s => s.subject_name.includes('TLE') || s.is_combination_class);
                        if (tleSlots.length > 1) {
                            const names = tleSlots.map(s => {
                                const t = s.Teacher || s.teacher;
                                return t ? formatShortName(t.first_name, t.last_name) : '';
                            }).filter(n => n).join(' / ');
                            html += `<div><strong>TLE</strong><br><small style="color: #374151;">${names}</small></div>`;
                        } else {
                            match.forEach(slot => {
                                const t = slot.Teacher || slot.teacher;
                                html += `<div style="margin-bottom: 2px;">
                                    <strong>${slot.subject_name}</strong><br>
                                    <small style="color: #374151;">${t ? formatShortName(t.first_name, t.last_name) : ''}</small>
                                    ${slot.room ? `<br><small style="color: #6b7280; font-style: italic;">${slot.room}</small>` : ''}
                                </div>`;
                            });
                        }
                    }
                    html += `</td>`;
                });
            }
            html += `</tr>`;
        });

        html += `
                    </tbody>
                </table>

                <div style="margin-top: 25px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 30px; font-size: 11px; color: black;">
                    ${signatories && signatories.length > 0 ? signatories.map(sig => `
                        <div style="text-align: left; color: black;">
                            <p style="margin: 0 0 25px 0; color: black;">${sig.label || 'Approved by:'}</p>
                            <p style="text-decoration: underline; font-weight: bold; margin: 0; color: black;">${(sig.name || '').toUpperCase()}</p>
                            <p style="margin: -2px 0 0 0; color: #374151; font-size: 10px;">${sig.position || ''}</p>
                        </div>
                    `).join('') : ''}
                </div>
            </div>
        `;

        container.innerHTML = html;

    } catch (error) {
        console.error('Error loading schedule:', error);
        container.innerHTML = '<div style="text-align:center; padding:30px; color:#ef4444;"><i class="fas fa-exclamation-triangle"></i> Failed to load schedule data.</div>';
    }
};

window.printStudentSchedule = function () {
    if (!lastStudentScheduleData || !lastStudentScheduleData.section) {
        alert('No schedule data loaded to print.');
        return;
    }

    const { schedules, templates, section, signatories, activeAY } = lastStudentScheduleData;
    const yearText = activeAY ? activeAY.year || activeAY.year_range : '2026-2027';

    function formatShortName(firstName, lastName) {
        if (!firstName || !lastName) return firstName || lastName || '';
        return `${firstName[0].toUpperCase()}. ${lastName}`;
    }

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const timeBlocks = templates && templates.length > 0
        ? templates.map(t => ({ start: t.start_time.slice(0, 5), end: t.end_time.slice(0, 5), label: t.label, isBreak: t.is_break }))
        : [
            { start: '06:45', end: '07:00', label: 'Flag Ceremony', isBreak: true },
            { start: '07:00', end: '08:00', label: '07:00 - 08:00' },
            { start: '08:00', end: '09:00', label: '08:00 - 09:00' },
            { start: '09:00', end: '10:00', label: '09:00 - 10:00' },
            { start: '10:00', end: '10:15', label: 'RECESS', isBreak: true },
            { start: '10:15', end: '11:15', label: '10:15 - 11:15' },
            { start: '11:15', end: '12:15', label: '11:15 - 12:15' },
            { start: '12:15', end: '13:00', label: 'LUNCH BREAK', isBreak: true },
            { start: '13:00', end: '14:00', label: '13:00 - 14:00' },
            { start: '14:00', end: '15:00', label: '14:00 - 15:00' },
            { start: '15:00', end: '16:00', label: '15:00 - 16:00' }
        ];

    let html = `
        <div class="report-document" style="padding: 20px; font-family: 'Times New Roman', serif; max-width: 900px; margin: auto; background: white; color: black;">
            <div class="report-header text-center" style="text-align: center; margin-bottom: 15px;">
                <img src="deped_seal.png" style="width: 70px; margin-bottom: 10px;">
                <p style="margin:0; font-size: 11px;">Republic of the Philippines</p>
                <p style="margin:0; font-weight:bold; font-size: 13px;">DEPARTMENT OF EDUCATION</p>
                <p style="margin:0; font-size: 11px;">Region IV-B MIMAROPA</p>
                <p style="margin:0; font-size: 11px;">Division of Oriental Mindoro</p>
                <h3 style="margin: 5px 0; font-size: 15px; font-weight: bold;">DOROTEO S. MENDOZA SR. MEMORIAL NATIONAL HIGH SCHOOL</h3>
                <p style="margin:0; font-size: 10px;">Pagkakaisa, Naujan, Oriental Mindoro</p>
                <hr style="border: 1px solid black; margin: 10px 0;">
                <h2 style="margin: 5px 0; font-size: 18px; font-weight: bold;">CLASS PROGRAM</h2>
                <p style="font-size: 13px;">S. Y. ${yearText} | Term 1</p>
            </div>

            <div class="report-info" style="display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 8px;">
                <div>
                    <p style="margin:2px 0;"><strong>Grade & Section:</strong> Grade ${section.grade_level} - ${section.section_name}</p>
                    <p style="margin:2px 0;"><strong>Program:</strong> ${section.program_type || 'Regular'}</p>
                </div>
                <div style="text-align: right;">
                    <p style="margin:2px 0;"><strong>Room:</strong> ${section.room || 'TBA'}</p>
                    <p style="margin:2px 0;"><strong>Adviser:</strong> ${section.adviser ? (section.adviser.last_name + ', ' + section.adviser.first_name + (section.adviser.middle_name ? ' ' + section.adviser.middle_name[0].toUpperCase() + '.' : '')).toUpperCase() : 'TBA'}</p>
                </div>
            </div>

            <table class="report-table" style="width: 100%; border-collapse: collapse; border: 2px solid black; font-size: 11px; color: black; background: white;">
                <thead>
                    <tr style="background: #f8fafc;">
                        <th style="border: 1px solid black; padding: 6px; width: 110px; text-align: center; font-weight: bold; color: black;">Time</th>
                        ${days.map(d => `<th style="border: 1px solid black; padding: 6px; text-align: center; font-weight: bold; color: black;">${d}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
    `;

    timeBlocks.forEach(block => {
        html += `<tr><td style="border: 1px solid black; padding: 6px; text-align: center; font-weight: bold; color: black;">${block.start} - ${block.end}</td>`;
        if (block.isBreak) {
            html += `<td colspan="5" style="border: 1px solid black; padding: 6px; text-align: center; font-style: italic; background: #f1f5f9; font-weight: bold; color: black;">${block.label.toUpperCase()}</td>`;
        } else {
            days.forEach(day => {
                const slots = schedules.filter(s => s.day === day && s.start_time.startsWith(block.start));
                html += `<td style="border: 1px solid black; padding: 6px; text-align: center; min-height: 45px; color: black;">`;
                if (slots.length > 0) {
                    const tleSlots = slots.filter(s => s.subject_name.includes('TLE') || s.is_combination_class);
                    if (tleSlots.length > 1) {
                        const names = tleSlots.map(s => {
                            const t = s.Teacher || s.teacher;
                            return t ? formatShortName(t.first_name, t.last_name) : '';
                        }).filter(n => n).join(' / ');
                        html += `<div><strong>TLE</strong><br><small style="color: #4b5563;">${names}</small></div>`;
                    } else {
                        slots.forEach(s => {
                            const t = s.Teacher || s.teacher;
                            html += `<div style="margin-bottom:2px;"><strong>${s.subject_name}</strong><br><small style="color: #4b5563;">${t ? formatShortName(t.first_name, t.last_name) : ''}</small></div>`;
                        });
                    }
                }
                html += `</td>`;
            });
        }
        html += `</tr>`;
    });

    html += `
                </tbody>
            </table>

            <div class="report-signatories" style="margin-top: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; font-size: 11px;">
                ${signatories && signatories.length > 0 ? signatories.map(sig => `
                    <div class="signatory-item" style="text-align: left; color: black;">
                        <p style="margin: 0 0 20px 0;">${sig.label || 'Approved by:'}</p>
                        <br>
                        <p class="sig-name" style="text-decoration: underline; font-weight: bold; margin: 0;">${(sig.name || '').toUpperCase()}</p>
                        <p class="sig-pos" style="margin: -2px 0 0 0; color: #4b5563;">${sig.position || ''}</p>
                    </div>
                `).join('') : ''}
            </div>
        </div>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Weekly Class Program</title>
                <style>
                    body { font-family: 'Times New Roman', serif; padding: 20px; background: white; color: black; }
                    .report-document { width: 100%; }
                    .text-center { text-align: center; }
                    .report-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    .report-table th, .report-table td { border: 1px solid black; padding: 8px; text-align: center; }
                    @page { margin: 1cm; size: landscape; }
                    @media print {
                        body { margin: 0; }
                    }
                </style>
            </head>
            <body onload="window.print(); window.close();">
                ${html}
            </body>
        </html>
    `);
    printWindow.document.close();
};

// ==========================================
// ARAL TUTOR LOGIC
// ==========================================
let aralRecognition = null;
let isAralListening = false;
let aralMicActive = false;
let aralTranscript = "";
let aralSelectedLang = "en";
let aralStartTime = null;
let aralEndTime = null;

let aralHasEnglishPlan = false;
let aralHasFilipinoPlan = false;

async function loadAralTutor() {
    // Reset UI state
    document.getElementById('aralTutorContent').style.display = 'block';
    document.getElementById('aralTutorInterface').style.display = 'none';
    document.getElementById('aralSubmitBtn').style.display = 'none';
    aralTranscript = "";
    aralStartTime = null;
    aralEndTime = null;

    // Check if the student already has an active plan (Daily Tutorial Phase) or needs Diagnostic
    document.getElementById('aralEnglishStatusBtn').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    document.getElementById('aralFilipinoStatusBtn').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    
    try {
        const res = await apiRequest('/aral-status');
        if (res) {
            aralHasEnglishPlan = res.hasEnglishPlan;
            aralHasFilipinoPlan = res.hasFilipinoPlan;
            
            if (aralHasEnglishPlan) {
                document.getElementById('aralEnglishStatusBtn').innerHTML = '<i class="fas fa-robot"></i> Enter Tutorial Room';
            } else {
                document.getElementById('aralEnglishStatusBtn').innerHTML = '<i class="fas fa-play"></i> Take Diagnostic First';
            }
            
            if (aralHasFilipinoPlan) {
                document.getElementById('aralFilipinoStatusBtn').innerHTML = '<i class="fas fa-robot"></i> Enter Tutorial Room';
            } else {
                document.getElementById('aralFilipinoStatusBtn').innerHTML = '<i class="fas fa-play"></i> Take Diagnostic First';
            }
        }
    } catch (e) {
        document.getElementById('aralEnglishStatusBtn').innerHTML = '<i class="fas fa-play"></i> Take Diagnostic First';
        document.getElementById('aralFilipinoStatusBtn').innerHTML = '<i class="fas fa-play"></i> Take Diagnostic First';
    }
}

function enterAralRoom(lang) {
    aralSelectedLang = lang;
    const hasPlan = lang === 'en' ? aralHasEnglishPlan : aralHasFilipinoPlan;
    
    if (hasPlan) {
        startAralTutorial();
    } else {
        alert("You must complete the Initial Reading Diagnostic Test for this language before entering the AI Room.");
        startAralDiagnostic();
    }
}

const aralPassages = {
    en: {
        title: "The Mysterious Forest (English Diagnostic)",
        text: "<p>One sunny afternoon, a young boy named Leo decided to explore the mysterious forest behind his house. He had always been told to stay away from the dense woods, but today, his curiosity got the better of him. As he walked deeper, the ancient trees seemed to whisper secrets to one another, and the bright sunlight barely broke through the thick, green canopy.</p><p>Suddenly, he heard a faint rustling sound coming from a nearby bush. Leo stopped in his tracks, his heart racing. He cautiously approached the bush, wondering if it was a wild animal or perhaps something magical. To his surprise, a small, injured bird fluttered out.</p><p>Leo knew he had to help it, realizing that the forest wasn't as scary as he thought—it just needed someone who cared. He gently scooped the bird into his hands, making sure not to hurt its fragile wings. The bird chirped softly, as if thanking him for his kindness.</p><p>When he finally returned home, his mother helped him build a small nest in a shoebox. Over the next few weeks, Leo fed the bird and watched it regain its strength. When the day came to release it back into the sky, Leo felt a sense of pride, knowing he had made a true friend in the very forest he once feared.</p>"
    },
    ph: {
        title: "Ang Mahiwagang Gubat (Filipino Diagnostic)",
        text: "<p>Isang maaraw na hapon, nagpasya ang isang batang lalaki na nagngangalang Leo na galugarin ang mahiwagang gubat sa likod ng kanilang bahay. Palagi siyang pinagsasabihan na lumayo sa makakapal na kakahuyan, ngunit ngayon, nanaig ang kanyang kuryosidad. Habang siya ay naglalakad nang mas malalim, tila nagbubulungan ng mga lihim ang mga sinaunang puno, at halos hindi makalusot ang sikat ng araw sa makapal na kulandong ng mga dahon.</p><p>Bigla siyang nakarinig ng mahinang kaluskos mula sa isang malapit na palumpong. Tumigil si Leo sa paglalakad, mabilis ang pintig ng kanyang puso. Maingat siyang lumapit, nagtataka kung ito ba ay isang ligaw na hayop o marahil isang bagay na mahiwaga. Sa kanyang gulat, isang maliit at sugatang ibon ang lumipad palabas.</p><p>Alam ni Leo na kailangan niya itong tulungan, at napagtanto niya na ang gubat ay hindi pala nakakatakot tulad ng kanyang iniisip—kailangan lang nito ng taong may malasakit. Dahan-dahan niyang kinuha ang ibon gamit ang kanyang mga kamay, sinisiguradong hindi masasaktan ang mga marurupok nitong pakpak. Humiuni nang mahina ang ibon, na tila nagpapasalamat sa kanyang kabaitan.</p><p>Nang siya ay makauwi, tinulungan siya ng kanyang ina na gumawa ng maliit na pugad sa isang kahon ng sapatos. Sa mga sumunod na linggo, pinakain ni Leo ang ibon at pinagmasdan itong muling lumakas. Nang dumating ang araw upang palayain ito pabalik sa kalangitan, nakaramdam si Leo ng pagmamalaki, alam niyang nakatagpo siya ng tunay na kaibigan sa gubat na dati niyang kinatatakutan.</p>"
    }
};

async function startAralTutorial() {
    alert("Welcome back! Loading your personalized daily AI One-on-One Reading Session...");
    // For now, reuse the diagnostic flow as a tutorial mock
    startAralDiagnostic();
}

async function startAralDiagnostic() {
    // aralSelectedLang is already set by enterAralRoom
    const btnId = aralSelectedLang === 'en' ? 'aralEnglishStatusBtn' : 'aralFilipinoStatusBtn';
    document.getElementById(btnId).innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading AI...';
    
    // AI Speaks Welcome Message
    speakAral(aralSelectedLang === 'ph' ? 
        "Maligayang pagdating. Pakibasa ang kwento sa ibaba nang malinaw. I-click ang mikropono kapag handa ka na." : 
        "Welcome to the Aral Tutor. Please read the passage on the screen clearly into the microphone. Click the mic when you are ready.");

    // Simulate fetching a passage
    setTimeout(() => {
        document.getElementById('aralTutorContent').style.display = 'none';
        document.getElementById('aralTutorInterface').style.display = 'block';
        
        const passage = aralPassages[aralSelectedLang];
        document.getElementById('aralReadingTitle').innerText = passage.title;
        document.getElementById('aralReadingText').innerHTML = passage.text;
        
        initAralRecognition();
    }, 1000);
}

// Global Text-to-Speech Helper
let currentAudio = null;

function speakAral(text) {
    // Stop any currently playing audio
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
    }
    
    // Use secure proxy to Google Translate's high-quality neural TTS engine 
    // This bypasses browser CORS blocks that were forcing it to fallback to the robotic English voice
    const langCode = aralSelectedLang === 'ph' ? 'tl' : 'en-US';
    const encodedText = encodeURIComponent(text);
    const ttsUrl = `/api/tts?text=${encodedText}&lang=${langCode}`;
    
    currentAudio = new Audio(ttsUrl);
    
    // Slightly adjust playback speed for better natural flow
    currentAudio.playbackRate = 0.95;
    
    currentAudio.play().catch(e => {
        console.log("Audio play failed, falling back to basic browser TTS...", e);
        // Fallback to basic TTS if the external natural voice is blocked
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = aralSelectedLang === 'ph' ? 'fil-PH' : 'en-US';
            window.speechSynthesis.speak(utterance);
        }
    });
}

function exitAralTutor() {
    if (aralRecognition) {
        aralRecognition.stop();
        aralMicActive = false;
    }
    document.getElementById('aralTutorContent').style.display = 'block';
    document.getElementById('aralTutorInterface').style.display = 'none';
    document.getElementById('aralComprehensionPhase').style.display = 'none';
    document.getElementById('aralReadingPhase').style.display = 'block';
    document.getElementById('aralListeningIndicator').style.display = 'none';
    document.getElementById('aralMicBtn').style.background = '#ef4444'; // Red
    document.getElementById('aralMicBtn').style.transform = 'scale(1)';
    document.getElementById('aralSubmitBtn').style.display = 'none';
    aralTranscript = "";
    aralStartTime = null;
    aralEndTime = null;
}

function initAralRecognition() {
    if ('webkitSpeechRecognition' in window) {
        aralRecognition = new webkitSpeechRecognition();
        aralRecognition.continuous = true;
        aralRecognition.interimResults = true;
        aralRecognition.lang = aralSelectedLang === 'ph' ? 'fil-PH' : 'en-US';
        
        aralRecognition.onstart = function() {
            if (!aralStartTime) aralStartTime = new Date(); // Start timer
            isAralListening = true;
            document.getElementById('aralListeningIndicator').style.display = 'block';
            document.getElementById('aralMicBtn').style.background = '#10b981'; // Green
            document.getElementById('aralMicBtn').style.transform = 'scale(1.1)';
            document.getElementById('aralSubmitBtn').style.display = 'inline-block'; // Show submit once started
        };
        
        aralRecognition.onresult = function(event) {
            let final_transcript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    final_transcript += event.results[i][0].transcript;
                }
            }
            if (final_transcript) {
                aralTranscript += final_transcript + " ";
                console.log("Aral Heard (Cumulative):", aralTranscript);
            }
        };
        
        aralRecognition.onerror = function(event) {
            console.error("Speech recognition error", event.error);
        };
        
        aralRecognition.onend = function() {
            isAralListening = false;
            if (aralMicActive) {
                aralRecognition.start(); // Keep listening if mic is active
            } else {
                if (!aralEndTime) aralEndTime = new Date(); // Record end time when mic manually stopped
                document.getElementById('aralListeningIndicator').style.display = 'none';
                document.getElementById('aralMicBtn').style.background = '#ef4444'; // Red
                document.getElementById('aralMicBtn').style.transform = 'scale(1)';
            }
        };
    } else {
        alert("Your browser does not support the Web Speech API. Please use Google Chrome.");
    }
}

function toggleAralMic() {
    if (!aralRecognition) return;
    
    if (aralMicActive) {
        // Stop listening
        aralMicActive = false;
        aralRecognition.stop();
        document.getElementById('aralTutorStatus').innerText = "Microphone stopped. Click to resume or Submit your reading.";
    } else {
        // Start listening
        aralMicActive = true;
        aralRecognition.start();
        document.getElementById('aralTutorStatus').innerText = "Go ahead and read. The AI is listening...";
    }
}

function submitAralReading() {
    if (aralMicActive) {
        toggleAralMic(); // stop mic if running
    }
    
    if (aralTranscript.trim().length < 5) {
        alert("We didn't hear you clearly. Please try reading again.");
        return;
    }
    
    // AI Speaks Transition
    speakAral(aralSelectedLang === 'ph' ? 
        "Magaling! Ngayon, sagutin natin ang ilang mga tanong." : 
        "Great job reading. Now, let's answer a few questions to check your comprehension.");
    
    document.getElementById('aralSubmitBtn').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing with AI...';
    document.getElementById('aralSubmitBtn').disabled = true;
    
    // Switch to Comprehension Phase
    setTimeout(() => {
        document.getElementById('aralReadingPhase').style.display = 'none';
        document.getElementById('aralSubmitBtn').style.display = 'none';
        document.getElementById('aralComprehensionPhase').style.display = 'block';
        
        loadAralComprehensionQuestions();
    }, 1500);
}

const aralQuestions = {
    en: [
        { q: "What underlying emotion might have driven Leo to ignore his parents' warnings about the dense woods?", options: ["Rebellion and anger", "Innocent curiosity and a desire for discovery", "Boredom with his toys", "Fear of staying home"], answer: 1 },
        { q: "Analyze the author's description of the 'ancient trees whispering secrets'. What atmosphere does this create?", options: ["A bright and cheerful environment", "A mysterious, almost magical tension", "A terrifying and dangerous setting", "A loud and chaotic forest"], answer: 1 },
        { q: "Based on the text, what can be inferred about the thick canopy of leaves?", options: ["It provided food for the animals", "It blocked most of the sunlight, creating a dim environment", "It was artificial and made by humans", "It was completely dead and dry"], answer: 1 },
        { q: "When Leo heard the rustling, his heart raced. Evaluate his subsequent decision to cautiously approach rather than run away.", options: ["It shows he was foolish and suicidal", "It demonstrates a balance of fear and empathetic bravery", "It proves he knew exactly what was there", "It indicates he was deaf to the sound"], answer: 1 },
        { q: "What does Leo's internal debate ('wild animal or perhaps something magical') reveal about his character?", options: ["He possesses a vivid, imaginative, and hopeful mindset", "He is deeply paranoid", "He has extensive scientific knowledge of animals", "He dislikes magic"], answer: 0 },
        { q: "Why is the detail of Leo scooping the bird 'gently' significant to the theme of the narrative?", options: ["It highlights his physical strength", "It contrasts with the perceived danger of the 'mysterious' forest, showing empathy", "It proves he wanted to keep the bird captive", "It shows he was afraid of catching a disease"], answer: 1 },
        { q: "Synthesize Leo's realization that the forest 'just needed someone who cared'. What is the broader moral implication?", options: ["Forests are meant to be chopped down", "Misunderstood places or situations often just require compassion", "Animals are better than humans", "Parents are always wrong about rules"], answer: 1 },
        { q: "How did the bird's soft chirping function as a turning point in Leo's perception of the forest?", options: ["It confirmed the forest was haunted", "It served as an immediate emotional validation of his kind action", "It made him deaf", "It scared away larger predators"], answer: 1 },
        { q: "Evaluate the mother's reaction to Leo bringing the bird home. What does her action imply?", options: ["She was furious that he disobeyed her", "She prioritized compassion and supported his empathetic action", "She wanted to cook the bird", "She ignored him completely"], answer: 1 },
        { q: "What is the symbolic significance of the 'shoebox' in this story?", options: ["It represents poverty", "It signifies a makeshift, loving sanctuary for recovery", "It shows Leo's obsession with shoes", "It acts as a permanent prison"], answer: 1 },
        { q: "Over the next few weeks, Leo fed the bird. What character trait does this sustained action demonstrate?", options: ["Impatience", "Consistent responsibility and nurturing", "Forgetfulness", "Selfishness"], answer: 1 },
        { q: "Predict what would have likely happened if Leo had adhered strictly to the rule of 'staying away from the woods'.", options: ["The bird would have likely perished", "He would have found a different magical creature", "The forest would have disappeared", "His mother would have bought him a pet"], answer: 0 },
        { q: "Analyze the climax of the story: releasing the bird. Why is this action considered a 'proud' moment rather than a 'sad' one?", options: ["Because he no longer had to do chores", "Because releasing it signifies successful rehabilitation and selfless love", "Because the bird was annoying", "Because he wanted it to get eaten"], answer: 1 },
        { q: "How does the author use the forest as a metaphor for the unknown in life?", options: ["It shows that the unknown is always deadly", "It illustrates that venturing into the unknown with a kind heart can yield beautiful friendships", "It proves that forests should be avoided", "It means that you should always carry a map"], answer: 1 },
        { q: "Contrast Leo's view of the forest at the beginning of the story versus the end. What is the fundamental shift?", options: ["From a place of fear to a place of connection", "From a playground to a nightmare", "From boring to exciting", "From dark to physically bright"], answer: 0 },
        { q: "If you were to write a sequel to this passage, what logical action might Leo take next based on his developed character?", options: ["Never go outside again", "Burn down the forest", "Become an advocate or protector of the forest's wildlife", "Start hunting birds"], answer: 2 },
        { q: "What is the primary conflict in this passage?", options: ["Man vs. Man", "Man vs. Society", "Internal conflict (fear vs. empathy) resulting in Man vs. Nature resolution", "Man vs. Technology"], answer: 2 },
        { q: "Assess the validity of the parents' original warning about the dense woods in light of the story's conclusion.", options: ["It was completely malicious", "It was valid for safety, but exceptions exist when intervention is morally necessary", "It was a lie to hide treasure", "It was scientifically accurate"], answer: 1 },
        { q: "Which word best describes the tone of the final sentence?", options: ["Melancholic", "Triumphant and heartwarming", "Anxious", "Sarcastic"], answer: 1 },
        { q: "What overarching theme does the story convey regarding 'fear'?", options: ["Fear should always control your actions", "Fear is often rooted in the unknown and can be overcome by acts of compassion", "Fear is a physical illness", "Only children experience fear"], answer: 1 }
    ],
    ph: [
        { q: "Ano ang maaaring malalim na emosyon na nag-udyok kay Leo na suwayin ang babala ng kanyang mga magulang?", options: ["Matinding galit at paghihiganti", "Inosenteng kuryosidad at pagnanasang tumuklas", "Pagkainip sa bahay", "Takot na maiwan mag-isa"], answer: 1 },
        { q: "Suriin ang paglalarawan ng may-akda sa 'mga sinaunang puno na nagbubulungan'. Anong atmospera ang nililikha nito?", options: ["Isang masaya at maliwanag na paligid", "Isang mahiwaga at tila may itinatagong lihim na tensyon", "Isang nakakabinging ingay", "Isang tuyo at patay na kapaligiran"], answer: 1 },
        { q: "Batay sa teksto, ano ang mahihinuha tungkol sa 'makapal na kulandong ng mga dahon'?", options: ["Ito ay nagsisilbing pagkain ng mga hayop", "Hinaharangan nito ang araw, kaya't madilim sa loob ng gubat", "Ito ay gawa ng mga tao", "Wala itong epekto sa gubat"], answer: 1 },
        { q: "Mabilis ang pintig ng puso ni Leo, ngunit maingat pa rin siyang lumapit. Suriin ang kanyang desisyon.", options: ["Nagpapakita ito ng pagkabaliw", "Nagpapakita ito ng balanse sa pagitan ng takot at matapang na empatiya", "Pinatutunayan nitong alam niya ang naroon", "Wala siyang pakialam sa panganib"], answer: 1 },
        { q: "Ano ang ipinapahiwatig ng pag-iisip ni Leo na baka ito ay 'ligaw na hayop o bagay na mahiwaga' tungkol sa kanyang pagkatao?", options: ["Siya ay may malawak at inosenteng imahinasyon", "Siya ay praning", "Siya ay isang siyentipiko", "Ayaw niya sa mga hayop"], answer: 0 },
        { q: "Bakit mahalaga sa tema ng kwento ang detalyeng 'dahan-dahan niyang kinuha ang ibon'?", options: ["Upang ipakita ang kanyang pisikal na lakas", "Upang magbigay ng contrast sa 'nakakatakot' na gubat sa pamamagitan ng pagmamalasakit", "Dahil gusto niya itong kainin", "Upang hindi siya madumihan"], answer: 1 },
        { q: "Sintesisin ang napagtanto ni Leo na 'kailangan lang nito ng taong may malasakit'. Ano ang moral na implikasyon nito?", options: ["Dapat putulin ang mga puno", "Ang mga bagay o lugar na kinatatakutan ay madalas nangangailangan lamang ng pang-unawa at habag", "Mas mabuti ang hayop kaysa tao", "Laging mali ang mga magulang"], answer: 1 },
        { q: "Paano nagsilbing 'turning point' o burador ng pagbabago ang paghuni ng ibon kay Leo?", options: ["Kinumpirma nitong may multo sa gubat", "Nagsilbi itong emosyonal na patunay na tama ang kanyang ginawang kabutihan", "Nabingi siya sa ingay nito", "Tinaboy nito ang mga ahas"], answer: 1 },
        { q: "Suriin ang reaksyon ng ina ni Leo nang iuwi niya ang ibon. Ano ang ipinapahiwatig ng kanyang aksyon?", options: ["Nagalit siya dahil sumuway si Leo", "Mas pinahalagahan niya ang pagmamalasakit kaya suportado niya ang anak", "Wala siyang pakialam", "Pinalayas niya si Leo"], answer: 1 },
        { q: "Ano ang simbolikong kahulugan ng 'kahon ng sapatos' sa kwentong ito?", options: ["Ito ay simbolo ng kahirapan", "Sumisimbolo ito sa isang simple ngunit punong-puno ng pagmamahal na santuwaryo para sa pagpapagaling", "Ito ay isang permanenteng kulungan", "Mahilig sila sa sapatos"], answer: 1 },
        { q: "Sa pagpapakain ni Leo sa ibon ng ilang linggo, anong katangian ang ipinakita niya?", options: ["Pagkainip", "Konsistent na pananagutan at pag-aaruga", "Pagiging makasarili", "Pagiging malilimutin"], answer: 1 },
        { q: "Hulaan kung ano ang malamang na nangyari kung sinunod ni Leo nang mahigpit ang babala na 'lumayo sa kakahuyan'.", options: ["Malamang na namatay ang sugatang ibon", "Makakahanap siya ng ginto", "Mawawala ang gubat", "Bibilhan siya ng aso"], answer: 0 },
        { q: "Suriin ang kasukdulan ng kwento: ang pagpapalaya sa ibon. Bakit ito itinuring na 'nakakapagmalaki' sa halip na 'nakakalungkot'?", options: ["Dahil wala na siyang pakakainin", "Dahil ang paglaya nito ay tanda ng matagumpay na rehabilitasyon at walang-pag-iimbot na pagmamahal", "Dahil maingay ang ibon", "Dahil gusto niya itong barilin"], answer: 1 },
        { q: "Paano ginamit ng may-akda ang gubat bilang metapora para sa 'hindi pamilyar na mga bagay' sa buhay?", options: ["Ipinapakita nitong laging nakamamatay ang hindi pamilyar", "Inilalarawan nito na ang pagharap sa hindi pamilyar nang may bukas na puso ay nagdudulot ng magagandang ugnayan", "Bawal pumunta sa hindi pamilyar na lugar", "Laging magdala ng mapa"], answer: 1 },
        { q: "Paghambingin ang pananaw ni Leo sa gubat sa simula at sa wakas. Ano ang pinakamahalagang pagbabago?", options: ["Mula sa lugar ng takot patungo sa lugar ng koneksyon at pagkakaibigan", "Mula sa palaruan patungo sa bangungot", "Mula sa tahimik patungo sa maingay", "Mula sa madilim patungo sa sobrang liwanag"], answer: 0 },
        { q: "Kung gagawa ka ng karugtong ng kwento, anong lohikal na aksyon ang maaaring gawin ni Leo batay sa pag-unlad ng kanyang karakter?", options: ["Hindi na siya lalabas ng bahay", "Susunugin niya ang gubat", "Magiging tagapagtanggol o tagapangalaga siya ng mga hayop sa gubat", "Manghuhuli siya ng mga ibon para ibenta"], answer: 2 },
        { q: "Ano ang pangunahing tunggalian sa binasang teksto?", options: ["Tao laban sa Tao", "Tao laban sa Lipunan", "Panloob na tunggalian (takot laban sa empatiya) na nauwi sa resolusyon ng Tao laban sa Kalikasan", "Tao laban sa Teknolohiya"], answer: 2 },
        { q: "Tayain ang bisa ng orihinal na babala ng mga magulang tungkol sa gubat sa liwanag ng naging wakas ng kwento.", options: ["Ito ay pawang kasinungalingan lamang", "Wasto ito para sa kaligtasan, ngunit may mga pagkakataong ang moral na pagtulong ay mas mahalaga kaysa sa takot", "Sinabi lang ito para itago ang yaman", "Ito ay siyentipikong katotohanan"], answer: 1 },
        { q: "Aling salita ang pinakamahusay na naglalarawan sa tono ng huling pangungusap?", options: ["Malungkot", "Matagumpay at nakakataba ng puso", "Nangangamba", "Sarkastiko"], answer: 1 },
        { q: "Anong pangkalahatang tema ang ipinaparating ng kwento tungkol sa 'takot'?", options: ["Dapat palaging magpadala sa takot", "Ang takot ay madalas nagmumula sa hindi pamilyar, at maaari itong mapagtagumpayan sa pamamagitan ng pagmamalasakit", "Ang takot ay isang sakit na walang lunas", "Bawal matakot ang mga bata"], answer: 1 }
    ]
};

function loadAralComprehensionQuestions() {
    const questions = aralQuestions[aralSelectedLang];
    const container = document.getElementById('comprehensionQuestionsContainer');
    
    let html = '';
    questions.forEach((item, index) => {
        html += `
            <div class="question-block" style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #fbcfe8;">
                <p style="font-weight: bold; margin-bottom: 10px; color: #831843;">${index + 1}. ${item.q}</p>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${item.options.map((opt, i) => `
                        <label style="cursor: pointer; display: flex; align-items: center; gap: 10px;">
                            <input type="radio" name="aral_q_${index}" value="${i}"> ${opt}
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

async function finishAralDiagnostic() {
    // Basic validation
    const questions = aralQuestions[aralSelectedLang];
    let score = 0;
    
    for (let i = 0; i < questions.length; i++) {
        const selected = document.querySelector(`input[name="aral_q_${i}"]:checked`);
        if (!selected) {
            alert("Please answer all questions before submitting.");
            return;
        }
        if (parseInt(selected.value) === questions[i].answer) {
            score++;
        }
    }
    
    const btn = document.getElementById('aralFinishBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
    btn.disabled = true;
    
    // Calculate Reading Speed (WPM)
    let wpm = 0;
    if (aralStartTime && aralEndTime) {
        let durationSeconds = (aralEndTime.getTime() - aralStartTime.getTime()) / 1000;
        let wordCount = aralTranscript.split(" ").filter(w => w.length > 0).length;
        if (durationSeconds > 0) {
            wpm = Math.round((wordCount / durationSeconds) * 60);
        }
    }
    
    // Strictly calculate ACTUAL mispronounced words by analyzing the transcript vs the passage
    let mispronouncedWords = 0;
    
    // Strip HTML and punctuation for clean comparison
    const cleanPassage = aralPassages[aralSelectedLang].text.replace(/<[^>]*>?/gm, '').replace(/[^\w\s\u00C0-\u024F]/g, '').toLowerCase().trim();
    const cleanTranscript = aralTranscript.replace(/[^\w\s\u00C0-\u024F]/g, '').toLowerCase().trim();
    
    const passageWords = cleanPassage.split(/\s+/).filter(w => w.length > 0);
    const spokenWords = cleanTranscript.split(/\s+/).filter(w => w.length > 0);
    
    // Evaluate pronunciation: Every word in the passage must be found in the transcript sequentially
    // If WebSpeech NLP couldn't parse the student's mumble into the correct word, it's flagged as an error
    let sIdx = 0;
    for (let pIdx = 0; pIdx < passageWords.length; pIdx++) {
        let matchFound = false;
        // Look ahead in the transcript to account for stuttering or repeating words
        for (let i = 0; i < 6 && (sIdx + i) < spokenWords.length; i++) {
            if (passageWords[pIdx] === spokenWords[sIdx + i]) {
                matchFound = true;
                sIdx = sIdx + i + 1; // Advance spoken pointer
                break;
            }
        }
        
        if (!matchFound) {
            mispronouncedWords++;
        }
    }

    // Determine level: 16-20 = Independent, 10-15 = Instructional, 0-9 = Frustration
    let readingLevel = "Frustration";
    if (score >= 16 && wpm >= 60) readingLevel = "Independent";
    else if (score >= 10 && wpm >= 40) readingLevel = "Instructional";
    
    // Fake the AI API call to the actual backend /api/ai-proxy to generate the record!
    try {
        const res = await apiRequest('/aral-plan/simulate', 'POST', {
            readingLevel: readingLevel,
            comprehensionScore: score,
            maxScore: questions.length,
            wpm: wpm,
            mispronouncedWords: mispronouncedWords,
            transcript: aralTranscript,
            language: aralSelectedLang
        });
        
        if (res && res.success) {
            if (res.isGraduated) {
                speakAral(aralSelectedLang === 'ph' ? "Binabati kita! Nakapasa ka na!" : "Congratulations! You have officially graduated from the Aral Tutor!");
            } else if (readingLevel === 'Non-Reader') {
                speakAral(aralSelectedLang === 'ph' ? "Pag-aaralan natin ang mga pangunahing tunog sa susunod." : "We will focus on basic sounds next time.");
            } else {
                speakAral(aralSelectedLang === 'ph' ? "Natapos mo na ang diagnostic. Titingnan ng iyong guro ang resulta." : "You have completed the diagnostic. Your teacher will review the results.");
            }
            alert(`Diagnostic Complete! Based on your reading and comprehension (${score}/${questions.length}), you are classified as: ${readingLevel}. Your adviser will review your AI Intervention Plan.`);
        } else {
            alert(`Diagnostic Complete! You are classified as: ${readingLevel}. However, there was an error saving this to the server.`);
        }
    } catch (e) {
        // Fallback if endpoint doesn't exist yet on portal server
        alert(`Diagnostic Complete! Based on your reading and comprehension (${score}/${questions.length}), you are classified as: ${readingLevel}. Your adviser will review your AI Intervention Plan.`);
    }
    
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Answers';
    btn.disabled = false;
    
    exitAralTutor();
}

// ==================== LEARNER RECORD MODULE (STUDENT PORTAL) ====================
let currentStudentLRSubjectData = null;
let currentStudentLRSubjectId = null;

async function loadStudentLearnerRecord() {
    const subjectsView = document.getElementById('lrSubjectsView');
    const detailView = document.getElementById('lrDetailView');
    const grid = document.getElementById('studentSubjectFoldersGrid');

    if (subjectsView && detailView) {
        subjectsView.style.display = 'block';
        detailView.style.display = 'none';
    }

    if (!grid) return;
    grid.innerHTML = '<div class="loading text-center" style="grid-column: 1/-1;">Loading subject folders...</div>';

    try {
        const data = await apiRequest('/learner-record/subjects');
        if (!data || !data.subjects) {
            grid.innerHTML = '<div class="glass text-center" style="grid-column: 1/-1; padding: 30px;">Failed to load subject folders.</div>';
            return;
        }

        if (data.subjects.length === 0) {
            grid.innerHTML = '<div class="glass text-center" style="grid-column: 1/-1; padding: 30px;">No subjects found for your section.</div>';
            return;
        }

        const iconPalette = [
            'fa-book-open', 'fa-calculator', 'fa-flask', 'fa-microscope', 
            'fa-globe-americas', 'fa-language', 'fa-palette', 'fa-running', 'fa-laptop-code'
        ];

        grid.innerHTML = data.subjects.map((sub, index) => {
            const icon = iconPalette[index % iconPalette.length];
            return `
                <div class="dashboard-card glass hover-lift" style="cursor: pointer; position: relative; border-radius: 16px; padding: 22px; transition: transform 0.2s, box-shadow 0.2s; border: 1px solid rgba(255,255,255,0.2);" onclick="openStudentLearnerSubjectRecord(${sub.id})">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                        <div style="width: 52px; height: 52px; border-radius: 14px; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 1.4rem; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">
                            <i class="fas ${icon}"></i>
                        </div>
                        <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #2563eb; font-weight: 700; border-radius: 20px; padding: 4px 12px; font-size: 0.8rem;">Subject Folder</span>
                    </div>

                    <h3 style="margin: 0 0 6px 0; font-size: 1.2rem; color: #1e293b; font-weight: 700;">${escapeHtml(sub.subject_name)}</h3>
                    <p style="margin: 0 0 14px 0; color: #64748b; font-size: 0.85rem; font-weight: 600;">Code: ${escapeHtml(sub.subject_code || '---')}</p>

                    <div style="border-top: 1px solid #f1f5f9; padding-top: 12px; display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 0.85rem; color: #475569; font-weight: 600;">
                            <i class="fas fa-user-tie text-primary" style="margin-right: 5px;"></i> ${escapeHtml(sub.teacher_name)}
                        </span>
                        <span style="color: #2563eb; font-size: 0.85rem; font-weight: 700; display: flex; align-items: center; gap: 4px;">
                            Open <i class="fas fa-chevron-right" style="font-size: 0.75rem;"></i>
                        </span>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Load learner record error:', err);
        grid.innerHTML = '<div class="glass text-center" style="grid-column: 1/-1; padding: 30px; color: red;">Error loading subject folders.</div>';
    }
}

async function openStudentLearnerSubjectRecord(subjectId) {
    currentStudentLRSubjectId = subjectId;
    const subjectsView = document.getElementById('lrSubjectsView');
    const detailView = document.getElementById('lrDetailView');

    if (subjectsView && detailView) {
        subjectsView.style.display = 'none';
        detailView.style.display = 'block';
    }

    try {
        const data = await apiRequest(`/learner-record/subject/${subjectId}`);
        if (!data || !data.subject) {
            alert('Failed to fetch learner record data.');
            backToStudentSubjectFolders();
            return;
        }

        currentStudentLRSubjectData = data;

        // Set Header Title & Information
        document.getElementById('lrDetailSubjectTitle').textContent = `${data.subject.subject_name} Individual Record`;
        document.getElementById('stLRSchoolYear').textContent = data.student.academic_year || '2026-2027';
        document.getElementById('stLRStudentName').textContent = data.student.name || '---';
        document.getElementById('stLRSubjectName').textContent = data.subject.subject_name || '---';
        document.getElementById('stLRGrSec').textContent = `GRADE ${data.student.grade_level || ''} - ${data.student.section_name || ''}`;
        document.getElementById('stLRTeacherName').textContent = data.subject.teacher_name || '---';

        // Select Term 1 by default or current value
        const termSelect = document.getElementById('studentLRTermSelect');
        const selectedTerm = termSelect ? termSelect.value : '1';
        renderStudentLRTermData(selectedTerm);

    } catch (err) {
        console.error('Error opening subject record:', err);
        alert('Error loading subject learner record.');
        backToStudentSubjectFolders();
    }
}

function getItemRemarkBadge(score, hps) {
    if (score === null || score === undefined || score === '' || !hps || parseFloat(hps) <= 0) {
        return '<span style="color: #94a3b8; font-weight: 700; font-size: 1.1rem;">-</span>';
    }
    const numScore = parseFloat(score);
    const numHps = parseFloat(hps);
    if (isNaN(numScore) || isNaN(numHps)) {
        return '<span style="color: #94a3b8; font-weight: 700; font-size: 1.1rem;">-</span>';
    }
    const pct = (numScore / numHps) * 100;
    const isPassed = pct >= 75;
    if (isPassed) {
        return '<span style="display: inline-block; background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 4px 18px; border-radius: 6px; font-weight: 800; font-size: 1.15rem;" title="Passed">P</span>';
    } else {
        return '<span style="display: inline-block; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; padding: 4px 18px; border-radius: 6px; font-weight: 800; font-size: 1.15rem;" title="Failed">F</span>';
    }
}

function getLRComponentRemarkBadge(hasScore, scoreSum, hpsSum) {
    if (!hasScore || !hpsSum || parseFloat(hpsSum) <= 0) {
        return '<span style="color: #94a3b8; font-weight: 700; font-size: 1.1rem;">-</span>';
    }
    const pct = (parseFloat(scoreSum) / parseFloat(hpsSum)) * 100;
    // Standard passing threshold (>= 75%): P for Passed, F for Failed
    const isPassed = pct >= 75;
    if (isPassed) {
        return '<span style="display: inline-block; background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 4px 18px; border-radius: 6px; font-weight: 800; font-size: 1.15rem;" title="Passed">P</span>';
    } else {
        return '<span style="display: inline-block; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; padding: 4px 18px; border-radius: 6px; font-weight: 800; font-size: 1.15rem;" title="Failed">F</span>';
    }
}

function renderStudentLRTermData(term) {
    if (!currentStudentLRSubjectData || !currentStudentLRSubjectData.terms) return;

    const termData = currentStudentLRSubjectData.terms[term] || {
        quarter: term,
        ww_hps: [0,0,0,0,0],
        ww_scores: [null,null,null,null,null],
        pt_hps: [0,0,0,0,0],
        pt_scores: [null,null,null,null,null],
        sa_hps: [0,0],
        sa_scores: [null,null],
        qa_hps: 0,
        qa_score: null,
        initial_grade: null,
        quarterly_grade: null,
        descriptor: '-'
    };

    document.getElementById('stLRTermBadge').textContent = `Term ${term}`;

    // Render WW Remarks (5 items + Total)
    let wwHpsSum = 0;
    let wwScoreSum = 0;
    let hasWwScore = false;

    for (let i = 0; i < 5; i++) {
        const hps = termData.ww_hps[i] || 0;
        const score = termData.ww_scores[i];

        wwHpsSum += parseFloat(hps);
        if (score !== null && score !== undefined && score !== '') {
            hasWwScore = true;
            wwScoreSum += parseFloat(score);
        }
        const elRemark = document.getElementById(`lr_ww_remark_${i}`);
        if (elRemark) elRemark.innerHTML = getItemRemarkBadge(score, hps);
    }
    const elWwRemarkTotal = document.getElementById('lr_ww_remark_total');
    if (elWwRemarkTotal) elWwRemarkTotal.innerHTML = getLRComponentRemarkBadge(hasWwScore, wwScoreSum, wwHpsSum);

    // Render PT Remarks (5 items + Total)
    let ptHpsSum = 0;
    let ptScoreSum = 0;
    let hasPtScore = false;

    for (let i = 0; i < 5; i++) {
        const hps = termData.pt_hps[i] || 0;
        const score = termData.pt_scores[i];

        ptHpsSum += parseFloat(hps);
        if (score !== null && score !== undefined && score !== '') {
            hasPtScore = true;
            ptScoreSum += parseFloat(score);
        }
        const elRemark = document.getElementById(`lr_pt_remark_${i}`);
        if (elRemark) elRemark.innerHTML = getItemRemarkBadge(score, hps);
    }
    const elPtRemarkTotal = document.getElementById('lr_pt_remark_total');
    if (elPtRemarkTotal) elPtRemarkTotal.innerHTML = getLRComponentRemarkBadge(hasPtScore, ptScoreSum, ptHpsSum);

    // Render Summative & Exam Remarks (SA1, SA2, Exam, Total)
    let saHpsSum = 0;
    let saScoreSum = 0;
    let hasSaScore = false;

    for (let i = 0; i < 2; i++) {
        const hps = termData.sa_hps[i] || 0;
        const score = termData.sa_scores[i];

        saHpsSum += parseFloat(hps);
        if (score !== null && score !== undefined && score !== '') {
            hasSaScore = true;
            saScoreSum += parseFloat(score);
        }
        const elRemark = document.getElementById(`lr_sa_remark_${i}`);
        if (elRemark) elRemark.innerHTML = getItemRemarkBadge(score, hps);
    }

    const qaHps = parseFloat(termData.qa_hps) || 0;
    const qaScore = termData.qa_score;
    if (qaScore !== null && qaScore !== undefined && qaScore !== '') {
        hasSaScore = true;
        saScoreSum += parseFloat(qaScore);
    }
    const elQaRemark = document.getElementById('lr_qa_remark');
    if (elQaRemark) elQaRemark.innerHTML = getItemRemarkBadge(qaScore, qaHps);

    const totalExamHps = saHpsSum + qaHps;
    const elExamRemarkTotal = document.getElementById('lr_exam_remark_total');
    if (elExamRemarkTotal) elExamRemarkTotal.innerHTML = getLRComponentRemarkBadge(hasSaScore, saScoreSum, totalExamHps);

    // Render Grade Summary Footer (Initial Grade Only)
    const initGrade = termData.initial_grade;
    const termGrade = termData.quarterly_grade;
    const descriptor = termData.descriptor || '-';

    const elInit = document.getElementById('stLRInitialGrade');
    if (elInit) {
        elInit.textContent = (initGrade !== null && initGrade !== undefined && initGrade !== '') 
            ? parseFloat(initGrade).toFixed(2) 
            : '-';
    }

    const elTerm = document.getElementById('stLRTermGrade');
    if (elTerm) {
        elTerm.textContent = (termGrade !== null && termGrade !== undefined && termGrade !== '') 
            ? parseFloat(termGrade).toFixed(2) 
            : '-';
    }

    const elDesc = document.getElementById('stLRDescriptor');
    if (elDesc) elDesc.textContent = descriptor;
}

function switchStudentLRTerm(term) {
    renderStudentLRTermData(term);
}

function backToStudentSubjectFolders() {
    const subjectsView = document.getElementById('lrSubjectsView');
    const detailView = document.getElementById('lrDetailView');

    if (subjectsView && detailView) {
        subjectsView.style.display = 'block';
        detailView.style.display = 'none';
    }
}

function printStudentLearnerRecord() {
    if (!currentStudentLRSubjectData) {
        alert('No record data available to print.');
        return;
    }

    const container = document.getElementById('stLRDocumentContainer');
    if (!container) return;

    const printWin = window.open('', '_blank', 'width=900,height=800');
    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Learner Individual Record - ${currentStudentLRSubjectData.subject.subject_name}</title>
            <style>
                body { font-family: 'Arial', sans-serif; padding: 20px; background: #fff; color: #000; }
                @page { size: A4 portrait; margin: 15mm; }
                table { width: 100%; border-collapse: collapse; text-align: center; }
                th, td { border: 1px solid #000; padding: 6px; font-size: 12px; }
                th { background-color: #f1f5f9; }
                .no-print { display: none !important; }
            </style>
        </head>
        <body onload="window.print();">
            ${container.innerHTML}
        </body>
        </html>
    `);
    printWin.document.close();
}
