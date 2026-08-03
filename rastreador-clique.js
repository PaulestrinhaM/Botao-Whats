/*
 * VERSÃO 1 — Rastreamento por clique, injetado via Google Tag Manager
 *
 * Contexto: sem acesso ao servidor do site do cliente. O único ponto onde
 * dá para inserir código é o GTM, que roda no navegador. Consequência direta:
 * não existe lugar para esconder um segredo. A "senha" abaixo fica visível
 * para qualquer pessoa que abrir o DevTools. Ela NÃO é uma proteção real.
 *
 * A proteção efetiva vive no n8n, que valida o header `origin` da requisição
 * (setado pelo navegador, não forjável por JavaScript de página). Isso cobre
 * o vetor de abuso via navegador. Não resiste a um atacante com ferramenta de
 * linha de comando, e nenhuma checagem client-side resistiria. Ver README.
 *
 * A versão 2 (WordPress) resolve isso movendo o segredo para um proxy no servidor.
 */

(function () {
  var _params = new URLSearchParams(window.location.search);
  var _currentDomain = window.location.hostname;
  var _referer = document.referrer || '';
  var _isExternal = _referer && _referer.indexOf(_currentDomain) === -1;

  // ─── CONFIG ─────────────────────────────────────────────
  // Placeholders. Os valores reais ficam no GTM do cliente.
  var WEBHOOK_PAGELOAD = 'https://SEU-N8N.exemplo.com/webhook/SEU-PATH-backup';
  var WEBHOOK_CLIQUE   = 'https://SEU-N8N.exemplo.com/webhook/SEU-PATH';
  var SENHA            = 'SENHA_DO_HEADER_AUTH'; // ver nota no topo: não é proteção real
  var numero           = 'NUMERO_WHATSAPP';       // ex.: 5554999999999

  // ─── STORAGE (3 camadas com fallback) ───────────────────
  function setCookie(name, value, days) {
    var expires = '';
    if (days) {
      var date = new Date();
      date.setTime(date.getTime() + (days * 86400000));
      expires = '; expires=' + date.toUTCString();
    }
    document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/';
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : '';
  }

  function saveToAll(key, value) {
    if (!value) return;
    try { sessionStorage.setItem(key, value); } catch (e) {}
    try { localStorage.setItem(key, value); } catch (e) {}
    setCookie(key, value, 7);
  }

  function getData(key) {
    return sessionStorage.getItem(key) || localStorage.getItem(key) || getCookie(key) || '';
  }

  // ─── CLARITY (cruza gravação de sessão com o lead) ──────
  function getClarityId() {
    return {
      userId: getCookie('_clck') || '',
      sessionId: getCookie('_clsk') || ''
    };
  }

  // ─── LEAD ID ────────────────────────────────────────────
  function generateLeadId() {
    var ts   = Date.now().toString(36).toUpperCase();
    var rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return 'LD-' + ts + '-' + rand;
  }

  // ─── REFERER (só o externo, só na primeira visita) ──────
  if (sessionStorage.getItem('original_referer') === null) {
    saveToAll('original_referer', _isExternal ? _referer : '');
  }

  // ─── UTMs (persiste só no primeiro acesso) ──────────────
  var _utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];
  for (var i = 0; i < _utmKeys.length; i++) {
    var _val = _params.get(_utmKeys[i]);
    if (_val && !getData(_utmKeys[i])) {
      saveToAll(_utmKeys[i], _val);
    }
  }

  // ─── LEAD ID INIT ───────────────────────────────────────
  if (!getData('lead_id')) {
    saveToAll('lead_id', generateLeadId());
  }

  // ─── ENVIO COM RETRY + KEEPALIVE ────────────────────────
  // keepalive garante que o beacon sobreviva ao redirect para o WhatsApp.
  function enviarWebhook(payload, tentativa) {
    tentativa = tentativa || 0;
    var url = payload.tipo === 'pageload' ? WEBHOOK_PAGELOAD : WEBHOOK_CLIQUE;

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'senha': SENHA
      },
      body: JSON.stringify(payload),
      keepalive: true
    })
    .catch(function () {
      if (tentativa < 2) {
        setTimeout(function () {
          enviarWebhook(payload, tentativa + 1);
        }, 500);
      }
    });
  }

  // ─── PAYLOAD PADRÃO ─────────────────────────────────────
  function montarPayload(tipo) {
    var clarity = getClarityId();
    return {
      tipo: tipo,
      leadId: getData('lead_id'),
      utmSource: getData('utm_source'),
      utmMedium: getData('utm_medium'),
      utmCampaign: getData('utm_campaign'),
      utmContent: getData('utm_content'),
      utmTerm: getData('utm_term'),
      gclid: getData('gclid'),
      fbclid: getData('fbclid'),
      referer: getData('original_referer'),
      pagina: window.location.href,
      clarityUserId: clarity.userId,
      claritySessionId: clarity.sessionId,
      timestamp: new Date().toISOString()
    };
  }

  // ─── PAGELOAD ───────────────────────────────────────────
  enviarWebhook(montarPayload('pageload'));

  // ─── CLICK WHATSAPP ─────────────────────────────────────
  function dispararWhatsapp() {
    var payload = montarPayload('clique');
    var leadId  = payload.leadId;

    enviarWebhook(payload);

    var mensagem = encodeURIComponent('Olá! Vim pelo site. Meu código de atendimento é ' + leadId);
    setTimeout(function () {
      window.location.href = 'https://wa.me/' + numero + '?text=' + mensagem;
    }, 300);
  }

  function isWhatsappLink(href) {
    return href.indexOf('wa.me') !== -1 || href.indexOf('api.whatsapp.com') !== -1;
  }

  // Delegação: intercepta clique em qualquer link de WhatsApp da página.
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el.tagName !== 'A') {
      el = el.parentElement;
    }
    if (!el) return;

    var href = el.getAttribute('href') || '';
    if (!isWhatsappLink(href)) return;

    e.preventDefault();
    dispararWhatsapp();
  });
})();
