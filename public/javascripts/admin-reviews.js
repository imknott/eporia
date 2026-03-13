// ================================================================
//  EPORIA ADMIN — REVIEW PANEL  (public/js/admin-reviews.js)
// ================================================================

let allReviews    = [];
let activeArtistId = null;
let currentStep   = 1;

// ── Load reviews ─────────────────────────────────────────────
async function loadReviews(priority = '') {
    try {
        const url = `/admin/api/artists/pending?limit=50${priority ? '&priority='+priority : ''}`;
        const res = await fetch(url, { headers: AdminAuth.authHeaders() });
        if (!res.ok) throw new Error('fetch failed');
        const d = await res.json();
        allReviews = d.reviews || [];
        renderReviews(allReviews);
        updateReviewStats();
    } catch {
        Toast.error('Failed to load artist reviews');
    }
}

function updateReviewStats() {
    document.getElementById('statPending').textContent  = allReviews.length;
    document.getElementById('statPriority').textContent = allReviews.filter(r => r.priority === 'high').length;
    document.getElementById('statMedium').textContent   = allReviews.filter(r => r.priority === 'medium').length;
}

function renderReviews(reviews) {
    const container = document.getElementById('reviewList');
    if (!reviews.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <h3>All Clear</h3>
                <p>No pending artist applications.</p>
            </div>`;
        return;
    }

    container.innerHTML = '';
    reviews.forEach(r => {
        const item = document.createElement('div');
        item.className = 'review-item';
        const lic = r.licensing || {};
        const flags = lic.adminFlags || {};

        item.innerHTML = `
            <div class="review-info">
                <div class="priority-badge ${r.priority}">
                    <i class="fas fa-${r.priority === 'high' ? 'star' : r.priority === 'medium' ? 'exclamation' : 'circle'}"></i>
                    ${r.priority.toUpperCase()} PRIORITY
                </div>
                <div class="review-name">${r.artistName}</div>
                <div class="review-handle">@${r.handle}</div>
                <div class="review-meta">
                    <span class="meta-chip"><i class="fas fa-envelope"></i>${r.contactEmail || 'N/A'}</span>
                    <span class="meta-chip"><i class="fas fa-map-marker-alt"></i>${r.location || 'Unknown'}</span>
                    <span class="meta-chip"><i class="fas fa-user"></i>${r.artistType || 'solo'}</span>
                    ${r.isrc ? `<span class="meta-chip"><i class="fas fa-barcode"></i>ISRC: ${r.isrc}</span>` : ''}
                    <span class="meta-chip"><i class="fas fa-clock"></i>${timeAgo(r.submittedAt)}</span>
                </div>
                ${flags.summary && flags.summary !== 'No licensing data submitted' ? `
                    <div class="licensing-summary">
                        <i class="fas fa-exclamation-triangle" style="margin-right:6px"></i>
                        ${flags.summary}
                    </div>` : ''}
            </div>
            <div class="review-actions">
                <button class="btn-cy btn-sm" onclick="openWizard('${r.id}', '${r.artistName}', '${r.handle}', '${r.contactEmail || ''}')">
                    <i class="fas fa-check"></i> Approve
                </button>
                <button class="btn-red btn-sm" onclick="rejectArtist('${r.id}')">
                    <i class="fas fa-times"></i> Reject
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

// ── Filter pills ─────────────────────────────────────────────
document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const val = pill.dataset.priority;
        if (val === 'all') renderReviews(allReviews);
        else renderReviews(allReviews.filter(r => r.priority === val));
    });
});

// ── Approval Wizard ──────────────────────────────────────────
window.openWizard = function(id, name, handle, email) {
    activeArtistId = id;
    document.getElementById('targetArtistName').textContent   = name;
    document.getElementById('targetArtistHandle').textContent = '@' + handle;
    document.getElementById('targetArtistEmail').textContent  = email;
    currentStep = 1;
    updateWizardUI();
    document.getElementById('approveModal').classList.add('open');
};

window.closeWizard = function() {
    if (currentStep === 3) location.reload();
    document.getElementById('approveModal').classList.remove('open');
    document.getElementById('tempPassword').value = '';
    document.getElementById('adminNotes').value   = '';
};

window.moveWizard = function(dir) {
    currentStep += dir;
    updateWizardUI();
};

function updateWizardUI() {
    [1, 2, 3].forEach(n => {
        const el = document.getElementById('step' + n);
        if (el) el.style.display = currentStep === n ? 'block' : 'none';
    });
    document.getElementById('wizardStepText').textContent =
        currentStep === 1 ? 'STEP 01 // CONFIRM' :
        currentStep === 2 ? 'STEP 02 // CREDENTIALS' : 'COMPLETE';

    document.getElementById('btnBack').style.display  = currentStep === 2 ? 'inline-flex' : 'none';
    document.getElementById('btnNext').style.display  = currentStep === 1 ? 'inline-flex' : 'none';
    document.getElementById('btnFinal').style.display = currentStep === 2 ? 'inline-flex' : 'none';
    document.getElementById('wizardFooter').style.display = currentStep === 3 ? 'none' : 'flex';
}

window.executeApproval = async function() {
    const pass  = document.getElementById('tempPassword').value.trim();
    const notes = document.getElementById('adminNotes').value.trim();
    if (pass.length < 6) { Toast.error('Password too short (min 6 chars)'); return; }

    const btn = document.getElementById('btnFinal');
    btn.textContent = 'PROCESSING...';
    btn.disabled = true;

    try {
        const res = await fetch(`/admin/api/artists/${activeArtistId}/approve`, {
            method: 'POST',
            headers: { ...AdminAuth.authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ tempPassword: pass, adminNotes: notes })
        });
        const result = await res.json();
        if (result.success) {
            document.getElementById('finalEmail').textContent = result.email;
            document.getElementById('finalPass').textContent  = pass;
            currentStep = 3;
            updateWizardUI();
            Toast.success('Artist approved successfully');
        } else {
            Toast.error(result.error || 'Approval failed');
            btn.textContent = 'COMPLETE APPROVAL';
            btn.disabled = false;
        }
    } catch {
        Toast.error('Server error — check console');
        btn.disabled = false;
    }
};

window.copyToClipboard = function() {
    const email = document.getElementById('finalEmail').textContent;
    const pass  = document.getElementById('finalPass').textContent;
    navigator.clipboard.writeText(`Email: ${email}\nPassword: ${pass}`).then(() => {
        const btn = document.getElementById('btnCopy');
        btn.innerHTML = '<i class="fas fa-check"></i> COPIED';
        setTimeout(() => btn.innerHTML = '<i class="fas fa-copy"></i> COPY CREDENTIALS', 2000);
    });
};

window.rejectArtist = async function(id) {
    const reason = prompt('REJECTION REASON (required):');
    if (!reason?.trim()) return;
    try {
        const res = await fetch(`/admin/api/artists/${id}/reject`, {
            method: 'POST',
            headers: { ...AdminAuth.authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });
        if (res.ok) {
            Toast.success('Artist rejected');
            loadReviews();
        } else {
            Toast.error('Reject failed');
        }
    } catch { Toast.error('Server error'); }
};

// ── Boot ─────────────────────────────────────────────────────
bootAdminPage(async () => {
    await loadReviews();
});