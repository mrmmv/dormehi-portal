let studentMessages = [];
let studentProfileInfo = null;
let studentCommPollInterval = null;
let studentNotifPollInterval = null;
let studentLastMessageCount = 0;
let studentLastNotifCount = 0;

document.addEventListener('DOMContentLoaded', () => {
    requestStudentNotifPermission();
    startStudentNotifPolling();
});

function requestStudentNotifPermission() {
    if ('Notification' in window) {
        if (Notification.permission === 'default') {
            showStudentNotificationPrompt();
        }
    }
}

function showStudentNotificationPrompt() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    if (document.getElementById('notifPromptBanner')) return;

    if (!document.getElementById('notifPromptStyles')) {
        const styles = document.createElement('style');
        styles.id = 'notifPromptStyles';
        styles.innerHTML = `
            .notif-prompt-banner {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(79, 70, 229, 0.2);
                box-shadow: 0 10px 30px rgba(0,0,0,0.15);
                padding: 16px 20px;
                border-radius: 12px;
                z-index: 9999;
                display: flex;
                flex-direction: column;
                gap: 12px;
                max-width: 340px;
                font-family: 'Segoe UI', Arial, sans-serif;
                animation: notifSlideUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            @keyframes notifSlideUp {
                from { transform: translateY(100px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            .notif-prompt-content {
                display: flex;
                align-items: flex-start;
                gap: 12px;
            }
            .notif-prompt-icon {
                font-size: 1.5rem;
                color: #4f46e5;
                margin-top: 2px;
            }
            .notif-prompt-text {
                font-size: 0.88rem;
                color: #050505;
                font-weight: 600;
                line-height: 1.4;
            }
            .notif-prompt-sub {
                font-size: 0.75rem;
                color: #65676b;
                margin-top: 2px;
            }
            .notif-prompt-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }
            .notif-btn-allow {
                background: #4f46e5;
                color: #fff;
                border: none;
                padding: 6px 14px;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .notif-btn-allow:hover { background: #4338ca; }
            .notif-btn-dismiss {
                background: #f0f2f5;
                color: #65676b;
                border: none;
                padding: 6px 14px;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s;
            }
            .notif-btn-dismiss:hover { background: #e4e6eb; }
        `;
        document.head.appendChild(styles);
    }

    const banner = document.createElement('div');
    banner.id = 'notifPromptBanner';
    banner.className = 'notif-prompt-banner';
    banner.innerHTML = `
        <div class="notif-prompt-content">
            <div class="notif-prompt-icon">🔔</div>
            <div>
                <div class="notif-prompt-text">Enable Notifications</div>
                <div class="notif-prompt-sub">Receive instant alerts when your adviser or section group sends a message.</div>
            </div>
        </div>
        <div class="notif-prompt-actions">
            <button class="notif-btn-dismiss" onclick="dismissStudentNotifPrompt()">Later</button>
            <button class="notif-btn-allow" onclick="allowStudentNotifPrompt()">Enable</button>
        </div>
    `;
    document.body.appendChild(banner);
}

function dismissStudentNotifPrompt() {
    const banner = document.getElementById('notifPromptBanner');
    if (banner) banner.remove();
}

function allowStudentNotifPrompt() {
    dismissStudentNotifPrompt();
    Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
            showStudentBrowserNotification(
                'Notifications Enabled 🔔',
                'You will now receive real-time message alerts!'
            );
        }
    });
}

function showStudentBrowserNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const notif = new Notification(title, {
            body: body,
            icon: '/favicon.ico',
            tag: 'student-comm',
            renotify: true
        });
        notif.onclick = () => {
            window.focus();
            if (typeof showSection === 'function') showSection('communication');
            if (typeof loadStudentCommunication === 'function') loadStudentCommunication();
            notif.close();
        };
        setTimeout(() => notif.close(), 5000);
    }
}

async function fetchStudentNotifications() {
    if (!localStorage.getItem('studentToken')) return;
    try {
        const res = await fetch('/api/student/notifications', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('studentToken')}` }
        });
        if (!res.ok) return;
        const notifs = await res.json();
        const unread = notifs.filter(n => !n.is_read);
        const count = unread.length;
        
        const badge = document.getElementById('commBadge');
        if (badge) {
            if (count > 0) {
                badge.style.display = 'inline-block';
                badge.innerText = count > 99 ? '99+' : count;
            } else {
                badge.style.display = 'none';
            }
        }

        // Fire browser push notification if new messages arrived
        if (count > studentLastNotifCount && studentLastNotifCount !== null) {
            const commSection = document.getElementById('communicationSection');
            const isChatOpen  = commSection && window.getComputedStyle(commSection).display !== 'none';
            if (!isChatOpen) {
                showStudentBrowserNotification(
                    'New Message – DSMSMNHS',
                    `You have ${count} unread message${count > 1 ? 's' : ''}.`
                );
            }
        }
        studentLastNotifCount = count;
    } catch(e) { /* silent */ }
}

function startStudentNotifPolling() {
    if (studentNotifPollInterval) clearInterval(studentNotifPollInterval);
    fetchStudentNotifications(); // immediate
    studentNotifPollInterval = setInterval(fetchStudentNotifications, 4000);
}

async function markStudentNotificationsRead() {
    if (!localStorage.getItem('studentToken')) return;
    try {
        const res = await fetch('/api/student/notifications', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('studentToken')}` }
        });
        const notifs = await res.json();
        const unreadNotifs = notifs.filter(n => !n.is_read);
        for (const n of unreadNotifs) {
            await fetch(`/api/student/notifications/${n.id}/read`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('studentToken')}` }
            });
        }
        fetchStudentNotifications();
    } catch(e) {}
}


async function loadStudentCommunication() {
    await fetchStudentProfileForComm();
    await openStudentChat();
}

async function fetchStudentProfileForComm() {
    try {
        const res = await fetch('/api/student/profile', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('studentToken')}` }
        });
        if (res.ok) {
            studentProfileInfo = await res.json();
        }
    } catch (e) {
        console.error(e);
    }
}

async function openStudentChat(silent = false) {
    const receiverType = document.getElementById('studentCommReceiver').value;
    const titleElement = document.getElementById('studentCommChatTitle');
    const chatBox = document.getElementById('studentCommChatBox');
    
    if (!silent) {
        chatBox.innerHTML = '<div style="text-align:center; padding: 20px;">Loading messages...</div>';
        markStudentNotificationsRead();

        if (receiverType === 'teacher') {
            fetch('/api/student/messages/read-all', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('studentToken')}` }
            }).then(() => {
                fetchStudentNotifications();
            }).catch(e => console.error(e));
        }
        
        if (studentCommPollInterval) clearInterval(studentCommPollInterval);
        studentCommPollInterval = setInterval(() => {
            const commSection = document.getElementById('communicationSection');
            if (commSection && commSection.style.display !== 'none') {
                openStudentChat(true);
            }
        }, 3000);
    }

    if (receiverType === 'teacher' && silent) {
        fetch('/api/student/messages/read-all', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('studentToken')}` }
        }).then(() => {
            fetchStudentNotifications();
        }).catch(e => console.error(e));
    }

    if (receiverType === 'teacher') {
        try {
            const statusRes = await fetch('/api/student/adviser-status', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('studentToken')}` }
            });
            if (statusRes.ok) {
                const statusData = await statusRes.json();
                const statusText = statusData.is_online ? 'Active now' : 'Offline';
                const statusColor = statusData.is_online ? '#22c55e' : '#64748b';
                titleElement.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <div><i class="fas fa-user-tie"></i> Adviser Direct Message</div>
                        <div style="font-size: 0.8rem; display: flex; align-items: center; gap: 5px; color: ${statusColor}; font-weight: normal;">
                            <span style="width: 8px; height: 8px; border-radius: 50%; background-color: ${statusColor}; display: inline-block;"></span>
                            ${statusText}
                        </div>
                    </div>
                `;
            }
        } catch (e) {
            console.error('Error fetching adviser status:', e);
        }
    } else {
        titleElement.innerHTML = `<i class="fas fa-users"></i> ${studentProfileInfo?.Section?.section_name || 'Section'} Group Chat`;
    }

    try {
        const res = await fetch('/api/student/messages', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('studentToken')}` }
        });
        
        if (!res.ok) {
            chatBox.innerHTML = '<div style="text-align:center; padding: 20px; color: #ef4444;">Please log in to view messages.</div>';
            return;
        }

        const allMessages = await res.json();
        
        if (!Array.isArray(allMessages)) {
             chatBox.innerHTML = '<div style="text-align:center; padding: 20px; color: #ef4444;">Failed to load messages.</div>';
             return;
        }

        let messages = [];
        if (receiverType === 'teacher') {
            // Direct messages between student and any teacher (adviser)
            messages = allMessages.filter(m => 
                (m.sender_type === 'student' && m.receiver_type === 'teacher') ||
                (m.sender_type === 'teacher' && m.receiver_type === 'student')
            );
        } else if (receiverType === 'section') {
            // Section group chat
            messages = allMessages.filter(m => m.receiver_type === 'section');
        }

        // Notify user if new message arrived via polling
        if (silent && messages.length > studentLastMessageCount) {
            const lastMsg = messages[messages.length - 1];
            if (lastMsg.sender_type !== 'student' || lastMsg.sender_id !== studentProfileInfo?.id) {
                showStudentBrowserNotification(
                    `New message from ${lastMsg.sender_name || 'Your Adviser'}`,
                    lastMsg.content || '📎 Attachment'
                );
            }
        }
        studentLastMessageCount = messages.length;

        const wasAtBottom = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 80;
        chatBox.innerHTML = '';
        
        if (messages.length === 0) {
            chatBox.innerHTML = '<div style="text-align:center; padding:40px; color:#8696a0;">No messages yet. Say hello! 👋</div>';
        } else {
            let lastDate = '';
            messages.forEach(m => {
                const isMine = (m.sender_type === 'student' && m.sender_id === studentProfileInfo?.id);
                const msgDate = new Date(m.created_at).toLocaleDateString();
                const msgTime = new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

                if (msgDate !== lastDate) {
                    lastDate = msgDate;
                    const sep = document.createElement('div');
                    sep.style.cssText = 'text-align:center;font-size:0.72rem;color:#65676b;margin:10px 0;font-weight:600;';
                    sep.innerText = new Date(m.created_at).toLocaleDateString([], {weekday:'long',month:'short',day:'numeric'});
                    chatBox.appendChild(sep);
                }

                let senderName = isMine ? 'You' : (m.sender_name || (m.sender_type === 'teacher' ? 'Teacher' : 'Classmate'));
                const row = document.createElement('div');
                row.style.cssText = `display:flex;flex-direction:column;margin-bottom:4px;max-width:75%;align-self:${isMine?'flex-end':'flex-start'};align-items:${isMine?'flex-end':'flex-start'};width:100%;`;

                const senderLabel = (!isMine && receiverType === 'section')
                    ? `<div style="font-size:0.72rem;color:#65676b;margin-bottom:3px;margin-left:4px;">${senderName}</div>`
                    : '';

                const imgHtml = m.attachment_url
                    ? `<img src="${m.attachment_url}" style="max-width:220px;border-radius:12px;cursor:pointer;display:block;margin-bottom:4px;" onclick="window.open('${m.attachment_url}','_blank')" />`
                    : '';

                const textHtml = m.content ? `<span>${m.content}</span>` : '';

                const bubbleBg    = isMine ? '#0084ff' : '#f0f2f5';
                const bubbleColor = isMine ? '#fff' : '#050505';
                const bRadius     = isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px';

                row.innerHTML = `
                    ${senderLabel}
                    <div style="background:${bubbleBg};color:${bubbleColor};padding:9px 14px;border-radius:${bRadius};font-size:0.93rem;line-height:1.4;word-break:break-word;">
                        ${imgHtml}${textHtml}
                    </div>
                    <div style="font-size:0.68rem;color:#8696a0;margin-top:3px;padding:0 4px;">${msgTime}</div>
                `;
                chatBox.appendChild(row);
            });
            if (!silent || wasAtBottom) chatBox.scrollTop = chatBox.scrollHeight;
        }
    } catch (error) {
        console.error('Error fetching chat:', error);
    }
}

async function sendStudentMessage() {
    const receiverType = document.getElementById('studentCommReceiver').value;
    const fileInput = document.getElementById('studentCommAttachment');
    const input = document.getElementById('studentCommInput');
    const content = input.value.trim();
    if ((!content && (!fileInput.files || fileInput.files.length === 0)) || !studentProfileInfo) return;

    let receiverId = null;
    if (receiverType === 'teacher') {
        receiverId = studentProfileInfo?.Section?.adviser_id; // Send to adviser
        if (!receiverId) {
            alert('You have no assigned adviser.');
            return;
        }
    } else if (receiverType === 'section') {
        receiverId = studentProfileInfo?.section_id;
        if (!receiverId) {
            alert('You are not assigned to a section.');
            return;
        }
    }

    input.disabled = true;
    try {
        const formData = new FormData();
        formData.append('receiver_type', receiverType);
        formData.append('receiver_id', receiverId);
        formData.append('content', content);
        if (fileInput.files && fileInput.files[0]) {
            formData.append('attachment', fileInput.files[0]);
        }

        const res = await fetch('/api/student/messages', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${localStorage.getItem('studentToken')}` 
            },
            body: formData
        });

        if (res.ok) {
            input.value = '';
            fileInput.value = '';
            document.getElementById('studentCommAttachmentPreview').style.display = 'none';
            openStudentChat(); // reload
        } else {
            alert('Failed to send message');
        }
    } catch (error) {
        console.error('Send error:', error);
        alert('An error occurred');
    } finally {
        input.disabled = false;
        input.focus();
    }
}
