/* =========================================================
   SUCRÉ — localizador de pontos de venda
   Dados: data/pontos-de-venda.json (gerado por tools/build_pdv.py)
   Mapa: Leaflet + MarkerCluster (lib/leaflet), tiles OpenStreetMap
   ========================================================= */
(function () {
  'use strict';

  const UF_NOME = {
    AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
    ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
    PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
    RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins'
  };
  const BRASIL = { center: [-14.5, -47.5], zoom: 4 };

  const $ = (id) => document.getElementById(id);
  const el = { busca: $('f-busca'), uf: $('f-uf'), cidade: $('f-cidade'), tipo: $('f-tipo'), geo: $('btn-geo'), limpar: $('btn-limpar'),
               resultado: $('resultado'), lista: $('lista'), resumo: $('pdv-resumo'), data: $('pdv-data') };

  let pontos = [];
  let marcadores = {};      // id -> L.marker
  let ativo = null;         // id do ponto selecionado
  let minhaPos = null;      // [lat, lon] do usuário
  let meuMarcador = null;

  // ---------- utilidades ----------
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function distanciaKm(a, b) {
    const R = 6371, dLat = (b[0] - a[0]) * Math.PI / 180, dLon = (b[1] - a[1]) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const fmtDist = (km) => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`;

  function enderecoCompleto(p) {
    const partes = [];
    if (p.endereco) partes.push(p.endereco);
    if (p.bairro) partes.push(p.bairro);
    partes.push(`${p.cidade} - ${p.uf}`);
    if (p.cep) partes.push(`CEP ${p.cep}`);
    return partes.join(', ');
  }

  // "Como chegar": quando temos o ponto exato, mandamos as coordenadas;
  // quando é aproximado, mandamos o nome + cidade pro Google resolver.
  function linkRota(p) {
    const destino = p.prec === 'endereco' ? `${p.lat},${p.lon}` : `${p.nome}, ${p.bairro ? p.bairro + ', ' : ''}${p.cidade} - ${p.uf}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}`;
  }

  // ---------- mapa ----------
  const mapa = L.map('mapa', { zoomControl: true, scrollWheelZoom: true }).setView(BRASIL.center, BRASIL.zoom);
  // Tiles do OpenStreetMap (gratuitos, com atribuição). Pra usar o visual do Google Maps
  // seria preciso uma chave da API do Google (Google Cloud, com cobrança configurada).
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(mapa);

  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 48, spiderfyOnMaxZoom: true,
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const cls = n >= 100 ? 'cluster cluster--lg' : n >= 20 ? 'cluster cluster--md' : 'cluster';
      return L.divIcon({ html: `<div class="${cls}">${n}</div>`, className: '', iconSize: [62, 62] });
    }
  });
  mapa.addLayer(cluster);

  const iconePin = (p, ativoFlag) => L.divIcon({
    className: '', iconSize: [34, 34], iconAnchor: [17, 32], popupAnchor: [0, -30],
    html: `<div class="pin${p.tipo === 'Loja Sucré' ? ' pin--sucre' : ''}${ativoFlag ? ' pin--ativo' : ''}"></div>`
  });

  function popupHtml(p) {
    return `<p class="popup__nome">${esc(p.nome)}</p>
      <span class="chip${p.tipo === 'Loja Sucré' ? ' chip--sucre' : ''}">${esc(p.tipo)}</span>
      <p class="popup__end">${esc(enderecoCompleto(p))}${p.prec !== 'endereco' ? '<br><small>Localização aproximada no mapa</small>' : ''}</p>
      <a class="popup__rota" data-id="${p.id}" href="${linkRota(p)}" target="_blank" rel="noopener">Como chegar ↗</a>`;
  }

  // ---------- filtros ----------
  function popularSelect(select, valores, rotulo) {
    const atual = select.value;
    select.innerHTML = `<option value="">${rotulo}</option>` + valores.map((v) => `<option value="${esc(v.valor)}">${esc(v.texto)}</option>`).join('');
    if (valores.some((v) => v.valor === atual)) select.value = atual;
  }

  function montarFiltros() {
    const ufs = [...new Set(pontos.map((p) => p.uf))].sort((a, b) => (UF_NOME[a] || a).localeCompare(UF_NOME[b] || b, 'pt-BR'));
    popularSelect(el.uf, ufs.map((uf) => ({ valor: uf, texto: `${UF_NOME[uf] || uf} (${pontos.filter((p) => p.uf === uf).length})` })), 'Todos os estados');
    const tipos = [...new Set(pontos.map((p) => p.tipo))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    popularSelect(el.tipo, tipos.map((t) => ({ valor: t, texto: t })), 'Todos os tipos');
    montarCidades();
  }

  function montarCidades() {
    const uf = el.uf.value;
    if (!uf) { el.cidade.innerHTML = '<option value="">Todas</option>'; el.cidade.disabled = true; return; }
    const cidades = [...new Set(pontos.filter((p) => p.uf === uf).map((p) => p.cidade))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    popularSelect(el.cidade, cidades.map((c) => ({ valor: c, texto: c })), 'Todas as cidades');
    el.cidade.disabled = false;
  }

  function filtrar() {
    const q = norm(el.busca.value), uf = el.uf.value, cidade = el.cidade.value, tipo = el.tipo.value;
    let lista = pontos.filter((p) =>
      (!uf || p.uf === uf) && (!cidade || p.cidade === cidade) && (!tipo || p.tipo === tipo) &&
      (!q || norm(`${p.nome} ${p.rede} ${p.bairro} ${p.cidade} ${p.endereco}`).includes(q)));
    if (minhaPos) {
      lista.forEach((p) => { p._dist = distanciaKm(minhaPos, [p.lat, p.lon]); });
      lista.sort((a, b) => a._dist - b._dist);
    } else {
      lista.forEach((p) => { delete p._dist; });
      lista.sort((a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'));
    }
    return lista;
  }

  // ---------- render ----------
  function renderLista(lista) {
    if (!lista.length) {
      el.lista.innerHTML = '<li class="lista__vazio"><strong>Nada por aqui ainda 😢</strong>Tente outra cidade ou limpe os filtros. E no Ceará tem delivery!</li>';
      return;
    }
    const limite = 120; // evita renderizar centenas de cards de uma vez
    el.lista.innerHTML = lista.slice(0, limite).map((p) => `
      <li class="pdv-item${p.id === ativo ? ' is-active' : ''}" data-id="${p.id}" tabindex="0">
        <div class="pdv-item__top">
          <h3 class="pdv-item__nome">${esc(p.nome)}</h3>
          ${p._dist != null ? `<span class="pdv-item__dist">${fmtDist(p._dist)}</span>` : ''}
        </div>
        <span class="chip${p.tipo === 'Loja Sucré' ? ' chip--sucre' : ''}">${esc(p.tipo)}</span>
        <p class="pdv-item__end">${esc(enderecoCompleto(p))}</p>
        <div class="pdv-item__acoes">
          <a class="pdv-item__rota" href="${linkRota(p)}" target="_blank" rel="noopener">Como chegar ↗</a>
          ${p.prec !== 'endereco' ? '<span class="pdv-item__aprox">· local aproximado no mapa</span>' : ''}
        </div>
      </li>`).join('') + (lista.length > limite ? `<li class="lista__vazio">Mostrando ${limite} de ${lista.length}. Filtre por cidade pra ver todos.</li>` : '');
  }

  function renderMapa(lista) {
    cluster.clearLayers();
    marcadores = {};
    lista.forEach((p) => {
      const m = L.marker([p.lat, p.lon], { icon: iconePin(p, p.id === ativo), title: p.nome });
      m.bindPopup(popupHtml(p), { maxWidth: 280 });
      m.on('click', () => selecionar(p.id, { centrar: false }));
      marcadores[p.id] = m;
    });
    cluster.addLayers(Object.values(marcadores));
  }

  function enquadrar(lista) {
    if (!lista.length) { mapa.setView(BRASIL.center, BRASIL.zoom); return; }
    if (minhaPos) {
      const proximos = lista.slice(0, 8).map((p) => [p.lat, p.lon]);
      mapa.fitBounds(L.latLngBounds([minhaPos, ...proximos]), { padding: [40, 40], maxZoom: 14 });
      return;
    }
    const b = L.latLngBounds(lista.map((p) => [p.lat, p.lon]));
    mapa.fitBounds(b, { padding: [40, 40], maxZoom: lista.length === 1 ? 16 : 13 });
  }

  // ---------- medição (dataLayer via window.track, definido em tracking.js) ----------
  const track = (ev, params) => { if (typeof window.track === 'function') window.track(ev, params); };
  const dadosPonto = (p) => ({ pdv_id: p.id, pdv_nome: p.nome, pdv_rede: p.rede || '', pdv_tipo: p.tipo, cidade: p.cidade, uf: p.uf });
  let origemProxima = 'url';      // primeira chamada depois de lerEstado() = "url"; depois, "usuario"
  let ultimaLista = [];
  let ultimaBuscaEnviada = null;
  let tBusca;
  function termoBusca() {
    const termo = norm(el.busca.value).slice(0, 80);
    return (/@/.test(termo) || /\d{7,}/.test(termo)) ? '[removido]' : termo; // nada de e-mail ou telefone no GA
  }
  function emitirFiltro() {
    const busca = termoBusca();
    ultimaBuscaEnviada = busca;
    track('pdv_filtro', { uf: el.uf.value, cidade: el.cidade.value, tipo: el.tipo.value, busca, resultados: ultimaLista.length, origem: origemProxima });
    origemProxima = 'usuario';
  }

  function atualizar(opts = {}) {
    const lista = filtrar();
    ultimaLista = lista;
    const total = pontos.length;
    el.resultado.textContent = lista.length === total
      ? `${total} pontos de venda em todo o Brasil`
      : `${lista.length} ${lista.length === 1 ? 'ponto de venda encontrado' : 'pontos de venda encontrados'}`;
    renderLista(lista);
    renderMapa(lista);
    if (opts.enquadrar !== false) enquadrar(lista);
    salvarEstado();
    if (opts.fonte === 'busca') {
      // digitação: só envia 800 ms depois da última tecla e só se o termo mudou
      clearTimeout(tBusca);
      tBusca = setTimeout(() => { if (termoBusca() !== ultimaBuscaEnviada) emitirFiltro(); }, 800);
    } else {
      emitirFiltro();
    }
  }

  function selecionar(id, opts = {}) {
    ativo = id;
    const p = pontos.find((x) => x.id === id);
    if (!p) return;
    track('pdv_selecionar', dadosPonto(p));
    el.lista.querySelectorAll('.pdv-item').forEach((li) => li.classList.toggle('is-active', li.dataset.id === id));
    Object.entries(marcadores).forEach(([k, m]) => m.setIcon(iconePin(pontos.find((x) => x.id === k), k === id)));
    const m = marcadores[id];
    if (!m) return;
    if (opts.centrar !== false) {
      cluster.zoomToShowLayer(m, () => { mapa.panTo(m.getLatLng()); m.openPopup(); });
      if (window.innerWidth <= 900) document.getElementById('mapa').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      const li = el.lista.querySelector(`.pdv-item[data-id="${id}"]`);
      if (li && window.innerWidth > 900) li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ---------- geolocalização ----------
  function pertoDeMim() {
    if (!navigator.geolocation) { alert('Seu navegador não permite usar a localização.'); return; }
    el.geo.classList.add('is-busy'); el.geo.textContent = 'Localizando…';
    navigator.geolocation.getCurrentPosition((pos) => {
      minhaPos = [pos.coords.latitude, pos.coords.longitude];
      el.uf.value = ''; el.cidade.value = ''; montarCidades();
      if (meuMarcador) mapa.removeLayer(meuMarcador);
      meuMarcador = L.marker(minhaPos, { icon: L.divIcon({ className: '', html: '<div class="pin--eu"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), title: 'Você está aqui', zIndexOffset: 1000 }).addTo(mapa);
      el.geo.classList.remove('is-busy'); el.geo.innerHTML = '📍 Perto de mim';
      track('pdv_geo', { resultado: 'ok' });
      atualizar();
    }, () => {
      el.geo.classList.remove('is-busy'); el.geo.textContent = 'Perto de mim';
      track('pdv_geo', { resultado: 'negado' });
      alert('Não conseguimos acessar sua localização. Você pode buscar pela cidade.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  // ---------- estado na URL (#uf=CE&cidade=Fortaleza) ----------
  function salvarEstado() {
    const q = new URLSearchParams();
    if (el.uf.value) q.set('uf', el.uf.value);
    if (el.cidade.value) q.set('cidade', el.cidade.value);
    if (el.tipo.value) q.set('tipo', el.tipo.value);
    if (el.busca.value) q.set('q', el.busca.value);
    const h = q.toString();
    history.replaceState(null, '', location.pathname + location.search + (h ? `#${h}` : ''));
  }
  function lerEstado() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (q.get('uf')) { el.uf.value = q.get('uf'); montarCidades(); }
    if (q.get('cidade')) el.cidade.value = q.get('cidade');
    if (q.get('tipo')) el.tipo.value = q.get('tipo');
    if (q.get('q')) el.busca.value = q.get('q');
  }

  // ---------- eventos ----------
  el.uf.addEventListener('change', () => { montarCidades(); minhaPos = null; atualizar(); });
  el.cidade.addEventListener('change', () => atualizar());
  el.tipo.addEventListener('change', () => atualizar());
  let t; el.busca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => atualizar({ fonte: 'busca' }), 220); });
  $('filtros').addEventListener('submit', (e) => { e.preventDefault(); atualizar(); });
  el.geo.addEventListener('click', pertoDeMim);
  el.limpar.addEventListener('click', () => {
    track('pdv_limpar');
    el.busca.value = ''; el.uf.value = ''; el.tipo.value = ''; montarCidades(); minhaPos = null; ativo = null;
    if (meuMarcador) { mapa.removeLayer(meuMarcador); meuMarcador = null; }
    el.geo.textContent = 'Perto de mim';
    atualizar();
  });
  el.lista.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const li = e.target.closest('.pdv-item'); if (li) selecionar(li.dataset.id);
  });
  // "Como chegar": delegação na lista e no mapa (o popup do Leaflet é criado dinamicamente). Sem preventDefault: o link segue abrindo.
  el.lista.addEventListener('click', (e) => {
    const a = e.target.closest('a.pdv-item__rota'); if (!a) return;
    const li = a.closest('.pdv-item'); const p = li && pontos.find((x) => x.id === li.dataset.id);
    if (p) track('btnclick_rota', dadosPonto(p));
  });
  document.getElementById('mapa').addEventListener('click', (e) => {
    const a = e.target.closest('a.popup__rota'); if (!a) return;
    const p = pontos.find((x) => x.id === a.dataset.id);
    if (p) track('btnclick_rota', dadosPonto(p));
  });
  const mapToggle = document.getElementById('map-toggle');
  if (mapToggle) mapToggle.addEventListener('click', () => {
    const lista = mapToggle.getAttribute('aria-expanded') !== 'true';
    mapToggle.setAttribute('aria-expanded', lista ? 'true' : 'false');
    mapToggle.textContent = lista ? 'Ver mapa' : 'Ver lista';
    track('pdv_toggle', { modo: lista ? 'lista' : 'mapa' });
  });
  el.lista.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const li = e.target.closest('.pdv-item'); if (li) { e.preventDefault(); selecionar(li.dataset.id); }
  });

  // ---------- carga ----------
  fetch('data/pontos-de-venda.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((dados) => {
      pontos = dados.pontos.filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number');
      const ufs = new Set(pontos.map((p) => p.uf)), cidades = new Set(pontos.map((p) => `${p.cidade}/${p.uf}`));
      el.resumo.textContent = `São ${pontos.length} pontos de venda em ${cidades.size} cidades de ${ufs.size} estados.`;
      if (el.data) el.data.textContent = dados.atualizado ? dados.atualizado.split('-').reverse().join('/') : '';
      montarFiltros();
      lerEstado();
      atualizar();
    })
    .catch((err) => {
      console.error('Falha ao carregar pontos de venda', err);
      el.resultado.textContent = 'Não conseguimos carregar os pontos de venda agora. Tente de novo em instantes.';
    });
})();
