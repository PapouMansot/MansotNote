/**
 * BookmarkletModal — Plugin Favoris & Compagnon Actif MansotNote
 * ----------------------------------------------------------------
 * Le Copilote peut AGIR directement sur votre espace de travail :
 *  - ➕ Créer automatiquement des tâches Kanban quand vous lui demandez
 *  - 📝 Créer des notes structurées
 *  - ✍️ Remplacer/Injecter du texte dans Slack/Teams/Gmail/Discord
 *  - ⚡ Détecter et exécuter les actions d'un simple clic
 */
import { useState } from 'react';
import {
  Bookmark,
  Check,
  Copy,
  Download,
  Globe,
  MessageSquare,
  Sparkles,
  SquareKanban,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export function BookmarkletModal({ onClose }: { onClose: () => void }) {
  const state = useAppStore();
  const settings = state.data.settings;
  const cards = state.data.cards;
  const [copied, setCopied] = useState(false);

  const defaultEndpoint = settings.aiEndpoint || 'https://api.openai.com/v1';
  const defaultModel = settings.aiModel || 'gpt-4o-mini';
  const defaultApiKey = settings.aiApiKey || '';
  const appUrl = window.location.origin;

  const tasksSnapshot = cards.map((c) => ({
    id: c.id,
    title: c.title,
    columnId: c.columnId,
    priority: c.priority,
  }));

  // Code JavaScript du Bookmarklet connecté au Hub MansotNote
  const scriptContent = `(function(){
  'use strict';
  if(document.getElementById('_mansot_host')) return;

  var defaultAppUrl = ${JSON.stringify(appUrl)};
  var initialEndpoint = ${JSON.stringify(defaultEndpoint)};
  var initialModel = ${JSON.stringify(defaultModel)};
  var initialApiKey = ${JSON.stringify(defaultApiKey)};
  var initialCards = ${JSON.stringify(tasksSnapshot)};

  var sel = window.getSelection() ? window.getSelection().toString().trim() : '';
  var pageTitle = document.title || 'Page Web';
  var pageUrl = window.location.href;
  var timestamp = new Date().toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });

  var savedConfig = {};
  try { savedConfig = JSON.parse(localStorage.getItem('_mn_hub_cfg') || '{}'); } catch(e){}
  var appBaseUrl = savedConfig.appUrl || defaultAppUrl;
  // Une adresse enregistrée en HTTP clair est désormais redirigée vers HTTPS :
  // la fenêtre relais répondrait depuis une origine différente de celle
  // attendue et la réponse serait rejetée. On repointe donc sur l'adresse
  // officielle dès que la configuration sauvegardée est obsolète.
  try {
    var savedOrigin = new URL(appBaseUrl).origin;
    var canonicalOrigin = new URL(defaultAppUrl).origin;
    if(savedOrigin !== canonicalOrigin && savedOrigin.indexOf('http://') === 0) {
      appBaseUrl = defaultAppUrl;
      savedConfig.appUrl = defaultAppUrl;
      try { localStorage.setItem('_mn_hub_cfg', JSON.stringify(savedConfig)); } catch(e){}
    }
  } catch(e){}
  var decryptKey = savedConfig.decryptKey || '';
  var aiEndpoint = savedConfig.endpoint || initialEndpoint;
  var aiModel = savedConfig.model || initialModel;
  var aiKey = savedConfig.apiKey || initialApiKey;

  var host = document.createElement('div');
  host.id = '_mansot_host';
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
    '.mn-window { position: fixed; top: 24px; right: 24px; width: 475px; max-width: calc(100vw - 32px); background: rgba(14, 16, 23, 0.95); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(99, 102, 241, 0.4); border-radius: 16px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.85); color: #f1f5f9; font-size: 13px; line-height: 1.5; display: flex; flex-direction: column; overflow: hidden; z-index: 2147483647; }',
    '.mn-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid rgba(255, 255, 255, 0.07); cursor: move; user-select: none; }',
    '.mn-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; color: #fff; }',
    '.mn-title-badge { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 20px; font-weight: 600; }',
    '.mn-controls { display: flex; align-items: center; gap: 4px; }',
    '.mn-btn-icon { background: transparent; border: none; color: #94a3b8; width: 26px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 15px; }',
    '.mn-btn-icon:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }',
    '.mn-tabs { display: flex; gap: 3px; padding: 10px 14px 6px; background: rgba(0, 0, 0, 0.25); }',
    '.mn-tab { flex: 1; padding: 7px 6px; border: none; border-radius: 8px; background: transparent; color: #94a3b8; font-weight: 600; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; }',
    '.mn-tab:hover { color: #f1f5f9; background: rgba(255, 255, 255, 0.04); }',
    '.mn-tab.active { background: #4f46e5; color: #ffffff; box-shadow: 0 2px 8px rgba(79, 70, 229, 0.4); }',
    '.mn-body { padding: 14px; max-height: 490px; overflow-y: auto; }',
    '.mn-field-label { display: block; font-size: 11px; font-weight: 600; color: #94a3b8; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.04em; }',
    '.mn-input, .mn-textarea, .mn-select { width: 100%; background: #090a0f; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 8px 10px; color: #f8fafc; font-size: 12.5px; outline: none; }',
    '.mn-input:focus, .mn-textarea:focus, .mn-select:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25); }',
    '.mn-textarea { font-family: Consolas, Monaco, monospace; resize: vertical; min-height: 90px; }',
    '.mn-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-weight: 600; font-size: 12px; border: none; cursor: pointer; text-decoration: none; }',
    '.mn-btn-primary { background: linear-gradient(135deg, #4f46e5, #6366f1); color: #fff; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35); }',
    '.mn-btn-primary:hover { background: linear-gradient(135deg, #4338ca, #4f46e5); }',
    '.mn-btn-success { background: #10b981; color: #fff; }',
    '.mn-btn-success:hover { background: #059669; }',
    '.mn-btn-secondary { background: rgba(255, 255, 255, 0.08); color: #e2e8f0; border: 1px solid rgba(255, 255, 255, 0.08); }',
    '.mn-btn-secondary:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }',
    '.mn-btn-danger { background: linear-gradient(135deg, #dc2626, #ef4444); color: #fff; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.35); }',
    '.mn-btn-danger:hover { background: linear-gradient(135deg, #b91c1c, #dc2626); }',
    '.mn-chat-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; max-height: 250px; overflow-y: auto; }',
    '.mn-msg { padding: 10px 12px; border-radius: 12px; font-size: 12px; line-height: 1.5; max-width: 94%; }',
    '.mn-msg-user { align-self: flex-end; background: linear-gradient(135deg, #4338ca, #4f46e5); color: #fff; border-bottom-right-radius: 3px; }',
    '.mn-msg-ai { align-self: flex-start; background: rgba(255, 255, 255, 0.05); color: #e2e8f0; border: 1px solid rgba(255, 255, 255, 0.08); border-bottom-left-radius: 3px; }',
    '.mn-action-card { background: rgba(99, 102, 241, 0.14); border: 1px solid rgba(99, 102, 241, 0.35); border-radius: 10px; padding: 10px; margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }',
    '.mn-action-title { font-weight: 700; font-size: 11px; color: #a5b4fc; display: flex; align-items: center; gap: 4px; }',
    '.mn-toast { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); background: #10b981; color: #fff; padding: 6px 14px; border-radius: 20px; font-size: 11.5px; font-weight: 600; display: none; z-index: 99; }',
    '.mn-bubble { position: fixed; bottom: 24px; right: 24px; width: 50px; height: 50px; border-radius: 25px; background: linear-gradient(135deg, #4f46e5, #7c3aed); box-shadow: 0 10px 25px rgba(79, 70, 229, 0.5); border: 2px solid #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 22px; color: #fff; z-index: 2147483647; }',
    '.mn-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }',
    '.mn-chip { background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); color: #cbd5e1; padding: 4px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; transition: all 0.15s; }',
    '.mn-chip:hover { background: rgba(99, 102, 241, 0.25); border-color: #6366f1; color: #fff; }',
    '.mn-kanban-item { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; font-size: 12px; display: flex; align-items: center; justify-content: space-between; gap: 6px; }',
    '.mn-badge { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }',
    '.mn-badge-todo { background: #3b82f6; color: #fff; }',
    '.mn-badge-progress { background: #eab308; color: #000; }',
    '.mn-badge-done { background: #10b981; color: #fff; }',
    '.mn-badge-backlog { background: #64748b; color: #fff; }'
  ].join('\\n');
  shadow.appendChild(style);

  var win = document.createElement('div');
  win.className = 'mn-window';

  win.innerHTML = [
    '<div class="mn-header" id="_hdr">',
    '  <div class="mn-title"><span>🚀 MansotNote</span><span class="mn-title-badge">Copilote Actif</span></div>',
    '  <div class="mn-controls">',
    '    <button class="mn-btn-icon" id="_btn_min" title="Réduire en bulle">—</button>',
    '    <button class="mn-btn-icon" id="_btn_close" title="Fermer">✕</button>',
    '  </div>',
    '</div>',
    '<div class="mn-tabs">',
    '  <button class="mn-tab active" id="_t_chat">🤖 Chat & Tâches</button>',
    '  <button class="mn-tab" id="_t_kanban">📋 Kanban</button>',
    '  <button class="mn-tab" id="_t_msg">💬 Messages</button>',
    '  <button class="mn-tab" id="_t_note">📝 Note</button>',
    '  <button class="mn-tab" id="_t_cfg" style="flex:0 0 28px;" title="Connexion MansotNote">⚙️</button>',
    '</div>',
    '<div class="mn-body">',

    /* PANEL CHAT */
    '  <div id="_p_chat">',
    '    <div class="mn-chat-list" id="_chat_msgs">',
    '      <div class="mn-msg mn-msg-ai">👋 <strong>Salut !</strong> Je suis ton Copilote MansotNote. Je peux <strong>consulter tes tâches, créer des todos dans ton Kanban ou créer des notes</strong> pour toi ! Demande-moi par exemple : <em>"Ajoute la tâche Déployer le serveur en Urgent"</em> ou <em>"Résume mes todos"</em>.</div>',
    '    </div>',
    '    <div style="display:flex; gap:6px;">',
    '      <input class="mn-input" id="_chat_inp" placeholder="ex: Ajoute la tâche Déployer en urgent, Résume mes todos..." />',
    '      <button class="mn-btn mn-btn-primary" id="_chat_btn" style="flex-shrink:0;">Envoyer</button>',
    '    </div>',
    '  </div>',

    /* PANEL KANBAN */
    '  <div id="_p_kanban" style="display:none;">',
    '    <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:8px;">',
    '      <label class="mn-field-label" style="margin-bottom:0;">Tâches du Kanban</label>',
    '      <div style="display:flex; gap:6px;">',
    '        <button class="mn-btn mn-btn-danger" id="_btn_clear_kanban" style="padding:3px 8px; font-size:10.5px;">🗑️ Tout supprimer</button>',
    '        <button class="mn-btn mn-btn-secondary" id="_btn_refresh_kanban" style="padding:3px 8px; font-size:10.5px;">🔄 Actualiser</button>',
    '      </div>',
    '    </div>',
    '    <div id="_kanban_list" style="max-height:220px; overflow-y:auto; margin-bottom:10px;"></div>',
    '    <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:10px;">',
    '      <label class="mn-field-label">Ajouter une tâche rapide</label>',
    '      <input class="mn-input" id="_k_title" placeholder="Titre de la tâche..." style="margin-bottom:6px;" />',
    '      <div style="display:flex; gap:6px; margin-bottom:8px;">',
    '        <select class="mn-select" id="_k_col" style="flex:1;">',
    '          <option value="todo">À faire (Todo)</option>',
    '          <option value="in_progress">En cours</option>',
    '          <option value="backlog">Backlog / Idée</option>',
    '        </select>',
    '        <select class="mn-select" id="_k_prio" style="flex:1;">',
    '          <option value="medium">Priorité Moyenne</option>',
    '          <option value="high">Priorité Haute</option>',
    '          <option value="urgent">Urgent</option>',
    '        </select>',
    '      </div>',
    '      <button class="mn-btn mn-btn-primary" id="_k_add" style="width:100%;">➕ Ajouter au Kanban</button>',
    '    </div>',
    '  </div>',

    /* PANEL MESSAGE & MAIL */
    '  <div id="_p_msg" style="display:none;">',
    '    <label class="mn-field-label">Action rapide</label>',
    '    <div class="mn-chips">',
    '      <button class="mn-chip" id="_chip_correct">✨ Corriger l\\'orthographe</button>',
    '      <button class="mn-chip" id="_chip_pro">👔 Style Pro & Courtois</button>',
    '      <button class="mn-chip" id="_chip_short">⚡ Raccourcir & Synthétiser</button>',
    '      <button class="mn-chip" id="_chip_slack">💬 Slack / Teams / WhatsApp</button>',
    '    </div>',
    '    <label class="mn-field-label">Texte à traiter</label>',
    '    <textarea class="mn-textarea" id="_m_input" placeholder="Tapez ou collez votre brouillon ici (ou sélectionnez du texte sur la page)..." style="height:80px; margin-bottom:8px;"></textarea>',
    '    <label class="mn-field-label">Format / Intention</label>',
    '    <select class="mn-select" id="_m_type" style="margin-bottom:8px;">',
    '      <option value="correct_only">Correction stricte (orthographe & grammaire fidèles)</option>',
    '      <option value="chat_pro">Message court & professionnel (Slack, Teams, WhatsApp)</option>',
    '      <option value="email_reply">Email de réponse courtois et structuré</option>',
    '      <option value="email_followup">Email de relance clair et bienveillant</option>',
    '    </select>',
    '    <label class="mn-field-label">Consigne spécifique (facultatif)</label>',
    '    <input class="mn-input" id="_m_custom" placeholder="ex: ton chaleureux, remercier, confirmer mardi..." style="margin-bottom:8px;" />',
    '    <button class="mn-btn mn-btn-primary" id="_m_gen" style="width:100%; margin-bottom:8px;">✨ Reformuler / Corriger</button>',
    '    <label class="mn-field-label">Résultat</label>',
    '    <textarea class="mn-textarea" id="_m_result" placeholder="Le message parfait apparaîtra ici..." style="height:90px; margin-bottom:8px;"></textarea>',
    '    <div style="display:flex; gap:6px;">',
    '      <button class="mn-btn mn-btn-success" id="_m_insert" style="flex:1;">✍️ Remplacer dans le champ actif</button>',
    '      <button class="mn-btn mn-btn-secondary" id="_m_copy">📋 Copier</button>',
    '    </div>',
    '  </div>',

    /* PANEL NOTE */
    '  <div id="_p_note" style="display:none;">',
    '    <label class="mn-field-label">Titre de la note</label>',
    '    <input class="mn-input" id="_n_title" style="margin-bottom:8px;" />',
    '    <label class="mn-field-label">Contenu Markdown</label>',
    '    <textarea class="mn-textarea" id="_n_content" style="height:130px; margin-bottom:10px;"></textarea>',
    '    <div style="display:flex; gap:6px;">',
    '      <button class="mn-btn mn-btn-primary" id="_n_send" style="flex:1;">🚀 Envoyer vers MansotNote</button>',
    '      <button class="mn-btn mn-btn-secondary" id="_n_copy">📋 Copier</button>',
    '    </div>',
    '  </div>',

    /* PANEL CONFIG */
    '  <div id="_p_cfg" style="display:none;">',
    '    <div style="background:rgba(99,102,241,0.12); border:1px solid rgba(99,102,241,0.3); border-radius:10px; padding:12px; margin-bottom:12px;">',
    '      <div style="font-weight:700; font-size:12px; color:#818cf8; margin-bottom:6px;">🌐 Connexion Hub MansotNote</div>',
    '      <label class="mn-field-label">URL de votre MansotNote (Prod ou Local)</label>',
    '      <input class="mn-input" id="_cfg_app_url" placeholder="ex: https://notes.mondomaine.com ou http://127.0.0.1:3080" style="margin-bottom:8px;" />',
    '      <label class="mn-field-label">Clé de déchiffrement / Mot de passe (facultatif)</label>',
    '      <input class="mn-input" id="_cfg_dkey" type="password" placeholder="Mot de passe maître ou clé MN-XXXX..." style="margin-bottom:8px;" />',
    '    </div>',
    '    <label class="mn-field-label">Endpoint IA (si direct / secours)</label>',
    '    <input class="mn-input" id="_cfg_ep" style="margin-bottom:6px;" />',
    '    <label class="mn-field-label">Modèle IA</label>',
    '    <input class="mn-input" id="_cfg_mod" style="margin-bottom:6px;" />',
    '    <label class="mn-field-label">Clé API IA</label>',
    '    <input class="mn-input" id="_cfg_key" type="password" style="margin-bottom:10px;" />',
    '    <button class="mn-btn mn-btn-primary" id="_cfg_save" style="width:100%;">Enregistrer les réglages</button>',
    '  </div>',
    '</div>',
    '<div class="mn-toast" id="_toast"></div>'
  ].join('');

  shadow.appendChild(win);

  var localCards = initialCards || [];

  function renderKanbanList() {
    var box = shadow.getElementById('_kanban_list');
    if(!localCards || localCards.length === 0) {
      box.innerHTML = '<div style="color:#94a3b8; font-size:11.5px; text-align:center; padding:16px;">Aucune tâche dans le Kanban</div>';
      return;
    }
    var html = '';
    var badges = {
      todo: '<span class="mn-badge mn-badge-todo">À FAIRE</span>',
      in_progress: '<span class="mn-badge mn-badge-progress">EN COURS</span>',
      done: '<span class="mn-badge mn-badge-done">FAIT</span>',
      backlog: '<span class="mn-badge mn-badge-backlog">BACKLOG</span>'
    };
    // Le hub renvoie de vrais ids ('col-doing'), le plugin utilise des alias
    // ('in_progress') : on normalise pour ne pas tout afficher en « À FAIRE ».
    function badgeFor(columnId) {
      var id = String(columnId || '').toLowerCase();
      if(/doing|progress|cours/.test(id)) return badges.in_progress;
      if(/done|termin|fini/.test(id)) return badges.done;
      if(/backlog|idee|idée/.test(id)) return badges.backlog;
      return badges.todo;
    }
    localCards.forEach(function(c){
      var badge = badgeFor(c.columnId);
      html += '<div class="mn-kanban-item">'
        + '<span style="font-weight:600; color:#f1f5f9;">' + c.title.replace(/</g,'&lt;') + '</span>'
        + badge
        + '</div>';
    });
    box.innerHTML = html;
  }
  renderKanbanList();

  function cleanOutput(text) {
    if(!text) return '';
    var out = String(text).replace(/<think(?:ing)?>[\\s\\S]*?<\\/think(?:ing)?>/gi, '');

    // Bloc <think> ouvert et jamais refermé (réponse coupée) : on tronque.
    var dangling = out.search(/<think(?:ing)?>/i);
    if(dangling !== -1) out = out.slice(0, dangling);

    // Balise fermante orpheline : le raisonnement précède la réponse.
    var closing = out.match(/<\\/think(?:ing)?>/i);
    if(closing && closing.index !== undefined) out = out.slice(closing.index + closing[0].length);

    out = out.replace(/^\\[DEBUG\\][\\s\\S]*?Generated prediction:\\s*/m, '').trim();

    // On ne retire les guillemets que s'ils ENTOURENT tout le texte, sinon un
    // message légitimement cité perdrait sa ponctuation.
    if(out.length > 1) {
      var first = out.charAt(0), last = out.charAt(out.length - 1);
      if((first === '"' && last === '"') || (first === "'" && last === "'")) {
        var inner = out.slice(1, -1);
        if(inner.indexOf(first) === -1) out = inner.trim();
      }
    }
    return out;
  }

  function renderMd(text) {
    var safe = cleanOutput(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return safe
      .replace(/^### (.*$)/gim, '<h3 style="color:#a5b4fc;margin:6px 0 2px;">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 style="color:#818cf8;margin:8px 0 3px;">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 style="color:#fff;margin:10px 0 4px;font-size:14px;">$1</h1>')
      .replace(/\\*\\*(.*?)\\*\\*/gim, '<strong>$1</strong>')
      .replace(/\\*(.*?)\\*/gim, '<em>$1</em>')
      .replace(/^\\- (.*$)/gim, '• $1<br/>')
      .replace(/\\n/g, '<br/>');
  }

  function toast(msg) {
    var t = shadow.getElementById('_toast');
    t.textContent = msg; t.style.display = 'block';
    setTimeout(function(){ t.style.display = 'none'; }, 2200);
  }

  if(sel) shadow.getElementById('_m_input').value = sel;

  var initNoteContent = '# ' + pageTitle + '\\n\\n'
    + '> 🔗 Source : [' + pageTitle + '](' + pageUrl + ')\\n'
    + '> 📅 Capturé le : ' + timestamp + '\\n\\n'
    + (sel ? '## Extrait sélectionné\\n\\n' + sel + '\\n' : '');
  shadow.getElementById('_n_title').value = pageTitle;
  shadow.getElementById('_n_content').value = initNoteContent;

  shadow.getElementById('_cfg_app_url').value = appBaseUrl;
  shadow.getElementById('_cfg_dkey').value = decryptKey;
  shadow.getElementById('_cfg_ep').value = aiEndpoint;
  shadow.getElementById('_cfg_mod').value = aiModel;
  shadow.getElementById('_cfg_key').value = aiKey;

  function setTab(tab) {
    ['chat', 'kanban', 'msg', 'note', 'cfg'].forEach(function(t){
      shadow.getElementById('_p_' + t).style.display = (t === tab) ? 'block' : 'none';
      var btn = shadow.getElementById('_t_' + t);
      if(btn) {
        if(t === tab) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    });
  }
  shadow.getElementById('_t_chat').onclick = function(){ setTab('chat'); };
  shadow.getElementById('_t_kanban').onclick = function(){ setTab('kanban'); renderKanbanList(); };
  shadow.getElementById('_t_msg').onclick = function(){ setTab('msg'); };
  shadow.getElementById('_t_note').onclick = function(){ setTab('note'); };
  shadow.getElementById('_t_cfg').onclick = function(){ setTab('cfg'); };

  shadow.getElementById('_chip_correct').onclick = function(){
    shadow.getElementById('_m_type').value = 'correct_only';
    shadow.getElementById('_m_custom').value = '';
    generateMessage();
  };
  shadow.getElementById('_chip_pro').onclick = function(){
    shadow.getElementById('_m_type').value = 'email_reply';
    shadow.getElementById('_m_custom').value = 'Ton très professionnel, courtois et fluide';
    generateMessage();
  };
  shadow.getElementById('_chip_short').onclick = function(){
    shadow.getElementById('_m_type').value = 'chat_pro';
    shadow.getElementById('_m_custom').value = 'Synthétiser au maximum en 1 phrase claire';
    generateMessage();
  };
  shadow.getElementById('_chip_slack').onclick = function(){
    shadow.getElementById('_m_type').value = 'chat_pro';
    shadow.getElementById('_m_custom').value = 'Ton naturel et direct pour messagerie instantanée';
    generateMessage();
  };

  var bubble = null;
  shadow.getElementById('_btn_min').onclick = function(){
    win.style.display = 'none';
    if(!bubble){
      bubble = document.createElement('div');
      bubble.className = 'mn-bubble';
      bubble.title = 'Rouvrir MansotNote Copilote';
      bubble.innerHTML = '🚀';
      bubble.onclick = function(){
        bubble.remove(); bubble = null;
        win.style.display = 'flex';
      };
      shadow.appendChild(bubble);
    }
  };
  shadow.getElementById('_btn_close').onclick = function(){ host.remove(); };

  var isDragging = false, startX, startY, initX, initY;
  shadow.getElementById('_hdr').onmousedown = function(e){
    if(e.target.closest('.mn-controls')) return;
    isDragging = true;
    startX = e.clientX; startY = e.clientY;
    var rect = win.getBoundingClientRect();
    initX = rect.left; initY = rect.top;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };
  function onMouseMove(e){
    if(!isDragging) return;
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    win.style.left = Math.max(10, Math.min(window.innerWidth - win.offsetWidth - 10, initX + dx)) + 'px';
    win.style.top = Math.max(10, Math.min(window.innerHeight - win.offsetHeight - 10, initY + dy)) + 'px';
    win.style.right = 'auto';
  }
  function onMouseUp(){
    isDragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  async function executeAi(systemPrompt, userPrompt) {
    var reqId = 'req_' + Math.random().toString(36).slice(2, 9);

    // 1. Essai BroadcastChannel avec contexte complet
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        var bc = new BroadcastChannel('mansotnote_remote_api');
        var resPromise = new Promise(function(resolve){
          var timer = setTimeout(function(){ resolve(null); }, 600);
          bc.onmessage = function(ev){
            if(ev.data && ev.data.id === reqId && ev.data.success){
              clearTimeout(timer);
              resolve(ev.data.data);
            }
          };
        });
        bc.postMessage({ id: reqId, action: 'chat', key: decryptKey, payload: { systemPrompt: systemPrompt, userPrompt: userPrompt } });
        var bcRes = await resPromise;
        bc.close(); // sinon un canal (et son listener) fuite à chaque requête
        if(bcRes && bcRes.content) return cleanOutput(bcRes.content);
      }
    } catch(e){}

    // 2. Appel Direct API avec contexte Kanban injecté
    if(aiEndpoint && aiModel) {
      var ep = (aiEndpoint.replace(/\\/+$/,'') + '/chat/completions').replace(/([^:]\\/)\\/+/g, '$1/');
      var headers = { 'Content-Type': 'application/json' };
      if(aiKey) headers['Authorization'] = 'Bearer ' + aiKey;
      if(decryptKey) headers['X-Mansot-Key'] = decryptKey;

      var kanbanContext = '';
      if(localCards && localCards.length > 0) {
        // L'id réel est fourni : indispensable pour supprimer/archiver/déplacer.
        kanbanContext = '\\n\\n[Tâches actuelles dans le Kanban MansotNote : '
          + localCards.map(function(c){ return 'id:' + c.id + ' - "' + c.title + '" (' + c.columnId + ')'; }).join(', ')
          + ']';
      }

      var body = {
        model: aiModel,
        messages: [
          { role: 'system', content: systemPrompt + kanbanContext },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3
      };

      var res = await fetch(ep, { method: 'POST', headers: headers, body: JSON.stringify(body) });
      if(res.ok) {
        var data = await res.json();
        if(data.choices && data.choices[0] && data.choices[0].message) {
          var rawMsg = data.choices[0].message.content || '';
          return cleanOutput(rawMsg);
        }
      }
    }

    throw new Error("Impossible de joindre l'IA. Vérifiez votre endpoint ou clé dans ⚙️.");
  }

  /* Actions Kanban directes */

  // Transport générique vers MansotNote.
  // - même origine : BroadcastChannel (rapide, sans fenêtre)
  // - autre origine : relais URL + postMessage (Gmail/Slack -> MansotNote)
  // BroadcastChannel est isolé par origine : l'utiliser seul depuis Gmail ne
  // peut JAMAIS atteindre une app sur localhost ou un autre domaine.
  async function callRemote(action, payload, timeoutMs) {
    var reqId = action + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    var request = { id: reqId, action: action, key: decryptKey, payload: payload || {} };
    var timeout = timeoutMs || 4000;
    var appOrigin = '';
    try { appOrigin = new URL(appBaseUrl).origin; } catch(e){}
    var canonicalRelayOrigin = '';
    try { canonicalRelayOrigin = new URL(defaultAppUrl).origin; } catch(e){}

    // 1. Canal même origine uniquement.
    if(appOrigin && appOrigin === window.location.origin && typeof BroadcastChannel !== 'undefined') {
      try {
        var bc = new BroadcastChannel('mansotnote_remote_api');
        var ack = new Promise(function(resolve){
          var timer = setTimeout(function(){ resolve(null); }, timeout);
          bc.onmessage = function(ev){
            if(ev.data && ev.data.id === reqId){
              clearTimeout(timer);
              resolve(ev.data);
            }
          };
        });
        bc.postMessage(request);
        var bcRes = await ack;
        bc.close();
        return bcRes;
      } catch(e){}
    }

    // 2. Relais cross-origin déjà géré par App.tsx (?action=api_relay).
    // La fenêtre est ouverte avant le premier await, donc depuis un clic elle
    // n'est pas bloquée par les protections anti-popup, puis se ferme seule.
    try {
      var relayUrl = appBaseUrl.replace(/\\\/$/, '')
        + '/?action=api_relay&req=' + encodeURIComponent(JSON.stringify(request));
      // Nom UNIQUE par requete : un nom fixe fait reutiliser la meme fenetre
      // par le navigateur, et la reference obtenue ne correspond alors plus a
      // la fenetre qui repond reellement. Le controle sur ev.source rejetait
      // donc silencieusement toutes les reponses des le 2e appel.
      var popup = window.open(relayUrl, '_mn_api_relay_' + reqId, 'popup=yes,width=480,height=640,left=20,top=20');
      if(!popup) return { id: reqId, success: false, error: 'Fenêtre relais bloquée par le navigateur.' };

      return await new Promise(function(resolve){
        var settled = false;
        var finish = function(value){
          if(settled) return;
          settled = true;
          clearTimeout(timer);
          window.removeEventListener('message', onRelayMessage);
          try { popup.close(); } catch(e){}
          resolve(value);
        };
        var onRelayMessage = function(ev){
          // 1. L emetteur doit etre MansotNote : adresse configuree, ou adresse
          //    officielle apres redirection HTTP vers HTTPS. Un site tiers est
          //    rejete ici.
          if(ev.origin !== appOrigin && ev.origin !== canonicalRelayOrigin) return;
          // 2. La reponse doit porter l identifiant unique et imprevisible de
          //    CETTE requete. L egalite stricte avec la reference popup n est
          //    plus exigee : une redirection ou une fenetre reutilisee la
          //    rendait caduque et faisait perdre toutes les reponses.
          if(!ev.data || !ev.data.__mansot_remote_res || ev.data.id !== reqId) return;
          finish(ev.data);
        };
        window.addEventListener('message', onRelayMessage);
        var timer = setTimeout(function(){
          finish({ id: reqId, success: false, error: 'MansotNote ne répond pas. Vérifiez que l’application est déverrouillée.' });
        }, timeout);
      });
    } catch(e) {
      return { id: reqId, success: false, error: e && e.message ? e.message : 'Relais MansotNote indisponible.' };
    }
  }

  async function addKanbanTask(title, col, prio) {
    col = col || 'todo';
    prio = prio || 'medium';

    // Affichage optimiste, confirmé (ou annulé) par la réponse du hub.
    var tempId = 'tmp_' + Date.now();
    localCards.unshift({ id: tempId, title: title, columnId: col, priority: prio });
    renderKanbanList();

    var res = await callRemote('create_card', { title: title, columnId: col, priority: prio });
    if(res && res.success) {
      // Remplacer la carte optimiste par la carte réelle.
      var real = res.data;
      if(real && real.cardId) {
        localCards = localCards.map(function(c){
          return c.id === tempId ? { id: real.cardId, title: title, columnId: real.columnId || col, priority: prio } : c;
        });
        renderKanbanList();
      }
      toast('✅ Tâche ajoutée au Kanban !');
      return true;
    }
    // Retrait de la carte optimiste : elle n'existe pas côté MansotNote.
    localCards = localCards.filter(function(c){ return c.id !== tempId; });
    renderKanbanList();
    if(res && res.error) { toast('⚠️ ' + res.error); }
    else { toast('⚠️ MansotNote injoignable : ouvrez l\\'application pour synchroniser.'); }
    return false;
  }

  // Suppression d'une tâche par son id réel.
  async function deleteKanbanCard(cardId) {
    var res = await callRemote('delete_card', { cardId: cardId });
    if(res && res.success) {
      localCards = localCards.filter(function(c){ return c.id !== cardId; });
      renderKanbanList();
      toast('🗑️ Tâche supprimée du Kanban.');
      return true;
    }
    if(res && res.error) { toast('⚠️ ' + res.error); }
    else { toast('⚠️ MansotNote injoignable : suppression non confirmée.'); }
    return null;
  }

  // Archivage d'une tâche par son id réel.
  async function archiveCard(cardId) {
    var res = await callRemote('archive_card', { cardId: cardId });
    if(res && res.success) {
      localCards = localCards.filter(function(c){ return c.id !== cardId; });
      renderKanbanList();
      toast('🗂️ Tâche archivée.');
      return true;
    }
    if(res && res.error) { toast('⚠️ ' + res.error); }
    else { toast('⚠️ MansotNote injoignable : archivage non confirmé.'); }
    return null;
  }

  // Vidage complet du Kanban : bouton de confirmation plutôt que de
  // dépendre du modèle pour émettre un id exact.
  async function clearKanbanAll() {
    var res = await callRemote('clear_kanban', {});
    if(res && res.success) {
      var n = (res.data && res.data.deleted) || 0;
      localCards = [];
      renderKanbanList();
      toast(n > 0 ? '🗑️ ' + n + ' tâche(s) supprimée(s).' : 'Le Kanban est déjà vide.');
      return true;
    }
    if(res && res.error) { toast('⚠️ ' + res.error); }
    else { toast('⚠️ MansotNote injoignable : vidage non confirmé.'); }
    return false;
  }

  // Déplacement d'une tâche vers une colonne (résolue par le serveur).
  async function moveCard(cardId, toColumnId) {
    var res = await callRemote('move_card', { cardId: cardId, toColumnId: toColumnId });
    if(res && res.success) {
      var target = (res.data && res.data.to) || toColumnId;
      localCards = localCards.map(function(c){
        return c.id === cardId ? { ...c, columnId: target } : c;
      });
      renderKanbanList();
      toast('↩️ Tâche déplacée.');
      return true;
    }
    if(res && res.error) { toast('⚠️ ' + res.error); }
    else { toast('⚠️ MansotNote injoignable : déplacement non confirmé.'); }
    return null;
  }

  shadow.getElementById('_k_add').onclick = async function(){
    var title = shadow.getElementById('_k_title').value.trim();
    if(!title){ toast('Saisissez un titre de tâche'); return; }
    var col = shadow.getElementById('_k_col').value;
    var prio = shadow.getElementById('_k_prio').value;
    var ok = await addKanbanTask(title, col, prio);
    // On ne vide le champ que si la tâche est réellement enregistrée,
    // pour ne pas faire perdre sa saisie à l'utilisateur en cas d'échec.
    if(ok) shadow.getElementById('_k_title').value = '';
  };

  shadow.getElementById('_btn_clear_kanban').onclick = async function(){
    if(!window.confirm('Supprimer TOUTES les cartes du Kanban ? Cette action est irréversible.')) return;
    var ok = await clearKanbanAll();
    if(ok) toast('✅ Kanban vidé.');
  };

  shadow.getElementById('_btn_refresh_kanban').onclick = async function(){
    toast('🔄 Actualisation...');
    var res = await callRemote('get_kanban', {}, 5000);
    if(res && res.success && res.data && Array.isArray(res.data.cards)) {
      localCards = res.data.cards;
      renderKanbanList();
      toast('✅ Kanban actualisé : ' + localCards.length + ' tâche(s).');
      return;
    }
    // Ne plus prétendre « à jour » après un timeout : l'ancienne liste reste
    // volontairement visible, accompagnée de l'erreur réelle.
    toast('⚠️ ' + ((res && res.error) || 'Actualisation impossible.'));
  };

  /* Actions Message / Mail */
  async function generateMessage() {
    var btn = shadow.getElementById('_m_gen');
    var inputTxt = shadow.getElementById('_m_input').value.trim();
    var type = shadow.getElementById('_m_type').value;
    var custom = shadow.getElementById('_m_custom').value.trim();

    if(!inputTxt && !custom) {
      toast('Veuillez saisir un texte à corriger ou reformuler.');
      return;
    }

    btn.disabled = true; btn.textContent = 'Traitement en cours...';
    try {
      var systemPrompt = '';
      var userPrompt = '';

      if (type === 'correct_only') {
        systemPrompt = 'Tu es un correcteur orthographique et grammatical expert de la langue française. Corrige les fautes d\\'orthographe, de grammaire et de ponctuation du texte fourni. Conserve scrupuleusement le sens, le vocabulaire et les intentions de l\\'auteur. Ne rajoute AUCUN contexte, aucune URL, aucun commentaire. Réponds UNIQUEMENT avec le texte corrigé.';
        userPrompt = inputTxt;
      } else {
        systemPrompt = 'Tu es un expert en communication professionnelle et rédaction (emails et messages Slack/Teams/WhatsApp). Réécris le texte fourni pour qu\\'il soit clair, percutant et professionnel. N\\'inclus JAMAIS d\\'URL technique ou de lien fictif. Donne UNIQUEMENT le texte final prêt à envoyer sans aucun commentaire.';
        userPrompt = 'Texte à reformuler :\\n' + (inputTxt || '(Rédiger à partir des consignes)') + '\\n\\nFormat souhaité : ' + type + (custom ? '\\nConsigne : ' + custom : '');
      }

      var rawResult = await executeAi(systemPrompt, userPrompt);
      var content = cleanOutput(rawResult);
      shadow.getElementById('_m_result').value = content || '';
      toast('✨ Traitement terminé !');
    } catch(err){
      toast('⚠️ ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '✨ Reformuler / Corriger';
    }
  }

  shadow.getElementById('_m_gen').onclick = generateMessage;

  shadow.getElementById('_m_copy').onclick = function(){
    navigator.clipboard.writeText(shadow.getElementById('_m_result').value).then(function(){ toast('📋 Message copié !'); });
  };

  shadow.getElementById('_m_insert').onclick = function(){
    var txt = shadow.getElementById('_m_result').value;
    if(!txt){ alert('Générez d\\'abord un message.'); return; }
    var activeEl = document.activeElement;
    if(activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
      activeEl.value = txt;
      activeEl.dispatchEvent(new Event('input', { bubbles: true }));
      toast('✍️ Inséré dans le champ actif !');
    } else if(activeEl && activeEl.isContentEditable) {
      activeEl.innerText = txt;
      activeEl.dispatchEvent(new Event('input', { bubbles: true }));
      toast('✍️ Inséré dans le composeur !');
    } else {
      navigator.clipboard.writeText(txt).then(function(){ toast('📋 Copié (cliquez dans votre messagerie puis Ctrl+V)'); });
    }
  };

  /* Actions Note */
  shadow.getElementById('_n_send').onclick = function(){
    var title = shadow.getElementById('_n_title').value;
    var content = shadow.getElementById('_n_content').value;
    var target = (appBaseUrl.replace(/\\/+$/, '')) + '/?action=new_note&title=' + encodeURIComponent(title) + '&content=' + encodeURIComponent(content);
    if(decryptKey) target += '&key=' + encodeURIComponent(decryptKey);
    window.open(target, '_blank');
    toast('🚀 Note envoyée à MansotNote !');
  };
  shadow.getElementById('_n_copy').onclick = function(){
    navigator.clipboard.writeText(shadow.getElementById('_n_content').value).then(function(){ toast('📋 Markdown copié !'); });
  };

  /* Actions Chat avec Capacité d'Exécution */
  async function sendChat() {
    var inp = shadow.getElementById('_chat_inp');
    var text = inp.value.trim();
    if(!text) return;
    var list = shadow.getElementById('_chat_msgs');

    var uDiv = document.createElement('div');
    uDiv.className = 'mn-msg mn-msg-user';
    uDiv.textContent = text;
    list.appendChild(uDiv);
    inp.value = '';
    list.scrollTop = list.scrollHeight;

    var aiDiv = document.createElement('div');
    aiDiv.className = 'mn-msg mn-msg-ai';
    aiDiv.innerHTML = '✨ <em>MansotNote Copilote réfléchit...</em>';
    list.appendChild(aiDiv);
    list.scrollTop = list.scrollHeight;

    try {
      var system = 'Tu es le Copilote IA de MansotNote. Tu as un accès direct aux tâches du Kanban et aux notes de l\\'utilisateur. Tu peux agir et créer des tâches ou des notes.\\n'
        + 'RÈGLES D\\'ACTION :\\n'
        + '1. Ajouter une tâche : [ACTION:CREATE_TASK|Titre|colonne:todo|priorite:medium]\\n'
        + '2. Supprimer une tâche : [ACTION:DELETE_TASK|idDeLaTache]\\n'
        + '3. Archiver une tâche : [ACTION:ARCHIVE_TASK|idDeLaTache]\\n'
        + '4. Déplacer une tâche : [ACTION:MOVE_TASK|idDeLaTache|vers:colonne_cible]\\n'
        + 'Pour supprimer, archiver ou déplacer, tu dois utiliser l\\'id réel de la tâche (champ "id" vu dans le Kanban), jamais son titre. En cas de doute sur l\\'id, demande-le à l\\'utilisateur.';

      var rawAnswer = await executeAi(system, text);
      var answer = cleanOutput(rawAnswer);

      // Détection d'action automatique Kanban
      var actionTaskMatch = answer.match(/\\[ACTION:CREATE_TASK\\|([^|\\]]+)(?:\\|colonne:([^|\\]]+))?(?:\\|priorite:([^|\\]]+))?\\]/i);
      var actionDeleteMatch = answer.match(/\\[ACTION:DELETE_TASK\\|([^|\\]]+)\\]/i);
      var actionArchiveMatch = answer.match(/\\[ACTION:ARCHIVE_TASK\\|([^|\\]]+)\\]/i);
      var actionMoveMatch = answer.match(/\\[ACTION:MOVE_TASK\\|([^|\\]]+)\\|vers:([^|\\]]+)\\]/i);
      var displayAnswer = answer
        .replace(/\\[ACTION:CREATE_TASK[^\\]]*\\]/gi, '')
        .replace(/\\[ACTION:DELETE_TASK[^\\]]*\\]/gi, '')
        .replace(/\\[ACTION:ARCHIVE_TASK[^\\]]*\\]/gi, '')
        .replace(/\\[ACTION:MOVE_TASK[^\\]]*\\]/gi, '')
        .trim();

      aiDiv.innerHTML = renderMd(displayAnswer);

      // Action : créer une tâche.
      if(actionTaskMatch) {
        var taskTitle = actionTaskMatch[1].trim();
        var taskCol = (actionTaskMatch[2] || 'todo').trim();
        var taskPrio = (actionTaskMatch[3] || 'medium').trim();
        var created = await addKanbanTask(taskTitle, taskCol, taskPrio);

        var card = document.createElement('div');
        card.className = 'mn-action-card';
        card.innerHTML = '<div class="mn-action-title"><span>'
          + (created
              ? '⚡ Action exécutée : tâche « ' + taskTitle.replace(/</g,'&lt;') + ' » ajoutée au Kanban'
              : '⚠️ Tâche « ' + taskTitle.replace(/</g,'&lt;') + ' » non enregistrée (MansotNote injoignable)')
          + '</span></div>';
        aiDiv.appendChild(card);
      }

      // Action : supprimer une tâche par son id.
      if(actionDeleteMatch) {
        var delId = actionDeleteMatch[1].trim();
        var delCard = document.createElement('div');
        delCard.className = 'mn-action-card';
        if(delId) {
          var delOk = await deleteKanbanCard(delId);
          delCard.innerHTML = '<div class="mn-action-title"><span>'
            + (delOk ? '🗑️ Tâche supprimée du Kanban.' : '⚠️ Suppression échouée (id : ' + delId.replace(/</g,'&lt;') + ').')
            + '</span></div>';
        } else {
          delCard.innerHTML = '<div class="mn-action-title"><span>⚠️ Aucun id fourni pour la suppression.</span></div>';
        }
        aiDiv.appendChild(delCard);
      }

      // Action : archiver une tâche par son id.
      if(actionArchiveMatch) {
        var arcId = actionArchiveMatch[1].trim();
        var arcCard = document.createElement('div');
        arcCard.className = 'mn-action-card';
        if(arcId) {
          var arcOk = await archiveCard(arcId);
          arcCard.innerHTML = '<div class="mn-action-title"><span>'
            + (arcOk ? '🗂️ Tâche archivée.' : '⚠️ Archivage échoué (id : ' + arcId.replace(/</g,'&lt;') + ').')
            + '</span></div>';
        } else {
          arcCard.innerHTML = '<div class="mn-action-title"><span>⚠️ Aucun id fourni pour l\\'archivage.</span></div>';
        }
        aiDiv.appendChild(arcCard);
      }

      // Action : déplacer une tâche vers une colonne.
      if(actionMoveMatch) {
        var movId = actionMoveMatch[1].trim();
        var movCol = actionMoveMatch[2].trim();
        var movCard = document.createElement('div');
        movCard.className = 'mn-action-card';
        if(movId && movCol) {
          var movOk = await moveCard(movId, movCol);
          movCard.innerHTML = '<div class="mn-action-title"><span>'
            + (movOk ? '↩️ Tâche déplacée vers « ' + movCol.replace(/</g,'&lt;') + ' ».' : '⚠️ Déplacement échoué (id : ' + movId.replace(/</g,'&lt;') + ').')
            + '</span></div>';
        } else {
          movCard.innerHTML = '<div class="mn-action-title"><span>⚠️ id ou colonne manquant pour le déplacement.</span></div>';
        }
        aiDiv.appendChild(movCard);
      }

      // Si proposition de note : nom distinct, car "card" est déjà déclaré
      // ci-dessus et une redéclaration casserait le script en mode strict.
      if(displayAnswer.indexOf('#') !== -1 || (displayAnswer.length > 80 && !actionTaskMatch)) {
        var noteCard = document.createElement('div');
        noteCard.className = 'mn-action-card';

        var titleMatch = displayAnswer.match(/^#+\\s*(.+)$/m);
        var noteTitle = titleMatch ? titleMatch[1].replace(/^[📝✨\\s]+/, '') : 'Note IA - ' + pageTitle;

        noteCard.innerHTML = [
          '<div class="mn-action-title"><span>⚡ Action rapide détectée</span></div>',
          '<div style="display:flex; gap:6px;">',
          '  <button class="mn-btn mn-btn-primary" style="flex:1; padding:6px 8px; font-size:11px;" id="_act_save">🚀 Sauvegarder dans MansotNote</button>',
          '  <button class="mn-btn mn-btn-secondary" style="padding:6px 8px; font-size:11px;" id="_act_cp">📋 Copier</button>',
          '</div>'
        ].join('');

        aiDiv.appendChild(noteCard);

        noteCard.querySelector('#_act_save').onclick = function(){
          var target = (appBaseUrl.replace(/\\/+$/, '')) + '/?action=new_note&title=' + encodeURIComponent(noteTitle) + '&content=' + encodeURIComponent(displayAnswer);
          if(decryptKey) target += '&key=' + encodeURIComponent(decryptKey);
          window.open(target, '_blank');
          toast('🚀 Note enregistrée dans MansotNote !');
        };

        noteCard.querySelector('#_act_cp').onclick = function(){
          navigator.clipboard.writeText(displayAnswer).then(function(){ toast('📋 Markdown copié !'); });
        };
      }

      // Bouton de confirmation pour supprimer TOUTES les cartes : on ne dépend
      // pas du modèle pour émettre un id exact, l'action serveur vide tout.
      var wantsClear = /(suppr[éeê].+\s*(toutes|tout|board|kanban|carte)|vide\s*(le\s*)?(kanban|board)|clear\s+all|delete\s+all)/i.test(text);
      if(wantsClear) {
        var clearCard = document.createElement('div');
        clearCard.className = 'mn-action-card';
        clearCard.innerHTML = [
          '<div class="mn-action-title"><span>🗑️ Vider tout le Kanban ?</span></div>',
          '<div style="display:flex; gap:6px;">',
          '  <button class="mn-btn mn-btn-danger" style="flex:1; padding:6px 8px; font-size:11px;" id="_act_clear">🗑️ Tout supprimer</button>',
          '  <button class="mn-btn mn-btn-secondary" style="padding:6px 8px; font-size:11px;" id="_act_clear_no">Annuler</button>',
          '</div>'
        ].join('');
        aiDiv.appendChild(clearCard);

        clearCard.querySelector('#_act_clear').onclick = async function(){
          clearCard.innerHTML = '<div class="mn-action-title"><span>🔄 Suppression...</span></div>';
          var ok = await clearKanbanAll();
          clearCard.innerHTML = '<div class="mn-action-title"><span>' + (ok ? '✅ Kanban vidé.' : '⚠️ Échec de la suppression.') + '</span></div>';
        };
        clearCard.querySelector('#_act_clear_no').onclick = function(){
          clearCard.innerHTML = '<div class="mn-action-title"><span>Suppression annulée.</span></div>';
        };
      }

      list.scrollTop = list.scrollHeight;
    } catch(e) {
      aiDiv.innerHTML = '⚠️ <strong>Erreur :</strong> ' + e.message;
    }
  }

  shadow.getElementById('_chat_btn').onclick = sendChat;
  shadow.getElementById('_chat_inp').onkeydown = function(e){ if(e.key === 'Enter') sendChat(); };

  shadow.getElementById('_cfg_save').onclick = function(){
    appBaseUrl = shadow.getElementById('_cfg_app_url').value.trim() || defaultAppUrl;
    decryptKey = shadow.getElementById('_cfg_dkey').value.trim();
    aiEndpoint = shadow.getElementById('_cfg_ep').value.trim();
    aiModel = shadow.getElementById('_cfg_mod').value.trim();
    aiKey = shadow.getElementById('_cfg_key').value.trim();

    localStorage.setItem('_mn_hub_cfg', JSON.stringify({
      appUrl: appBaseUrl,
      decryptKey: decryptKey,
      endpoint: aiEndpoint,
      model: aiModel,
      apiKey: aiKey
    }));
    toast('✅ Configuration enregistrée !');
    setTab('chat');
  };
})();`;

  /**
   * `encodeURIComponent` gonflait le bookmarklet à ~76 Ko (> limite 64 Ko de
   * plusieurs navigateurs), qui le tronquaient : le plugin ne démarrait plus.
   * Une URL javascript: accepte le code brut ; seuls %, # et les caractères
   * de contrôle doivent être protégés pour éviter une interprétation d'URL.
   */
  const encodeBookmarklet = (code: string): string =>
    code
      .replace(/%/g, '%25')
      .replace(/#/g, '%23')
      .replace(/\r/g, '')
      .replace(/\n/g, '%0A')
      .replace(/\t/g, '%09');

  const bookmarkletHref = `javascript:${encodeBookmarklet(scriptContent)}`;

  // Favori « chargeur » : au lieu d'embarquer tout le script (figé au moment de
  // la copie), il télécharge la version courante depuis MansotNote à chaque
  // clic. Les correctifs s'appliquent donc sans jamais recopier le favori.
  // Le script distant est servi same-origin et exécuté après vérification, ce
  // qui n'ouvre aucune surface nouvelle : le favori faisait déjà tourner ce
  // même code, mais dans une version obsolète.
  const loaderSource = `(function(){
  if(document.getElementById('_mansot_host')) return;
  var s = document.createElement('script');
  s.src = ${JSON.stringify(`${appUrl}/bookmarklet.js`)} + '?v=' + Date.now();
  s.onerror = function(){ alert('MansotNote injoignable. Vérifie ta connexion ou ouvre ' + ${JSON.stringify(appUrl)}); };
  document.body.appendChild(s);
})();`;
  const loaderHref = `javascript:${encodeBookmarklet(loaderSource)}`;
  const [useLoader, setUseLoader] = useState(true);
  const activeHref = useLoader ? loaderHref : bookmarkletHref;
  // Version sûre pour l'attribut href du fichier HTML autonome.
  const bookmarkletHrefHtml = bookmarkletHref
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const copyBookmarklet = () => {
    navigator.clipboard.writeText(activeHref);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadStandaloneHtml = () => {
    const html = `<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MansotNote - Copilote Actif (Kanban, Notes, Messages)</title>
<style>
:root{--bg:#090a0f;--surface:#13151f;--surface2:#1c1e2d;--border:#2e324a;--text:#f8fafc;--muted:#94a3b8;--primary:#6366f1;--primary-hover:#4f46e5;--success:#10b981;--shadow:0 12px 40px rgba(0,0,0,.7)}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{min-height:100dvh;background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;font-size:15px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:40px 20px}
h1{font-size:26px;font-weight:800;color:#fff;margin-bottom:6px;display:flex;align-items:center;gap:10px}
.subtitle{color:var(--muted);font-size:14px;margin-bottom:32px;text-align:center}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;width:100%;max-width:780px;margin-bottom:20px;box-shadow:var(--shadow)}
.card h2{font-size:14px;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px}
.step{display:flex;gap:14px;margin-bottom:16px;align-items:flex-start}
.step-num{min-width:28px;height:28px;background:var(--primary);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0;margin-top:1px}
.step-body{font-size:14px;line-height:1.6;color:var(--text)}
.bookmarklet-box{background:var(--surface2);border:2px dashed var(--primary);border-radius:14px;padding:24px;text-align:center;margin:18px 0}
.bookmarklet-box p{font-size:13px;color:var(--muted);margin-bottom:14px}
.bm-link{display:inline-block;background:linear-gradient(135deg,var(--primary),var(--primary-hover));color:#fff;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;cursor:grab;box-shadow:0 4px 16px rgba(99,102,241,.4);transition:transform .15s,box-shadow .15s}
.bm-link:hover{transform:translateY(-2px);box-shadow:0 6px 22px rgba(99,102,241,.6)}
kbd{background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:2px 7px;font-family:monospace;font-size:12px}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:16px}
.feature-box{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px}
.feature-box h3{font-size:13px;font-weight:700;color:#fff;margin-bottom:4px}
.feature-box p{font-size:12px;color:var(--muted);line-height:1.5}
</style>
</head>
<body>
<h1>🚀 MansotNote Copilote Actif</h1>
<p class="subtitle">Plugin de favoris avec exécution d'actions directes (Kanban, Notes, Mails)</p>

<div class="card">
  <h2>📦 Installation en 2 secondes</h2>
  <div class="step"><div class="step-num">1</div><div class="step-body">Affichez la <strong>barre des favoris</strong> de votre navigateur (<kbd>Ctrl+Shift+B</kbd> ou <kbd>Cmd+Shift+B</kbd>).</div></div>
  <div class="step"><div class="step-num">2</div><div class="step-body">Glissez ce bouton directement dans votre barre des favoris :
    <div class="bookmarklet-box">
      <p>↓ Glissez ce bouton dans vos favoris ↓</p>
      <a class="bm-link" href="${bookmarkletHrefHtml}" onclick="return false;">🚀 MansotNote Copilote</a>
    </div>
  </div></div>

  <div class="features">
    <div class="feature-box">
      <h3>⚡ Actions Automatiques</h3>
      <p>Demandez à l'IA d'ajouter une tâche ou de résumer vos todos : elle l'exécute directement dans le Kanban.</p>
    </div>
    <div class="feature-box">
      <h3>💬 Messages & Mails Pro</h3>
      <p>Corrige l'orthographe et reformule pour Slack, Teams, WhatsApp, Gmail ou Outlook.</p>
    </div>
    <div class="feature-box">
      <h3>✍️ Injection en 1 Clic</h3>
      <p>Insère directement vos textes et réponses dans n'importe quel champ de saisie.</p>
    </div>
  </div>
</div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MansotNote-Copilote-Bookmarklet.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Modal title="Plugin Favoris — Copilote Actif (Kanban, Notes & Mails)" onClose={onClose}>
      <div className="space-y-4">
        {/* Présentation */}
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/30">
          <div className="flex items-center gap-2 font-semibold text-indigo-900 dark:text-indigo-200">
            <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400" />
            <span>Copilote Actif avec Actions Directes</span>
          </div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
            Le Copilote ne se contente plus de répondre : <strong>il peut agir directement</strong>. Demandez-lui d'ajouter des tâches à votre Kanban, de rédiger des notes ou d'insérer des messages dans vos applications web.
          </p>
          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs">
            <div className="flex items-center gap-2 rounded-lg bg-white/70 p-2 dark:bg-zinc-900/70 border border-indigo-100 dark:border-indigo-900/40">
              <SquareKanban size={15} className="text-indigo-600 shrink-0" />
              <span><strong>Création Tâches Kanban</strong></span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-white/70 p-2 dark:bg-zinc-900/70 border border-indigo-100 dark:border-indigo-900/40">
              <MessageSquare size={15} className="text-indigo-600 shrink-0" />
              <span><strong>Slack / Teams / WhatsApp</strong></span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-white/70 p-2 dark:bg-zinc-900/70 border border-indigo-100 dark:border-indigo-900/40">
              <Globe size={15} className="text-indigo-600 shrink-0" />
              <span><strong>Hub MansotNote</strong></span>
            </div>
          </div>
        </div>

        {/* Bouton à glisser-déposer */}
        <div className="rounded-xl border-2 border-dashed border-indigo-400/50 bg-zinc-50 p-6 text-center dark:border-indigo-500/40 dark:bg-zinc-900/60">
          <p className="mb-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            ↓ Glisse ce bouton directement dans ta barre de favoris (<kbd className="rounded border border-zinc-300 bg-zinc-200 px-1 py-0.5 text-[10px] dark:border-zinc-700 dark:bg-zinc-800">Ctrl+Shift+B</kbd>) ↓
          </p>
          <label className="mb-3 flex items-center justify-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <input type="checkbox" checked={useLoader} onChange={(e) => setUseLoader(e.target.checked)} />
            <span>
              Version auto-mise à jour <strong>(recommandé)</strong> — les correctifs s’appliquent sans recopier le favori
            </span>
          </label>
          <a
            href={activeHref}
            onClick={(e) => e.preventDefault()}
            title="Glisse-moi dans ta barre de favoris !"
            className="inline-flex cursor-grab items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-600 to-indigo-700 px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-500/30 transition-transform hover:scale-105 active:cursor-grabbing"
          >
            <Bookmark size={17} />
            <span>🚀 MansotNote Copilote</span>
          </a>
        </div>

        {/* Actions secondaires */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button
            size="sm"
            variant="secondary"
            icon={copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            onClick={copyBookmarklet}
          >
            {copied ? 'Code JavaScript copié !' : 'Copier le code'}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={14} />}
            onClick={downloadStandaloneHtml}
          >
            Télécharger la page HTML autonome
          </Button>
        </div>
      </div>
    </Modal>
  );
}
