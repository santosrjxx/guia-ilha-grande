import { visit } from 'unist-util-visit';

// Deixa o editor posicionar um Card de Estabelecimento/Produto no meio do texto sem
// precisar colar HTML: ele escreve um marcador sozinho num parágrafo (ex.: %%estabelecimento%%)
// e aqui a gente troca esse parágrafo pelo card renderizado, casando por ordem com a lista
// "estabelecimentos"/"produtos" do frontmatter (1º marcador -> 1º item da lista, 2º -> 2º...).
// Os dados do card continuam vivendo em campos de formulário do CMS (não em HTML solto no
// corpo) porque o Sveltia CMS não reconhece de volta um bloco de HTML já salvo como
// formulário editável ao reabrir o artigo (bug conhecido: github.com/sveltia/sveltia-cms/issues/410).
// Usamos %% em vez de {{ }} porque chaves são sintaxe reservada do MDX (viram uma expressão
// JS — {{estabelecimento}} quebra o build com "estabelecimento is not defined").

const MARKER_RE = /^%%\s*(estabelecimento|produto)\s*%%$/;

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TIPO_LUGAR_LABELS = {
  pousada: '🏨 Pousada',
  restaurante: '🍽️ Restaurante',
  hotel: '🏝️ Hotel',
};

function renderCardLugar(data) {
  let links = '';
  if (data.mapsUrl) {
    links += `<a class="btn-link" href="${escapeHtml(data.mapsUrl)}" rel="noopener noreferrer" target="_blank">📍 Ver no Mapa ↗</a>`;
  }
  if (data.bookingUrl) {
    links += `<a class="btn-link booking" href="${escapeHtml(data.bookingUrl)}" rel="sponsored noopener noreferrer" target="_blank">🛏️ Reservar no Booking ↗</a>`;
  }
  if (data.instagramUrl) {
    links += `<a class="btn-link insta" href="${escapeHtml(data.instagramUrl)}" rel="noopener noreferrer" target="_blank">📷 Ver no Instagram ↗</a>`;
  }
  return (
    '<div class="card-lugar">' +
    '<div class="foto-wrap">' +
    `<img src="${escapeHtml(data.foto || '')}" alt="${escapeHtml(data.fotoAlt || data.nome || '')}" loading="lazy" width="800" height="600" />` +
    `<span class="tipo-badge">${TIPO_LUGAR_LABELS[data.tipo] || '📍 Estabelecimento'}</span>` +
    '</div>' +
    '<div class="conteudo">' +
    `<h3>${escapeHtml(data.nome || '')}</h3>` +
    `<p class="descricao">${escapeHtml(data.descricao || '')}</p>` +
    `<div class="links">${links}</div>` +
    '</div>' +
    '</div>'
  );
}

const PROVIDER_INFO = {
  amazon: { cls: 'btn-loja--amazon', nome: 'amazon' },
  mercadoLivre: { cls: 'btn-loja--mercadolivre', nome: 'Mercado Livre' },
  booking: { cls: 'btn-loja--booking', nome: 'Booking.com' },
  rentcar: { cls: 'btn-loja--rentcar', nome: 'Rentcars' },
};

function renderCardProduto(data) {
  const lojas = (data.lojas || [])
    .map((loja) => {
      const info = PROVIDER_INFO[loja.provider];
      const cls = `btn-loja ${info ? info.cls : 'btn-loja--outro'}`;
      const nomeSpan = info ? `<span class="loja-nome">${info.nome}</span>` : '';
      return (
        `<a class="${cls}" href="${escapeHtml(loja.url || '#')}" rel="sponsored noopener noreferrer" target="_blank">` +
        `${nomeSpan}<span class="loja-cta">${escapeHtml(loja.label || 'Ver oferta')} ↗</span></a>`
      );
    })
    .join('');
  return (
    '<div class="card-produto">' +
    '<div class="foto-wrap">' +
    `<img src="${escapeHtml(data.foto || '')}" alt="${escapeHtml(data.fotoAlt || data.nome || '')}" loading="lazy" width="600" height="450" />` +
    (data.selo ? `<span class="tipo-badge">${escapeHtml(data.selo)}</span>` : '') +
    '</div>' +
    '<div class="conteudo">' +
    `<h3>${escapeHtml(data.nome || '')}</h3>` +
    `<p class="why">${escapeHtml(data.porque || '')}</p>` +
    `<div class="ctas">${lojas}</div>` +
    '<p class="disclosure">Link de afiliado — sem custo extra pra você.</p>' +
    '</div>' +
    '</div>'
  );
}

export default function remarkInlineCards() {
  return (tree, file) => {
    const frontmatter = file.data.astro?.frontmatter ?? {};
    const estabelecimentos = frontmatter.estabelecimentos ?? [];
    const produtos = frontmatter.produtos ?? [];
    let estabelecimentoIndex = 0;
    let produtoIndex = 0;

    visit(tree, 'paragraph', (node, index, parent) => {
      if (!parent || node.children?.length !== 1 || node.children[0].type !== 'text') return;
      const match = node.children[0].value.trim().match(MARKER_RE);
      if (!match) return;

      if (match[1] === 'estabelecimento') {
        const data = estabelecimentos[estabelecimentoIndex];
        estabelecimentoIndex += 1;
        if (!data) return;
        parent.children[index] = { type: 'html', value: renderCardLugar(data) };
      } else {
        const data = produtos[produtoIndex];
        produtoIndex += 1;
        if (!data) return;
        parent.children[index] = { type: 'html', value: renderCardProduto(data) };
      }
    });
  };
}
