importScripts('storage.js');

/**
 * MansotNote Web Clipper — Service Worker (Background Script)
 * Gère les menus contextuels, les appels API REST directs en tâche de fond et les notifications.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'mn-clip-note-selection',
    title: '📝 Enregistrer la sélection en Note',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: 'mn-clip-note-page',
    title: '📝 Capturer cette page en Note',
    contexts: ['page'],
  });

  chrome.contextMenus.create({
    id: 'mn-clip-kanban-task',
    title: '📋 Ajouter en tâche Kanban',
    contexts: ['page', 'selection', 'link'],
  });
});

async function sendClipToApi({ type, title, content, url, metadata }) {
  const config = await mnGetConfig({
    appUrl: 'https://notes.mansotfamily.fr',
    apiToken: '',
  });

  const appBaseUrl = (config.appUrl || 'https://notes.mansotfamily.fr').replace(/\/+$/, '');
  const apiToken = config.apiToken?.trim();

  // Si un token API est configuré, on fait un POST direct en tâche de fond (silencieux et immédiat)
  if (apiToken) {
    try {
      const response = await fetch(`${appBaseUrl}/api/v1/clips`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          type,
          title,
          content,
          url,
          metadata,
          idempotentKey: `${url}_${Date.now()}`,
        }),
      });

      if (response.ok) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'MansotNote Web Clipper',
          message: `✨ « ${title} » a été enregistré en tâche de fond !`,
        });
        return { success: true };
      } else {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Erreur HTTP ${response.status}`);
      }
    } catch (e) {
      console.warn('[WebClipper] Erreur API direct, bascule sur onglet', e);
      // En cas d'échec du token, repli sur l'ouverture d'onglet
    }
  }

  // Repli automatique sans token : ouverture d'onglet
  const targetUrl = `${appBaseUrl}/?action=new_note&title=${encodeURIComponent(title)}&content=${encodeURIComponent(content)}`;
  chrome.tabs.create({ url: targetUrl });
  return { success: true, mode: 'tab' };
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  const pageTitle = tab.title || 'Page Web';
  const pageUrl = tab.url || '';
  const selectionText = info.selectionText || '';

  if (info.menuItemId === 'mn-clip-note-selection' || info.menuItemId === 'mn-clip-note-page') {
    const noteTitle = selectionText ? `${pageTitle} (Extrait)` : pageTitle;
    const noteContent = selectionText
      ? `> ${selectionText.replace(/\n/g, '\n> ')}\n\n---\n**Source** : [${pageTitle}](${pageUrl})`
      : `# [${pageTitle}](${pageUrl})\n\nPage capturée le ${new Date().toLocaleDateString('fr-FR')}\n\n**URL** : ${pageUrl}`;

    await sendClipToApi({
      type: 'note',
      title: noteTitle,
      content: noteContent,
      url: pageUrl,
    });
  } else if (info.menuItemId === 'mn-clip-kanban-task') {
    const taskTitle = selectionText ? selectionText.slice(0, 80) : `Consulter : ${pageTitle}`;
    const taskDesc = `Lien : ${pageUrl}\n\n${selectionText ? `Extrait : ${selectionText}` : ''}`;

    await sendClipToApi({
      type: 'card',
      title: taskTitle,
      content: taskDesc,
      url: pageUrl,
      metadata: { priority: 'medium' },
    });
  }
});
