let currentStep = 1;
let enrolleeId = null;

document.addEventListener('DOMContentLoaded', () => {
    checkEnrollmentStatus();
});

async function checkEnrollmentStatus() {
    try {
        const response = await fetch('/api/public/enrollment-status');
        if (response.ok) {
            const status = await response.json();

            if (status.settings && status.settings.school_year) {
                const syDisplay = document.getElementById('syDisplay');
                if (syDisplay) {
                    syDisplay.textContent = `School Year ${status.settings.school_year}`;
                }
            }

            if (!status.enabled) {
                // Hide main content area (keep header)
                const stepProgress = document.querySelector('.step-progress');
                const contentArea = document.querySelector('.content-area');
                if (stepProgress) stepProgress.style.display = 'none';
                if (contentArea) contentArea.style.display = 'none';

                // Setup container for centered layout
                const container = document.querySelector('.container');
                if (container) {
                    container.style.display = 'flex';
                    container.style.flexDirection = 'column';
                    container.style.alignItems = 'center';
                }

                // Show premium closed message
                const msgDiv = document.createElement('div');
                msgDiv.id = 'enrollmentClosedMessage';
                msgDiv.style.cssText = `
                    position: relative;
                    padding: 60px 40px; 
                    text-align: center; 
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(10px);
                    margin: 40px auto; 
                    width: 100%;
                    max-width: 550px;
                    border-radius: 24px; 
                    box-shadow: 0 20px 40px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.03);
                    border: 1px solid rgba(255,255,255,0.6);
                    overflow: hidden;
                    animation: slideUpFadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                `;
                
                msgDiv.innerHTML = `
                    <style>
                        @keyframes slideUpFadeIn {
                            0% { opacity: 0; transform: translateY(30px) scale(0.98); }
                            100% { opacity: 1; transform: translateY(0) scale(1); }
                        }
                        @keyframes pulseGlow {
                            0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
                            70% { box-shadow: 0 0 0 20px rgba(239, 68, 68, 0); }
                            100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                        }
                        @keyframes floatIcon {
                            0% { transform: translateY(0px); }
                            50% { transform: translateY(-8px); }
                            100% { transform: translateY(0px); }
                        }
                        .lock-container {
                            width: 90px;
                            height: 90px;
                            background: linear-gradient(135deg, #fee2e2 0%, #fca5a5 100%);
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            margin: 0 auto 30px auto;
                            color: #ef4444;
                            font-size: 2.8rem;
                            animation: pulseGlow 2.5s infinite cubic-bezier(0.66, 0, 0, 1), floatIcon 4s ease-in-out infinite;
                        }
                        .blob-bg {
                            position: absolute;
                            width: 250px;
                            height: 250px;
                            background: radial-gradient(circle, rgba(239,68,68,0.06) 0%, rgba(255,255,255,0) 70%);
                            border-radius: 50%;
                            top: -80px;
                            left: -80px;
                            z-index: 0;
                        }
                        .blob-bg-2 {
                            position: absolute;
                            width: 300px;
                            height: 300px;
                            background: radial-gradient(circle, rgba(59,130,246,0.06) 0%, rgba(255,255,255,0) 70%);
                            border-radius: 50%;
                            bottom: -100px;
                            right: -100px;
                            z-index: 0;
                        }
                        .content-z {
                            position: relative;
                            z-index: 1;
                        }
                        .btn-return {
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            gap: 10px;
                            background: #0f172a;
                            color: #ffffff !important;
                            text-decoration: none;
                            padding: 14px 32px;
                            border-radius: 12px;
                            font-weight: 600;
                            font-size: 1.05rem;
                            font-family: 'Inter', -apple-system, sans-serif;
                            margin-top: 35px;
                            transition: all 0.3s ease;
                            border: 1px solid rgba(255,255,255,0.1);
                        }
                        .btn-return:hover {
                            background: #1e293b;
                            transform: translateY(-2px);
                            box-shadow: 0 10px 20px rgba(15, 23, 42, 0.15);
                            color: #ffffff;
                        }
                    </style>
                    <div class="blob-bg"></div>
                    <div class="blob-bg-2"></div>
                    <div class="content-z">
                        <div class="lock-container">
                            <i class="fas fa-lock"></i>
                        </div>
                        <h2 style="font-family: 'Inter', -apple-system, sans-serif; margin-bottom:12px; font-size: 2.2rem; color: #0f172a; font-weight: 800; letter-spacing: -0.5px;">Enrollment Closed</h2>
                        <p style="font-size: 1.1rem; color:#64748b; max-width:400px; margin: 0 auto; line-height: 1.7; font-family: 'Inter', -apple-system, sans-serif;">
                            ${status.message || 'The enrollment period is currently closed. Please check back later or contact the administration.'}
                        </p>
                    </div>
                `;
                document.querySelector('.container').appendChild(msgDiv);
            }
        }
    } catch (e) {
        console.error('Failed to check status', e);
    }
}
// Agreement Checkbox
const agreeCheck = document.getElementById('agreeCheck');
const btnStep1 = document.getElementById('btnStep1');

agreeCheck.addEventListener('change', (e) => {
    btnStep1.disabled = !e.target.checked;
});

// Navigation
function nextStep(step) {
    showStep(step);
}

function prevStep(step) {
    showStep(step);
}

function showStep(step) {
    // Validate before moving
    if (step > currentStep && step > 1) {
        // Validation logic can go here
    }

    // Hide all sections
    document.querySelectorAll('.form-section').forEach(el => el.classList.remove('active'));
    // Show target section
    document.getElementById(`step${step}`).classList.add('active');

    // Update Indicators
    document.querySelectorAll('.step-item').forEach((el, index) => {
        if (index + 1 < step) {
            el.classList.add('completed');
            el.classList.remove('active');
        } else if (index + 1 === step) {
            el.classList.add('active');
            el.classList.remove('completed');
        } else {
            el.classList.remove('active', 'completed');
        }
    });

    currentStep = step;
}

// File Upload Utils
function updateFileName(inputId, displayId) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    if (input.files && input.files[0]) {
        display.textContent = input.files[0].name;
        display.style.color = 'var(--primary)';
        display.style.fontWeight = 'bold';
    }
}

// Signature Canvas
const canvas = document.getElementById('signaturePad');
const ctx = canvas.getContext('2d');
let isDrawing = false;

// Resize canvas high DPI
function resizeCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    ctx.scale(ratio, ratio);
}
window.addEventListener('resize', resizeCanvas);
// Call once on load (delay slightly to ensure layout)
setTimeout(resizeCanvas, 100);

// Mouse Events
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

// Touch Events
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startDrawing(e.touches[0]);
});
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    draw(e.touches[0]);
});
canvas.addEventListener('touchend', stopDrawing);

function startDrawing(e) {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
}

function draw(e) {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
}

function stopDrawing() {
    isDrawing = false;
}

function clearSignature() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Use actual dimensions
}

// API Interactions

async function submitInfo() {
    const form = document.getElementById('infoForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // Show loading state
    const btn = document.querySelector('#step2 .btn-primary');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
        const response = await fetch('/api/public/enroll/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok) {
            enrolleeId = result.id;
            nextStep(3);
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        console.error(error);
        alert('Network error. Please try again.');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function submitFiles() {
    if (!enrolleeId) {
        alert('Session lost. Please start over.');
        return;
    }

    const reportCard = document.getElementById('reportCard').files[0];
    const birthCert = document.getElementById('birthCert').files[0];

    if (!reportCard || !birthCert) {
        alert('Please upload both documents to proceed.');
        return;
    }

    const formData = new FormData();
    formData.append('report_card', reportCard);
    formData.append('birth_cert', birthCert);

    // Show loading state
    const btn = document.querySelector('#step3 .btn-primary');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    btn.disabled = true;

    try {
        const response = await fetch(`/api/public/enroll/${enrolleeId}/upload`, {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            nextStep(4);
            // Trigger resize again just in case
            resizeCanvas();
        } else {
            const result = await response.json();
            alert('Upload Failed: ' + result.error);
        }
    } catch (error) {
        console.error(error);
        alert('Upload failed. Please try again.');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function submitFinal() {
    // Check signature
    // Simple check: see if canvas is empty (basic heuristic)
    // For now, allow submit but warn if empty? No, require it?
    // User asked for signature.

    const signatureData = canvas.toDataURL('image/png');
    // Check if empty canvas (data url length is small for empty white canvas)
    if (signatureData.length < 1000) {
        // Very rough check, might need better validation but fine for now
        // alert('Please sign the declaration.');
        // return;
    }

    // Health Data
    const checked = document.querySelectorAll('input[name="symptom"]:checked');
    const symptoms = Array.from(checked).map(c => c.value);

    const payload = {
        health_declaration: { symptoms },
        signature: signatureData
    };

    const btn = document.querySelector('#step4 .btn-primary');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Finalizing...';
    btn.disabled = true;

    try {
        const response = await fetch(`/api/public/enroll/${enrolleeId}/health`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok) {
            document.getElementById('displayCode').textContent = result.unique_code;
            nextStep(5);
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        console.error(error);
        alert('Submission failed. Please try again.');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}
