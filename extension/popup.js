/**
 * MansotNote Web Clipper — Popup Logic
 * Architecture 100 % sécurisée : tout transite par l'API MansotNote avec Token Bearer (Ollama reste en backend privé).
 */

document.addEventListener('DOMContentLoaded', async () => {
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // Gestion des onglets
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tabContents.forEach((c) => c.classList.remove('active'));

      tab.classList.add('active');
      const target = document.getElementById(`tab-${tab.dataset.tab}`);
      if (target) target.classList.add('active');
    });
  });

  // Chargement de la configuration
  const storedConfig = await mnGetConfig({
    appUrl: 'https://notes.mansotfamily.fr',
    apiToken: '',
    aiModel: 'qwen3.8:9b-q6-32k',
  });

  const appUrlInput = document.getElementById('cfg-app-url');
  const apiTokenInput = document.getElementById('cfg-api-token');
  const aiModelInput = document.getElementById('cfg-ai-model');

  if (appUrlInput) appUrlInput.value = storedConfig.appUrl;
  if (apiTokenInput) apiTokenInput.value = storedConfig.apiToken;
  if (aiModelInput) appUrlInput && (aiModelInput.value = storedConfig.aiModel || 'qwen3.8:9b-q6-32k');

  const getBaseAppUrl = () => {
    return (appUrlInput?.value || storedConfig.appUrl || 'https://notes.mansotfamily.fr').replace(/\/+$/, '');
  };

  const getApiToken = () => {
    return (apiTokenInput?.value || storedConfig.apiToken || '').trim();
  };

  const getAiModel = () => {
    return (aiModelInput?.value || storedConfig.aiModel || 'qwen3.8:9b-q6-32k').trim();
  };

  // Appel IA : Passe par le backend sécurisé MansotNote avec think: false pour une vitesse instantanée
  const callAi = async (messages, temperature = 0.2, think = false) => {
    const baseUrl = getBaseAppUrl();
    const token = getApiToken();
    const model = getAiModel();

    if (!token) {
      throw new Error('Veuillez configurer votre Token API dans l\'onglet ⚙️ Réglages (créé dans MansotNote → Sécurité du compte).');
    }

    const res = await fetch(`${baseUrl}/api/v1/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        think,
        keep_alive: -1,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erreur serveur MansotNote (${res.status})`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  };

  // Récupération de l'onglet actif et de sa sélection
  let currentPageTitle = '';
  let currentPageUrl = '';
  let currentSelection = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentPageTitle = tab.title || '';
      currentPageUrl = tab.url || '';

      document.getElementById('note-title').value = currentPageTitle;
      document.getElementById('task-title').value = `Consulter : ${currentPageTitle}`;
      document.getElementById('note-url').value = currentPageUrl;

      // Extraction du texte sélectionné
      if (tab.id && !currentPageUrl.startsWith('chrome://') && !currentPageUrl.startsWith('edge://')) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.getSelection()?.toString() || '',
        }).catch(() => []);

        currentSelection = results?.[0]?.result?.trim() || '';
        if (currentSelection) {
          document.getElementById('note-content').value = currentSelection;
          document.getElementById('correct-input').value = currentSelection;
          document.getElementById('task-desc').value = `Lien : ${currentPageUrl}\n\nExtrait :\n${currentSelection}`;
        } else {
          document.getElementById('note-content').value = `# [${currentPageTitle}](${currentPageUrl})\n\nPage web capturée le ${new Date().toLocaleDateString('fr-FR')}.`;
          document.getElementById('task-desc').value = `Lien : ${currentPageUrl}`;
        }
      }
    }
  } catch (e) {
    console.error('Erreur lecture onglet actif', e);
  }

  const sendDirectClip = async (payload) => {
    const baseUrl = getBaseAppUrl();
    const token = getApiToken();

    if (token) {
      try {
        const res = await fetch(`${baseUrl}/api/v1/clips`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) return true;
      } catch {
        // Origine personnalisée non autorisée, réseau indisponible ou CORS : repli onglet.
      }
    }

    // Repli si pas de token : ouverture d'onglet
    const targetUrl = `${baseUrl}/?action=new_note&title=${encodeURIComponent(payload.title)}&content=${encodeURIComponent(payload.content)}`;
    chrome.tabs.create({ url: targetUrl });
    return false;
  };

  // ==============================================================
  // 1. Outils IA dans l'onglet Note : Structurer Markdown & Résumer (AVEC RÉFLEXION / THINK: TRUE)
  // ==============================================================
  document.getElementById('btn-ai-reformulate')?.addEventListener('click', async () => {
    const rawContent = document.getElementById('note-content').value.trim();
    if (!rawContent) return;

    const btn = document.getElementById('btn-ai-reformulate');
    const oldText = btn.textContent;
    btn.textContent = '⏳ Structuration approfondie...';
    btn.disabled = true;

    try {
      const messages = [
        {
          role: 'system',
          content: 'Tu es SIA, l\'assistante IA de MansotNote. Analyse les éléments bruts ou le texte fourni et reformule-le sous forme d\'une note Markdown impeccable, claire, bien structurée, hiérarchisée avec des titres, sous-titres, listes à puces et mise en gras. Ne réponds qu\'avec le contenu Markdown final sans bavardage.',
        },
        {
          role: 'user',
          content: `Voici le contenu brut à structurer en Markdown de haute qualité :\n\n${rawContent}`,
        },
      ];

      // think: true pour permettre à Qwen 3.8 de bien réfléchir à la structure
      const formatted = await callAi(messages, 0.4, true);
      if (formatted) {
        document.getElementById('note-content').value = formatted.trim();
        document.getElementById('note-markdown-preview')?.removeAttribute('hidden');
        const previewButton = document.getElementById('btn-note-preview');
        if (previewButton) previewButton.textContent = '✏️ Édition';
        document.getElementById('note-markdown-preview').innerHTML = renderMarkdown(formatted.trim());
      }
    } catch (err) {
      alert(`Erreur : ${err.message}`);
    } finally {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  });

  document.getElementById('btn-ai-summary')?.addEventListener('click', async () => {
    const rawContent = document.getElementById('note-content').value.trim();
    if (!rawContent) return;

    const btn = document.getElementById('btn-ai-summary');
    const oldText = btn.textContent;
    btn.textContent = '⏳ Résumé analytique...';
    btn.disabled = true;

    try {
      const messages = [
        {
          role: 'system',
          content: 'Tu es SIA, l\'assistante IA de MansotNote. Analyse et résume ce texte sous forme de points clés concis, pertinents et bien organisés en Markdown.',
        },
        { role: 'user', content: rawContent },
      ];

      // think: true pour un résumé de grande qualité
      const summary = await callAi(messages, 0.3, true);
      if (summary) {
        document.getElementById('note-content').value = summary.trim();
        document.getElementById('note-markdown-preview')?.removeAttribute('hidden');
        const previewButton = document.getElementById('btn-note-preview');
        if (previewButton) previewButton.textContent = '✏️ Édition';
        document.getElementById('note-markdown-preview').innerHTML = renderMarkdown(summary.trim());
      }
    } catch (err) {
      alert(`Erreur : ${err.message}`);
    } finally {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  });

  const noteContent = document.getElementById('note-content');
  const notePreview = document.getElementById('note-markdown-preview');
  const notePreviewButton = document.getElementById('btn-note-preview');

  const refreshNotePreview = () => {
    if (!notePreview || notePreview.hidden) return;
    notePreview.innerHTML = renderMarkdown(noteContent?.value || '');
  };

  notePreviewButton?.addEventListener('click', () => {
    notePreview.hidden = !notePreview.hidden;
    notePreviewButton.textContent = notePreview.hidden ? '👁 Aperçu' : '✏️ Édition';
    refreshNotePreview();
  });
  noteContent?.addEventListener('input', refreshNotePreview);

  // Action Sauvegarder Note
  document.getElementById('btn-save-note')?.addEventListener('click', async () => {
    const title = document.getElementById('note-title').value || 'Note Web';
    const content = document.getElementById('note-content').value || '';
    const url = document.getElementById('note-url').value || '';

    const btn = document.getElementById('btn-save-note');
    if (btn) btn.textContent = 'Enregistrement...';

    await sendDirectClip({
      type: 'note',
      title,
      content,
      url,
      idempotentKey: `${url}_${Date.now()}`,
    });

    window.close();
  });

  // ==============================================================
  // 2. Onglet Correction Orthographe & Style
  // ==============================================================
  document.getElementById('btn-run-correct')?.addEventListener('click', async () => {
    const textToCorrect = document.getElementById('correct-input').value.trim();
    if (!textToCorrect) return;

    const btn = document.getElementById('btn-run-correct');
    const oldText = btn.textContent;
    btn.textContent = '⏳ Correction en cours...';
    btn.disabled = true;

    try {
      const messages = [
        {
          role: 'system',
          content: 'Tu es SIA, correctrice experte de la langue française. Corrige l\'orthographe, la grammaire et la ponctuation du texte. Règle absolue : renvoie UNIQUEMENT le texte corrigé brut, sans introduction, sans salutation, sans explication.',
        },
        { role: 'user', content: textToCorrect },
      ];

      const corrected = await callAi(messages, 0.1);
      const cleanOutput = corrected.replace(/^```[a-z]*\n?([\s\S]*?)\n?```$/i, '$1').replace(/^["«](.*)["»]$/s, '$1').trim();
      document.getElementById('correct-output').value = cleanOutput;
    } catch (err) {
      alert(`Erreur : ${err.message}`);
    } finally {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  });

  document.getElementById('btn-copy-correct')?.addEventListener('click', () => {
    const out = document.getElementById('correct-output').value;
    if (out) {
      navigator.clipboard.writeText(out);
      const btn = document.getElementById('btn-copy-correct');
      btn.textContent = '✅ Copié !';
      setTimeout(() => btn.textContent = '📋 Copier', 1800);
    }
  });

  document.getElementById('btn-save-correct-note')?.addEventListener('click', async () => {
    const content = document.getElementById('correct-output').value || document.getElementById('correct-input').value;
    if (!content.trim()) return;

    await sendDirectClip({
      type: 'note',
      title: `Texte corrigé (${new Date().toLocaleDateString('fr-FR')})`,
      content,
      url: currentPageUrl,
    });
    window.close();
  });

  // ==============================================================
  // 3. Onglet SIA (Copilote Chat)
  // ==============================================================
  const siaMessages = document.getElementById('sia-messages');
  const siaInput = document.getElementById('sia-chat-input');
  const siaForm = document.getElementById('sia-chat-form');

  const siaHistory = [
    {
      role: 'system',
      content: `Tu es SIA, l'assistante IA personnelle et copilote de productivité de MansotNote.
Tu es intelligente, bienveillante, concise et experte en organisation de notes et tâches.
L'utilisateur est actuellement sur la page : "${currentPageTitle}" (${currentPageUrl}).
${currentSelection ? `Extrait de texte sélectionné sur la page :\n"""${currentSelection}"""` : ''}
Réponds toujours en Markdown clair et structuré.`,
    },
  ];

  siaForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = siaInput.value.trim();
    if (!query) return;

    // Afficher message utilisateur
    const userMsgDiv = document.createElement('div');
    userMsgDiv.className = 'sia-msg user';
    userMsgDiv.innerHTML = `<div class="sia-msg-text">${escapeHtml(query)}</div>`;
    siaMessages.appendChild(userMsgDiv);
    siaInput.value = '';
    siaMessages.scrollTop = siaMessages.scrollHeight;

    siaHistory.push({ role: 'user', content: query });

    // Placeholder assistant
    const botMsgDiv = document.createElement('div');
    botMsgDiv.className = 'sia-msg assistant';
    botMsgDiv.innerHTML = `<div class="sia-msg-author">🤖 SIA</div><div class="sia-msg-text">⏳ Réflexion...</div>`;
    siaMessages.appendChild(botMsgDiv);
    siaMessages.scrollTop = siaMessages.scrollHeight;

    try {
      // think: true pour SIA Chat (réflexion et pertinence maximale)
      const reply = await callAi(siaHistory, 0.7, true);
      botMsgDiv.querySelector('.sia-msg-text').innerHTML = renderMarkdown(reply);
      siaHistory.push({ role: 'assistant', content: reply });
    } catch (err) {
      botMsgDiv.querySelector('.sia-msg-text').textContent = `⚠️ Erreur : ${err.message}`;
    } finally {
      siaMessages.scrollTop = siaMessages.scrollHeight;
    }
  });

  // ==============================================================
  // 4. Onglet Kanban & Réglages
  // ==============================================================
  document.getElementById('btn-save-task')?.addEventListener('click', async () => {
    const title = document.getElementById('task-title').value || 'Tâche Web';
    const desc = document.getElementById('task-desc').value || '';
    const priority = document.getElementById('task-priority').value || 'medium';
    const url = document.getElementById('note-url').value || '';

    const btn = document.getElementById('btn-save-task');
    if (btn) btn.textContent = 'Enregistrement...';

    await sendDirectClip({
      type: 'card',
      title,
      content: desc,
      url,
      metadata: { priority },
      idempotentKey: `${url}_task_${Date.now()}`,
    });

    window.close();
  });

  document.getElementById('btn-save-config')?.addEventListener('click', async () => {
    const newUrl = document.getElementById('cfg-app-url').value.trim();
    const newToken = document.getElementById('cfg-api-token').value.trim();
    const newModel = document.getElementById('cfg-ai-model').value.trim();

    await mnSetConfig({
      appUrl: newUrl,
      apiToken: newToken,
      aiModel: newModel,
    });

    const status = document.getElementById('connection-status');
    if (status) {
      status.textContent = 'Enregistré !';
      status.style.color = '#10b981';
      setTimeout(() => {
        status.textContent = 'Prêt';
        status.style.color = '';
      }, 2000);
    }
  });

  document.getElementById('link-open-app')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: getBaseAppUrl() });
  });

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[m]));
  }

  function renderMarkdown(source) {
    const codeBlocks = [];
    let text = String(source || '').replace(/\r\n?/g, '\n');
    text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => {
      const index = codeBlocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`) - 1;
      return `\n@@CODE_BLOCK_${index}@@\n`;
    });

    text = escapeHtml(text);
    text = text
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^---+$/gm, '<hr>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    const lines = text.split('\n');
    const output = [];
    let listType = '';
    const closeList = () => {
      if (listType) output.push(`</${listType}>`);
      listType = '';
    };

    for (const line of lines) {
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        const nextType = unordered ? 'ul' : 'ol';
        if (listType !== nextType) {
          closeList();
          listType = nextType;
          output.push(`<${listType}>`);
        }
        output.push(`<li>${unordered?.[1] || ordered?.[1]}</li>`);
        continue;
      }
      closeList();
      if (!line.trim()) continue;
      if (/^<(h[1-3]|blockquote|hr|pre)/.test(line) || /^@@CODE_BLOCK_\d+@@$/.test(line)) output.push(line);
      else output.push(`<p>${line}</p>`);
    }
    closeList();

    return output.join('').replace(/@@CODE_BLOCK_(\d+)@@/g, (_, index) => codeBlocks[Number(index)] || '');
  }
});
