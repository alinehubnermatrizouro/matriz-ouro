/* ============================================================================
   SERVIDOR MATRIZ OURO — atualização automática da Lotofácil (Caixa)
   ----------------------------------------------------------------------------
   O QUE FAZ:
   - Busca o ÚLTIMO concurso e os ÚLTIMOS 500 direto da API oficial da Caixa.
   - Guarda em cache (dados-lotofacil.json) e atualiza sozinho a cada 6 horas.
   - Expõe os dados para o app Matriz Ouro consumir automaticamente.

   REQUISITOS: Node.js 18 ou superior (usa fetch nativo).
   COMO RODAR:  npm install   →   npm start
   ============================================================================ */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const PORT   = process.env.PORT || 3000;
const CACHE  = path.join(__dirname, 'dados-lotofacil.json');
const API    = 'https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil';
const MANTER = 500;                       // quantos concursos manter na base
const HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };

const app = express();
app.use(cors());                          // libera o app (frontend) a consultar
// serve o app (index.html) na raiz — todos os arquivos ficam juntos, sem pasta
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// estrutura em memória: { ultimo:{numero,data,dezenas[]}, concursos:[...desc] }
let dados = { ultimo: null, concursos: [] };

try {
  if (fs.existsSync(CACHE)) dados = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
} catch (e) { console.error('Cache ilegível, começando do zero:', e.message); }

function salvar() {
  try { fs.writeFileSync(CACHE, JSON.stringify(dados)); }
  catch (e) { console.error('Erro ao salvar cache:', e.message); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Busca um concurso (numero=null → o último). Com timeout e até 3 tentativas. */
async function buscaConcurso(numero, tentativas = 3) {
  const url = numero ? `${API}/${numero}` : `${API}/`;
  for (let t = 1; t <= tentativas; t++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !Array.isArray(j.listaDezenas)) throw new Error('resposta sem dezenas');
      return {
        numero: j.numero,
        data:   j.dataApuracao,
        dezenas: j.listaDezenas.map(Number).sort((a, b) => a - b)
      };
    } catch (e) {
      if (t === tentativas) { console.error(`Falha no concurso ${numero || 'último'}: ${e.message}`); return null; }
      await sleep(800 * t);               // espera crescente entre tentativas
    }
  }
}

/* Atualiza a base: pega o último e completa até 500, pulando o que já existe. */
async function atualizar() {
  console.log(`[${new Date().toISOString()}] Atualizando base...`);
  const ultimo = await buscaConcurso(null);
  if (!ultimo) { console.error('Não consegui obter o último concurso agora. Tentarei de novo no próximo ciclo.'); return; }

  const alvoMin = Math.max(1, ultimo.numero - MANTER + 1);
  const jaTenho = new Set(dados.concursos.map(c => c.numero));
  const novos = [];

  for (let n = ultimo.numero; n >= alvoMin; n--) {
    if (jaTenho.has(n)) continue;                       // não rebaixa o que já temos
    const c = (n === ultimo.numero) ? ultimo : await buscaConcurso(n);
    if (c) { novos.push(c); if (n !== ultimo.numero) await sleep(350); } // pausa p/ não sobrecarregar a Caixa
  }

  const mapa = new Map(dados.concursos.map(c => [c.numero, c]));
  novos.forEach(c => mapa.set(c.numero, c));
  const lista = [...mapa.values()].sort((a, b) => b.numero - a.numero).slice(0, MANTER);

  dados = { ultimo: lista[0] || ultimo, concursos: lista };
  salvar();
  console.log(`OK: ${lista.length} concursos na base | último = ${dados.ultimo.numero} (${dados.ultimo.data})`);
}

/* -------- Endpoints que o app Matriz Ouro consome -------- */
app.get('/api/lotofacil', (req, res) => {
  if (!dados.ultimo) return res.status(503).json({ erro: 'Base ainda carregando, tente novamente em instantes.' });
  res.json(dados);                        // { ultimo, concursos:[...] }
});
app.get('/api/lotofacil/ultimo', (req, res) => {
  if (!dados.ultimo) return res.status(503).json({ erro: 'Carregando.' });
  res.json(dados.ultimo);
});
app.get('/api/status', (req, res) => {
  res.json({ ok: true, total: dados.concursos.length, ultimo: dados.ultimo ? dados.ultimo.numero : null });
});

app.listen(PORT, async () => {
  console.log(`Servidor Matriz Ouro rodando na porta ${PORT}`);
  await atualizar();                          // primeira carga ao subir
  setInterval(atualizar, 6 * 60 * 60 * 1000); // repete a cada 6h (pega o resultado novo após o sorteio)
});
