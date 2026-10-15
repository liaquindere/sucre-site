/* =========================================================
   SUCRÉ — medição
   1) window.track(): atalho pro dataLayer (GTM lê os eventos por nome)
   2) Banner de consentimento (Google Consent Mode v2) + "Preferências de cookies"
   3) Cliques nos CTAs (WhatsApp, Instagram, Onde comprar, produtos) em todas as páginas
   O GTM em si é carregado no <head> de cada página; GA4 e Pixel entram só pelo GTM.
   ========================================================= */
window.track = function (evento, params) {
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: evento }, params || {}));
  } catch (e) {}
};

(function () {
  'use strict';
  var CHAVE = 'sucre_consent';

  function lerConsent() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (e) { return null; }
  }
  function gtagSafe() {
    if (typeof window.gtag === 'function') { window.gtag.apply(null, arguments); return; }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(arguments);
  }

  /* ---------- banner de consentimento ---------- */
  var banner = null;

  function ajustarZap() {
    var h = banner && !banner.hidden ? banner.offsetHeight : 0; // (offsetParent é null em position:fixed)
    document.documentElement.style.setProperty('--consent-h', h + 'px');
    document.body.classList.toggle('has-consent', h > 0);
  }

  function mostrarBanner() {
    if (banner) { banner.hidden = false; ajustarZap(); return; }
    banner = document.createElement('div');
    banner.className = 'consent';
    banner.id = 'consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'Preferências de cookies');
    banner.innerHTML =
      '<p class="consent__texto">Usamos cookies de medição (Google Analytics) e de mídia (Meta) pra entender o que funciona no site. Você escolhe. ' +
      '<a href="privacidade.html">Política de privacidade</a></p>' +
      '<div class="consent__acoes">' +
      '<button type="button" class="btn btn--primary consent__aceitar">Aceitar</button>' +
      '<button type="button" class="btn btn--ghost consent__essencial">Só o essencial</button>' +
      '</div>';
    document.body.appendChild(banner);
    banner.querySelector('.consent__aceitar').addEventListener('click', function () { responder(true); });
    banner.querySelector('.consent__essencial').addEventListener('click', function () { responder(false); });
    window.addEventListener('resize', ajustarZap);
    ajustarZap();
  }

  function fecharBanner() {
    if (banner) banner.hidden = true;
    ajustarZap();
  }

  function responder(aceitou) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify({ analytics: aceitou, ads: aceitou, data: new Date().toISOString() }));
    } catch (e) {}
    gtagSafe('consent', 'update', {
      ad_storage: aceitou ? 'granted' : 'denied',
      ad_user_data: aceitou ? 'granted' : 'denied',
      ad_personalization: aceitou ? 'granted' : 'denied',
      analytics_storage: aceitou ? 'granted' : 'denied'
    });
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'consent_update', consent_analytics: aceitou, consent_ads: aceitou });
    fecharBanner();
  }

  function iniciarBanner() {
    if (!lerConsent()) mostrarBanner();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarBanner);
  else iniciarBanner();

  /* ---------- cliques nos CTAs (um listener só, delegado) ---------- */
  function posicaoDe(a) {
    var s = a.closest('section');
    if (s) return s.id || (s.className || '').trim().split(/\s+/)[0] || 'section';
    var cls = (a.className || '').trim().split(/\s+/)[0];
    if (cls) return cls;
    var pai = a.closest('header, footer, nav');
    return pai ? pai.tagName.toLowerCase() : '';
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;

    if (a.id === 'abrir-consentimento') {
      e.preventDefault(); // só reabre o banner, não é link de navegação
      mostrarBanner();
      return;
    }

    var href = a.getAttribute('href') || '';
    var abs = a.href || '';
    var base = { posicao: posicaoDe(a), pagina: location.pathname };
    var caminho = '';
    try { caminho = new URL(abs, location.href).pathname; } catch (err) {}

    if (href.indexOf('https://wa.me/5585998620312') === 0) {
      window.track('btnclick_whatsapp', Object.assign({ whatsapp_tipo: 'delivery' }, base));
    } else if (href.indexOf('https://wa.me/5585999978713') === 0) {
      window.track('btnclick_whatsapp', Object.assign({ whatsapp_tipo: 'revenda' }, base));
    } else if (href.indexOf('instagram.com/') !== -1) {
      var m = href.match(/instagram\.com\/([^/?#]+)/);
      window.track('btnclick_instagram', Object.assign({ perfil: m ? m[1] : '' }, base));
    } else if (/onde-encontrar(\.html)?$/.test(href.split('#')[0].split('?')[0])) {
      window.track('btnclick_onde_comprar', base);
    } else if (/\/(minicoxinha|minipasteis|bolaco)(\.html)?$/.test(caminho)) {
      var p = caminho.match(/\/(minicoxinha|minipasteis|bolaco)(\.html)?$/);
      window.track('btnclick_produto', Object.assign({ produto: p[1] }, base));
    }
  });
})();
