/* SERVIDOR MATRIZ OURO v2 - atualizacao automatica da Lotofacil (Caixa)
   Versao reforcada: cabecalhos de navegador, mais tentativas, timeout maior,
   e fonte de reserva (espelho publico) caso a Caixa recuse.
   Requisitos: Node 18+. Rodar: npm install -> npm start */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const PORT   = process.env.PORT || 3000;
const CACHE  = path.join(__dirname, 'dados-lotofacil.json');
const API    = 'https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil';
const MANTER = 500;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Referer': 'https://loterias.caixa.gov.br/'
};

const app = express();
app.use(cors());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let dados = { ultimo: null, concursos: [] };
try { if (fs.existsSync(CACHE)) dados = JSON.parse(fs.readFileSync(CACHE, 'utf8')); }
catch (e) { console.error('Cache ilegivel:', e.message); }

function salvar() { try { fs.writeFileSync(CACHE, JSON.stringify(dados)); } catch (e) { console.error('Erro cache:', e.message); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, tentativas) {
  tentativas = tentativas || 4;
  for (let t = 1; t <= tentativas; t++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      console.error('  tentativa ' + t + '/' + tentativas + ' falhou: ' + e.message);
      if (t === tentativas) return null;
      await sleep(1200 * t);
    }
  }
}

function normaliza(j) {
  if (!j || !Array.isArray(j.listaDezenas)) return null;
  return { numero: j.numero, data: j.dataApuracao, dezenas: j.listaDezenas.map(Number).sort((a,b)=>a-b) };
}

async function tentaEspelho() {
  console.log('Caixa indisponivel - tentando fonte de reserva...');
  const j = await fetchJson('https://raw.githubusercontent.com/guilhermeasn/loteria.json/master/data/lotofacil.json', 2);
  if (!j) return false;
  try {
    const arr = Object.keys(j).map(function (k) {
      return { numero: parseInt(k), data: (j[k].data || ''), dezenas: (j[k].dezenas || j[k]).map(Number).sort((a,b)=>a-b) };
    }).filter(function (c) { return c.dezenas.length === 15; })
      .sort(function (a, b) { return b.numero - a.numero; }).slice(0, MANTER);
    if (!arr.length) return false;
    dados = { ultimo: arr[0], concursos: arr };
    salvar();
    console.log('Reserva OK: ' + arr.length + ' concursos. Ultimo = ' + dados.ultimo.numero);
    return true;
  } catch (e) { console.error('Espelho falhou:', e.message); return false; }
}

async function atualizar() {
  console.log('Atualizando via Caixa...');
  const ult = normaliza(await fetchJson(API + '/'));
  if (!ult) { await tentaEspelho(); return; }
  const alvoMin = Math.max(1, ult.numero - MANTER + 1);
  const jaTenho = new Set(dados.concursos.map(function (c) { return c.numero; }));
  const novos = [];
  for (let n = ult.numero; n >= alvoMin; n--) {
    if (jaTenho.has(n)) continue;
    const c = (n === ult.numero) ? ult : normaliza(await fetchJson(API + '/' + n));
    if (c) { novos.push(c); if (n !== ult.numero) await sleep(300); }
  }
  const mapa = new Map(dados.concursos.map(function (c) { return [c.numero, c]; }));
  novos.forEach(function (c) { mapa.set(c.numero, c); });
  const lista = Array.from(mapa.values()).sort(function (a, b) { return b.numero - a.numero; }).slice(0, MANTER);
  dados = { ultimo: lista[0] || ult, concursos: lista };
  salvar();
  console.log('Caixa OK: ' + lista.length + ' concursos | ultimo = ' + dados.ultimo.numero);
}

app.get('/api/lotofacil', function (req, res) {
  if (!dados.ultimo) return res.status(503).json({ erro: 'Base carregando.' });
  res.json(dados);
});
app.get('/api/lotofacil/ultimo', function (req, res) {
  if (!dados.ultimo) return res.status(503).json({ erro: 'Carregando.' });
  res.json(dados.ultimo);
});
app.get('/api/status', function (req, res) {
  res.json({ ok: true, total: dados.concursos.length, ultimo: dados.ultimo ? dados.ultimo.numero : null });
});
app.get('/api/atualizar', function (req, res) {
  atualizar();
  res.json({ iniciado: true });
});

app.listen(PORT, async function () {
  console.log('Servidor Matriz Ouro v2 na porta ' + PORT);
  await atualizar();
  setInterval(atualizar, 6 * 60 * 60 * 1000);
});
