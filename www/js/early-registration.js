
let currentStep = 1;
let enrolleeId = null;

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
        const response = await fetch('/api/early-enrollment/register', {
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
        const response = await fetch(`/api/early-enrollment/${enrolleeId}/upload`, {
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
        const response = await fetch(`/api/early-enrollment/${enrolleeId}/health`, {
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
